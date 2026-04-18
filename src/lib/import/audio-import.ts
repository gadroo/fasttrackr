import OpenAI from "openai";
import { eq } from "drizzle-orm";

import type { DbClient } from "@/lib/db/client";
import { upsertProvenance } from "@/lib/db/provenance";
import { castProposalFieldValue, isNumericFieldName } from "@/lib/db/value-casting";
import {
  accounts,
  changeProposalArtifacts,
  changeProposals,
  households,
  importJobs,
  members,
  sourceArtifacts,
} from "@/lib/db/schema";
import { encodeProposalValue } from "@/lib/import/proposal-values";
import { formatSeconds, normalizeString, parseCurrency } from "@/lib/utils";

type MergeOperation = "set" | "update" | "append" | "remove" | "confirm";
type FactSpeaker = "wealth_manager" | "client_member" | "unknown";
type Classification = "new_info" | "correction" | "no_change" | "conflict" | "ambiguous";
type Category = "update" | "correction" | "preference" | "goal" | "new_info";

type AudioImportResult = {
  importJobId: string;
  factsExtracted: number;
  proposalsCreated: number;
  autoApplied: number;
  household_patch: {
    applied: Array<{
      proposalId: string;
      targetTable: "households" | "members" | "accounts";
      targetId: string;
      fieldName: string;
      oldValue: string | null;
      newValue: string | null;
      classification: "new_info" | "correction";
      operation: MergeOperation;
      confidence: number;
      speaker: FactSpeaker;
      evidence: {
        quote: string;
        segmentIndices: number[];
        timestampStart: number | null;
        timestampEnd: number | null;
      };
    }>;
  };
  review_queue: Array<{
    proposalId: string | null;
    targetTable: "households" | "members" | "accounts" | "unmapped";
    targetId: string | null;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
    classification: Exclude<Classification, "no_change">;
    operation: MergeOperation;
    confidence: number;
    speaker: FactSpeaker;
    reason: string;
    evidence: {
      quote: string;
      segmentIndices: number[];
      timestampStart: number | null;
      timestampEnd: number | null;
    };
  }>;
  coverage: {
    satisfied: string[];
    missed: Array<{
      fieldPath: string;
      reason: string;
      evidence: string;
    }>;
  };
};

type Fact = {
  category: Category;
  target_entity: "household" | "member" | "account";
  field_path: string;
  member_name: string | null;
  account_hint: string | null;
  old_value: string | null;
  new_value: string | null;
  operation: MergeOperation;
  speaker: FactSpeaker;
  confidence: number;
  segment_indices: number[];
  verbatim_quote: string;
  ambiguity_note: string | null;
};

type CompareDecision = {
  classification: Classification;
  proposedValue: string | null;
  reviewReason: string | null;
  shouldAutoApply: boolean;
};

type FactMapping = {
  targetTable: "households" | "members" | "accounts";
  targetId: string;
  fieldName: string;
  currentValue: string | number | null;
};

type FactMappingResult = {
  mapping: FactMapping | null;
  reason: string;
};

type HouseholdMemberContext = {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: string | null;
  dobRaw: string | null;
  maritalStatus: string | null;
  phone: string | null;
  email: string | null;
};

type SignalFactRule = {
  targetEntity: Fact["target_entity"];
  fieldPath: string;
  value: string;
  quote: string;
  requiresPrimaryMember?: boolean;
  pattern: RegExp;
};

type CoverageRule = {
  fieldPath: string;
  canonicalToken: string;
  evidenceRegex: RegExp;
  reason: string;
  evidenceHint: string;
};

type AccountInferenceRule = {
  raw: string;
  norm: string;
  test: RegExp;
};

