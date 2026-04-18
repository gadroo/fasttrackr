import { notFound } from "next/navigation";

import { HouseholdDetailClient } from "@/components/household-detail-client";
import { getCachedHouseholdChangeBundle, getCachedHouseholdDetail } from "@/lib/cache/read-models";
import { toIsoTimestamp } from "@/lib/utils";

export default async function HouseholdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Run all data fetching in parallel
  const [household, changeBundle] = await Promise.all([
    getCachedHouseholdDetail(id),
    getCachedHouseholdChangeBundle(id),
  ]);

  if (!household) {
    notFound();
  }

  const { changes, enrichment, sources } = changeBundle;
  const pendingCount = changes.filter((c) => c.status === "pending").length;

  const provenanceViews = (household.provenance ?? []).map((p) => ({
    fieldName: p.fieldName,
    sourceType: p.sourceType as "spreadsheet" | "audio" | "user_edit",
    setAt: toIsoTimestamp(p.setAt as Date | string),
  }));

  return (
    <HouseholdDetailClient
      household={{ ...household, pendingChanges: pendingCount }}
      changes={changes}
      enrichment={enrichment}
      provenance={provenanceViews}
      sources={sources.map((source) => ({
        id: source.id,
        type: source.type,
        filename: source.filename,
        status: source.status,
        createdAt: toIsoTimestamp(source.createdAt as Date | string),
      }))}
    />
  );
}
