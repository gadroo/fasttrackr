import { InsightsDashboard } from "@/components/insights-dashboard";
import { getCachedHouseholdOptions, getCachedInsightData } from "@/lib/cache/read-models";

export const metadata = {
  title: "Insights | FastTrackr",
  description: "Financial storytelling and data-quality intelligence for household portfolio management.",
};

type InsightsPageProps = {
  searchParams?: Promise<{ household?: string | string[] }>;
};

export default async function InsightsPage({ searchParams }: InsightsPageProps) {
  const sp = searchParams ? await searchParams : {};
  const raw = sp.household;
  const householdParam = Array.isArray(raw) ? raw[0] : raw;
  const householdId =
    householdParam && householdParam !== "all" ? householdParam : undefined;

  const [householdOptions, insightData] = await Promise.all([
    getCachedHouseholdOptions(),
    getCachedInsightData(householdId),
  ]);

  return (
    <div className="space-y-6">
      <header className="group relative overflow-hidden rounded-3xl border border-border-primary/80 bg-bg-surface p-7 shadow-[var(--shadow-elevated)] transition-all duration-300 hover:shadow-[var(--shadow-chart)]">
        <div className="pointer-events-none absolute -left-24 -top-24 h-60 w-60 rounded-full bg-[image:var(--gradient-decorative-warm)] blur-2xl transition-opacity duration-500 opacity-60 group-hover:opacity-80" />
        <div className="pointer-events-none absolute -bottom-28 -right-20 h-64 w-64 rounded-full bg-[image:var(--gradient-decorative-cool)] blur-2xl transition-opacity duration-500 opacity-60 group-hover:opacity-80" />
        <div className="relative max-w-3xl">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1 rounded-full bg-[image:var(--gradient-brand)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-text-tertiary">Insights</p>
          </div>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight text-text-primary md:text-4xl">
            Financial Storytelling and Data-Quality Intelligence
          </h1>
          <p className="mt-3 text-sm text-text-secondary md:text-base leading-relaxed">
            Explore portfolio composition, advisor-ready opportunity signals, and completeness gaps in one decision-focused workspace.
          </p>
        </div>
      </header>
      <InsightsDashboard
        key={householdId ?? "all"}
        insights={insightData}
        householdOptions={householdOptions}
        initialHouseholdId={householdId ?? "all"}
      />
    </div>
  );
}
