import { desc, eq, sql } from "drizzle-orm";

import type { DbClient } from "@/lib/db/client";
import type { ProvenanceInput } from "@/lib/db/provenance";
import {
  accounts,
  bankDetails,
  beneficiaries,
  changeProposalArtifacts,
  changeProposals,
  fieldProvenance,
  households,
  importJobs,
  members,
  sourceArtifacts,
} from "@/lib/db/schema";
import { parseWorkbook, type ParsedImportRow } from "@/lib/import/parse";
import {
  levenshtein,
  normalizeMemberEmailList,
  normalizeNameForMatch,
  normalizeString,
} from "@/lib/utils";

type ImportResult = {
  importJobId: string;
  householdsCreated: number;
  membersCreated: number;
  accountsCreated: number;
  changeProposalsCreated: number;
  rowsProcessed: number;
  sheetsFound: number;
  sheetsParsed: number;
  sheetsSkipped: number;
  skippedSheets: string[];
};

type HouseholdEntity = typeof households.$inferSelect;
type MemberEntity = typeof members.$inferSelect;
type AccountEntity = typeof accounts.$inferSelect;
type BankDetailsEntity = typeof bankDetails.$inferSelect;
type BeneficiaryEntity = typeof beneficiaries.$inferSelect;

type ImportContext = {
  db: DbClient;
  importJobId: string;
  householdCache: Map<string, HouseholdEntity>;
  memberCache: Map<string, MemberEntity>;
  accountCache: Map<string, AccountEntity>;
  bankDetailsCache: Map<string, BankDetailsEntity | null>;
  beneficiaryCache: Map<string, Map<number, BeneficiaryEntity>>;
  pendingProposalKeys: Set<string>;
  pendingProvenance: Map<string, ProvenanceInput>;
  counters: {
    householdsCreated: number;
    membersCreated: number;
    accountsCreated: number;
    changeProposalsCreated: number;
  };
};

