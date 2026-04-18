import { revalidateTag } from "next/cache";

export const CACHE_TAGS = {
  householdSummaries: "household-summaries",
  householdOptions: "household-options",
  householdDetail: "household-detail",
  householdChanges: "household-changes",
  insightData: "insight-data",
} as const;

export function revalidateReadModelTags() {
  revalidateTag(CACHE_TAGS.householdSummaries, "max");
  revalidateTag(CACHE_TAGS.householdOptions, "max");
  revalidateTag(CACHE_TAGS.householdDetail, "max");
  revalidateTag(CACHE_TAGS.householdChanges, "max");
  revalidateTag(CACHE_TAGS.insightData, "max");
}
