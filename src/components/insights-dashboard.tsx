"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";

import type { HouseholdOption, InsightData } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { getChartColors, getChartVars } from "@/lib/chart-theme";

const MEMBER_PREVIEW_LIMIT = 6;

const TONE_BARS = {
  amber: "bg-gradient-to-r from-amber-500 via-orange-500 to-red-500",
  teal: "bg-gradient-to-r from-teal-500 via-cyan-500 to-sky-500",
  slate: "bg-gradient-to-r from-slate-700 via-slate-600 to-slate-500",
  indigo: "bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500",
} as const;

const COMPLETENESS_LABELS: Record<string, string> = {
  income: "Income",
  liquidNetWorth: "Liquid NW",
  totalNetWorth: "Total NW",
  taxBracketRaw: "Tax Bracket",
  expenseRange: "Expenses",
  riskTolerance: "Risk Tol.",
  timeHorizon: "Time Horizon",
  investmentObjective: "Inv. Obj.",
  memberHasDob: "Any member: DOB",
  memberHasPhone: "Any member: Phone",
  memberHasEmail: "Any member: Email",
  memberHasOccupation: "Any member: Occupation",
  accountHasCustodian: "Custodian",
  accountHasValue: "Acct Value",
  bankDetailsPresent: "Bank Details",
};

type ChartTone = keyof typeof TONE_BARS;

function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Match SSR (resolvedTheme is undefined on server) until after mount so palette matches hydration.
  const isDark = mounted && resolvedTheme === "dark";

  const colors = useMemo(() => getChartColors(isDark), [isDark]);
  const vars = useMemo(() => getChartVars(isDark), [isDark]);

  const tooltipStyle = useMemo(
    () => ({
      borderRadius: "12px",
      border: `1px solid ${vars.tooltipBorder}`,
      background: vars.tooltipBg,
      backdropFilter: "blur(6px)",
      boxShadow: vars.tooltipShadow,
      color: vars.label,
    }),
    [vars],
  );

  const axisTick = useMemo(
    () => ({ fontSize: 11, fill: vars.axis }),
    [vars.axis],
  );

  return { colors, vars, tooltipStyle, axisTick };
}

function tooltipCurrency(value: unknown) {
  if (typeof value === "number") return formatCurrency(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? formatCurrency(n) : value;
  }
  return "—";
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercentage(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** Stable width strings for SSR/client hydration (avoids float formatting drift). */
function formatPctOfMax(value: number, max: number): string {
  if (max <= 0) return "0%";
  return `${((value / max) * 100).toFixed(4)}%`;
}

function EmptyState({ message, action }: { message: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-border-primary bg-bg-muted/50 px-5 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-muted">
        <svg className="h-6 w-6 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-text-secondary">{message}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[image:var(--gradient-brand)] px-4 py-2 text-sm font-semibold text-accent-on shadow-md transition-all hover:shadow-lg hover:scale-105"
        >
          {action.label}
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      )}
    </div>
  );
}

type SelectionState = {
  type: string | null;
  index: number | null;
};