export async function importSpreadsheet(params: {
  db: DbClient;
  filename: string;
  fileBuffer: Buffer;
}): Promise<ImportResult> {
  const { db, filename, fileBuffer } = params;
  const parsed = parseWorkbook(fileBuffer, filename);

  const [job] = await db
    .insert(importJobs)
    .values({
      type: "spreadsheet",
      filename,
      status: "processing",
      rowCount: parsed.rows.length,
      sheetsFound: parsed.sheetsFound,
      sheetsParsed: parsed.sheetsParsed,
      sheetsSkipped: parsed.sheetsSkipped,
    })
    .returning({ id: importJobs.id });

  const [
    householdCache,
    memberCache,
    accountCache,
    bankDetailsCache,
    beneficiaryCache,
    pendingProposalKeys,
  ] = await Promise.all([
    preloadHouseholds(db),
    preloadMembers(db),
    preloadAccounts(db),
    preloadBankDetails(db),
    preloadBeneficiaries(db),
    preloadPendingProposalKeys(db),
  ]);

  const ctx: ImportContext = {
    db,
    importJobId: job.id,
    householdCache,
    memberCache,
    accountCache,
    bankDetailsCache,
    beneficiaryCache,
    pendingProposalKeys,
    pendingProvenance: new Map(),
    counters: {
      householdsCreated: 0,
      membersCreated: 0,
      accountsCreated: 0,
      changeProposalsCreated: 0,
    },
  };

  const rowArtifactIds = await insertRowArtifacts(ctx, parsed.rows);

  try {
    for (const [index, row] of parsed.rows.entries()) {
      await processRow(ctx, row, rowArtifactIds[index]);
    }

    await db
      .update(importJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(importJobs.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Spreadsheet import failed";
    await db
      .update(importJobs)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(importJobs.id, job.id));
    throw error;
  }

  return {
    importJobId: job.id,
    householdsCreated: ctx.counters.householdsCreated,
    membersCreated: ctx.counters.membersCreated,
    accountsCreated: ctx.counters.accountsCreated,
    changeProposalsCreated: ctx.counters.changeProposalsCreated,
    rowsProcessed: parsed.rows.length,
    sheetsFound: parsed.sheetsFound,
    sheetsParsed: parsed.sheetsParsed,
    sheetsSkipped: parsed.sheetsSkipped,
    skippedSheets: parsed.skippedSheets,
  };
}

async function preloadHouseholds(db: DbClient) {
  const existing = await db.query.households.findMany();
  return new Map(existing.map((household) => [matchHouseholdKey(household.name), household]));
}

async function preloadMembers(db: DbClient) {
  const existing = await db.query.members.findMany();
  return new Map(
    existing.map((member) => [
      makeMemberKey(member.householdId, member.firstName, member.lastName),
      member,
    ]),
  );
}

async function preloadAccounts(db: DbClient) {
  const existing = await db.query.accounts.findMany();
  return new Map(
    existing.map((account) => [
      makeAccountKey(account.memberId, account.accountTypeRaw, account.custodian, account.coOwnerName),
      account,
    ]),
  );
}

async function preloadBankDetails(db: DbClient) {
  const existing = await db.query.bankDetails.findMany({
    orderBy: [desc(bankDetails.createdAt)],
  });

  const byMember = new Map<string, BankDetailsEntity | null>();
  for (const item of existing) {
    if (!byMember.has(item.memberId)) {
      byMember.set(item.memberId, item);
    }
  }

  return byMember;
}

async function preloadBeneficiaries(db: DbClient) {
  const existing = await db.query.beneficiaries.findMany();
  const byAccount = new Map<string, Map<number, BeneficiaryEntity>>();

  for (const item of existing) {
    const accountEntries = byAccount.get(item.accountId) ?? new Map<number, BeneficiaryEntity>();
    accountEntries.set(item.ordinal, item);
    byAccount.set(item.accountId, accountEntries);
  }

  return byAccount;
}

async function preloadPendingProposalKeys(db: DbClient) {
  const existing = await db.query.changeProposals.findMany({
    where: eq(changeProposals.status, "pending"),
    columns: {
      targetTable: true,
      targetId: true,
      fieldName: true,
      oldValue: true,
      newValue: true,
    },
  });

  const keys = new Set<string>();
  for (const proposal of existing) {
    if (!isSupportedTargetTable(proposal.targetTable)) {
      continue;
    }
    keys.add(
      makeProposalKey(
        proposal.targetTable,
        proposal.targetId ?? "",
        proposal.fieldName,
        proposal.oldValue ?? "",
        proposal.newValue,
      ),
    );
  }
  return keys;
}

async function insertRowArtifacts(ctx: ImportContext, rows: ParsedImportRow[]) {
  const inserted = await ctx.db
    .insert(sourceArtifacts)
    .values(
      rows.map((row) => ({
        importJobId: ctx.importJobId,
        artifactType: "spreadsheet_row",
        rawContent: row as unknown as Record<string, unknown>,
        sheetName: row.sourceSheet,
        rowNumber: row.sourceRowNumber,
      })),
    )
    .returning({ id: sourceArtifacts.id });
  return inserted.map((artifact) => artifact.id);
}

async function processRow(ctx: ImportContext, row: ParsedImportRow, artifactId: string) {
  try {
    const household = await resolveHousehold(ctx, row, artifactId);
    const member = await resolveMember(ctx, household.id, row, artifactId);
    const account = await resolveAccount(ctx, household.id, member.id, row, artifactId);

    await upsertBankDetails(ctx, member.id, row, artifactId);
    await upsertBeneficiaries(ctx, account.id, row);
  } finally {
    await flushQueuedProvenance(ctx);
  }
}

async function resolveHousehold(
  ctx: ImportContext,
  row: ParsedImportRow,
  artifactId: string,
): Promise<HouseholdEntity> {
  const directKey = matchHouseholdKey(row.householdName);
  let household = ctx.householdCache.get(directKey);

  if (!household) {
    household = findFuzzyHousehold(ctx.householdCache, row.householdName, row.address);
  }

  if (!household) {
    const [inserted] = await ctx.db
      .insert(households)
      .values({
        name: row.householdName,
        income: row.income,
        liquidNetWorth: row.liquidNetWorth,
        totalNetWorth: row.totalNetWorth,
        taxBracketRaw: row.taxBracketRaw,
        taxBracketPct: row.taxBracketPct,
        expenseRange: row.expenseRange,
        riskTolerance: row.riskTolerance,
        timeHorizon: row.timeHorizon,
        investmentObjective: row.investmentObjective,
        address: row.address,
      })
      .returning();
    ctx.counters.householdsCreated += 1;
    ctx.householdCache.set(directKey, inserted);

    const fields = [
      ["income", row.income],
      ["liquidNetWorth", row.liquidNetWorth],
      ["totalNetWorth", row.totalNetWorth],
      ["taxBracketRaw", row.taxBracketRaw],
      ["taxBracketPct", row.taxBracketPct],
      ["expenseRange", row.expenseRange],
      ["riskTolerance", row.riskTolerance],
      ["timeHorizon", row.timeHorizon],
      ["investmentObjective", row.investmentObjective],
      ["address", row.address],
    ] as const;
    for (const [fieldName, value] of fields) {
      if (value !== null && value !== undefined) {
        queueProvenance(ctx, {
          targetTable: "households",
          targetId: inserted.id,
          fieldName,
          sourceType: "spreadsheet",
          sourceArtifactId: artifactId,
          importJobId: ctx.importJobId,
        });
      }
    }
    return inserted;
  }

  const householdUpdates: Partial<typeof households.$inferInsert> = {};
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "income",
    currentValue: household.income,
    nextValue: row.income,
    artifactId,
    patch: householdUpdates,
    patchKey: "income",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "liquidNetWorth",
    currentValue: household.liquidNetWorth,
    nextValue: row.liquidNetWorth,
    artifactId,
    patch: householdUpdates,
    patchKey: "liquidNetWorth",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "totalNetWorth",
    currentValue: household.totalNetWorth,
    nextValue: row.totalNetWorth,
    artifactId,
    patch: householdUpdates,
    patchKey: "totalNetWorth",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "taxBracketRaw",
    currentValue: household.taxBracketRaw,
    nextValue: row.taxBracketRaw,
    artifactId,
    patch: householdUpdates,
    patchKey: "taxBracketRaw",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "taxBracketPct",
    currentValue: household.taxBracketPct,
    nextValue: row.taxBracketPct,
    artifactId,
    patch: householdUpdates,
    patchKey: "taxBracketPct",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "expenseRange",
    currentValue: household.expenseRange,
    nextValue: row.expenseRange,
    artifactId,
    patch: householdUpdates,
    patchKey: "expenseRange",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "riskTolerance",
    currentValue: household.riskTolerance,
    nextValue: row.riskTolerance,
    artifactId,
    patch: householdUpdates,
    patchKey: "riskTolerance",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "timeHorizon",
    currentValue: household.timeHorizon,
    nextValue: row.timeHorizon,
    artifactId,
    patch: householdUpdates,
    patchKey: "timeHorizon",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "investmentObjective",
    currentValue: household.investmentObjective,
    nextValue: row.investmentObjective,
    artifactId,
    patch: householdUpdates,
    patchKey: "investmentObjective",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "households",
    targetId: household.id,
    fieldName: "address",
    currentValue: household.address,
    nextValue: row.address,
    artifactId,
    patch: householdUpdates,
    patchKey: "address",
  });

  if (Object.keys(householdUpdates).length > 0) {
    const [updated] = await ctx.db
      .update(households)
      .set({ ...householdUpdates, updatedAt: new Date() })
      .where(eq(households.id, household.id))
      .returning();
    ctx.householdCache.set(matchHouseholdKey(updated.name), updated);
    return updated;
  }

  return household;
}