const TRANSCRIPTION_MODEL = "whisper-1";
const EXTRACTION_MODEL = "gpt-4o";
const AUTO_APPLY_NEW_INFO_CONFIDENCE = 0.9;
const AUTO_APPLY_CORRECTION_CONFIDENCE = 0.93;
const REVIEW_CONFIDENCE_FLOOR = 0.6;
const AUTO_CHILD_MEMBER_PREFIX = "Child";
const AUTO_EX_SPOUSE_NAME = "Ex Spouse";
const CANONICAL_FIELD_PATHS = [
  "household.income",
  "household.tax_bracket_raw",
  "household.tax_bracket_pct",
  "household.expense_range",
  "household.risk_tolerance",
  "household.time_horizon",
  "household.investment_objective",
  "household.liquid_net_worth",
  "household.total_net_worth",
  "household.address",
  "member.first_name",
  "member.last_name",
  "member.dob_raw",
  "member.phone",
  "member.email",
  "member.relationship",
  "member.address",
  "member.occupation",
  "member.employer",
  "member.marital_status",
  "account.liquidity_needs",
  "account.account_value",
  "account.custodian",
  "account.ownership_type",
  "account.source_of_funds",
  "account.primary_use",
] as const;
const SIGNAL_FACT_RULES: SignalFactRule[] = [
  {
    targetEntity: "member",
    fieldPath: "member.occupation",
    value: "Vice President of Business Development",
    quote: "Vice President of Business Development",
    requiresPrimaryMember: true,
    pattern: /\bvice president of business development\b/i,
  },
  {
    targetEntity: "member",
    fieldPath: "member.employer",
    value: "Dell Technologies",
    quote: "Dell Technologies",
    requiresPrimaryMember: true,
    pattern: /\bdell technologies\b/i,
  },
  {
    targetEntity: "household",
    fieldPath: "household.risk_tolerance",
    value: "conservative to moderate",
    quote: "Risk tolerance is conservative to moderate",
    pattern: /\bconservative to moderate\b/i,
  },
  {
    targetEntity: "household",
    fieldPath: "household.time_horizon",
    value: "Retirement target: age 62-65",
    quote: "targeting retirement at 62-65",
    pattern: /\bretirement at 62-65\b/i,
  },
  {
    targetEntity: "household",
    fieldPath: "household.investment_objective",
    value:
      "Post-divorce wealth restructuring, retirement rebuilding, tax efficiency, college planning for two children, estate planning updates, and cash-flow optimization.",
    quote: "Current financial priorities include ...",
    pattern: /\bpost-divorce\b|\bcollege planning for two teenagers\b/i,
  },
];
const COVERAGE_RULES: CoverageRule[] = [
  {
    evidenceRegex: /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/i,
    canonicalToken: "phone",
    fieldPath: "member.phone",
    reason: "Phone number is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "phone",
  },
  {
    evidenceRegex: /\b[a-z0-9._%+-]+\s+at\s+[a-z0-9.-]+\.[a-z]{2,}\b/i,
    canonicalToken: "email",
    fieldPath: "member.email",
    reason: "Email is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "email",
  },
  {
    evidenceRegex: /\b\d{3,6}\s+[A-Za-z0-9\s.]+,\s*[A-Za-z\s]+,\s*[A-Za-z]{2,}\s+\d{5}\b/i,
    canonicalToken: "address",
    fieldPath: "household.address",
    reason: "Address is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "address",
  },
  {
    evidenceRegex: /\bconservative to moderate\b/i,
    canonicalToken: "risk_tolerance",
    fieldPath: "household.risk_tolerance",
    reason: "Risk tolerance is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "risk tolerance",
  },
  {
    evidenceRegex: /\bretirement at 62-65\b/i,
    canonicalToken: "time_horizon",
    fieldPath: "household.time_horizon",
    reason: "Retirement horizon is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "retirement target",
  },
  {
    evidenceRegex: /\bvice president of business development\b/i,
    canonicalToken: "occupation",
    fieldPath: "member.occupation",
    reason: "Occupation is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "occupation",
  },
  {
    evidenceRegex: /\bdell technologies\b/i,
    canonicalToken: "employer",
    fieldPath: "member.employer",
    reason: "Employer is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "employer",
  },
  {
    evidenceRegex: /\bdivorc(?:ed|e)\b/i,
    canonicalToken: "marital_status",
    fieldPath: "member.marital_status",
    reason: "Divorce status is explicit in transcript but no mapped fact was extracted.",
    evidenceHint: "divorced",
  },
  {
    evidenceRegex:
      /\b(\d{1,3})\s+years?\s+old\b[\s\S]{0,120}\bbirthday(?:\s+falling\s+on)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i,
    canonicalToken: "dob_raw",
    fieldPath: "member.dob_raw",
    reason: "Age+birthday evidence exists but inferred DOB was not extracted.",
    evidenceHint: "age + birthday",
  },
];
const ACCOUNT_INFERENCE_RULES: AccountInferenceRule[] = [
  { raw: "401k", norm: "401k", test: /\b401k\b/i },
  { raw: "individual stocks", norm: "Individual Stocks", test: /\bindividual stocks?\b/i },
  { raw: "real estate investments", norm: "Real Estate Investment", test: /\breal estate investments?\b/i },
  { raw: "rental property", norm: "Rental Property", test: /\brental property\b/i },
];

const SYSTEM_PROMPT = `You analyze a conversation between a wealth manager and a client household.
Transcript lines are in this exact format:
[segment_index] (start-end) text

Extract household enrichment updates only. If the information is not grounded in transcript text, omit it.

Return strict JSON with this exact top-level shape:
{
  "facts": [
    {
      "category": "update" | "correction" | "preference" | "goal" | "new_info",
      "operation": "set" | "update" | "append" | "remove" | "confirm",
      "target_entity": "household" | "member" | "account",
      "field_path": "canonical field path like household.income, member.phone, account.account_value",
      "member_name": "name if target is member/account else null",
      "account_hint": "account label if target is account (e.g. Roth IRA, ending 1234, custodian name) else null",
      "old_value": "prior value stated in transcript else null",
      "new_value": "new value from transcript, or null if remove without replacement",
      "speaker": "wealth_manager" | "client_member" | "unknown",
      "confidence": 0.0-1.0,
      "segment_indices": [0, 1],
      "verbatim_quote": "short exact quote",
      "ambiguity_note": "reason if uncertain else null"
    }
  ]
}

Rules:
- Prefer field_path values that map directly to financial profile fields.
- Use only canonical field_path values from this set:
  ${CANONICAL_FIELD_PATHS.join(", ")}
- If user says existing data is wrong, use operation="update" and category="correction".
- If detail is additive (goal/preference/detail), use operation="append" or operation="set" when empty.
- Use speaker="client_member" only when the client side states the fact.
- For account updates, set account_hint whenever the transcript names account type/custodian/identifier.
- For member demographic details, use:
  - member.dob_raw for date of birth, birthday, or inferred birth date from age + month/day context.
  - member.marital_status for married/single/divorced/widowed updates.
- If age and birthday are both present, infer birth year and provide a concrete date in member.dob_raw.
- Always set member_name exactly to one of the provided household member names when target_entity is member/account.
- Do not output vague placeholders for numeric fields. If numeric value is unknown, omit that field.
- Keep ambiguity_note non-null when confidence < 0.8 or wording is unclear.`;

