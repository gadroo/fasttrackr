import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { DbClient } from "@/lib/db/client";
import { upsertProvenance } from "@/lib/db/provenance";
import {
  accounts,
  bankDetails,
  changeProposalArtifacts,
  changeProposals,
  fieldProvenance,
  households,
  importJobs,
  members,
  sourceArtifacts,
} from "@/lib/db/schema";
import type {
  ChangeProposalView,
  EnrichmentView,
  HouseholdDetail,
  HouseholdOption,
  HouseholdSummary,
  InsightData,
} from "@/lib/types";
import {
  decodeProposalValue,
  decodeProposalValueForDisplay,
} from "@/lib/import/proposal-values";
import { castProposalFieldValue } from "@/lib/db/value-casting";
import {
  compareHouseholdMembersForDisplay,
  formatTimeWindow,
  normalizeMemberEmailList,
  parseDate,
  parseExpenseRange,
} from "@/lib/utils";

const COMPLETENESS_KEYS = [
  "income",
  "liquidNetWorth",
  "totalNetWorth",
  "taxBracketRaw",
  "expenseRange",
  "riskTolerance",
  "timeHorizon",
  "investmentObjective",
  "memberHasDob",
  "memberHasPhone",
  "memberHasEmail",
  "memberHasOccupation",
  "accountHasCustodian",
  "accountHasValue",
  "bankDetailsPresent",
] as const;

export async function getHouseholdOptions(db: DbClient): Promise<HouseholdOption[]> {
  return db
    .select({
      id: households.id,
      name: households.name,
    })
    .from(households)
    .orderBy(asc(households.name));
}

export async function getHouseholdSummaries(db: DbClient): Promise<HouseholdSummary[]> {
  const householdRows = await db.select().from(households).orderBy(asc(households.name));
  if (!householdRows.length) {
    return [];
  }
  const householdIds = householdRows.map((household) => household.id);
  const householdIdSet = new Set(householdIds);

  const [memberRows, accountRows, allPendingRows, importRows] = await Promise.all([
    db.query.members.findMany({ where: inArray(members.householdId, householdIds) }),
    db.query.accounts.findMany({ where: inArray(accounts.householdId, householdIds) }),
    db.query.changeProposals.findMany({
      where: eq(changeProposals.status, "pending"),
    }),
    db.query.importJobs.findMany({
      where: inArray(importJobs.targetHouseholdId, householdIds),
      orderBy: [desc(importJobs.createdAt)],
    }),
  ]);
  const memberRowsByHousehold = groupRowsBy(memberRows, (row) => row.householdId);
  const accountRowsByHousehold = groupRowsBy(accountRows, (row) => row.householdId);
  const memberIds = memberRows.map((member) => member.id);
  const bankRows = memberIds.length
    ? await db.query.bankDetails.findMany({
        where: inArray(bankDetails.memberId, memberIds),
      })
    : [];

  const memberIdSet = new Set(memberIds);
  const accountIdSet = new Set(accountRows.map((a) => a.id));
  const memberToHousehold = new Map(memberRows.map((m) => [m.id, m.householdId]));
  const accountToHousehold = new Map(accountRows.map((a) => [a.id, a.householdId]));
  const bankRowsByHousehold = new Map<string, Array<typeof bankDetails.$inferSelect>>();
  for (const bank of bankRows) {
    const householdId = memberToHousehold.get(bank.memberId);
    if (!householdId) {
      continue;
    }
    const existing = bankRowsByHousehold.get(householdId) ?? [];
    existing.push(bank);
    bankRowsByHousehold.set(householdId, existing);
  }

  const pendingByHousehold = new Map<string, number>();
  for (const proposal of allPendingRows) {
    let householdId: string | null = null;
    if (proposal.targetTable === "households" && proposal.targetId && householdIdSet.has(proposal.targetId)) {
      householdId = proposal.targetId;
    } else if (proposal.targetTable === "members" && proposal.targetId && memberIdSet.has(proposal.targetId)) {
      householdId = memberToHousehold.get(proposal.targetId) ?? null;
    } else if (proposal.targetTable === "accounts" && proposal.targetId && accountIdSet.has(proposal.targetId)) {
      householdId = accountToHousehold.get(proposal.targetId) ?? null;
    }
    if (householdId) {
      pendingByHousehold.set(householdId, (pendingByHousehold.get(householdId) ?? 0) + 1);
    }
  }

  const memberCountByHousehold = countBy(memberRows, (row) => row.householdId);
  const accountCountByHousehold = countBy(accountRows, (row) => row.householdId);

  const importByHousehold = new Map<string, { createdAt: Date; type: "spreadsheet" | "audio" }>();
  for (const row of importRows) {
    if (!row.targetHouseholdId || !row.createdAt) {
      continue;
    }
    if (!importByHousehold.has(row.targetHouseholdId)) {
      importByHousehold.set(row.targetHouseholdId, {
        createdAt: row.createdAt,
        type: row.type as "spreadsheet" | "audio",
      });
    }
  }

  return householdRows.map((household) => {
    const memberRowsForHousehold = memberRowsByHousehold.get(household.id) ?? [];
    const accountRowsForHousehold = accountRowsByHousehold.get(household.id) ?? [];
    const bankRowsForHousehold = bankRowsByHousehold.get(household.id) ?? [];
    const completenessScore = computeCompleteness(household, memberRowsForHousehold, accountRowsForHousehold, bankRowsForHousehold);
    const latestImport = importByHousehold.get(household.id);
    return {
      id: household.id,
      name: household.name,
      memberCount: memberCountByHousehold.get(household.id) ?? 0,
      accountCount: accountCountByHousehold.get(household.id) ?? 0,
      income: household.income,
      totalNetWorth: household.totalNetWorth,
      liquidNetWorth: household.liquidNetWorth,
      expenseRange: household.expenseRange,
      completenessScore,
      pendingChanges: pendingByHousehold.get(household.id) ?? 0,
      memberNames: memberRowsForHousehold.map((m) => `${m.firstName} ${m.lastName ?? ""}`.trim()),
      lastImportAt: latestImport?.createdAt?.toISOString() ?? null,
      lastImportType: latestImport?.type ?? null,
    };
  });
}

