import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeString(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeNameForMatch(value: string | null | undefined) {
  return normalizeString(value).replace(/\band\b/g, "&").replace(/[^\w& ]/g, "");
}

export function parseCurrency(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const cleaned = text.replace(/[$,%\s]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTaxBracket(value: unknown): {
  raw: string | null;
  pct: number | null;
} {
  if (value === null || value === undefined) {
    return { raw: null, pct: null };
  }
  const raw = String(value).trim();
  if (!raw) {
    return { raw: null, pct: null };
  }
  if (raw.toLowerCase() === "highest") {
    return { raw, pct: null };
  }
  const parsed = parseCurrency(raw);
  return { raw, pct: parsed };
}

export function parsePhone(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 10) {
    return null;
  }
  if (digits.length === 10) {
    return digits;
  }
  return digits.slice(-10);
}

export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d{8}$/.test(text)) {
    const month = Number(text.slice(0, 2));
    const day = Number(text.slice(2, 4));
    const year = Number(text.slice(4, 8));
    return safeDate(year, month, day);
  }

  const normalized = text.replace(/[-.]/g, "/");
  const parts = normalized.split("/").map((segment) => Number(segment.trim()));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    const [a, b, c] = parts;
    if (c > 1900) {
      if (a > 12 && b <= 12) {
        return safeDate(c, b, a);
      }
      if (b > 12 && a <= 12) {
        return safeDate(c, a, b);
      }
      return safeDate(c, a, b);
    }
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function safeDate(year: number, month: number, day: number) {
  if (!year || !month || !day) {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)}%`;
}

/** After `unstable_cache` / RSC serialization, `Date` values become ISO strings. */
export function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatTimeWindow(start: number | null, end: number | null) {
  if (start === null || end === null) {
    return "Manual edit";
  }
  return `${formatSeconds(start)} - ${formatSeconds(end)}`;
}

export function formatSeconds(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

/** Collapse duplicate addresses in a semicolon-separated list (case-insensitive). */
export function normalizeMemberEmailList(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const tokens = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  if (!tokens.length) {
    return text;
  }
  return Array.from(new Set(tokens.map((token) => token.toLowerCase()))).join("; ");
}

export type HouseholdMemberSortInput = {
  relationship: string | null;
  firstName: string;
  lastName: string | null;
  dob: string | Date | null;
};

const RELATIONSHIP_DISPLAY_ORDER: Record<string, number> = {
  primary: 0,
  spouse: 1,
  ex_spouse: 2,
  child: 3,
  parent: 4,
  other: 5,
  business_entity: 6,
};

function childOrdinalFromFirstName(firstName: string): number | null {
  const trimmed = firstName.trim();
  const labeled = trimmed.match(/^(?:child|kid)\s*(\d+)\s*$/i);
  if (labeled) {
    const n = Number(labeled[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Stable ordering for household members: relationship, then child index / DOB, then name. */
export function compareHouseholdMembersForDisplay(
  a: HouseholdMemberSortInput,
  b: HouseholdMemberSortInput,
): number {
  const ar =
    RELATIONSHIP_DISPLAY_ORDER[normalizeString(a.relationship)] ?? 99;
  const br =
    RELATIONSHIP_DISPLAY_ORDER[normalizeString(b.relationship)] ?? 99;
  if (ar !== br) {
    return ar - br;
  }

  const relA = normalizeString(a.relationship);
  const relB = normalizeString(b.relationship);
  if (relA === "child" && relB === "child") {
    const ordA = childOrdinalFromFirstName(a.firstName);
    const ordB = childOrdinalFromFirstName(b.firstName);
    if (ordA !== null && ordB !== null && ordA !== ordB) {
      return ordA - ordB;
    }
    const ad = a.dob ? new Date(a.dob as Date).getTime() : NaN;
    const bd = b.dob ? new Date(b.dob as Date).getTime() : NaN;
    if (!Number.isNaN(ad) && !Number.isNaN(bd) && ad !== bd) {
      return ad - bd;
    }
  }

  const an = `${a.firstName} ${a.lastName ?? ""}`.trim().toLowerCase();
  const bn = `${b.firstName} ${b.lastName ?? ""}`.trim().toLowerCase();
  return an.localeCompare(bn);
}

export function parseExpenseRange(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/(\d[\d,]*(?:\.\d+)?(?:\s*[kmb])?)/gi);
  if (!match?.length) {
    return null;
  }
  const numbers = match
    .map((token) => {
      const normalized = token.trim().replace(/,/g, "").toLowerCase();
      const suffix = normalized.slice(-1);
      const multiplier =
        suffix === "k" ? 1_000 :
        suffix === "m" ? 1_000_000 :
        suffix === "b" ? 1_000_000_000 : 1;
      const numericPart = multiplier === 1 ? normalized : normalized.slice(0, -1).trim();
      const parsed = Number(numericPart);
      return Number.isFinite(parsed) ? parsed * multiplier : null;
    })
    .filter((num): num is number => num !== null);
  if (!numbers.length) {
    return null;
  }
  return numbers.reduce((acc, num) => acc + num, 0) / numbers.length;
}