async function resolveMember(
  ctx: ImportContext,
  householdId: string,
  row: ParsedImportRow,
  artifactId: string,
): Promise<MemberEntity> {
  const memberKey = makeMemberKey(householdId, row.firstName, row.lastName);
  const member = ctx.memberCache.get(memberKey);

  if (!member) {
    const [inserted] = await ctx.db
      .insert(members)
      .values({
        householdId,
        firstName: row.firstName,
        lastName: row.lastName,
        relationship: row.relationship,
        dob: row.dob,
        dobRaw: row.dobRaw,
        phone: row.phone,
        email: normalizeMemberEmailList(row.email),
        address: row.address,
        occupation: row.occupation,
        employer: row.employer,
        maritalStatus: row.maritalStatus,
        isBusinessEntity: row.isBusinessEntity,
      })
      .returning();
    ctx.counters.membersCreated += 1;
    ctx.memberCache.set(memberKey, inserted);
    ctx.bankDetailsCache.set(inserted.id, null);

    const fields = [
      ["relationship", row.relationship],
      ["dob", row.dob],
      ["phone", row.phone],
      ["email", row.email],
      ["address", row.address],
      ["occupation", row.occupation],
      ["employer", row.employer],
      ["maritalStatus", row.maritalStatus],
    ] as const;
    for (const [fieldName, value] of fields) {
      if (value !== null && value !== undefined) {
        queueProvenance(ctx, {
          targetTable: "members",
          targetId: inserted.id,
          fieldName,
          sourceType: "spreadsheet",
          sourceArtifactId: artifactId,
          importJobId: ctx.importJobId,
        });
      }
    }
    return inserted;
  }

  const updates: Partial<typeof members.$inferInsert> = {};
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "members",
    targetId: member.id,
    fieldName: "relationship",
    currentValue: member.relationship,
    nextValue: row.relationship,
    artifactId,
    patch: updates,
    patchKey: "relationship",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "members",
    targetId: member.id,
    fieldName: "dobRaw",
    currentValue: member.dobRaw,
    nextValue: row.dobRaw,
    artifactId,
    patch: updates,
    patchKey: "dobRaw",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "members",
    targetId: member.id,
    fieldName: "phone",
    currentValue: member.phone,
    nextValue: row.phone,
    artifactId,
    patch: updates,
    patchKey: "phone",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "members",
    targetId: member.id,
    fieldName: "email",
    currentValue: member.email,
    nextValue: row.email,
    artifactId,
    patch: updates,
    patchKey: "email",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "members",
    targetId: member.id,
    fieldName: "occupation",
    currentValue: member.occupation,
    nextValue: row.occupation,
    artifactId,
    patch: updates,
    patchKey: "occupation",
  });

  if (Object.keys(updates).length > 0) {
    const [updated] = await ctx.db
      .update(members)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(members.id, member.id))
      .returning();
    ctx.memberCache.set(memberKey, updated);
    return updated;
  }

  return member;
}

