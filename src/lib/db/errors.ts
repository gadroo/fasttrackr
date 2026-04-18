const TRANSIENT_DB_ERROR_CODES = new Set([
  "EADDRNOTAVAIL",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "57P01",
  "57P02",
  "57P03",
]);

const TRANSIENT_DB_MESSAGE_PATTERNS = [
  "connection timeout",
  "timed out",
  "connection terminated unexpectedly",
  "connection terminated due to connection timeout",
  "server closed the connection unexpectedly",
  "connect econnrefused",
  "getaddrinfo enotfound",
  "econnreset",
  "socket hang up",
];

function getErrorCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  return (error as { cause?: unknown }).cause ?? null;
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  return error.message;
}

function collectErrorChain(error: unknown) {
  const chain: unknown[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && !visited.has(current)) {
    chain.push(current);
    visited.add(current);
    current = getErrorCause(current);
  }

  return chain;
}

export function isTransientDatabaseError(error: unknown) {
  const chain = collectErrorChain(error);

  for (const entry of chain) {
    const code = getErrorCode(entry);
    if (code && TRANSIENT_DB_ERROR_CODES.has(code)) {
      return true;
    }
  }

  const messages = chain
    .map(getErrorMessage)
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return messages.some((message) => TRANSIENT_DB_MESSAGE_PATTERNS.some((needle) => message.includes(needle)));
}

/** Walks Drizzle/pg error.cause chain for the underlying Postgres or libpq message. */
export function getUnderlyingDatabaseMessage(error: unknown): string | null {
  const chain = collectErrorChain(error);
  for (let i = chain.length - 1; i >= 0; i--) {
    const entry = chain[i];
    const msg =
      entry instanceof Error
        ? entry.message
        : typeof entry === "object" && entry !== null && "message" in entry
          ? String((entry as { message: unknown }).message)
          : "";
    const trimmed = msg.trim();
    if (trimmed && !trimmed.startsWith("Failed query:")) {
      return trimmed;
    }
  }
  return null;
}

/** Logs the real driver/Postgres reason in dev (Drizzle only surfaces "Failed query: …" in the top message). */
export function logDatabaseErrorCauseInDev(error: unknown) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  const detail = getUnderlyingDatabaseMessage(error);
  if (detail) {
    console.error("[database]", detail);
  }
}