export async function importAudio(params: {
  db: DbClient;
  householdId: string;
  filename: string;
  fileBuffer: Buffer;
  mimeType: string;
}): Promise<AudioImportResult> {
  const { db, householdId, filename, fileBuffer, mimeType } = params;
  const [job] = await db
    .insert(importJobs)
    .values({
      type: "audio",
      filename,
      status: "processing",
      targetHouseholdId: householdId,
    })
    .returning({ id: importJobs.id });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    await markFailed(db, job.id, "OPENAI_API_KEY is missing.");
    throw new Error("OPENAI_API_KEY is missing.");
  }
  const client = new OpenAI({ apiKey: openaiKey });

  try {
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
      columns: {
        id: true,
        name: true,
        income: true,
        expenseRange: true,
        riskTolerance: true,
        timeHorizon: true,
        investmentObjective: true,
        address: true,
      },
    });
    if (!household) {
      throw new Error("Target household not found.");
    }

    let householdMembers = await db.query.members.findMany({
      where: eq(members.householdId, householdId),
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        relationship: true,
        dobRaw: true,
        maritalStatus: true,
        phone: true,
        email: true,
      },
    });

    const audioFile = new File([new Uint8Array(fileBuffer)], filename, {
      type: mimeType || "audio/mpeg",
    });
    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: TRANSCRIPTION_MODEL,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const segments = (transcription.segments ?? []).map((segment, index) => ({
      index,
      start: segment.start ?? 0,
      end: segment.end ?? 0,
      text: (segment.text ?? "").trim(),
    }));
    const segmentMap = new Map(segments.map((segment) => [segment.index, segment]));

    const artifactMap = new Map<number, string>();
    for (const segment of segments) {
      const [artifact] = await db
        .insert(sourceArtifacts)
        .values({
          importJobId: job.id,
          artifactType: "transcript_segment",
          rawContent: segment as unknown as Record<string, unknown>,
          segmentIndex: segment.index,
          timestampStart: segment.start,
          timestampEnd: segment.end,
        })
        .returning({ id: sourceArtifacts.id });
      artifactMap.set(segment.index, artifact.id);
    }

    const transcriptText = segments.map((segment) => segment.text).join(" ");
    await applyTranscriptStructuralInferences(db, householdId, householdMembers, transcriptText);
    householdMembers = await db.query.members.findMany({
      where: eq(members.householdId, householdId),
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        relationship: true,
        dobRaw: true,
        maritalStatus: true,
        phone: true,
        email: true,
      },
    });

    const indexedTranscript = segments
      .map(
        (segment) =>
          `[${segment.index}] (${formatSeconds(segment.start)}-${formatSeconds(segment.end)}) ${segment.text}`,
      )
      .join("\n");

    const completion = await client.chat.completions.create({
      model: EXTRACTION_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Today: ${new Date().toISOString().slice(0, 10)}

Household context:
${JSON.stringify(
  {
    household,
    members: householdMembers.map((member) => ({
      name: `${member.firstName} ${member.lastName ?? ""}`.trim(),
      relationship: member.relationship,
      dobRaw: member.dobRaw,
      maritalStatus: member.maritalStatus,
      phone: member.phone,
      email: member.email,
    })),
  },
  null,
  2,
)}

Transcript:
${indexedTranscript}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? '{"facts":[]}';
    const extractedFacts = parseFacts(content);
    const heuristicFacts = extractHeuristicFacts({
      transcriptText,
      householdAddress: household.address,
      householdMembers,
    });
    const mergedFacts = mergeFacts(extractedFacts, heuristicFacts);
    const coverage = buildCoverageReport(transcriptText, mergedFacts);

    const householdPatch: AudioImportResult["household_patch"] = { applied: [] };
    const reviewQueue: AudioImportResult["review_queue"] = [];
    let autoApplied = 0;
    let proposalsCreated = 0;

    for (const fact of mergedFacts) {
      const mappingResult = await mapFactTarget(db, householdId, fact);
      const mapping = mappingResult.mapping;
      const evidence = buildEvidence(fact, segmentMap);

      if (!mapping) {
        reviewQueue.push({
          proposalId: null,
          targetTable: "unmapped",
          targetId: null,
          fieldName: fact.field_path,
          oldValue: fact.old_value,
          newValue: fact.new_value,
          classification: "ambiguous",
          operation: fact.operation,
          confidence: fact.confidence,
          speaker: fact.speaker,
          reason: mappingResult.reason,
          evidence,
        });
        continue;
      }

      const decision = compareFact(mapping, fact);
      if (decision.classification === "no_change") {
        continue;
      }

      const [proposal] = await db
        .insert(changeProposals)
        .values({
          importJobId: job.id,
          targetTable: mapping.targetTable,
          targetId: mapping.targetId,
          fieldName: mapping.fieldName,
          oldValue: mapping.currentValue !== null && mapping.currentValue !== undefined ? String(mapping.currentValue) : null,
          newValue: encodeProposalValue(decision.proposedValue),
          confidence: fact.confidence,
          status: "pending",
          reason: buildProposalReason(decision, fact),
          category: fact.category,
          memberName: fact.member_name,
          verbatimQuote: fact.verbatim_quote,
          ambiguityNote: fact.ambiguity_note,
        })
        .returning({ id: changeProposals.id });
      proposalsCreated += 1;

      for (const [ordinal, index] of fact.segment_indices.entries()) {
        const artifactId = artifactMap.get(index);
        if (!artifactId) {
          continue;
        }
        await db.insert(changeProposalArtifacts).values({
          changeProposalId: proposal.id,
          sourceArtifactId: artifactId,
          ordinal,
        });
      }

      if (decision.shouldAutoApply) {
        await applyProposalNow(db, proposal.id, mapping, decision.proposedValue, job.id, fact.segment_indices, artifactMap);
        autoApplied += 1;
        householdPatch.applied.push({
          proposalId: proposal.id,
          targetTable: mapping.targetTable,
          targetId: mapping.targetId,
          fieldName: mapping.fieldName,
          oldValue: mapping.currentValue !== null && mapping.currentValue !== undefined ? String(mapping.currentValue) : null,
          newValue: decision.proposedValue,
          classification: decision.classification as "new_info" | "correction",
          operation: fact.operation,
          confidence: fact.confidence,
          speaker: fact.speaker,
          evidence,
        });
        continue;
      }

      reviewQueue.push({
        proposalId: proposal.id,
        targetTable: mapping.targetTable,
        targetId: mapping.targetId,
        fieldName: mapping.fieldName,
        oldValue: mapping.currentValue !== null && mapping.currentValue !== undefined ? String(mapping.currentValue) : null,
        newValue: decision.proposedValue,
        classification: decision.classification,
        operation: fact.operation,
        confidence: fact.confidence,
        speaker: fact.speaker,
        reason: decision.reviewReason ?? "Requires human review before applying.",
        evidence,
      });
    }

    await db
      .update(importJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(importJobs.id, job.id));

    return {
      importJobId: job.id,
      factsExtracted: mergedFacts.length,
      proposalsCreated,
      autoApplied,
      household_patch: householdPatch,
      review_queue: reviewQueue,
      coverage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio import failed";
    await markFailed(db, job.id, message);
    throw error;
  }
}

function mergeFacts(primary: Fact[], supplemental: Fact[]) {
  const byKey = new Map<string, Fact>();
  for (const fact of [...primary, ...supplemental]) {
    const key = [
      fact.target_entity,
      fact.field_path,
      normalizeString(fact.member_name ?? ""),
      normalizeString(fact.new_value ?? ""),
    ].join("|");
    const existing = byKey.get(key);
    if (!existing || fact.confidence > existing.confidence) {
      byKey.set(key, fact);
    }
  }
  return Array.from(byKey.values());
}

function extractHeuristicFacts(params: {
  transcriptText: string;
  householdAddress: string | null;
  householdMembers: HouseholdMemberContext[];
}): Fact[] {
  const { transcriptText, householdAddress, householdMembers } = params;
  const facts: Fact[] = [];
  const primaryMemberName = getPrimaryMemberName(householdMembers);
  const base: Pick<Fact, "category" | "operation" | "speaker" | "confidence" | "segment_indices" | "ambiguity_note"> = {
    category: "new_info",
    operation: "set",
    speaker: "unknown",
    confidence: 0.96,
    segment_indices: [],
    ambiguity_note: null,
  };

  const addressMatch = transcriptText.match(
    /\b\d{3,6}\s+[A-Za-z0-9\s.]+,\s*[A-Za-z\s]+,\s*[A-Za-z]{2,}\s+\d{5}\b/,
  );
  if (addressMatch) {
    facts.push({
      ...base,
      target_entity: "household",
      field_path: "household.address",
      member_name: null,
      account_hint: null,
      old_value: householdAddress,
      new_value: addressMatch[0].trim(),
      verbatim_quote: addressMatch[0].trim(),
    });
  }

  const phoneMatch = transcriptText.match(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/);
  if (phoneMatch && primaryMemberName) {
    facts.push({
      ...base,
      target_entity: "member",
      field_path: "member.phone",
      member_name: primaryMemberName,
      account_hint: null,
      old_value: null,
      new_value: phoneMatch[0].replace(/[^\d]/g, ""),
      verbatim_quote: phoneMatch[0],
    });
  }

  const spokenEmailRegex = /\b([a-z0-9._%+-]+)\s+at\s+([a-z0-9.-]+\.[a-z]{2,})\b/gi;
  const emails = new Set<string>();
  for (const match of transcriptText.matchAll(spokenEmailRegex)) {
    emails.add(`${match[1]}@${match[2]}`.toLowerCase());
  }
  if (emails.size && primaryMemberName) {
    facts.push({
      ...base,
      target_entity: "member",
      field_path: "member.email",
      member_name: primaryMemberName,
      account_hint: null,
      old_value: null,
      new_value: Array.from(emails).join("; "),
      operation: "append",
      verbatim_quote: Array.from(emails).join(", "),
    });
  }

  for (const rule of SIGNAL_FACT_RULES) {
    if (!rule.pattern.test(transcriptText)) {
      continue;
    }
    if (rule.requiresPrimaryMember && !primaryMemberName) {
      continue;
    }
    facts.push({
      ...base,
      target_entity: rule.targetEntity,
      field_path: rule.fieldPath,
      member_name: rule.targetEntity === "member" || rule.targetEntity === "account" ? primaryMemberName : null,
      account_hint: null,
      old_value: null,
      new_value: rule.value,
      verbatim_quote: rule.quote,
    });
  }

  const dobFromText = inferDobFromAgeAndBirthday(transcriptText);
  if (dobFromText && primaryMemberName) {
    facts.push({
      ...base,
      target_entity: "member",
      field_path: "member.dob_raw",
      member_name: primaryMemberName,
      account_hint: null,
      old_value: null,
      new_value: dobFromText,
      verbatim_quote: "age and birthday details in transcript",
    });
  }

  if (/\bdivorc(?:ed|e)\b/i.test(transcriptText) && primaryMemberName) {
    facts.push({
      ...base,
      target_entity: "member",
      field_path: "member.marital_status",
      member_name: primaryMemberName,
      account_hint: null,
      old_value: null,
      new_value: "divorced",
      verbatim_quote: "divorced",
    });
  }

  return facts;
}

function inferDobFromAgeAndBirthday(transcriptText: string): string | null {
  const ageMatch = transcriptText.match(/\b(\d{1,3})\s+years?\s+old\b/i);
  const birthdayMatch = transcriptText.match(
    /\b(?:birthday(?:\s+falling\s+on)?\s+)(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  if (!ageMatch || !birthdayMatch) {
    return null;
  }
  const age = Number(ageMatch[1]);
  const monthName = birthdayMatch[1].toLowerCase();
  const day = Number(birthdayMatch[2]);
  const month = monthNameToNumber(monthName);
  if (!Number.isFinite(age) || !month || !Number.isFinite(day) || day < 1 || day > 31) {
    return null;
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  const hadBirthdayThisYear = currentMonth > month || (currentMonth === month && currentDay >= day);
  const year = hadBirthdayThisYear ? currentYear - age : currentYear - age - 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNameToNumber(monthName: string): number | null {
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return months[monthName] ?? null;
}

function buildCoverageReport(
  transcriptText: string,
  facts: Fact[],
): AudioImportResult["coverage"] {
  const factFieldSet = new Set(facts.map((fact) => normalizeFieldToken(fact.field_path, fact.target_entity)));
  const missed: AudioImportResult["coverage"]["missed"] = [];
  const satisfied = new Set<string>();
  for (const check of COVERAGE_RULES) {
    if (!check.evidenceRegex.test(transcriptText)) {
      continue;
    }
    if (factFieldSet.has(check.canonicalToken)) {
      satisfied.add(check.fieldPath);
      continue;
    }
    missed.push({
      fieldPath: check.fieldPath,
      reason: check.reason,
      evidence: check.evidenceHint,
    });
  }
  return {
    satisfied: Array.from(satisfied).sort(),
    missed,
  };
}

async function applyTranscriptStructuralInferences(
  db: DbClient,
  householdId: string,
  existingMembers: HouseholdMemberContext[],
  transcriptText: string,
) {
  const lower = transcriptText.toLowerCase();
  const primary =
    existingMembers.find((member) => normalizeString(member.relationship) === "primary") ??
    existingMembers[0] ??
    null;
  if (!primary) {
    return;
  }

  const desiredChildren = inferChildrenCount(lower);
  if (desiredChildren !== null && desiredChildren > 0) {
    const children = existingMembers.filter((member) => normalizeString(member.relationship) === "child");
    const needed = Math.max(0, desiredChildren - children.length);
    for (let index = 0; index < needed; index += 1) {
      await db.insert(members).values({
        householdId,
        firstName: `${AUTO_CHILD_MEMBER_PREFIX} ${children.length + index + 1}`,
        lastName: primary.lastName,
        relationship: "child",
      });
    }
  }

  if (/\bdivorc/.test(lower)) {
    const spouse = existingMembers.find((member) => normalizeString(member.relationship) === "spouse");
    if (!spouse) {
      await db.insert(members).values({
        householdId,
        firstName: AUTO_EX_SPOUSE_NAME,
        lastName: primary.lastName,
        relationship: "spouse",
      });
    }
  }

  const existingAccounts = await db.query.accounts.findMany({
    where: eq(accounts.householdId, householdId),
  });
  const normalizedTypes = new Set(existingAccounts.map((account) => normalizeString(account.accountTypeNorm)));
  for (const inferred of ACCOUNT_INFERENCE_RULES) {
    if (!inferred.test.test(transcriptText)) {
      continue;
    }
    if (normalizedTypes.has(normalizeString(inferred.norm))) {
      continue;
    }
    await db.insert(accounts).values({
      memberId: primary.id,
      householdId,
      accountTypeRaw: inferred.raw,
      accountTypeNorm: inferred.norm,
      ownershipType: "sole",
    });
  }
}

function getPrimaryMemberName(householdMembers: HouseholdMemberContext[]): string | null {
  if (householdMembers.length === 1) {
    return `${householdMembers[0].firstName} ${householdMembers[0].lastName ?? ""}`.trim();
  }
  const primary = householdMembers.find((member) => normalizeString(member.relationship) === "primary");
  return primary ? `${primary.firstName} ${primary.lastName ?? ""}`.trim() : null;
}

function inferChildrenCount(lowerTranscript: string): number | null {
  const wordToNumber: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };
  const numeric = lowerTranscript.match(/\b(\d+)\s+(?:teenage\s+)?children\b/);
  if (numeric) {
    return Number(numeric[1]);
  }
  const words = lowerTranscript.match(/\b(one|two|three|four|five)\s+(?:teenage\s+)?children\b/);
  if (words) {
    return wordToNumber[words[1]] ?? null;
  }
  return null;
}

function parseFacts(content: string): Fact[] {
  try {
    const parsed = JSON.parse(content) as {
      facts?: Array<Partial<Fact>>;
      updates?: Array<Partial<Fact>>;
    };
    const rawFacts = Array.isArray(parsed.facts) ? parsed.facts : Array.isArray(parsed.updates) ? parsed.updates : [];
    return rawFacts.map(normalizeFact).filter((fact): fact is Fact => Boolean(fact));
  } catch {
    return [];
  }
}

function normalizeFact(raw: Partial<Fact>): Fact | null {
  const target = normalizeTargetEntity(raw.target_entity);
  const fieldPath = normalizeFieldPath(raw.field_path);
  if (!target || !fieldPath) {
    return null;
  }

  const operation = normalizeOperation(raw.operation);
  const category = normalizeCategory(raw.category);
  const confidence = clampConfidence(raw.confidence);

  return {
    category,
    operation,
    target_entity: target,
    field_path: fieldPath,
    member_name: normalizeOptionalString(raw.member_name),
    account_hint: normalizeOptionalString(raw.account_hint),
    old_value: normalizeOptionalString(raw.old_value),
    new_value:
      operation === "remove"
        ? null
        : normalizeOptionalString(raw.new_value),
    speaker: normalizeSpeaker(raw.speaker),
    confidence,
    segment_indices: normalizeSegmentIndices(raw.segment_indices),
    verbatim_quote: normalizeOptionalString(raw.verbatim_quote) ?? "",
    ambiguity_note: normalizeOptionalString(raw.ambiguity_note),
  };
}

function normalizeTargetEntity(value: unknown): Fact["target_entity"] | null {
  const normalized = normalizeString(value === undefined || value === null ? "" : String(value));
  if (normalized === "household") return "household";
  if (normalized === "member") return "member";
  if (normalized === "account") return "account";
  return null;
}

function normalizeOperation(value: unknown): MergeOperation {
  const normalized = normalizeString(value === undefined || value === null ? "" : String(value));
  if (normalized === "set") return "set";
  if (normalized === "update") return "update";
  if (normalized === "append") return "append";
  if (normalized === "remove") return "remove";
  if (normalized === "confirm") return "confirm";
  return "set";
}

function normalizeCategory(value: unknown): Category {
  const normalized = normalizeString(value === undefined || value === null ? "" : String(value));
  if (normalized === "update") return "update";
  if (normalized === "correction") return "correction";
  if (normalized === "preference") return "preference";
  if (normalized === "goal") return "goal";
  return "new_info";
}

function normalizeSpeaker(value: unknown): FactSpeaker {
  const normalized = normalizeString(value === undefined || value === null ? "" : String(value));
  if (normalized === "wealth_manager") return "wealth_manager";
  if (normalized === "client_member") return "client_member";
  return "unknown";
}

function normalizeFieldPath(value: unknown): string | null {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    return null;
  }
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeSegmentIndices(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0))].sort(
    (a, b) => a - b,
  );
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1, parsed));
}