async function resolveAccount(
  ctx: ImportContext,
  householdId: string,
  memberId: string,
  row: ParsedImportRow,
  artifactId: string,
): Promise<AccountEntity> {
  const accountKey = makeAccountKey(memberId, row.accountTypeRaw, row.custodian, row.coOwnerName);
  const account = ctx.accountCache.get(accountKey);

  if (!account) {
    const [inserted] = await ctx.db
      .insert(accounts)
      .values({
        memberId,
        householdId,
        accountTypeRaw: row.accountTypeRaw,
        accountTypeNorm: row.accountTypeNorm,
        coOwnerName: row.coOwnerName,
        custodian: row.custodian,
        ownershipType: row.ownershipType,
        ownershipPct: row.ownershipPct,
        decisionMaking: row.decisionMaking,
        sourceOfFunds: row.sourceOfFunds,
        primaryUse: row.primaryUse,
        liquidityNeeds: row.liquidityNeeds,
        liquidityHorizon: row.liquidityHorizon,
        isUncertain: row.isUncertain,
        investmentExperience: row.investmentExperience,
      })
      .returning();
    ctx.counters.accountsCreated += 1;
    ctx.accountCache.set(accountKey, inserted);
    ctx.beneficiaryCache.set(inserted.id, new Map());

    const fields = [
      ["accountTypeRaw", row.accountTypeRaw],
      ["accountTypeNorm", row.accountTypeNorm],
      ["coOwnerName", row.coOwnerName],
      ["custodian", row.custodian],
      ["ownershipType", row.ownershipType],
      ["ownershipPct", row.ownershipPct],
      ["decisionMaking", row.decisionMaking],
      ["sourceOfFunds", row.sourceOfFunds],
      ["primaryUse", row.primaryUse],
      ["liquidityNeeds", row.liquidityNeeds],
      ["liquidityHorizon", row.liquidityHorizon],
    ] as const;
    for (const [fieldName, value] of fields) {
      if (value !== null && value !== undefined) {
        queueProvenance(ctx, {
          targetTable: "accounts",
          targetId: inserted.id,
          fieldName,
          sourceType: "spreadsheet",
          sourceArtifactId: artifactId,
          importJobId: ctx.importJobId,
        });
      }
    }
    return inserted;
  }

  const updates: Partial<typeof accounts.$inferInsert> = {};
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "accounts",
    targetId: account.id,
    fieldName: "ownershipType",
    currentValue: account.ownershipType,
    nextValue: row.ownershipType,
    artifactId,
    patch: updates,
    patchKey: "ownershipType",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "accounts",
    targetId: account.id,
    fieldName: "ownershipPct",
    currentValue: account.ownershipPct,
    nextValue: row.ownershipPct,
    artifactId,
    patch: updates,
    patchKey: "ownershipPct",
  });
  await applyOrProposeFieldChange({
    ctx,
    targetTable: "accounts",
    targetId: account.id,
    fieldName: "liquidityNeeds",
    currentValue: account.liquidityNeeds,
    nextValue: row.liquidityNeeds,
    artifactId,
    patch: updates,
    patchKey: "liquidityNeeds",
  });

  if (Object.keys(updates).length > 0) {
    const [updated] = await ctx.db
      .update(accounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(accounts.id, account.id))
      .returning();
    ctx.accountCache.set(accountKey, updated);
    return updated;
  }

  return account;
}