export function InsightsDashboard({
  insights,
  householdOptions,
  initialHouseholdId,
}: {
  insights: InsightData;
  householdOptions: HouseholdOption[];
  initialHouseholdId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isBookScope = initialHouseholdId === "all";
  const { colors: CHART_COLORS, vars, tooltipStyle: TOOLTIP_CONTENT_STYLE, axisTick: AXIS_TICK } = useChartTheme();

  const GRID_STROKE = vars.grid;

  const [showAllRankedMembers, setShowAllRankedMembers] = useState(false);
  const [chartSelection, setChartSelection] = useState<SelectionState>({
    type: null,
    index: null,
  });

  const handleBadgeClick = (
    type: SelectionState['type'],
    index: number,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    if (chartSelection.type === type && chartSelection.index === index) {
      setChartSelection({ type: null, index: null });
    } else {
      setChartSelection({ type, index });
    }
  };

  const handleChartAreaClick = () => {
    setChartSelection({ type: null, index: null });
  };

  const isSelected = (type: SelectionState['type'], index: number) => {
    return chartSelection.type === type && chartSelection.index === index;
  };

  const getElementOpacity = (type: SelectionState['type'], index: number) => {
    if (chartSelection.type === null) return 1;
    if (chartSelection.type !== type) return 1;
    return isSelected(type, index) ? 1 : 0.2;
  };

  const getHighlightStroke = (type: SelectionState['type'], index: number, defaultColor: string) => {
    if (isSelected(type, index)) {
      return { stroke: vars.text, strokeWidth: 3, opacity: 1 };
    }
    const opacity = getElementOpacity(type, index);
    return { stroke: defaultColor, strokeWidth: 0, opacity };
  };

  const incomeVsExpenses = insights.incomeVsExpenses;
  const hasExpenseEstimateData = incomeVsExpenses.some((row) => row.expenses !== null);
  const netWorthComposition = insights.netWorthComposition;
  const membersPerHousehold = insights.membersPerHousehold;
  const incomeVsNetWorth = insights.incomeVsNetWorth;
  const topHouseholds = insights.topHouseholdsByNetWorth;
  const riskVsTime = insights.riskVsTimeHorizon;
  const completeness = insights.completenessMatrix;

  const investmentRows = insights.investmentExperience.households;

  const ownershipSizingUsesValue = insights.ownershipDistribution.some((row) => row.totalValue > 0);
  const ownershipTreemapData = insights.ownershipDistribution.map((row) => ({
    name: `${row.ownershipType} (${row.accountCount})`,
    size: ownershipSizingUsesValue ? row.totalValue : row.accountCount,
  }));

  const radarData = insights.investmentExperience.categories.map((category, idx) => {
    const values = investmentRows.map((row) => row.values[idx] ?? 0);
    const sum = values.reduce((acc, v) => acc + v, 0);
    const value = values.length ? sum / values.length : 0;
    return { category, value };
  });
  const radarHasData = radarData.some((row) => row.value > 0);

  const incomeConcentrationBars = useMemo(() => {
    const c = insights.incomeConcentration;
    if (!c) return [];
    const householdCount = c.householdsWithIncome;
    const allHouseholds = { label: "All income-reporting households", pct: 100 };

    if (householdCount >= 5) {
      return [
        { label: "Top 1 household", pct: c.top1Share * 100 },
        { label: "Top 3 households", pct: c.top3Share * 100 },
        { label: "Top 5 households", pct: c.top5Share * 100 },
      ];
    }

    if (householdCount === 4) {
      return [
        { label: "Top 1 household", pct: c.top1Share * 100 },
        { label: "Top 3 households", pct: c.top3Share * 100 },
        allHouseholds,
      ];
    }

    if (householdCount >= 2) {
      return [
        { label: "Top 1 household", pct: c.top1Share * 100 },
        allHouseholds,
      ];
    }

    return [{ label: "Top 1 household", pct: c.top1Share * 100 }];
  }, [insights.incomeConcentration]);

  const riskTimeDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of riskVsTime) {
      const key = `${row.riskTolerance}::${row.timeHorizon}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([key, count]) => {
        const [riskTolerance, timeHorizon] = key.split("::");
        return { riskTolerance, timeHorizon, count };
      })
      .sort((a, b) => b.count - a.count);
  }, [riskVsTime]);

  const rankedMembers = useMemo(
    () => [...membersPerHousehold].sort((a, b) => b.count - a.count),
    [membersPerHousehold],
  );

  const occupationForChart = useMemo(
    () =>
      insights.occupationDistribution
        .filter((o) => o.occupation !== "Unknown")
        .slice(0, 10),
    [insights.occupationDistribution],
  );

  const hiddenMemberCount = Math.max(0, rankedMembers.length - MEMBER_PREVIEW_LIMIT);
  const visibleMembers = showAllRankedMembers
    ? rankedMembers
    : rankedMembers.slice(0, MEMBER_PREVIEW_LIMIT);

  const summary = useMemo(() => {
    const visibleHouseholdCount = membersPerHousehold.length;

    const visibleNetWorth = insights.netWorthDistribution.reduce(
      (sum, row) => sum + row.totalNetWorth,
      0,
    );
    const hasNetWorthData = insights.netWorthDistribution.length > 0;

    const completenessFields = completeness[0]
      ? Object.keys(completeness[0].fields).length
      : 0;

    const completenessPct = completeness.length
      ? completeness.reduce((sum, row) => {
          const fields = Object.values(row.fields);
          const populated = fields.filter(Boolean).length;
          return sum + (fields.length ? populated / fields.length : 0);
        }, 0) / completeness.length
      : null;

    const lowCompletenessHouseholds = completeness.reduce((sum, row) => {
      const fields = Object.values(row.fields);
      const populated = fields.filter(Boolean).length;
      const coverage = fields.length ? populated / fields.length : 0;
      return sum + (coverage < 0.6 ? 1 : 0);
    }, 0);

    const highRiskCount = insights.highRiskHouseholdCount;
    const highRiskShare =
      visibleHouseholdCount > 0 ? highRiskCount / visibleHouseholdCount : null;

    return {
      visibleHouseholdCount,
      visibleNetWorth,
      hasNetWorthData,
      completenessFields,
      completenessPct,
      lowCompletenessHouseholds,
      highRiskCount,
      highRiskShare,
    };
  }, [completeness, insights.highRiskHouseholdCount, insights.netWorthDistribution, membersPerHousehold]);

  return (
    <section className="space-y-10">
      <div className="rounded-3xl border border-border-primary bg-bg-surface/90 p-5 shadow-[var(--shadow-elevated)] backdrop-blur md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary" htmlFor="household-filter">
              Scope
            </label>
            <select
              id="household-filter"
              value={initialHouseholdId}
              onChange={(event) => {
                const next = event.target.value;
                setShowAllRankedMembers(false);
                if (next === "all") {
                  router.replace(pathname);
                } else {
                  router.replace(`${pathname}?household=${encodeURIComponent(next)}`);
                }
              }}
              className="mt-2 block w-full rounded-xl border border-border-primary bg-bg-surface px-3 py-2 text-sm text-text-secondary shadow-[var(--shadow-card)] transition outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 md:w-80"
            >
              <option value="all">All households</option>
              {householdOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-border-primary bg-bg-muted px-3 py-2 text-xs text-text-tertiary">
            Showing {summary.visibleHouseholdCount} household{summary.visibleHouseholdCount === 1 ? "" : "s"}
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric
            label="Visible Net Worth"
            value={summary.hasNetWorthData ? formatCompactCurrency(summary.visibleNetWorth) : "—"}
            tone="amber"
          />
          <SummaryMetric
            label="Avg. Completeness"
            value={summary.completenessPct === null ? "—" : formatPercentage(summary.completenessPct)}
            hint={summary.completenessFields ? `${summary.completenessFields} tracked fields` : undefined}
            tone="teal"
          />
          <SummaryMetric
            label="Profiles <60% Complete"
            value={String(summary.lowCompletenessHouseholds)}
            hint="High-priority records for data cleanup"
            tone="slate"
          />
          <SummaryMetric
            label="High-Risk Profiles"
            value={String(summary.highRiskCount)}
            hint={summary.highRiskShare === null ? undefined : `${formatPercentage(summary.highRiskShare)} of visible scope`}
            tone="indigo"
          />
        </div>
      </div>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Portfolio Health"
          title="Cashflow and Wealth Dynamics"
          description="These views explain earnings power, spend pressure, and wealth concentration."
        />
        <div className="grid gap-6 2xl:grid-cols-2">
          <ChartCard
            title="Income vs Expenses"
            subtitle={
              hasExpenseEstimateData
                ? "Annual income next to a midpoint parsed from the stated expense range, when present."
                : "Expense ranges are missing in source data, so this currently shows annual income only."
            }
            insight="Large income with modest implied spend highlights surplus capacity; tight spreads suggest cashflow or reserve planning."
            tone="amber"
          >
            {incomeVsExpenses.length ? (
              <div className="space-y-2">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={incomeVsExpenses}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="household" tick={AXIS_TICK} interval={0} angle={-24} textAnchor="end" height={54} />
                  <YAxis tick={AXIS_TICK} tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value, name, item) => {
                      const payload = item?.payload as { expenses: number | null };
                      if (name === "Expenses (est.)" && payload?.expenses === null) return "—";
                      return tooltipCurrency(value);
                    }}
                    contentStyle={TOOLTIP_CONTENT_STYLE}
                    labelStyle={{ color: vars.label, fontWeight: 600 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: vars.legend }} />
                  <Bar dataKey="income" name="Annual income" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                    {hasExpenseEstimateData ? (
                      <Bar dataKey="expenses" name="Expenses (est.)" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
                    ) : null}
                  </BarChart>
                </ResponsiveContainer>
                {!hasExpenseEstimateData ? (
                  <p className="text-center text-xs text-text-quaternary">
                    No expense-range values found in imported households.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState message="No household income data available yet." action={{ label: "Import household data", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Net Worth Breakdown"
            subtitle="Liquid and illiquid composition by household."
            insight="A high illiquid share can indicate refinancing/liquidity planning opportunities before major goals."
            tone="teal"
          >
            {netWorthComposition.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={netWorthComposition}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="household" tick={AXIS_TICK} interval={0} angle={-24} textAnchor="end" height={54} />
                  <YAxis tick={AXIS_TICK} tickFormatter={(value) => `$${(value / 1_000_000).toFixed(1)}M`} />
                  <Tooltip formatter={(value) => tooltipCurrency(value)} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={{ color: vars.label, fontWeight: 600 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: vars.legend }} />
                  <Bar dataKey="liquid" name="Liquid" stackId="nw" fill={CHART_COLORS[4]} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="illiquid" name="Illiquid" stackId="nw" fill={CHART_COLORS[1]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No net worth data available." action={{ label: "Upload financial data", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Income vs Net Worth"
            subtitle="Each colored dot represents a different household. Click a name to highlight."
            insight="Points with high income but modest net worth are often ideal for targeted accumulation plans."
            tone="amber"
          >
            {incomeVsNetWorth.length ? (
              <>
                <div onClick={handleChartAreaClick} className="cursor-pointer">
                  <ResponsiveContainer width="100%" height={280}>
                    <ScatterChart>
                      <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                      <XAxis type="number" dataKey="income" name="Income" tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} tick={AXIS_TICK} />
                      <YAxis type="number" dataKey="netWorth" name="Net Worth" tickFormatter={(value) => `$${(value / 1_000_000).toFixed(1)}M`} tick={AXIS_TICK} />
                      <Tooltip
                        cursor={{ strokeDasharray: "4 4", stroke: vars.axis }}
                        formatter={(value) => tooltipCurrency(value)}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.household ?? ""}
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        labelStyle={{ color: vars.label, fontWeight: 600 }}
                      />
                      <Scatter data={incomeVsNetWorth} fill={CHART_COLORS[0]}>
                        {incomeVsNetWorth.map((entry, idx) => {
                          const color = CHART_COLORS[idx % CHART_COLORS.length];
                          const highlight = getHighlightStroke('scatter', idx, color);
                          const highlighted = isSelected('scatter', idx);
                          return (
                            <Cell
                              key={entry.householdId ?? idx}
                              fill={color}
                              stroke={highlight.stroke}
                              strokeWidth={highlight.strokeWidth}
                              fillOpacity={highlight.opacity}
                              r={highlighted ? 10 : undefined}
                            />
                          );
                        })}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <ChartLegendButtons
                  items={incomeVsNetWorth.map((e, idx) => ({ key: e.householdId ?? String(idx), label: e.household }))}
                  type="scatter"
                  colors={CHART_COLORS}
                  isSelected={isSelected}
                  onBadgeClick={handleBadgeClick}
                />
              </>
            ) : (
              <EmptyState message="Need both income and net worth data to render this chart." action={{ label: "Import data", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Top Households by Net Worth"
            subtitle={isBookScope ? "Largest relationships in the selected scope." : "Book rank for the scoped household (when net worth is on file)."}
            insight="Use this leaderboard for service-tier alignment and retention prioritization."
            tone="slate"
          >
            {!isBookScope && insights.netWorthRank && topHouseholds[0] ? (
              <div className="rounded-xl border border-border-primary bg-bg-muted p-6 shadow-sm">
                <p className="text-sm leading-relaxed text-text-secondary">
                  <span className="font-semibold text-text-primary">{topHouseholds[0].household}</span>
                  {" "}ranks{" "}
                  <span className="font-[family-name:var(--font-display)] text-2xl font-semibold text-text-primary tabular-nums">
                    #{insights.netWorthRank.rank}
                  </span>
                  {" "}of{" "}
                  <span className="font-semibold tabular-nums">{insights.netWorthRank.totalWithNetWorth}</span>
                  {" "}households with net worth on file.
                </p>
                <p className="mt-4 text-lg font-semibold tabular-nums text-text-primary">
                  {formatCompactCurrency(topHouseholds[0].totalNetWorth)} total net worth
                </p>
              </div>
            ) : topHouseholds.length ? (
              <ResponsiveContainer width="100%" height={Math.max(320, topHouseholds.length * 34)}>
                <BarChart data={topHouseholds} layout="vertical">
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(value) => `$${(value / 1_000_000).toFixed(1)}M`} tick={AXIS_TICK} />
                  <YAxis type="category" dataKey="household" width={170} tick={AXIS_TICK} />
                  <Tooltip formatter={(value) => tooltipCurrency(value)} contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={{ color: vars.label, fontWeight: 600 }} />
                  <Bar dataKey="totalNetWorth" name="Net Worth" fill={CHART_COLORS[0]} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No net worth data available." action={{ label: "Import data", href: "/upload" }} />
            )}
          </ChartCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Client Mix"
          title="Segmentation and Exposure"
          description="Understand portfolio structure, demographic mix, and ownership patterns."
        />
        <div className="grid gap-6 2xl:grid-cols-2">
          <ChartCard
            title="Income Concentration"
            subtitle="Share of total reported income from the highest-earning relationships (not net worth)."
            insight="High concentration can mean key-person risk for firm revenue; compare with the net-worth leaderboard for a fuller picture."
            tone="slate"
          >
            {incomeConcentrationBars.length ? (
              <div className="space-y-2">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={incomeConcentrationBars} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} interval={0} angle={-12} textAnchor="end" height={52} />
                    <YAxis tick={AXIS_TICK} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(value) => {
                        const n = typeof value === "number" ? value : Number(value);
                        return [`${Number.isFinite(n) ? n.toFixed(1) : "—"}%`, "Share of income"];
                      }}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      labelStyle={{ color: vars.label, fontWeight: 600 }}
                    />
                    <Bar dataKey="pct" name="Share of income" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {insights.incomeConcentration ? (
                  <p className="text-center text-xs text-text-quaternary">
                    Based on {insights.incomeConcentration.householdsWithIncome} household
                    {insights.incomeConcentration.householdsWithIncome === 1 ? "" : "s"} with income on file.
                  </p>
                ) : null}
              </div>
            ) : (
              <EmptyState message="No household income data yet." action={{ label: "Import household data", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Ownership Distribution"
            subtitle={ownershipSizingUsesValue ? "Treemap tile area is proportional to total market value. Click a badge to highlight." : "No account values on file — tile area uses account count (not dollars). Click a badge to highlight."}
            insight="Ownership structure complexity usually correlates with estate and governance planning needs."
            tone="indigo"
          >
            {ownershipTreemapData.length ? (
              <>
                <div onClick={handleChartAreaClick} className="cursor-pointer">
                  <ResponsiveContainer width="100%" height={280}>
                    <Treemap
                      data={ownershipTreemapData}
                      dataKey="size"
                      stroke={vars.surface}
                      fill={CHART_COLORS[1]}
                      content={({ x, y, width, height, name }: { x: number; y: number; width: number; height: number; name: string }) => {
                        const idx = ownershipTreemapData.findIndex((row) => row.name === name);
                        const color = CHART_COLORS[idx % CHART_COLORS.length];
                        const opacity = getElementOpacity('treemap-ownership', idx);
                        const highlighted = isSelected('treemap-ownership', idx);
                        return (
                          <g style={{ opacity }}>
                            <rect x={x} y={y} width={width} height={height} fill={color} stroke={highlighted ? vars.text : vars.surface} strokeWidth={highlighted ? 4 : 2} rx={5} />
                            {width > 65 && height > 30 && (
                              <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={11} fontWeight={700}>
                                {name}
                              </text>
                            )}
                          </g>
                        );
                      }}
                    />
                  </ResponsiveContainer>
                </div>
                <ChartLegendButtons
                  items={ownershipTreemapData.map((e) => ({ key: e.name, label: e.name }))}
                  type="treemap-ownership"
                  colors={CHART_COLORS}
                  isSelected={isSelected}
                  onBadgeClick={handleBadgeClick}
                />
              </>
            ) : (
              <EmptyState message="No ownership data available." action={{ label: "Import accounts", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Tax Bracket Distribution"
            subtitle="Concentration of households by tax bracket. Click a badge to highlight."
            insight="Bracket concentration helps prioritize tax-aware portfolio and withdrawal strategies."
            tone="slate"
          >
            {insights.taxBracketDistribution.length ? (
              <>
                <div onClick={handleChartAreaClick} className="cursor-pointer">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={insights.taxBracketDistribution}>
                      <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="bracket" tick={AXIS_TICK} />
                      <YAxis allowDecimals={false} tick={AXIS_TICK} />
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
                      <Bar dataKey="count" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]}>
                        {insights.taxBracketDistribution.map((entry, idx) => {
                          const color = CHART_COLORS[idx % CHART_COLORS.length];
                          const opacity = getElementOpacity('bar-tax', idx);
                          const highlighted = isSelected('bar-tax', idx);
                          return (
                            <Cell key={`${entry.bracket}-${idx}`} fill={color} fillOpacity={opacity} stroke={highlighted ? vars.text : undefined} strokeWidth={highlighted ? 3 : 0} />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ChartLegendButtons
                  items={insights.taxBracketDistribution.map((e, idx) => ({ key: `${e.bracket}-${idx}`, label: e.bracket }))}
                  type="bar-tax"
                  colors={CHART_COLORS}
                  isSelected={isSelected}
                  onBadgeClick={handleBadgeClick}
                />
              </>
            ) : (
              <EmptyState message="No tax bracket data available." action={{ label: "Add household info", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Members per Household"
            subtitle="Family complexity at a glance."
            insight="Higher member counts imply increased beneficiary and trust complexity."
            tone="indigo"
          >
            {rankedMembers.length ? (
              <div className="rounded-xl border border-border-primary bg-bg-muted p-4 shadow-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {visibleMembers.map((row) => (
                    <Link
                      key={row.householdId}
                      href={`/households/${row.householdId}`}
                      className="group flex items-center justify-between rounded-lg border border-border-primary bg-bg-surface px-3 py-2 transition hover:border-info hover:shadow-md"
                      title={row.household}
                    >
                      <span className="text-sm font-medium text-text-secondary group-hover:text-info">
                        {row.household.length > 14 ? row.household.slice(0, 14) + "…" : row.household}
                      </span>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[var(--chart-7)] to-[var(--chart-2)] text-xs font-semibold text-white shadow-sm">
                        {row.count}
                      </span>
                    </Link>
                  ))}
                </div>
                {hiddenMemberCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllRankedMembers((current) => !current)}
                    className="mt-3 block w-full rounded-lg border border-border-primary bg-bg-surface px-3 py-2 text-center text-xs font-medium text-text-secondary transition hover:border-info hover:text-info"
                  >
                    {showAllRankedMembers ? "Show fewer households" : `+${hiddenMemberCount} more households`}
                  </button>
                ) : null}
              </div>
            ) : (
              <EmptyState message="No household member data available." action={{ label: "Import households", href: "/upload" }} />
            )}
          </ChartCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Client Demographics"
          title="Who You Serve"
          description="Understand your client base through wealth distribution, goals, and personal attributes."
        />
        <div className="grid gap-6 2xl:grid-cols-2">
          <ChartCard
            title="Net Worth Distribution"
            subtitle="Household concentration by wealth tier."
            insight="Wealth concentration identifies your core markets and highlights segments for specialized service offerings."
            tone="amber"
          >
            {insights.netWorthDistribution.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={insights.netWorthDistribution}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="range" tick={AXIS_TICK} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as {
                        count: number;
                        totalNetWorth: number;
                        range: string;
                        households?: Array<{ household: string; householdId: string }>;
                      };
                      const list = row.households ?? [];
                      const maxNames = 14;
                      const shown = list.slice(0, maxNames);
                      const rest = Math.max(0, list.length - shown.length);
                      return (
                        <div
                          className="max-h-[min(320px,50vh)] max-w-[min(340px,90vw)] overflow-y-auto rounded-xl border border-border-primary bg-bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
                          style={TOOLTIP_CONTENT_STYLE}
                        >
                          <p className="font-semibold text-text-primary">{label ?? row.range}</p>
                          <p className="mt-1 text-text-secondary">{row.count} household{row.count === 1 ? "" : "s"}</p>
                          {row.totalNetWorth > 0 ? (
                            <p className="mt-0.5 text-text-tertiary">Combined NW in tier: {formatCompactCurrency(row.totalNetWorth)}</p>
                          ) : null}
                          {shown.length ? (
                            <ul className="mt-2 space-y-0.5 border-t border-border-primary/60 pt-2 text-text-secondary">
                              {shown.map((h) => (
                                <li key={h.householdId} className="leading-snug">
                                  {h.household}
                                </li>
                              ))}
                              {rest > 0 ? (
                                <li className="pt-1 text-text-quaternary italic">+{rest} more</li>
                              ) : null}
                            </ul>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: vars.legend }} />
                  <Bar dataKey="count" name="Households" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No net worth data available." action={{ label: "Import household data", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Investment Objectives"
            subtitle="Primary goals across households. Click a badge to highlight."
            insight="Align marketing and product offerings with the most common client objectives."
            tone="teal"
          >
            {insights.investmentObjectiveDistribution.length ? (
              <>
                <div onClick={handleChartAreaClick} className="cursor-pointer">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={insights.investmentObjectiveDistribution}>
                      <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="objective" tick={AXIS_TICK} />
                      <YAxis allowDecimals={false} tick={AXIS_TICK} />
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
                      <Bar dataKey="count" fill={CHART_COLORS[4]} radius={[6, 6, 0, 0]}>
                        {insights.investmentObjectiveDistribution.map((entry, idx) => {
                          const color = CHART_COLORS[idx % CHART_COLORS.length];
                          const opacity = getElementOpacity('bar-objective', idx);
                          const highlighted = isSelected('bar-objective', idx);
                          return <Cell key={`${entry.objective}-${idx}`} fill={color} fillOpacity={opacity} stroke={highlighted ? vars.text : undefined} strokeWidth={highlighted ? 3 : 0} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ChartLegendButtons
                  items={insights.investmentObjectiveDistribution.map((e, idx) => ({ key: `${e.objective}-${idx}`, label: e.objective }))}
                  type="bar-objective"
                  colors={CHART_COLORS}
                  isSelected={isSelected}
                  onBadgeClick={handleBadgeClick}
                />
              </>
            ) : (
              <EmptyState message="No investment objective data available." action={{ label: "Add household info", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Account Complexity"
            subtitle="Number of accounts per household. Click a badge to highlight."
            insight="Higher account complexity indicates greater servicing needs and estate planning requirements."
            tone="indigo"
          >
            {insights.accountComplexityDistribution.length ? (
              <>
                <div onClick={handleChartAreaClick} className="cursor-pointer">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={insights.accountComplexityDistribution}
                        dataKey="count"
                        nameKey="complexity"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={(props: PieLabelRenderProps) => {
                          const { complexity, count } = props.payload as { complexity: string; count: number };
                          const total = insights.accountComplexityDistribution.reduce((sum, e) => sum + e.count, 0);
                          const pct = ((count / total) * 100).toFixed(0);
                          return `${complexity}: ${count} (${pct}%)`;
                        }}
                        labelLine={false}
                      >
                        {insights.accountComplexityDistribution.map((entry, idx) => {
                          const color = CHART_COLORS[idx % CHART_COLORS.length];
                          const opacity = getElementOpacity('pie-complexity', idx);
                          const highlighted = isSelected('pie-complexity', idx);
                          return <Cell key={entry.complexity} fill={color} fillOpacity={opacity} stroke={highlighted ? vars.text : vars.surface} strokeWidth={highlighted ? 3 : 2} />;
                        })}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ChartLegendButtons
                  items={insights.accountComplexityDistribution.map((e) => ({ key: e.complexity, label: e.complexity }))}
                  type="pie-complexity"
                  colors={CHART_COLORS}
                  isSelected={isSelected}
                  onBadgeClick={handleBadgeClick}
                />
              </>
            ) : (
              <EmptyState message="No account data available." action={{ label: "Import accounts", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Custodian Relationships"
            subtitle="Account concentration by custodian."
            insight="Custodian concentration reveals transition complexity and consolidations opportunities."
            tone="slate"
          >
            {insights.custodianDistribution.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={insights.custodianDistribution} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} />
                  <YAxis type="category" dataKey="custodian" width={140} tick={AXIS_TICK} />
                  <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={{ color: vars.label, fontWeight: 600 }} />
                  <Bar dataKey="accountCount" fill={CHART_COLORS[1]} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No custodian data available." action={{ label: "Import account details", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Marital Status Breakdown"
            subtitle="Member counts by status, plus households containing at least one member in each status."
            insight="Member counts size planning demand; household counts show how widely each status appears across the book."
            tone="amber"
          >
            {insights.maritalStatusDistribution.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={insights.maritalStatusDistribution}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="status" tick={AXIS_TICK} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} />
                  <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={{ color: vars.label, fontWeight: 600 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: vars.legend }} />
                  <Bar dataKey="count" name="Members" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="householdCount" name="Households" fill={CHART_COLORS[4]} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No marital status data available." action={{ label: "Import member details", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Occupation Distribution"
            subtitle="Top client professions."
            insight="Professional concentrations reveal industry expertise value and networking opportunities."
            tone="teal"
          >
            {occupationForChart.length ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={occupationForChart} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} />
                  <YAxis type="category" dataKey="occupation" width={160} tick={AXIS_TICK} />
                  <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={{ color: vars.label, fontWeight: 600 }} />
                  <Bar dataKey="count" fill={CHART_COLORS[4]} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No occupation data available." action={{ label: "Import member details", href: "/upload" }} />
            )}
          </ChartCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Suitability and Data Readiness"
          title="Risk Profile and Data Integrity"
          description="Connect suitability signals with profile completeness before making recommendations."
        />
        <div className="grid gap-6 2xl:grid-cols-2">
          <ChartCard
            title="Risk Tolerance vs Time Horizon"
            subtitle="Most common profile combinations in current scope."
            insight="Watch for high-risk + short-horizon combinations; they often require recommendation guardrails."
            tone="amber"
          >
            {riskTimeDistribution.length ? (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_72px] gap-2 rounded-lg bg-bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  <span>Risk Tolerance</span>
                  <span>Time Horizon</span>
                  <span className="text-right">Count</span>
                </div>
                {riskTimeDistribution.map((row) => (
                  <div
                    key={`${row.riskTolerance}-${row.timeHorizon}`}
                    className="grid grid-cols-[1fr_1fr_72px] items-center gap-2 rounded-xl border border-border-primary bg-bg-surface/80 px-3 py-2 text-sm"
                  >
                    <span className="rounded-full border border-warning-border bg-warning-subtle px-2.5 py-1 text-center text-[11px] font-semibold uppercase leading-snug tracking-[0.06em] text-warning-text">
                      {row.riskTolerance}
                    </span>
                    <span className="rounded-full border border-info-border bg-info-subtle px-2.5 py-1 text-center text-[11px] font-semibold uppercase leading-snug tracking-[0.06em] text-info-text">
                      {row.timeHorizon}
                    </span>
                    <span className="text-right font-semibold text-text-secondary">{row.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Insufficient profile data. Add risk tolerance and time horizon to unlock this analysis." action={{ label: "Enrich via audio", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Investment Experience Radar"
            subtitle="Each household contributes its highest reported years per asset class; chart shows the mean across households."
            insight="Use low-experience categories to calibrate complexity and communication depth in proposals."
            tone="teal"
          >
            {radarHasData ? (
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
                  <PolarGrid stroke={vars.grid} />
                  <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: vars.axis }} />
                  <Radar dataKey="value" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.34} />
                  <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No investment experience data populated yet." action={{ label: "Upload data", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Account Type Distribution"
            subtitle="Book composition by account type. Click a badge to highlight."
            insight="Concentration by account type can reveal cross-sell and product diversification opportunities."
            tone="teal"
          >
            {insights.accountTypeDistribution.length ? (
              <>
                <div onClick={handleChartAreaClick} className="cursor-pointer space-y-2">
                  {insights.accountTypeDistribution.map((entry, idx) => {
                    const maxCount = Math.max(...insights.accountTypeDistribution.map((e) => e.count));
                    const pct = (entry.count / insights.accountTypeDistribution.reduce((sum, e) => sum + e.count, 0)) * 100;
                    const opacity = getElementOpacity('bar-account-type', idx);
                    const highlighted = isSelected('bar-account-type', idx);
                    return (
                      <div key={entry.type} className="group flex items-center gap-3">
                        <div className="w-28 flex-shrink-0">
                          <p className={`truncate text-xs font-medium transition-all duration-200 ${highlighted ? 'text-text-primary font-bold' : 'text-text-secondary'}`} title={entry.type}>
                            {entry.type}
                          </p>
                        </div>
                        <div className="relative flex-1 h-6 rounded-full bg-bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: formatPctOfMax(entry.count, maxCount),
                              backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                              opacity,
                            }}
                          />
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2 text-[10px] text-text-tertiary tabular-nums">
                          <span className={`font-semibold transition-all duration-200 ${highlighted ? 'text-text-primary' : 'text-text-secondary'}`}>{pct.toFixed(0)}%</span>
                          <span className="text-text-quaternary">·</span>
                          <span className={highlighted ? 'text-text-primary font-bold' : ''}>{entry.count}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <ChartLegendButtons
                  items={insights.accountTypeDistribution.map((e) => ({ key: e.type, label: e.type }))}
                  type="bar-account-type"
                  colors={CHART_COLORS}
                  isSelected={isSelected}
                  onBadgeClick={handleBadgeClick}
                />
              </>
            ) : (
              <EmptyState message="No account data available." action={{ label: "Upload spreadsheet", href: "/upload" }} />
            )}
          </ChartCard>

          <ChartCard
            title="Data Completeness Heatmap"
            subtitle="Green indicates populated fields; gray indicates missing data."
            insight="Prioritize households with the densest gray blocks to improve downstream recommendation quality."
            tone="indigo"
          >
            {completeness.length ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-success" />
                    Populated
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded bg-bg-inset" />
                    Missing
                  </span>
                </div>
                <div className="overflow-auto rounded-xl border border-border-primary">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-bg-muted">
                        <th className="sticky left-0 z-10 bg-bg-muted px-3 py-2 text-left font-semibold text-text-secondary">
                          Household
                        </th>
                        {Object.keys(completeness[0]?.fields ?? {}).map((key) => (
                          <th key={key} className="px-1 py-2 text-center font-semibold text-text-tertiary" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
                            {COMPLETENESS_LABELS[key] ?? key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {completeness.map((row) => (
                        <tr key={row.householdId} className="border-t border-border-subtle hover:bg-bg-muted/50">
                          <td className="sticky left-0 bg-bg-surface px-3 py-2">
                            <Link href={`/households/${row.householdId}`} className="truncate font-semibold text-text-secondary transition hover:text-text-primary hover:underline">
                              {row.household}
                            </Link>
                          </td>
                          {Object.entries(row.fields).map(([key, populated]) => (
                            <td key={`${row.householdId}-${key}`} className="px-1 py-1.5 text-center">
                              <span
                                className={`inline-block h-4 w-4 rounded ${populated ? "bg-success" : "bg-bg-inset"}`}
                                title={`${COMPLETENESS_LABELS[key] ?? key}: ${populated ? "Present" : "Missing"}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState message="No household data available." action={{ label: "Import households", href: "/upload" }} />
            )}
          </ChartCard>
        </div>
      </section>
    </section>
  );
}