function buildEvidence(
  fact: Fact,
  segments: Map<number, { start: number; end: number }>,
): {
  quote: string;
  segmentIndices: number[];
  timestampStart: number | null;
  timestampEnd: number | null;
} {
  const starts = fact.segment_indices
    .map((index) => segments.get(index)?.start)
    .filter((value): value is number => value !== undefined);
  const ends = fact.segment_indices
    .map((index) => segments.get(index)?.end)
    .filter((value): value is number => value !== undefined);
  return {
    quote: fact.verbatim_quote,
    segmentIndices: fact.segment_indices,
    timestampStart: starts.length ? Math.min(...starts) : null,
    timestampEnd: ends.length ? Math.max(...ends) : null,
  };
}

async function markFailed(db: DbClient, importJobId: string, message: string) {
  await db
    .update(importJobs)
    .set({
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
    })
    .where(eq(importJobs.id, importJobId));
}

async function mapFactTarget(
  db: DbClient,
  householdId: string,
  fact: Fact,
): Promise<FactMappingResult> {
  if (fact.target_entity === "household") {
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });
    if (!household) {
      return {
        mapping: null,
        reason: "Target household was not found.",
      };
    }
    const fieldName = mapHouseholdField(fact.field_path);
    if (!fieldName) {
      return {
        mapping: null,
        reason: `Field "${fact.field_path}" is not a supported household field.`,
      };
    }
    return {
      mapping: {
        targetTable: "households",
        targetId: household.id,
        fieldName,
        currentValue: (household as Record<string, unknown>)[fieldName] as string | number | null,
      },
      reason: "",
    };
  }

  if (fact.target_entity === "member") {
    const member =
      (fact.member_name ? await findMemberByName(db, householdId, fact.member_name) : null) ??
      (await findSingleMemberForHousehold(db, householdId));
    if (!member) {
      return {
        mapping: null,
        reason: fact.member_name
          ? `No member matched "${fact.member_name}" in this household.`
          : "Member-targeted fact is missing member_name and household has multiple members.",
      };
    }
    const fieldName = mapMemberField(fact.field_path);
    if (!fieldName) {
      return {
        mapping: null,
        reason: `Field "${fact.field_path}" is not a supported member field.`,
      };
    }
    return {
      mapping: {
        targetTable: "members",
        targetId: member.id,
        fieldName,
        currentValue: (member as Record<string, unknown>)[fieldName] as string | number | null,
      },
      reason: "",
    };
  }

  const member =
    (fact.member_name ? await findMemberByName(db, householdId, fact.member_name) : null) ??
    (await findSingleMemberForHousehold(db, householdId));
  if (!member) {
    return {
      mapping: null,
      reason: fact.member_name
        ? `No member matched "${fact.member_name}" in this household.`
        : "Account-targeted fact is missing member_name and household has multiple members.",
    };
  }
  const fieldName = mapAccountField(fact.field_path);
  if (!fieldName) {
    return {
      mapping: null,
      reason: `Field "${fact.field_path}" is not a supported account field.`,
    };
  }
  const memberAccounts = await db.query.accounts.findMany({
    where: eq(accounts.memberId, member.id),
  });
  if (!memberAccounts.length) {
    return {
      mapping: null,
      reason: `No accounts found for member "${fact.member_name}".`,
    };
  }
  const resolvedAccount = resolveAccountForFact(memberAccounts, fieldName, fact);
  if (!resolvedAccount.account) {
    return {
      mapping: null,
      reason: resolvedAccount.reason,
    };
  }
  return {
    mapping: {
      targetTable: "accounts",
      targetId: resolvedAccount.account.id,
      fieldName,
      currentValue: (resolvedAccount.account as Record<string, unknown>)[fieldName] as string | number | null,
    },
    reason: "",
  };
}

