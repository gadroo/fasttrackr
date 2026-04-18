import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/lib/db/schema";

let _pool: Pool | undefined;

const LEGACY_SSLMODES = new Set(["prefer", "require", "verify-ca"]);

function getPositiveNumberFromEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeDatabaseUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const sslmode = parsed.searchParams.get("sslmode");
    const useLibpqCompat = parsed.searchParams.get("uselibpqcompat") === "true";

    if (!useLibpqCompat && sslmode && LEGACY_SSLMODES.has(sslmode)) {
      // Keep pg v8 behavior explicit and forward-compatible with pg v9.
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }
  } catch {
    // Leave non-standard URLs untouched; pg will handle parsing errors downstream.
  }

  return rawUrl;
}

function getPool() {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured.");
    }
    _pool = new Pool({
      connectionString: normalizeDatabaseUrl(connectionString),
      max: getPositiveNumberFromEnv("DB_POOL_MAX", 10),
      idleTimeoutMillis: getPositiveNumberFromEnv("DB_IDLE_TIMEOUT_MS", 30_000),
      connectionTimeoutMillis: getPositiveNumberFromEnv("DB_CONNECT_TIMEOUT_MS", 5_000),
      query_timeout: getPositiveNumberFromEnv("DB_QUERY_TIMEOUT_MS", 10_000),
      statement_timeout: getPositiveNumberFromEnv("DB_STATEMENT_TIMEOUT_MS", 10_000),
      keepAlive: true,
      application_name: "fasttrackr-web",
    });
  }
  return _pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function closeDbPool() {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}

export type DbClient = ReturnType<typeof getDb>;
