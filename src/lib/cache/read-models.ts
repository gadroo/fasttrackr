import { unstable_cache } from "next/cache";

import { getDb } from "@/lib/db/client";
import {
  getUnderlyingDatabaseMessage,
  isTransientDatabaseError,
  logDatabaseErrorCauseInDev,
} from "@/lib/db/errors";
import {
  getHouseholdChangeBundleOptimized,
  getHouseholdDetail,
  getHouseholdOptions,
  getHouseholdSummaries,
  getInsightData,
} from "@/lib/db/repository";

import { CACHE_TAGS } from "./tags";

async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientDatabaseError(error)) {
      logDatabaseErrorCauseInDev(error);
      const detail = getUnderlyingDatabaseMessage(error);
      if (
        detail &&
        error instanceof Error &&
        !error.message.includes(detail.slice(0, 80))
      ) {
        throw new Error(`${error.message}\nCause: ${detail}`, { cause: error });
      }
      throw error;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
  return operation();
}

const getCachedHouseholdSummariesInternal = unstable_cache(
  async () => withDbRetry(() => getHouseholdSummaries(getDb())),
  ["household-summaries-v2"],
  {
    tags: [CACHE_TAGS.householdSummaries],
    revalidate: 120,
  },
);

const getCachedHouseholdOptionsInternal = unstable_cache(
  async () => withDbRetry(() => getHouseholdOptions(getDb())),
  ["household-options-v1"],
  {
    tags: [CACHE_TAGS.householdOptions],
    revalidate: 300,
  },
);

function getCachedInsightDataForScope(scopeKey: string, householdId?: string) {
  return unstable_cache(
    async () => withDbRetry(() => getInsightData(getDb(), householdId)),
    ["insight-data-v2", scopeKey],
    {
      tags: [CACHE_TAGS.insightData],
      revalidate: 120,
    },
  )();
}

export async function getCachedHouseholdSummaries() {
  return getCachedHouseholdSummariesInternal();
}

export async function getCachedHouseholdOptions() {
  return getCachedHouseholdOptionsInternal();
}

export async function getCachedInsightData(householdId?: string) {
  const scopeKey = householdId ?? "__all__";
  return getCachedInsightDataForScope(scopeKey, householdId);
}

export async function getCachedHouseholdDetail(householdId: string) {
  return unstable_cache(
    async () => withDbRetry(() => getHouseholdDetail(getDb(), householdId)),
    ["household-detail-v1", householdId],
    {
      tags: [CACHE_TAGS.householdDetail],
      revalidate: 120,
    },
  )();
}

export async function getCachedHouseholdChangeBundle(householdId: string) {
  return unstable_cache(
    () => withDbRetry(() => getHouseholdChangeBundleOptimized(getDb(), householdId)),
    ["household-change-bundle-v2", householdId],
    {
      tags: [CACHE_TAGS.householdChanges],
      revalidate: 120,
    },
  )();
}