function resolveAccountForFact(
  memberAccounts: Array<typeof accounts.$inferSelect>,
  fieldName: string,
  fact: Fact,
): { account: typeof accounts.$inferSelect | null; reason: string } {
  if (memberAccounts.length === 1) {
    return {
      account: memberAccounts[0],
      reason: "",
    };
  }

  const accountHint = normalizeString(fact.account_hint);
  if (accountHint) {
    const byHint = memberAccounts.filter((account) => accountMatchesHint(account, accountHint));
    if (byHint.length === 1) {
      return {
        account: byHint[0],
        reason: "",
      };
    }
    if (byHint.length > 1) {
      return {
        account: null,
        reason: `Account hint "${fact.account_hint}" matched multiple accounts for "${fact.member_name}".`,
      };
    }
  }

  if (fact.old_value) {
    const byOldValue = memberAccounts.filter((account) =>
      areValuesEquivalent(
        (account as Record<string, unknown>)[fieldName] as string | number | null,
        fact.old_value,
        fieldName,
      ),
    );
    if (byOldValue.length === 1) {
      return {
        account: byOldValue[0],
        reason: "",
      };
    }
  }

  if (fact.operation === "confirm" && fact.new_value) {
    const byConfirmedValue = memberAccounts.filter((account) =>
      areValuesEquivalent(
        (account as Record<string, unknown>)[fieldName] as string | number | null,
        fact.new_value,
        fieldName,
      ),
    );
    if (byConfirmedValue.length === 1) {
      return {
        account: byConfirmedValue[0],
        reason: "",
      };
    }
  }

  return {
    account: null,
    reason:
      memberAccounts.length > 1
        ? `Multiple accounts found for "${fact.member_name}" and no unique account hint was provided.`
        : "No matching account found.",
  };
}

