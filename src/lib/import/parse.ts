import * as XLSX from "xlsx";

import { canonicalHeader, requiredHouseholdHeaders } from "@/lib/import/header-aliases";
import {
  normalizeNameForMatch,
  parseCurrency,
  parseDate,
  parseExpenseRange,
  parsePhone,
  parseTaxBracket,
} from "@/lib/utils";

export type ParsedImportRow = {
  sourceSheet: string;
  sourceRowNumber: number;
  householdName: string;
  firstName: string;
  lastName: string | null;
  accountTypeRaw: string;
  accountTypeNorm: string;
  coOwnerName: string | null;
  isUncertain: boolean;
  custodian: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  dob: Date | null;
  dobRaw: string | null;
  occupation: string | null;
  employer: string | null;
  taxBracketRaw: string | null;
  taxBracketPct: number | null;
  income: number | null;
  liquidNetWorth: number | null;
  totalNetWorth: number | null;
  investmentObjective: string | null;
  riskTolerance: string | null;
  timeHorizon: string | null;
  decisionMaking: string | null;
  sourceOfFunds: string | null;
  primaryUse: string | null;
  liquidityNeeds: string | null;
  liquidityHorizon: string | null;
  maritalStatus: string | null;
  bankName: string | null;
  bankType: string | null;
  bankAccountNumber: string | null;
  beneficiary1Name: string | null;
  beneficiary1Pct: number | null;
  beneficiary1Dob: Date | null;
  beneficiary2Name: string | null;
  beneficiary2Pct: number | null;
  beneficiary2Dob: Date | null;
  ownershipType: "sole" | "joint" | "trust" | "business" | "custodial" | null;
  ownershipPct: number | null;
  relationship:
    | "primary"
    | "spouse"
    | "ex_spouse"
    | "child"
    | "parent"
    | "business_entity"
    | "other";
  isBusinessEntity: boolean;
  investmentExperience: Record<string, number | null>;
  expenseRange: string | null;
};

type ParsedWorkbook = {
  rows: ParsedImportRow[];
  sheetsFound: number;
  sheetsParsed: number;
  sheetsSkipped: number;
  skippedSheets: string[];
};

type RecordValue = string | number | null | undefined;
type RawRow = Record<string, RecordValue>;

export function parseWorkbook(buffer: Buffer, filename: string): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  const sheetsFound = workbook.SheetNames.length;
  const rows: ParsedImportRow[] = [];
  const skippedSheets: string[] = [];
  let sheetsParsed = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null, raw: false });
    if (!rawRows.length) {
      skippedSheets.push(sheetName);
      continue;
    }

    const mapped = rawRows.map((rawRow) => {
      const normalized: RawRow = {};
      for (const [header, value] of Object.entries(rawRow)) {
        normalized[canonicalHeader(header)] = value;
      }
      return normalized;
    });

    const hasRequired = Array.from(requiredHouseholdHeaders).every((header) =>
      mapped.some((row) => row[header] !== null && row[header] !== ""),
    );
    if (!hasRequired) {
      skippedSheets.push(sheetName);
      continue;
    }

    sheetsParsed += 1;
    mapped.forEach((row, index) => {
      const parsed = parseRow(row, sheetName, index + 2);
      if (parsed) {
        rows.push(parsed);
      }
    });
  }

  if (!rows.length) {
    throw new Error(`No parseable rows found in ${filename}.`);
  }

  return {
    rows,
    sheetsFound,
    sheetsParsed,
    sheetsSkipped: sheetsFound - sheetsParsed,
    skippedSheets,
  };
}

