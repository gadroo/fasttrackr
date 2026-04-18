import { HouseholdList } from "@/components/household-list";
import { getCachedHouseholdSummaries } from "@/lib/cache/read-models";
import type { HouseholdSummary } from "@/lib/types";

export default async function Home() {
  let households: HouseholdSummary[] = [];
  let error: string | null = null;
  try {
    households = await getCachedHouseholdSummaries();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to load households";
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-border-primary bg-bg-surface p-5 shadow-[var(--shadow-elevated)] sm:rounded-3xl sm:p-8">
        <div className="absolute -right-32 -top-28 h-64 w-64 rounded-full bg-[image:var(--gradient-decorative-warm)] blur-2xl" />
        <div className="relative max-w-2xl">
          <p className="text-xs uppercase tracking-[0.25em] text-text-tertiary">Advisory Workspace</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold leading-tight text-text-primary sm:text-3xl md:text-4xl">
            Household Data, Reconciled with Source-Level Provenance
          </h1>
          <p className="mt-2 text-sm text-text-secondary sm:mt-3">
            Import spreadsheets, enrich records with advisor calls, review AI change proposals, and monitor completeness across every household.
          </p>
        </div>
      </section>
      {error ? (
        <div className="rounded-2xl border border-error-border bg-error-subtle p-4 text-sm text-error-text">
          {error}. Configure `DATABASE_URL` and run migrations before using the dashboard.
        </div>
      ) : (
        <HouseholdList households={households} />
      )}
    </div>
  );
}