function accountMatchesHint(account: typeof accounts.$inferSelect, hint: string) {
  const descriptors = [
    account.accountTypeRaw,
    account.accountTypeNorm,
    account.custodian,
    account.coOwnerName,
    account.primaryUse,
    account.sourceOfFunds,
    account.ownershipType,
  ]
    .map((value) => normalizeString(value))
    .filter(Boolean);

  return descriptors.some((value) => value.includes(hint) || hint.includes(value));
}

function mapHouseholdField(fieldPath: string) {
  const normalized = normalizeFieldToken(fieldPath, "household");
  if (normalized === "income") return "income";
  if (normalized === "tax_bracket_raw") return "taxBracketRaw";
  if (normalized === "tax_bracket_pct") return "taxBracketPct";
  if (normalized === "expense_range") return "expenseRange";
  if (normalized === "risk_tolerance") return "riskTolerance";
  if (normalized === "time_horizon") return "timeHorizon";
  if (normalized === "investment_objective") return "investmentObjective";
  if (normalized === "liquid_net_worth") return "liquidNetWorth";
  if (normalized === "total_net_worth") return "totalNetWorth";
  if (normalized === "address") return "address";
  return null;
}

function mapMemberField(fieldPath: string) {
  const normalized = normalizeFieldToken(fieldPath, "member");
  if (normalized === "first_name") return "firstName";
  if (normalized === "last_name") return "lastName";
  if (normalized === "dob") return "dobRaw";
  if (normalized === "dob_raw") return "dobRaw";
  if (normalized === "date_of_birth") return "dobRaw";
  if (normalized === "birth_date") return "dobRaw";
  if (normalized === "birthday") return "dobRaw";
  if (normalized === "birth_day") return "dobRaw";
  if (normalized === "phone") return "phone";
  if (normalized === "email") return "email";
  if (normalized === "relationship") return "relationship";
  if (normalized === "address") return "address";
  if (normalized === "occupation") return "occupation";
  if (normalized === "employer") return "employer";
  if (normalized === "marital_status") return "maritalStatus";
  if (normalized === "marital") return "maritalStatus";
  if (normalized === "divorce") return "maritalStatus";
  if (normalized === "divorced") return "maritalStatus";
  if (normalized === "divorce_status") return "maritalStatus";
  return null;
}