function parseRow(
  row: RawRow,
  sheetName: string,
  sourceRowNumber: number,
): ParsedImportRow | null {
  const householdName = normalizeText(row.household_name);
  const firstName = normalizeText(row.first_name);
  const lastName = normalizeText(row.last_name);
  const rawAccountType = normalizeText(row.account_type);
  if (!householdName || !firstName || !rawAccountType) {
    return null;
  }

  const { accountTypeNorm, coOwnerName, isUncertain } = parseAccountType(rawAccountType);
  const ownership = deriveOwnership(accountTypeNorm, coOwnerName);
  const { raw: taxBracketRaw, pct: taxBracketPct } = parseTaxBracket(row.tax_bracket);
  const relationship = inferRelationship({
    householdName,
    firstName,
    lastName,
    accountTypeNorm,
  });

  const isBusinessEntity =
    relationship === "business_entity" ||
    accountTypeNorm.toLowerCase().includes("business") ||
    !lastName;

  const expenseRange = normalizeText(row.expense_range) ?? null;

  return {
    sourceSheet: sheetName,
    sourceRowNumber,
    householdName,
    firstName,
    lastName,
    accountTypeRaw: rawAccountType,
    accountTypeNorm,
    coOwnerName,
    isUncertain,
    custodian: normalizeText(row.custodian),
    phone: parsePhone(row.phone),
    email: normalizeText(row.email),
    address: normalizeText(row.address),
    dob: parseDate(row.dob),
    dobRaw: normalizeText(row.dob),
    occupation: normalizeText(row.occupation),
    employer: normalizeText(row.employer),
    taxBracketRaw,
    taxBracketPct,
    income: parseCurrency(row.income),
    liquidNetWorth: parseCurrency(row.liquid_net_worth),
    totalNetWorth: parseCurrency(row.total_net_worth),
    investmentObjective: normalizeText(row.investment_objective),
    riskTolerance: normalizeText(row.risk_tolerance),
    timeHorizon: normalizeText(row.time_horizon),
    decisionMaking: normalizeText(row.decision_making),
    sourceOfFunds: normalizeText(row.source_of_funds),
    primaryUse: normalizeText(row.primary_use),
    liquidityNeeds: normalizeText(row.liquidity_needs),
    liquidityHorizon: normalizeText(row.liquidity_horizon),
    maritalStatus: normalizeText(row.marital_status),
    bankName: normalizeText(row.bank_name),
    bankType: normalizeText(row.bank_type),
    bankAccountNumber: normalizeText(row.bank_account_number),
    beneficiary1Name: normalizeText(row.beneficiary_1_name),
    beneficiary1Pct: parseCurrency(row.beneficiary_1_pct),
    beneficiary1Dob: parseDate(row.beneficiary_1_dob),
    beneficiary2Name: normalizeText(row.beneficiary_2_name),
    beneficiary2Pct: parseCurrency(row.beneficiary_2_pct),
    beneficiary2Dob: parseDate(row.beneficiary_2_dob),
    ownershipType: ownership.ownershipType,
    ownershipPct: ownership.ownershipPct,
    relationship,
    isBusinessEntity,
    investmentExperience: {
      bonds: parseCurrency(row.exp_bonds),
      stocks: parseCurrency(row.exp_stocks),
      alternatives: parseCurrency(row.exp_alternatives),
      vas: parseCurrency(row.exp_vas),
      mutualFunds: parseCurrency(row.exp_mutual_funds),
      options: parseCurrency(row.exp_options),
      partnerships: parseCurrency(row.exp_partnerships),
    },
    expenseRange:
      expenseRange ??
      (parseExpenseRange(normalizeText(row.primary_use) ?? "") !== null
        ? normalizeText(row.primary_use)
        : null),
  };
}

function normalizeText(value: RecordValue) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function parseAccountType(raw: string) {
  const isUncertain = raw.includes("?");
  const stripped = raw.replace(/\?/g, "").trim();
  const match = stripped.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (!match) {
    return {
      accountTypeNorm: titleCase(stripped),
      coOwnerName: null,
      isUncertain,
    };
  }
  const [, baseType, context] = match;
  const coOwnerName = context
    .replace(/joint w\/?/i, "")
    .replace(/beneficiary/i, "")
    .trim();
  return {
    accountTypeNorm: titleCase(baseType.trim()),
    coOwnerName: coOwnerName || null,
    isUncertain,
  };
}

function deriveOwnership(
  accountTypeNorm: string,
  coOwnerName: string | null,
): {
  ownershipType: "sole" | "joint" | "trust" | "business" | "custodial" | null;
  ownershipPct: number | null;
} {
  const value = accountTypeNorm.toLowerCase();
  if (value.includes("trust")) {
    return { ownershipType: "trust", ownershipPct: null };
  }
  if (value.includes("business")) {
    return { ownershipType: "business", ownershipPct: null };
  }
  if (value.includes("529") || value.includes("ugma")) {
    return { ownershipType: "custodial", ownershipPct: 100 };
  }
  if (value.includes("joint") || value.includes("jtwros") || coOwnerName) {
    return { ownershipType: "joint", ownershipPct: 50 };
  }
  return { ownershipType: "sole", ownershipPct: 100 };
}

function inferRelationship(input: {
  householdName: string;
  firstName: string;
  lastName: string | null;
  accountTypeNorm: string;
}) {
  const accountType = input.accountTypeNorm.toLowerCase();
  if (accountType.includes("business")) {
    return "business_entity";
  }
  if (!input.lastName) {
    return "business_entity";
  }

  const first = normalizeNameForMatch(input.firstName);
  if (first === "ex spouse" || /^ex[-\s]spouse$/i.test(input.firstName.trim())) {
    return "ex_spouse";
  }

  const normalizedHousehold = normalizeNameForMatch(input.householdName);
  const tokens = normalizedHousehold.split(" ").filter(Boolean);
  if (tokens.length >= 3) {
    if (first === tokens[0]) {
      return "primary";
    }
    if (first === tokens[2]) {
      return "spouse";
    }
  }
  return "other";
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}
