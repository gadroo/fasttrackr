import { parseCurrency } from "@/lib/utils";

type ProposalTargetTable = "households" | "members" | "accounts";

const NUMERIC_FIELDS_BY_TABLE: Record<ProposalTargetTable, Set<string>> = {
  households: new Set(["income", "liquidNetWorth", "totalNetWorth", "taxBracketPct"]),
  members: new Set([]),
  accounts: new Set(["accountValue", "ownershipPct"]),
};

const NUMERIC_FIELDS = new Set(
  Object.values(NUMERIC_FIELDS_BY_TABLE).flatMap((fields) => Array.from(fields)),
);

export function isNumericFieldName(fieldName: string) {
  return NUMERIC_FIELDS.has(fieldName);
}

export function castProposalFieldValue(
  targetTable: ProposalTargetTable,
  fieldName: string,
  value: string | null,
) {
  if (value === null) {
    return null;
  }
  if (!NUMERIC_FIELDS_BY_TABLE[targetTable].has(fieldName)) {
    return value;
  }
  const numeric = parseCurrency(value);
  return numeric ?? value;
}