function ChartLegendButtons({
  items,
  type,
  colors,
  isSelected: isSelectedFn,
  onBadgeClick,
}: {
  items: { key: string; label: string }[];
  type: string;
  colors: string[];
  isSelected: (type: string, index: number) => boolean;
  onBadgeClick: (type: string, index: number, event: React.MouseEvent) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((item, idx) => {
        const highlighted = isSelectedFn(type, idx);
        return (
          <button
            key={item.key}
            onClick={(e) => onBadgeClick(type, idx, e)}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs shadow-sm transition-all duration-200 ${
              highlighted
                ? 'border-text-primary bg-text-primary ring-2 ring-text-quaternary ring-offset-1 ring-offset-bg-surface'
                : 'border-border-primary bg-bg-surface hover:border-border-primary hover:shadow-md'
            }`}
            title={`Click to highlight ${item.label}`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ring-1 ring-border-primary transition-all duration-200 ${
                highlighted ? 'ring-bg-surface scale-125' : ''
              }`}
              style={{ backgroundColor: colors[idx % colors.length] }}
            />
            <span className={`font-medium ${highlighted ? 'text-bg-surface' : 'text-text-secondary'}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-tertiary" aria-hidden="true">{eyebrow}</p>
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-text-primary">{title}</h2>
      <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
    </div>
  );
}

function SummaryMetric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: ChartTone }) {
  return (
    <article className="group relative overflow-hidden rounded-xl border border-border-primary bg-bg-surface px-3 py-2.5 shadow-[var(--shadow-chart)] transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${TONE_BARS[tone]} transition-all duration-300 group-hover:h-1`} />
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">{label}</p>
      <p className="mt-1 font-[family-name:var(--font-display)] text-xl font-semibold text-text-primary tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-text-tertiary">{hint}</p> : null}
    </article>
  );
}

function ChartCard({ title, subtitle, insight, children, tone = "slate" }: { title: string; subtitle?: string; insight?: string; children: React.ReactNode; tone?: ChartTone }) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-border-primary/80 bg-bg-surface/90 p-5 shadow-[var(--shadow-chart)] backdrop-blur transition-all duration-300 hover:shadow-[var(--shadow-elevated)] hover:border-border-primary md:p-6">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${TONE_BARS[tone]} transition-all duration-300 group-hover:h-1.5`} />
      <div className="relative">
        <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-text-primary">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-text-secondary leading-relaxed">{subtitle}</p> : null}
        {insight ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-border-primary bg-bg-muted px-3 py-2.5 text-xs text-text-secondary transition-colors group-hover:border-border-primary">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span><span className="font-semibold text-text-primary">Why this matters:</span> {insight}</span>
          </div>
        ) : null}
        <div className="mt-4">{children}</div>
      </div>
    </article>
  );
}