async function upsertBankDetails(
  ctx: ImportContext,
  memberId: string,
  row: ParsedImportRow,
  artifactId: string,
) {
  if (!row.bankName && !row.bankType && !row.bankAccountNumber) {
    return;
  }
  let existing = ctx.bankDetailsCache.get(memberId);
  if (existing === undefined) {
    existing = null;
    ctx.bankDetailsCache.set(memberId, existing);
  }

  if (!existing) {
    const [inserted] = await ctx.db
      .insert(bankDetails)
      .values({
        memberId,
        bankName: row.bankName,
        bankType: row.bankType,
        accountNumber: row.bankAccountNumber,
        routingNumber: null,
      })
      .returning();
    ctx.bankDetailsCache.set(memberId, inserted);
    return;
  }

  const nextBankName = existing.bankName ?? row.bankName;
  const nextBankType = existing.bankType ?? row.bankType;
  const nextAccountNumber = existing.accountNumber ?? row.bankAccountNumber;

  if (
    isSameValue(existing.bankName, nextBankName) &&
    isSameValue(existing.bankType, nextBankType) &&
    isSameValue(existing.accountNumber, nextAccountNumber)
  ) {
    return;
  }

  const [updated] = await ctx.db
    .update(bankDetails)
    .set({
      bankName: nextBankName,
      bankType: nextBankType,
      accountNumber: nextAccountNumber,
    })
    .where(eq(bankDetails.id, existing.id))
    .returning();
  ctx.bankDetailsCache.set(memberId, updated);

  queueProvenance(ctx, {
    targetTable: "members",
    targetId: memberId,
    fieldName: "bankDetails",
    sourceType: "spreadsheet",
    sourceArtifactId: artifactId,
    importJobId: ctx.importJobId,
  });
}