// Optimized single-query version using PostgreSQL JSON aggregation
export async function getHouseholdDetail(
  db: DbClient,
  householdId: string,
): Promise<(HouseholdDetail & { provenance: typeof fieldProvenance.$inferSelect[] }) | null> {
  // Single query with CTEs and JSON aggregation to fetch all household data at once
  const result = await db.execute(
    sql`
      WITH household_data AS (
        SELECT id, name, income, liquid_net_worth, total_net_worth,
               tax_bracket_raw, tax_bracket_pct, expense_range, risk_tolerance,
               time_horizon, investment_objective, address
        FROM households
        WHERE id = ${householdId}
      ),
      members_data AS (
        SELECT m.id, m.household_id, m.first_name, m.last_name, m.relationship,
               m.dob, m.dob_raw, m.phone, m.email, m.address, m.occupation, m.employer,
               m.marital_status, m.is_business_entity
        FROM members m
        WHERE m.household_id = ${householdId}
        ORDER BY m.first_name
      ),
      accounts_data AS (
        SELECT a.id, a.member_id, a.account_type_raw, a.account_type_norm,
               a.co_owner_name, a.custodian, a.account_value, a.ownership_pct,
               a.ownership_type, a.is_uncertain
        FROM accounts a
        WHERE a.household_id = ${householdId}
      ),
      bank_data AS (
        SELECT bd.id, bd.member_id, bd.bank_name, bd.bank_type,
               bd.account_number, bd.routing_number
        FROM bank_details bd
        WHERE bd.member_id IN (SELECT id FROM members_data)
      ),
      beneficiary_data AS (
        SELECT b.id, b.account_id, b.name, b.percentage, b.dob, b.ordinal
        FROM beneficiaries b
        WHERE b.account_id IN (SELECT id FROM accounts_data)
      ),
      provenance_data AS (
        SELECT fp.field_name, fp.source_type, fp.set_at
        FROM field_provenance fp
        WHERE fp.target_table = 'households' AND fp.target_id = ${householdId}
      )
      SELECT
        h.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', m.id,
          'householdId', m.household_id,
          'firstName', m.first_name,
          'lastName', m.last_name,
          'relationship', m.relationship,
          'dob', m.dob,
          'dobRaw', m.dob_raw,
          'phone', m.phone,
          'email', m.email,
          'address', m.address,
          'occupation', m.occupation,
          'employer', m.employer,
          'maritalStatus', m.marital_status,
          'isBusinessEntity', m.is_business_entity
        )) FILTER (WHERE m.id IS NOT NULL), '[]') AS members,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', a.id,
          'memberId', a.member_id,
          'accountTypeRaw', a.account_type_raw,
          'accountTypeNorm', a.account_type_norm,
          'coOwnerName', a.co_owner_name,
          'custodian', a.custodian,
          'accountValue', a.account_value,
          'ownershipPct', a.ownership_pct,
          'ownershipType', a.ownership_type,
          'isUncertain', a.is_uncertain
        )) FILTER (WHERE a.id IS NOT NULL), '[]') AS accounts,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', bd.id,
          'memberId', bd.member_id,
          'bankName', bd.bank_name,
          'bankType', bd.bank_type,
          'accountNumber', bd.account_number,
          'routingNumber', bd.routing_number
        )) FILTER (WHERE bd.id IS NOT NULL), '[]') AS bank_details,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'id', b.id,
          'accountId', b.account_id,
          'name', b.name,
          'percentage', b.percentage,
          'dob', b.dob,
          'ordinal', b.ordinal
        )) FILTER (WHERE b.id IS NOT NULL), '[]') AS beneficiaries,
        COALESCE(json_agg(DISTINCT jsonb_build_object(
          'fieldName', fp.field_name,
          'sourceType', fp.source_type,
          'setAt', fp.set_at
        )) FILTER (WHERE fp.field_name IS NOT NULL), '[]') AS provenance
      FROM household_data h
      LEFT JOIN members_data m ON true
      LEFT JOIN accounts_data a ON true
      LEFT JOIN bank_data bd ON true
      LEFT JOIN beneficiary_data b ON true
      LEFT JOIN provenance_data fp ON true
      GROUP BY h.id, h.name, h.income, h.liquid_net_worth, h.total_net_worth,
               h.tax_bracket_raw, h.tax_bracket_pct, h.expense_range, h.risk_tolerance,
               h.time_horizon, h.investment_objective, h.address
    `
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0] as {
    id: string;
    name: string;
    income: number | null;
    liquid_net_worth: number | null;
    total_net_worth: number | null;
    tax_bracket_raw: string | null;
    tax_bracket_pct: number | null;
    expense_range: string | null;
    risk_tolerance: string | null;
    time_horizon: string | null;
    investment_objective: string | null;
    address: string | null;
    members: unknown;
    accounts: unknown;
    bank_details: unknown;
    beneficiaries: unknown;
    provenance: unknown;
  };

  // pg driver already parses JSON columns, no need to JSON.parse
  const members = (row.members as Array<{
    id: string;
    householdId: string;
    firstName: string;
    lastName: string | null;
    relationship: string | null;
    dob: string | null;
    dobRaw: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    occupation: string | null;
    employer: string | null;
    maritalStatus: string | null;
    isBusinessEntity: boolean;
  }>).filter(m => m !== null);

  members.sort(compareHouseholdMembersForDisplay);

  const accounts = (row.accounts as Array<{
    id: string;
    memberId: string;
    accountTypeRaw: string;
    accountTypeNorm: string;
    coOwnerName: string | null;
    custodian: string | null;
    accountValue: number | null;
    ownershipPct: number | null;
    ownershipType: string | null;
    isUncertain: boolean;
  }>).filter(a => a !== null);

  const bankDetails = (row.bank_details as Array<{
    id: string;
    memberId: string;
    bankName: string | null;
    bankType: string | null;
    accountNumber: string | null;
    routingNumber: string | null;
  }>).filter(bd => bd !== null);

  const beneficiaries = (row.beneficiaries as Array<{
    id: string;
    accountId: string;
    name: string;
    percentage: number | null;
    dob: string | null;
    ordinal: number;
  }>).filter(b => b !== null);

  const provenanceRows = (row.provenance as Array<{
    fieldName: string;
    sourceType: string;
    setAt: Date;
  }>).filter(p => p !== null);

  const completenessScore = computeCompleteness(
    {
      id: row.id,
      name: row.name,
      income: row.income,
      liquidNetWorth: row.liquid_net_worth,
      totalNetWorth: row.total_net_worth,
      taxBracketRaw: row.tax_bracket_raw,
      taxBracketPct: row.tax_bracket_pct,
      expenseRange: row.expense_range,
      riskTolerance: row.risk_tolerance,
      timeHorizon: row.time_horizon,
      investmentObjective: row.investment_objective,
      address: row.address,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    members.map((m) => ({
      id: m.id,
      householdId: m.householdId,
      firstName: m.firstName,
      lastName: m.lastName,
      relationship: m.relationship,
      dob: m.dob ? new Date(m.dob) : parseDate(m.dobRaw),
      phone: m.phone,
      email: m.email,
      address: m.address,
      occupation: m.occupation,
      employer: m.employer,
      maritalStatus: m.maritalStatus,
      isBusinessEntity: m.isBusinessEntity,
      dobRaw: m.dobRaw,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    accounts.map((a) => ({
      id: a.id,
      memberId: a.memberId,
      householdId: householdId,
      accountTypeRaw: a.accountTypeRaw,
      accountTypeNorm: a.accountTypeNorm,
      coOwnerName: a.coOwnerName,
      custodian: a.custodian,
      accountValue: a.accountValue,
      ownershipPct: a.ownershipPct,
      ownershipType: a.ownershipType,
      decisionMaking: null,
      sourceOfFunds: null,
      primaryUse: null,
      liquidityNeeds: null,
      liquidityHorizon: null,
      isUncertain: a.isUncertain,
      investmentExperience: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    bankDetails.map((bd) => ({
      id: bd.id,
      memberId: bd.memberId,
      bankName: bd.bankName,
      bankType: bd.bankType,
      accountNumber: bd.accountNumber,
      routingNumber: bd.routingNumber,
      createdAt: new Date(),
    }))
  );

  // Build member accounts map
  const memberAccountsMap = new Map<string, typeof accounts>();
  for (const account of accounts) {
    const existing = memberAccountsMap.get(account.memberId) ?? [];
    existing.push(account);
    memberAccountsMap.set(account.memberId, existing);
  }

  return {
    id: row.id,
    name: row.name,
    income: row.income,
    liquidNetWorth: row.liquid_net_worth,
    totalNetWorth: row.total_net_worth,
    taxBracketRaw: row.tax_bracket_raw,
    taxBracketPct: row.tax_bracket_pct,
    expenseRange: row.expense_range,
    riskTolerance: row.risk_tolerance,
    timeHorizon: row.time_horizon,
    investmentObjective: row.investment_objective,
    address: row.address,
    completenessScore,
    pendingChanges: 0,
    members: members.map((member) => {
      const memberAccounts = memberAccountsMap.get(member.id) ?? [];
      return {
        id: member.id,
        householdId: member.householdId,
        firstName: member.firstName,
        lastName: member.lastName,
        displayName: `${member.firstName} ${member.lastName ?? ""}`.trim(),
        relationship: (member.relationship ?? "other") as
          | "primary"
          | "spouse"
          | "ex_spouse"
          | "child"
          | "parent"
          | "business_entity"
          | "other",
        dob: member.dob ?? member.dobRaw,
        phone: member.phone,
        email: normalizeMemberEmailList(member.email),
        address: member.address,
        occupation: member.occupation,
        employer: member.employer,
        maritalStatus: member.maritalStatus,
        isBusinessEntity: member.isBusinessEntity,
        accounts: memberAccounts.map((account) => ({
          id: account.id,
          memberId: account.memberId,
          accountTypeRaw: account.accountTypeRaw,
          accountTypeNorm: account.accountTypeNorm,
          coOwnerName: account.coOwnerName,
          custodian: account.custodian,
          accountValue: account.accountValue,
          ownershipPct: account.ownershipPct,
          ownershipType: account.ownershipType as
            | "sole"
            | "joint"
            | "trust"
            | "business"
            | "custodial"
            | null,
          isUncertain: account.isUncertain,
        })),
      };
    }),
    accounts: accounts.map((account) => ({
      id: account.id,
      memberId: account.memberId,
      accountTypeRaw: account.accountTypeRaw,
      accountTypeNorm: account.accountTypeNorm,
      coOwnerName: account.coOwnerName,
      custodian: account.custodian,
      accountValue: account.accountValue,
      ownershipPct: account.ownershipPct,
      ownershipType: account.ownershipType as
        | "sole"
        | "joint"
        | "trust"
        | "business"
        | "custodial"
        | null,
      isUncertain: account.isUncertain,
    })),
    bankDetails: bankDetails.map((bd) => ({
      id: bd.id,
      memberId: bd.memberId,
      bankName: bd.bankName,
      bankType: bd.bankType,
      accountNumber: bd.accountNumber,
      routingNumber: bd.routingNumber,
    })),
    beneficiaries: beneficiaries.map((b) => ({
      id: b.id,
      accountId: b.accountId,
      name: b.name,
      percentage: b.percentage,
      dob: b.dob,
      ordinal: b.ordinal,
    })),
    provenance: provenanceRows.map((p) => ({
      id: "",
      importJobId: null,
      targetTable: "households",
      targetId: householdId,
      fieldName: p.fieldName,
      sourceArtifactId: null,
      sourceType: p.sourceType as "spreadsheet" | "audio" | "user_edit",
      setAt: p.setAt,
    })),
  };
}

export async function acceptChangeProposal(db: DbClient, proposalId: string) {
  const proposal = await db.query.changeProposals.findFirst({
    where: eq(changeProposals.id, proposalId),
  });
  if (!proposal || !proposal.targetId) {
    throw new Error("Change proposal not found.");
  }
  if (proposal.status !== "pending") {
    return proposal;
  }

  const castValue = parseProposalValue(proposal.targetTable, proposal.fieldName, proposal.newValue);
  if (proposal.targetTable === "households") {
    await db
      .update(households)
      .set({ [proposal.fieldName]: castValue } as Partial<typeof households.$inferInsert>)
      .where(eq(households.id, proposal.targetId));
  } else if (proposal.targetTable === "members") {
    await db
      .update(members)
      .set({ [proposal.fieldName]: castValue } as Partial<typeof members.$inferInsert>)
      .where(eq(members.id, proposal.targetId));
  } else {
    await db
      .update(accounts)
      .set({ [proposal.fieldName]: castValue } as Partial<typeof accounts.$inferInsert>)
      .where(eq(accounts.id, proposal.targetId));
  }

  await db
    .update(changeProposals)
    .set({
      status: "accepted",
      resolvedAt: new Date(),
      resolvedBy: "user",
    })
    .where(eq(changeProposals.id, proposalId));

  const artifactLink = await db.query.changeProposalArtifacts.findFirst({
    where: eq(changeProposalArtifacts.changeProposalId, proposalId),
  });
  const job = await db.query.importJobs.findFirst({
    where: eq(importJobs.id, proposal.importJobId),
  });
  await upsertProvenance(db, {
    targetTable: proposal.targetTable as "households" | "members" | "accounts",
    targetId: proposal.targetId,
    fieldName: proposal.fieldName,
    sourceType: (job?.type as "spreadsheet" | "audio" | "user_edit") ?? "user_edit",
    sourceArtifactId: artifactLink?.sourceArtifactId ?? null,
    importJobId: proposal.importJobId,
  });
}

export async function dismissChangeProposal(db: DbClient, proposalId: string) {
  await db
    .update(changeProposals)
    .set({
      status: "dismissed",
      resolvedAt: new Date(),
      resolvedBy: "user",
    })
    .where(eq(changeProposals.id, proposalId));
}

function parseProposalValue(
  targetTable: string,
  fieldName: string,
  value: string,
) {
  const maybeNull = decodeProposalValue(value);
  if (
    targetTable !== "households" &&
    targetTable !== "members" &&
    targetTable !== "accounts"
  ) {
    return maybeNull;
  }
  return castProposalFieldValue(targetTable, fieldName, maybeNull);
}

// Optimized combined query for household detail page
export async function getHouseholdChangeBundleOptimized(
  db: DbClient,
  householdId: string,
): Promise<{
  changes: ChangeProposalView[];
  enrichment: EnrichmentView;
  sources: Array<typeof importJobs.$inferSelect>;
}> {
  // Run independent queries in parallel:
  // 1) direct jobs targeted to this household
  // 2) all proposals that resolve to this household via target entity mapping
  const [directJobs, proposalsResult] = await Promise.all([
    db.query.importJobs.findMany({
      where: eq(importJobs.targetHouseholdId, householdId),
      orderBy: [desc(importJobs.createdAt)],
    }),
    db.execute(
      sql`SELECT cp.id, cp.import_job_id, cp.target_table, cp.target_id, cp.field_name, cp.old_value, cp.new_value, cp.confidence, cp.status, cp.reason, cp.category, cp.member_name, cp.verbatim_quote, cp.ambiguity_note, cp.resolved_at, cp.resolved_by, cp.created_at
          FROM change_proposals cp
          LEFT JOIN members m ON cp.target_table = 'members' AND cp.target_id = m.id
          LEFT JOIN accounts a ON cp.target_table = 'accounts' AND cp.target_id = a.id
          WHERE (
            (cp.target_table = 'households' AND cp.target_id = ${householdId})
            OR (cp.target_table = 'members' AND m.household_id = ${householdId})
            OR (cp.target_table = 'accounts' AND a.household_id = ${householdId})
          )
          ORDER BY cp.created_at DESC`
    ),
  ]);

  const proposals = proposalsResult.rows as Array<{
    id: string;
    import_job_id: string;
    target_table: string;
    target_id: string | null;
    field_name: string;
    old_value: string | null;
    new_value: string;
    confidence: number;
    status: string;
    reason: string | null;
    category: string | null;
    member_name: string | null;
    verbatim_quote: string | null;
    ambiguity_note: string | null;
    resolved_at: Date | null;
    resolved_by: string | null;
    created_at: Date;
  }>;

  const directJobIds = new Set(directJobs.map((job) => job.id));
  const missingProposalJobIds = Array.from(new Set(proposals.map((proposal) => proposal.import_job_id))).filter(
    (jobId) => !directJobIds.has(jobId),
  );
  const missingJobs = missingProposalJobIds.length
    ? await db.query.importJobs.findMany({
        where: inArray(importJobs.id, missingProposalJobIds),
      })
    : [];
  const allJobs = [...directJobs, ...missingJobs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  if (!allJobs.length && !proposals.length) {
    return {
      changes: [],
      enrichment: { transcript: null, extractedFacts: [] },
      sources: [],
    };
  }

  const audioJobIds = allJobs.filter((j) => j.type === "audio").map((j) => j.id);
  const artifacts = audioJobIds.length
    ? await db.query.sourceArtifacts.findMany({
        where: and(
          eq(sourceArtifacts.artifactType, "transcript_segment"),
          inArray(sourceArtifacts.importJobId, audioJobIds),
        ),
        orderBy: [sourceArtifacts.segmentIndex],
      })
    : [];

  // Get links for proposals
  const proposalIds = proposals.map((p) => p.id);
  const links = proposalIds.length
    ? await db.query.changeProposalArtifacts.findMany({
        where: inArray(changeProposalArtifacts.changeProposalId, proposalIds),
      })
    : [];

  // Build maps for efficient lookup
  const artifactById = new Map(artifacts.map((a) => [a.id, a]));
  const jobById = new Map(allJobs.map((j) => [j.id, j]));

  // Build fact by segment map
  const factBySegment = new Map<number, string[]>();
  for (const link of links) {
    const artifact = artifactById.get(link.sourceArtifactId);
    if (!artifact || artifact.segmentIndex === null) continue;
    const existing = factBySegment.get(artifact.segmentIndex) ?? [];
    existing.push(link.changeProposalId);
    factBySegment.set(artifact.segmentIndex, existing);
  }

  // Build change proposals view
  const changes: ChangeProposalView[] = proposals.map((proposal) => {
    const job = jobById.get(proposal.import_job_id);
    const proposalLinks = links.filter((l) => l.changeProposalId === proposal.id);
    const linkedArtifacts = proposalLinks
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((l) => artifactById.get(l.sourceArtifactId))
      .filter(Boolean);

    return {
      id: proposal.id,
      importJobId: proposal.import_job_id,
      targetTable: proposal.target_table,
      targetId: proposal.target_id,
      fieldName: proposal.field_name,
      oldValue: proposal.old_value,
      newValue: decodeProposalValueForDisplay(proposal.new_value),
      confidence: proposal.confidence,
      status: proposal.status as "pending" | "auto_applied" | "accepted" | "dismissed",
      reason: proposal.reason,
      category: proposal.category as "update" | "correction" | "preference" | "goal" | "new_info" | null,
      memberName: proposal.member_name,
      verbatimQuote: proposal.verbatim_quote,
      ambiguityNote: proposal.ambiguity_note,
      source: {
        type: (job?.type as "spreadsheet" | "audio" | "user_edit") ?? "unknown",
        filename: job?.filename ?? "Unknown source",
        detail: linkedArtifacts[0]
          ? linkedArtifacts[0]?.artifactType === "spreadsheet_row"
            ? `${linkedArtifacts[0]?.sheetName ?? "Sheet"}, row ${linkedArtifacts[0]?.rowNumber ?? "?"}`
            : `Segment ${linkedArtifacts[0]?.segmentIndex ?? "?"}`
          : "No source artifact",
        artifacts: linkedArtifacts.map((artifact) => ({
          id: artifact!.id,
          kind: artifact!.artifactType as "spreadsheet_row" | "transcript_segment",
          detail:
            artifact!.artifactType === "spreadsheet_row"
              ? `${artifact!.sheetName ?? "Sheet"}, row ${artifact!.rowNumber ?? "?"}`
              : `Segment ${artifact!.segmentIndex ?? "?"}, ${formatTimeWindow(artifact!.timestampStart ?? null, artifact!.timestampEnd ?? null)}`,
          segmentIndex: artifact!.segmentIndex,
          timestampStart: artifact!.timestampStart,
          timestampEnd: artifact!.timestampEnd,
        })),
      },
    };
  });

  // Build enrichment view
  const enrichment: EnrichmentView = {
    transcript: artifacts.length
      ? {
          fullText: artifacts.map((a) => (a.rawContent as { text?: string }).text ?? "").filter(Boolean).join(" "),
          segments: artifacts.map((artifact) => ({
            id: artifact.id,
            segmentIndex: artifact.segmentIndex ?? -1,
            text: (artifact.rawContent as { text?: string }).text ?? "",
            start: artifact.timestampStart ?? 0,
            end: artifact.timestampEnd ?? 0,
            extractedFacts: factBySegment.get(artifact.segmentIndex ?? -1) ?? [],
          })),
        }
      : null,
    extractedFacts: proposals.map((proposal) => {
      const segmentIndices = links
        .filter((l) => l.changeProposalId === proposal.id)
        .map((l) => artifactById.get(l.sourceArtifactId)?.segmentIndex ?? -1)
        .filter((i) => i >= 0);

      return {
        id: proposal.id,
        category: proposal.category as "update" | "correction" | "preference" | "goal" | "new_info" | null,
        field: proposal.field_name,
        oldValue: proposal.old_value,
        newValue: decodeProposalValueForDisplay(proposal.new_value),
        confidence: proposal.confidence,
        segmentIndices,
        verbatimQuote: proposal.verbatim_quote,
        ambiguityNote: proposal.ambiguity_note,
        status: proposal.status as "pending" | "auto_applied" | "accepted" | "dismissed",
      };
    }),
  };

  return { changes, enrichment, sources: allJobs };
}

export async function getInsightData(db: DbClient, householdId?: string): Promise<InsightData> {
  const targetHouseholds = householdId
    ? await db.select().from(households).where(eq(households.id, householdId))
    : await db.select().from(households).orderBy(asc(households.name));
  const householdIds = targetHouseholds.map((household) => household.id);
  const householdById = new Map(targetHouseholds.map((household) => [household.id, household]));
  const memberRows = householdIds.length
    ? await db.query.members.findMany({ where: inArray(members.householdId, householdIds) })
    : [];
  const memberRowsByHousehold = groupRowsBy(memberRows, (row) => row.householdId);
  const accountRows = householdIds.length
    ? await db.query.accounts.findMany({ where: inArray(accounts.householdId, householdIds) })
    : [];
  const accountRowsByHousehold = groupRowsBy(accountRows, (row) => row.householdId);
  const insightMemberIds = memberRows.map((m) => m.id);
  const insightBankRows = insightMemberIds.length
    ? await db.query.bankDetails.findMany({ where: inArray(bankDetails.memberId, insightMemberIds) })
    : [];
  const memberToHousehold = new Map(memberRows.map((member) => [member.id, member.householdId]));
  const bankRowsByHousehold = new Map<string, Array<typeof bankDetails.$inferSelect>>();
  for (const bank of insightBankRows) {
    const linkedHouseholdId = memberToHousehold.get(bank.memberId);
    if (!linkedHouseholdId) {
      continue;
    }
    const existing = bankRowsByHousehold.get(linkedHouseholdId) ?? [];
    existing.push(bank);
    bankRowsByHousehold.set(linkedHouseholdId, existing);
  }

  const incomeVsExpenses = targetHouseholds
    .filter((household) => household.income !== null)
    .map((household) => ({
      household: household.name,
      householdId: household.id,
      income: household.income ?? 0,
      expenses: parseExpenseRange(household.expenseRange ?? ""),
    }));

  const netWorthComposition = targetHouseholds
    .filter((household) => household.totalNetWorth !== null || household.liquidNetWorth !== null)
    .map((household) => {
      const liquid = household.liquidNetWorth ?? 0;
      const total = household.totalNetWorth ?? 0;
      return {
        household: household.name,
        householdId: household.id,
        liquid,
        illiquid: Math.max(total - liquid, 0),
      };
    });

  const accountValueDistribution = accountRows
    .filter((account) => account.accountValue !== null)
    .map((account) => {
      const household = householdById.get(account.householdId);
      return {
        household: household?.name ?? "Unknown",
        householdId: account.householdId,
        accountType: account.accountTypeNorm,
        value: account.accountValue ?? 0,
      };
    });

  const householdsWithIncomeSorted = targetHouseholds
    .filter((household) => household.income !== null && household.income > 0)
    .sort((a, b) => (b.income ?? 0) - (a.income ?? 0));
  const totalIncome = householdsWithIncomeSorted.reduce((sum, h) => sum + (h.income ?? 0), 0);
  const incomeConcentration =
    totalIncome > 0
      ? (() => {
          const share = (n: number) =>
            householdsWithIncomeSorted.slice(0, Math.min(n, householdsWithIncomeSorted.length)).reduce((s, h) => s + (h.income ?? 0), 0) /
            totalIncome;
          return {
            top1Share: share(1),
            top3Share: share(3),
            top5Share: share(5),
            householdsWithIncome: householdsWithIncomeSorted.length,
          };
        })()
      : null;

  const membersPerHousehold = targetHouseholds.map((household) => ({
    household: household.name,
    householdId: household.id,
    count: memberRowsByHousehold.get(household.id)?.length ?? 0,
  }));

  const incomeVsNetWorth = targetHouseholds
    .filter((household) => household.income !== null && household.totalNetWorth !== null)
    .map((household) => ({
      household: household.name,
      householdId: household.id,
      income: household.income ?? 0,
      netWorth: household.totalNetWorth ?? 0,
    }));

  const accountTypeDistribution = countEntries(
    accountRows,
    (row) => row.accountTypeNorm || "Unknown",
  ).map(([type, count]) => ({ type, count }));

  const taxBracketDistribution = countEntries(
    targetHouseholds,
    (row) => row.taxBracketRaw || "Unknown",
  ).map(([bracket, count]) => ({ bracket, count }));

  const riskVsTimeHorizon = targetHouseholds
    .filter((household) => household.riskTolerance && household.timeHorizon)
    .map((household) => ({
      household: household.name,
      householdId: household.id,
      riskTolerance: household.riskTolerance ?? "Unknown",
      timeHorizon: household.timeHorizon ?? "Unknown",
    }));
  const highRiskHouseholdCount = targetHouseholds.filter((household) =>
    isHighRiskToleranceLabel(household.riskTolerance),
  ).length;

  const ownershipDistribution = countByNumeric(accountRows, (row) => row.ownershipType || "unknown", (row) => row.accountValue ?? 0).map(
    ([ownershipType, payload]) => ({
      ownershipType,
      totalValue: payload.total,
      accountCount: payload.count,
    }),
  );

  const topHouseholdsByNetWorth = [...targetHouseholds]
    .filter((household) => household.totalNetWorth !== null)
    .sort((a, b) => (b.totalNetWorth ?? 0) - (a.totalNetWorth ?? 0))
    .slice(0, 10)
    .map((household) => ({
      household: household.name,
      householdId: household.id,
      totalNetWorth: household.totalNetWorth ?? 0,
    }));

  const investmentExperienceCategories = [
    "bonds",
    "stocks",
    "alternatives",
    "vas",
    "mutualFunds",
    "options",
    "partnerships",
  ];
  const investmentExperience = {
    categories: investmentExperienceCategories,
    households: targetHouseholds.map((household) => {
      const householdAccounts = accountRowsByHousehold.get(household.id) ?? [];
      // Experience fields are often repeated across multiple imported account rows.
      // Use the highest reported value per household/category to avoid inflating years.
      const totals = investmentExperienceCategories.map((category) => {
        let maxYears = 0;
        for (const account of householdAccounts) {
          const payload = (account.investmentExperience ?? {}) as Record<string, number>;
          const years = payload[category];
          if (typeof years === "number" && Number.isFinite(years)) {
            maxYears = Math.max(maxYears, years);
          }
        }
        return maxYears;
      });
      return {
        householdId: household.id,
        name: household.name,
        values: totals,
      };
    }),
  };

  const completenessMatrix = targetHouseholds.map((household) => {
    const householdMemberRows = memberRowsByHousehold.get(household.id) ?? [];
    const householdAccountRows = accountRowsByHousehold.get(household.id) ?? [];
    const householdBankRows = bankRowsByHousehold.get(household.id) ?? [];
    const fields = getCompletenessFields(household, householdMemberRows, householdAccountRows, householdBankRows);
    return {
      household: household.name,
      householdId: household.id,
      fields,
    };
  });

  // NEW: Net worth distribution in buckets
  const netWorthBuckets = [
    { range: "$0-$500K", min: 0, max: 500_000 },
    { range: "$500K-$1M", min: 500_000, max: 1_000_000 },
    { range: "$1M-$2M", min: 1_000_000, max: 2_000_000 },
    { range: "$2M-$5M", min: 2_000_000, max: 5_000_000 },
    { range: "$5M-$10M", min: 5_000_000, max: 10_000_000 },
    { range: "$10M+", min: 10_000_000, max: Infinity },
  ];
  const netWorthDistribution = netWorthBuckets.map((bucket) => {
    const householdsInBucket = targetHouseholds.filter(
      (h) => h.totalNetWorth !== null && h.totalNetWorth >= bucket.min && h.totalNetWorth < bucket.max,
    );
    const sorted = [...householdsInBucket].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return {
      range: bucket.range,
      count: householdsInBucket.length,
      totalNetWorth: householdsInBucket.reduce((sum, h) => sum + (h.totalNetWorth ?? 0), 0),
      households: sorted.map((h) => ({ household: h.name, householdId: h.id })),
    };
  }).filter((bucket) => bucket.count > 0);

  // NEW: Investment objective distribution
  const investmentObjectiveDistribution = countEntries(
    targetHouseholds,
    (row) => normalizeCategoryKey(row.investmentObjective),
  ).map(([objectiveKey, count]) => ({
    objective: formatCategoryLabel(objectiveKey),
    count,
  }));

  // NEW: Custodian distribution
  const custodianDistribution = countByNumeric(
    accountRows,
    (row) => row.custodian || "Unknown",
    () => 1, // count by account, not by value
  ).map(([custodian, payload]) => ({
    custodian,
    count: payload.count,
    accountCount: payload.count,
  }));

  // NEW: Marital status distribution (from members, deduplicated by household)
  const maritalStatusByHousehold = new Map<string, Set<string>>();
  for (const member of memberRows) {
    const householdId = member.householdId;
    const status = member.maritalStatus || "Unknown";
    if (!maritalStatusByHousehold.has(householdId)) {
      maritalStatusByHousehold.set(householdId, new Set());
    }
    maritalStatusByHousehold.get(householdId)!.add(status);
  }
  const maritalStatusCounts = new Map<string, { memberCount: number; householdCount: number }>();
  for (const member of memberRows) {
    const status = member.maritalStatus || "Unknown";
    const existing = maritalStatusCounts.get(status) ?? { memberCount: 0, householdCount: 0 };
    existing.memberCount += 1;
    maritalStatusCounts.set(status, existing);
  }
  for (const [, statuses] of maritalStatusByHousehold) {
    for (const status of statuses) {
      const existing = maritalStatusCounts.get(status)!;
      existing.householdCount += 1;
    }
  }
  const maritalStatusDistribution = Array.from(maritalStatusCounts.entries())
    .map(([status, counts]) => ({ status, count: counts.memberCount, householdCount: counts.householdCount }))
    .sort((a, b) => b.count - a.count);

  // NEW: Account complexity distribution (accounts per household)
  const accountComplexityDistribution = countEntries(
    targetHouseholds,
    (household) => {
      const count = accountRowsByHousehold.get(household.id)?.length ?? 0;
      if (count === 0) return "No accounts";
      if (count <= 2) return "1-2 accounts";
      if (count <= 5) return "3-5 accounts";
      if (count <= 10) return "6-10 accounts";
      return "10+ accounts";
    },
  ).map(([complexity, count]) => ({ complexity, count }));

  // NEW: Occupation distribution
  const occupationDistribution = countEntries(
    memberRows.filter((m) => !m.isBusinessEntity),
    (row) => row.occupation || "Unknown",
  ).map(([occupation, count]) => ({ occupation, count }));

  let netWorthRank: { rank: number; totalWithNetWorth: number } | null = null;
  if (householdId && targetHouseholds.length === 1) {
    const ranked = await db
      .select({ id: households.id })
      .from(households)
      .where(isNotNull(households.totalNetWorth))
      .orderBy(desc(households.totalNetWorth));
    const idx = ranked.findIndex((row) => row.id === householdId);
    if (idx >= 0) {
      netWorthRank = { rank: idx + 1, totalWithNetWorth: ranked.length };
    }
  }

  return {
    incomeVsExpenses,
    netWorthComposition,
    accountValueDistribution,
    incomeConcentration,
    membersPerHousehold,
    incomeVsNetWorth,
    accountTypeDistribution,
    taxBracketDistribution,
    riskVsTimeHorizon,
    ownershipDistribution,
    topHouseholdsByNetWorth,
    investmentExperience,
    completenessMatrix,
    netWorthDistribution,
    investmentObjectiveDistribution,
    custodianDistribution,
    maritalStatusDistribution,
    accountComplexityDistribution,
    occupationDistribution,
    highRiskHouseholdCount,
    netWorthRank,
  };
}

function computeCompleteness(
  household: typeof households.$inferSelect,
  memberRows: Array<typeof members.$inferSelect>,
  accountRows: Array<typeof accounts.$inferSelect>,
  bankRows: Array<typeof bankDetails.$inferSelect>,
) {
  const fields = getCompletenessFields(household, memberRows, accountRows, bankRows);
  const populated = Object.values(fields).filter(Boolean).length;
  return Math.round((populated / COMPLETENESS_KEYS.length) * 100);
}

function getCompletenessFields(
  household: {
    income: number | null;
    liquidNetWorth: number | null;
    totalNetWorth: number | null;
    taxBracketRaw: string | null;
    expenseRange: string | null;
    riskTolerance: string | null;
    timeHorizon: string | null;
    investmentObjective: string | null;
  },
  memberRows: Array<{
    dob: Date | null;
    phone: string | null;
    email: string | null;
    occupation: string | null;
  }>,
  accountRows: Array<{
    custodian: string | null;
    accountValue: number | null;
  }>,
  bankRows: Array<{ id: string }>,
) {
  return {
    income: household.income !== null,
    liquidNetWorth: household.liquidNetWorth !== null,
    totalNetWorth: household.totalNetWorth !== null,
    taxBracketRaw: !!household.taxBracketRaw,
    expenseRange: !!household.expenseRange,
    riskTolerance: !!household.riskTolerance,
    timeHorizon: !!household.timeHorizon,
    investmentObjective: !!household.investmentObjective,
    memberHasDob: memberRows.some((member) => member.dob !== null),
    memberHasPhone: memberRows.some((member) => !!member.phone),
    memberHasEmail: memberRows.some((member) => !!member.email),
    memberHasOccupation: memberRows.some((member) => !!member.occupation),
    accountHasCustodian: accountRows.some((account) => !!account.custodian),
    accountHasValue: accountRows.some((account) => account.accountValue !== null),
    bankDetailsPresent: bankRows.length > 0,
  };
}

function countBy<T>(rows: T[], select: (row: T) => string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = select(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function groupRowsBy<T>(rows: T[], select: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = select(row);
    const existing = map.get(key) ?? [];
    existing.push(row);
    map.set(key, existing);
  }
  return map;
}

function countEntries<T>(rows: T[], select: (row: T) => string) {
  return Array.from(countBy(rows, select).entries()).sort((a, b) => b[1] - a[1]);
}

function countByNumeric<T>(
  rows: T[],
  select: (row: T) => string,
  amount: (row: T) => number,
) {
  const map = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const key = select(row);
    const existing = map.get(key) ?? { total: 0, count: 0 };
    existing.total += amount(row);
    existing.count += 1;
    map.set(key, existing);
  }
  return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
}

function normalizeCategoryKey(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "__unknown__";
  }
  return trimmed.toLowerCase();
}

function formatCategoryLabel(key: string) {
  if (key === "__unknown__") {
    return "Unknown";
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function isHighRiskToleranceLabel(riskTolerance: string | null | undefined): boolean {
  const t = riskTolerance?.trim() ?? "";
  if (!t) {
    return false;
  }
  return /\bhigh\b/i.test(t) || /\baggressive\b/i.test(t);
}
