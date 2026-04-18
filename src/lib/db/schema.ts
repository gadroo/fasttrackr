import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const households = pgTable(
  "households",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    income: doublePrecision("income"),
    liquidNetWorth: doublePrecision("liquid_net_worth"),
    totalNetWorth: doublePrecision("total_net_worth"),
    taxBracketRaw: text("tax_bracket_raw"),
    taxBracketPct: doublePrecision("tax_bracket_pct"),
    expenseRange: text("expense_range"),
    riskTolerance: text("risk_tolerance"),
    timeHorizon: text("time_horizon"),
    investmentObjective: text("investment_objective"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("households_name_address_uq").on(table.name, table.address)],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    relationship: text("relationship").default("other"),
    dob: timestamp("dob", { mode: "date", withTimezone: false }),
    dobRaw: text("dob_raw"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    occupation: text("occupation"),
    employer: text("employer"),
    maritalStatus: text("marital_status"),
    isBusinessEntity: boolean("is_business_entity").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("members_household_idx").on(table.householdId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountTypeRaw: text("account_type_raw").notNull(),
    accountTypeNorm: text("account_type_norm").notNull(),
    coOwnerName: text("co_owner_name"),
    custodian: text("custodian"),
    accountValue: doublePrecision("account_value"),
    ownershipPct: doublePrecision("ownership_pct"),
    ownershipType: text("ownership_type"),
    decisionMaking: text("decision_making"),
    sourceOfFunds: text("source_of_funds"),
    primaryUse: text("primary_use"),
    liquidityNeeds: text("liquidity_needs"),
    liquidityHorizon: text("liquidity_horizon"),
    isUncertain: boolean("is_uncertain").default(false).notNull(),
    investmentExperience: jsonb("investment_experience"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("accounts_member_idx").on(table.memberId),
    index("accounts_household_idx").on(table.householdId),
  ],
);

export const bankDetails = pgTable(
  "bank_details",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    bankName: text("bank_name"),
    bankType: text("bank_type"),
    accountNumber: text("account_number"),
    routingNumber: text("routing_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("bank_member_idx").on(table.memberId)],
);

export const beneficiaries = pgTable(
  "beneficiaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    percentage: doublePrecision("percentage"),
    dob: timestamp("dob", { mode: "date", withTimezone: false }),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [index("beneficiary_account_idx").on(table.accountId)],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    filename: text("filename").notNull(),
    status: text("status").notNull().default("pending"),
    targetHouseholdId: uuid("target_household_id").references(() => households.id),
    rowCount: integer("row_count"),
    sheetsFound: integer("sheets_found"),
    sheetsParsed: integer("sheets_parsed"),
    sheetsSkipped: integer("sheets_skipped"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("import_jobs_type_idx").on(table.type)],
);

export const sourceArtifacts = pgTable(
  "source_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").notNull(),
    rawContent: jsonb("raw_content").notNull(),
    sheetName: text("sheet_name"),
    rowNumber: integer("row_number"),
    segmentIndex: integer("segment_index"),
    timestampStart: doublePrecision("timestamp_start"),
    timestampEnd: doublePrecision("timestamp_end"),
  },
  (table) => [index("artifacts_import_idx").on(table.importJobId)],
);

export const changeProposals = pgTable(
  "change_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    targetTable: text("target_table").notNull(),
    targetId: uuid("target_id"),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value").notNull(),
    confidence: doublePrecision("confidence").notNull().default(1),
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    category: text("category"),
    memberName: text("member_name"),
    verbatimQuote: text("verbatim_quote"),
    ambiguityNote: text("ambiguity_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("change_proposals_import_idx").on(table.importJobId)],
);

export const changeProposalArtifacts = pgTable(
  "change_proposal_artifacts",
  {
    changeProposalId: uuid("change_proposal_id")
      .notNull()
      .references(() => changeProposals.id, { onDelete: "cascade" }),
    sourceArtifactId: uuid("source_artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.changeProposalId, table.sourceArtifactId] }),
    index("change_proposal_artifacts_idx").on(table.changeProposalId),
  ],
);

export const fieldProvenance = pgTable(
  "field_provenance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetTable: text("target_table").notNull(),
    targetId: uuid("target_id").notNull(),
    fieldName: text("field_name").notNull(),
    sourceType: text("source_type").notNull(),
    sourceArtifactId: uuid("source_artifact_id").references(() => sourceArtifacts.id, {
      onDelete: "set null",
    }),
    importJobId: uuid("import_job_id").references(() => importJobs.id, {
      onDelete: "set null",
    }),
    setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("field_provenance_unique").on(
      table.targetTable,
      table.targetId,
      table.fieldName,
    ),
    index("field_provenance_target_idx").on(table.targetTable, table.targetId),
  ],
);