async function upsertBeneficiaries(ctx: ImportContext, accountId: string, row: ParsedImportRow) {
  if (!row.beneficiary1Name && !row.beneficiary2Name) {
    return;
  }

  const entries: Array<{
    name: string | null;
    percentage: number | null;
    dob: Date | null;
    ordinal: number;
  }> = [
    {
      name: row.beneficiary1Name,
      percentage: row.beneficiary1Pct,
      dob: row.beneficiary1Dob,
      ordinal: 1,
    },
    {
      name: row.beneficiary2Name,
      percentage: row.beneficiary2Pct,
      dob: row.beneficiary2Dob,
      ordinal: 2,
    },
  ];

  let accountBeneficiaries = ctx.beneficiaryCache.get(accountId);
  if (!accountBeneficiaries) {
    accountBeneficiaries = new Map();
    ctx.beneficiaryCache.set(accountId, accountBeneficiaries);
  }

  for (const entry of entries) {
    if (!entry.name) {
      continue;
    }
    const existing = accountBeneficiaries.get(entry.ordinal);
    if (existing) {
      const nextName = existing.name || entry.name;
      const nextPercentage = existing.percentage ?? entry.percentage;
      const nextDob = existing.dob ?? entry.dob;

      if (
        isSameValue(existing.name, nextName) &&
        isSameValue(existing.percentage, nextPercentage) &&
        isSameDateValue(existing.dob, nextDob)
      ) {
        continue;
      }

      const [updated] = await ctx.db
        .update(beneficiaries)
        .set({
          name: nextName,
          percentage: nextPercentage,
          dob: nextDob,
        })
        .where(eq(beneficiaries.id, existing.id))
        .returning();
      accountBeneficiaries.set(entry.ordinal, updated);
      continue;
    }

    const [inserted] = await ctx.db
      .insert(beneficiaries)
      .values({
        accountId,
        name: entry.name,
        percentage: entry.percentage,
        dob: entry.dob,
        ordinal: entry.ordinal,
      })
      .returning();
    accountBeneficiaries.set(entry.ordinal, inserted);
  }
}

async function applyOrProposeFieldChange<TPatch extends Record<string, unknown>>(params: {
  ctx: ImportContext;
  targetTable: "households" | "members" | "accounts";
  targetId: string;
  fieldName: string;
  currentValue: unknown;
  nextValue: unknown;
  artifactId: string;
  patch: TPatch;
  patchKey: keyof TPatch;
}) {
  const { ctx, targetTable, targetId, fieldName, currentValue, nextValue, artifactId, patch, patchKey } =
    params;
  if (nextValue === null || nextValue === undefined || nextValue === "") {
    return;
  }
  const normalizedNext =
    fieldName === "email" ? normalizeMemberEmailList(String(nextValue)) : nextValue;
  if (fieldName === "email" && !normalizedNext) {
    return;
  }
  if (isSameValue(currentValue, normalizedNext, fieldName)) {
    return;
  }
  if (currentValue === null || currentValue === undefined || currentValue === "") {
    patch[patchKey] = normalizedNext as TPatch[keyof TPatch];
    queueProvenance(ctx, {
      targetTable,
      targetId,
      fieldName,
      sourceType: "spreadsheet",
      sourceArtifactId: artifactId,
      importJobId: ctx.importJobId,
    });
    return;
  }

  const oldValue = String(currentValue);
  const newValue = String(normalizedNext);
  const proposalKey = makeProposalKey(targetTable, targetId, fieldName, oldValue, newValue);
  if (ctx.pendingProposalKeys.has(proposalKey)) {
    return;
  }

  const [proposal] = await ctx.db
    .insert(changeProposals)
    .values({
      importJobId: ctx.importJobId,
      targetTable,
      targetId,
      fieldName,
      oldValue,
      newValue,
      confidence: 0.72,
      status: "pending",
      reason: "Conflict between existing value and spreadsheet re-import.",
    })
    .returning({ id: changeProposals.id });
  await ctx.db.insert(changeProposalArtifacts).values({
    changeProposalId: proposal.id,
    sourceArtifactId: artifactId,
    ordinal: 0,
  });
  ctx.pendingProposalKeys.add(proposalKey);
  ctx.counters.changeProposalsCreated += 1;
}