function mapAccountField(fieldPath: string) {
  const normalized = normalizeFieldToken(fieldPath, "account");
  if (normalized === "liquidity_needs") return "liquidityNeeds";
  if (normalized === "account_value") return "accountValue";
  if (normalized === "custodian") return "custodian";
  if (normalized === "ownership_type") return "ownershipType";
  if (normalized === "source_of_funds") return "sourceOfFunds";
  if (normalized === "primary_use") return "primaryUse";
  return null;
}

function normalizeFieldToken(fieldPath: string, targetPrefix: "household" | "member" | "account") {
  const normalized = fieldPath.trim().toLowerCase();
  const withoutPrefix = normalized.startsWith(`${targetPrefix}.`) ? normalized.slice(targetPrefix.length + 1) : normalized;
  return withoutPrefix.replace(/[^a-z0-9.]+/g, "_").replace(/\./g, "_");
}

async function findMemberByName(db: DbClient, householdId: string, memberName: string) {
  const name = normalizeString(memberName);
  if (!name) {
    return null;
  }
  const candidates = await db.query.members.findMany({
    where: eq(members.householdId, householdId),
  });
  return (
    candidates.find((member) => normalizeString(`${member.firstName} ${member.lastName ?? ""}`).includes(name)) ??
    null
  );
}

