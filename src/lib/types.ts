export type HouseholdSummary = {
  id: string;
  name: string;
  memberCount: number;
  accountCount: number;
  income: number | null;
  totalNetWorth: number | null;
  liquidNetWorth: number | null;
  expenseRange: string | null;
  completenessScore: number;
  pendingChanges: number;
  memberNames: string[];
  lastImportAt: string | null;
  lastImportType: "spreadsheet" | "audio" | null;
};

export type HouseholdOption = {
  id: string;
  name: string;
};

export type FieldProvenanceView = {
  fieldName: string;
  sourceType: "spreadsheet" | "audio" | "user_edit";
  setAt: string;
};

type AccountDetail = {
  id: string;
  memberId: string;
  accountTypeRaw: string;
  accountTypeNorm: string;
  coOwnerName: string | null;
  custodian: string | null;
  accountValue: number | null;
  ownershipPct: number | null;
  ownershipType: "sole" | "joint" | "trust" | "business" | "custodial" | null;
  isUncertain: boolean;
};

export type MemberDetail = {
  id: string;
  householdId: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  relationship:
    | "primary"
    | "spouse"
    | "child"
    | "parent"
    | "business_entity"
    | "other";
  dob: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  occupation: string | null;
  employer: string | null;
  maritalStatus: string | null;
  isBusinessEntity: boolean;
  accounts: AccountDetail[];
};

export type HouseholdDetail = {
  id: string;
  name: string;
  income: number | null;
  liquidNetWorth: number | null;
  totalNetWorth: number | null;
  taxBracketRaw: string | null;
  taxBracketPct: number | null;
  expenseRange: string | null;
  riskTolerance: string | null;
  timeHorizon: string | null;
  investmentObjective: string | null;
  address: string | null;
  completenessScore: number;
  pendingChanges: number;
  members: MemberDetail[];
  accounts: AccountDetail[];
  bankDetails: Array<{
    id: string;
    memberId: string;
    bankName: string | null;
    bankType: string | null;
    accountNumber: string | null;
    routingNumber: string | null;
  }>;
  beneficiaries: Array<{
    id: string;
    accountId: string;
    name: string;
    percentage: number | null;
    dob: string | null;
    ordinal: number;
  }>;
};

export type ChangeProposalView = {
  id: string;
  importJobId: string;
  targetTable: string;
  targetId: string | null;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  confidence: number;
  status: "pending" | "auto_applied" | "accepted" | "dismissed";
  reason: string | null;
  category: "update" | "correction" | "preference" | "goal" | "new_info" | null;
  memberName: string | null;
  verbatimQuote: string | null;
  ambiguityNote: string | null;
  source: {
    type: "spreadsheet" | "audio" | "user_edit" | "unknown";
    filename: string;
    detail: string;
    artifacts: Array<{
      id: string;
      kind: "spreadsheet_row" | "transcript_segment";
      detail: string;
      segmentIndex: number | null;
      timestampStart: number | null;
      timestampEnd: number | null;
    }>;
  };
};

export type EnrichmentView = {
  transcript: {
    fullText: string;
    segments: Array<{
      id: string;
      segmentIndex: number;
      text: string;
      start: number;
      end: number;
      extractedFacts: string[];
    }>;
  } | null;
  extractedFacts: Array<{
    id: string;
    category: "update" | "correction" | "preference" | "goal" | "new_info" | null;
    field: string;
    oldValue: string | null;
    newValue: string;
    confidence: number;
    segmentIndices: number[];
    verbatimQuote: string | null;
    ambiguityNote: string | null;
    status: "pending" | "auto_applied" | "accepted" | "dismissed";
  }>;
};

export type InsightData = {
  incomeVsExpenses: Array<{
    household: string;
    householdId: string;
    income: number;
    expenses: number | null;
  }>;
  netWorthComposition: Array<{
    household: string;
    householdId: string;
    liquid: number;
    illiquid: number;
  }>;
  accountValueDistribution: Array<{
    household: string;
    householdId: string;
    accountType: string;
    value: number;
  }>;
  /** Share of total reported income from highest-earning households (book-level); distinct from net-worth ranking. */
  incomeConcentration: {
    top1Share: number;
    top3Share: number;
    top5Share: number;
    householdsWithIncome: number;
  } | null;
  membersPerHousehold: Array<{ household: string; householdId: string; count: number }>;
  incomeVsNetWorth: Array<{
    household: string;
    householdId: string;
    income: number;
    netWorth: number;
  }>;
  accountTypeDistribution: Array<{ type: string; count: number }>;
  taxBracketDistribution: Array<{ bracket: string; count: number }>;
  riskVsTimeHorizon: Array<{
    household: string;
    householdId: string;
    riskTolerance: string;
    timeHorizon: string;
  }>;
  ownershipDistribution: Array<{
    ownershipType: string;
    totalValue: number;
    accountCount: number;
  }>;
  topHouseholdsByNetWorth: Array<{
    household: string;
    householdId: string;
    totalNetWorth: number;
  }>;
  investmentExperience: {
    categories: string[];
    households: Array<{
      householdId: string;
      name: string;
      values: number[];
    }>;
  };
  completenessMatrix: Array<{
    household: string;
    householdId: string;
    fields: Record<string, boolean>;
  }>;
  // NEW: Net worth distribution for histogram view
  netWorthDistribution: Array<{
    range: string;
    count: number;
    totalNetWorth: number;
    /** Households in this tier (for tooltips); sorted by name. */
    households: Array<{ household: string; householdId: string }>;
  }>;
  // NEW: Investment objective distribution
  investmentObjectiveDistribution: Array<{ objective: string; count: number }>;
  // NEW: Custodian distribution
  custodianDistribution: Array<{ custodian: string; count: number; accountCount: number }>;
  // NEW: Marital status distribution
  maritalStatusDistribution: Array<{ status: string; count: number; householdCount: number }>;
  // NEW: Account complexity (accounts per household)
  accountComplexityDistribution: Array<{ complexity: string; count: number }>;
  // NEW: Occupation/employer distribution
  occupationDistribution: Array<{ occupation: string; count: number }>;
  /** Number of households in scope with risk tolerance tagged as high/aggressive. */
  highRiskHouseholdCount: number;
  /** Present when insights are scoped to a single household with net worth on file. */
  netWorthRank: { rank: number; totalWithNetWorth: number } | null;
};