function queueProvenance(ctx: ImportContext, input: ProvenanceInput) {
  const key = `${input.targetTable}:${input.targetId}:${input.fieldName}`;
  ctx.pendingProvenance.set(key, input);
}

async function flushQueuedProvenance(ctx: ImportContext) {
  if (!ctx.pendingProvenance.size) {
    return;
  }

  const pending = Array.from(ctx.pendingProvenance.values());
  ctx.pendingProvenance.clear();

  await ctx.db
    .insert(fieldProvenance)
    .values(
      pending.map((item) => ({
        ...item,
        sourceArtifactId: item.sourceArtifactId ?? null,
        importJobId: item.importJobId ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [fieldProvenance.targetTable, fieldProvenance.targetId, fieldProvenance.fieldName],
      set: {
        sourceType: sql`excluded.source_type`,
        sourceArtifactId: sql`excluded.source_artifact_id`,
        importJobId: sql`excluded.import_job_id`,
        setAt: new Date(),
      },
    });
}

function isSameValue(currentValue: unknown, nextValue: unknown, fieldName?: string) {
  if (fieldName === "email") {
    const a = normalizeMemberEmailList(String(currentValue ?? ""));
    const b = normalizeMemberEmailList(String(nextValue ?? ""));
    return (a ?? "") === (b ?? "");
  }
  if (typeof currentValue === "number" && typeof nextValue === "number") {
    return Math.abs(currentValue - nextValue) < 1e-9;
  }
  return normalizeString(String(currentValue ?? "")) === normalizeString(String(nextValue ?? ""));
}

function isSameDateValue(currentValue: Date | null, nextValue: Date | null) {
  if (!currentValue && !nextValue) {
    return true;
  }
  if (!currentValue || !nextValue) {
    return false;
  }
  return currentValue.getTime() === nextValue.getTime();
}

function findFuzzyHousehold(
  householdsByName: Map<string, HouseholdEntity>,
  householdName: string,
  address: string | null,
) {
  const normalized = matchHouseholdKey(householdName);
  const candidates = Array.from(householdsByName.values());
  for (const candidate of candidates) {
    const distance = levenshtein(normalized, matchHouseholdKey(candidate.name));
    if (distance <= 2) {
      if (!address || !candidate.address) {
        return candidate;
      }
      if (normalizeString(address) === normalizeString(candidate.address)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function makeMemberKey(householdId: string, firstName: string, lastName: string | null) {
  return `${householdId}:${normalizeNameForMatch(firstName)}:${normalizeNameForMatch(lastName ?? "")}`;
}

function makeAccountKey(
  memberId: string,
  accountTypeRaw: string,
  custodian: string | null,
  coOwnerName: string | null,
) {
  return [
    memberId,
    normalizeString(accountTypeRaw),
    normalizeString(custodian ?? ""),
    normalizeString(coOwnerName ?? ""),
  ].join(":");
}

function makeProposalKey(
  targetTable: "households" | "members" | "accounts",
  targetId: string,
  fieldName: string,
  oldValue: string,
  newValue: string,
) {
  return [targetTable, targetId, fieldName, oldValue, newValue].join("|");
}

function isSupportedTargetTable(value: string): value is "households" | "members" | "accounts" {
  return value === "households" || value === "members" || value === "accounts";
}

function matchHouseholdKey(name: string) {
  return normalizeNameForMatch(name);
}