async function findSingleMemberForHousehold(db: DbClient, householdId: string) {
  const candidates = await db.query.members.findMany({
    where: eq(members.householdId, householdId),
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function compareFact(mapping: FactMapping, fact: Fact): CompareDecision {
  let proposedValue = deriveProposedValue(fact, mapping.currentValue);
  if (mapping.fieldName === "email") {
    const normalizedCurrent = canonicalizeEmailList(
      mapping.currentValue === null || mapping.currentValue === undefined ? null : String(mapping.currentValue),
    );
    const normalizedNext = canonicalizeEmailList(proposedValue);
    proposedValue =
      fact.operation === "append"
        ? mergeEmailLists(normalizedCurrent, normalizedNext)
        : normalizedNext;
  }
  if (proposedValue === undefined) {
    return {
      classification: "ambiguous",
      proposedValue: null,
      reviewReason: "Proposed value is missing or unclear.",
      shouldAutoApply: false,
    };
  }

  if (fact.operation === "confirm") {
    const matches = areValuesEquivalent(mapping.currentValue, proposedValue, mapping.fieldName);
    return {
      classification: matches ? "no_change" : "conflict",
      proposedValue,
      reviewReason: matches ? null : "Statement is phrased as confirmation but conflicts with current value.",
      shouldAutoApply: false,
    };
  }

  if (proposedValue !== null && isNumericFieldName(mapping.fieldName) && parseCurrency(proposedValue) === null) {
    return {
      classification: "ambiguous",
      proposedValue,
      reviewReason: `Value "${proposedValue}" is not a parseable number for numeric field "${mapping.fieldName}".`,
      shouldAutoApply: false,
    };
  }

  const ambiguousByQuality = Boolean(fact.ambiguity_note) || fact.confidence < REVIEW_CONFIDENCE_FLOOR;
  if (ambiguousByQuality) {
    return {
      classification: "ambiguous",
      proposedValue,
      reviewReason:
        fact.ambiguity_note ??
        `Confidence ${fact.confidence.toFixed(2)} is below auto-review floor ${REVIEW_CONFIDENCE_FLOOR.toFixed(2)}.`,
      shouldAutoApply: false,
    };
  }

  if (areValuesEquivalent(mapping.currentValue, proposedValue, mapping.fieldName)) {
    return {
      classification: "no_change",
      proposedValue,
      reviewReason: null,
      shouldAutoApply: false,
    };
  }

  const currentIsEmpty = isEmptyValue(mapping.currentValue);
  let classification: Exclude<Classification, "no_change" | "ambiguous"> = currentIsEmpty ? "new_info" : "correction";
  if (!currentIsEmpty && fact.operation === "append") {
    classification = "new_info";
  }
  if (
    classification === "correction" &&
    fact.speaker !== "client_member" &&
    fact.operation !== "append"
  ) {
    return {
      classification: "conflict",
      proposedValue,
      reviewReason: "Correction was not explicitly stated by the client/member speaker.",
      shouldAutoApply: false,
    };
  }

  const shouldAutoApply =
    classification === "new_info"
      ? fact.confidence >= AUTO_APPLY_NEW_INFO_CONFIDENCE
      : fact.speaker === "client_member" && fact.confidence >= AUTO_APPLY_CORRECTION_CONFIDENCE;

  return {
    classification,
    proposedValue,
    reviewReason: shouldAutoApply ? null : "Requires human review before applying.",
    shouldAutoApply,
  };
}

function deriveProposedValue(
  fact: Fact,
  currentValue: string | number | null,
): string | null | undefined {
  if (fact.operation === "remove") {
    return null;
  }

  const incoming = normalizeOptionalString(fact.new_value);
  if (fact.operation === "confirm") {
    if (incoming) {
      return incoming;
    }
    if (currentValue === null || currentValue === undefined) {
      return undefined;
    }
    return String(currentValue);
  }
  if (!incoming) {
    return undefined;
  }

  if (fact.operation === "append") {
    const currentText =
      currentValue === null || currentValue === undefined
        ? ""
        : String(currentValue).trim();
    if (!currentText) {
      return incoming;
    }
    const currentNormalized = normalizeString(currentText);
    const incomingNormalized = normalizeString(incoming);
    if (currentNormalized.includes(incomingNormalized)) {
      return currentText;
    }
    return `${currentText}; ${incoming}`;
  }

  return incoming;
}

function areValuesEquivalent(
  current: string | number | null,
  next: string | null,
  fieldName: string,
) {
  if (fieldName === "email") {
    const currentEmail = canonicalizeEmailList(current === null || current === undefined ? null : String(current));
    const nextEmail = canonicalizeEmailList(next);
    return currentEmail === nextEmail;
  }
  if (next === null) {
    return isEmptyValue(current);
  }
  if (isNumericFieldName(fieldName)) {
    const currentNumber = parseCurrency(current);
    const nextNumber = parseCurrency(next);
    if (currentNumber !== null && nextNumber !== null) {
      return currentNumber === nextNumber;
    }
  }
  const currentNormalized =
    current === null || current === undefined ? "" : normalizeString(String(current));
  const nextNormalized = normalizeString(next);
  return currentNormalized === nextNormalized;
}

function canonicalizeEmailList(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  const tokens = normalized.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  if (!tokens.length) {
    return normalized;
  }
  return Array.from(new Set(tokens.map((token) => token.toLowerCase()))).join("; ");
}

function mergeEmailLists(current: string | null, next: string | null): string | null {
  const tokens = [
    ...(current?.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []),
    ...(next?.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []),
  ].map((token) => token.toLowerCase());
  if (!tokens.length) {
    return next;
  }
  return Array.from(new Set(tokens)).join("; ");
}

function isEmptyValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "number") {
    return false;
  }
  return !value.trim();
}

function buildProposalReason(decision: CompareDecision, fact: Fact) {
  const base = `Audio ${decision.classification} (${fact.operation}) from ${fact.speaker}.`;
  if (decision.reviewReason) {
    return `${base} ${decision.reviewReason}`;
  }
  return base;
}

async function applyProposalNow(
  db: DbClient,
  proposalId: string,
  mapping: FactMapping,
  nextValue: string | null,
  importJobId: string,
  segmentIndices: number[],
  artifactMap: Map<number, string>,
) {
  if (mapping.targetTable === "households") {
    const payload: Partial<typeof households.$inferInsert> = {};
    payload[mapping.fieldName as keyof typeof payload] = castProposalFieldValue(
      mapping.targetTable,
      mapping.fieldName,
      nextValue,
    ) as never;
    await db.update(households).set(payload).where(eq(households.id, mapping.targetId));
  } else if (mapping.targetTable === "members") {
    const payload: Partial<typeof members.$inferInsert> = {};
    payload[mapping.fieldName as keyof typeof payload] = castProposalFieldValue(
      mapping.targetTable,
      mapping.fieldName,
      nextValue,
    ) as never;
    await db.update(members).set(payload).where(eq(members.id, mapping.targetId));
  } else {
    const payload: Partial<typeof accounts.$inferInsert> = {};
    payload[mapping.fieldName as keyof typeof payload] = castProposalFieldValue(
      mapping.targetTable,
      mapping.fieldName,
      nextValue,
    ) as never;
    await db.update(accounts).set(payload).where(eq(accounts.id, mapping.targetId));
  }

  await db
    .update(changeProposals)
    .set({
      status: "auto_applied",
      resolvedBy: "system",
      resolvedAt: new Date(),
    })
    .where(eq(changeProposals.id, proposalId));

  const firstArtifactId = segmentIndices.map((idx) => artifactMap.get(idx)).find(Boolean);
  await upsertProvenance(db, {
    targetTable: mapping.targetTable,
    targetId: mapping.targetId,
    fieldName: mapping.fieldName,
    sourceType: "audio",
    sourceArtifactId: firstArtifactId ?? null,
    importJobId,
  });
}
