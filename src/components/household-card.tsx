import Link from "next/link";

import { CompletionRing } from "@/components/ui/ring";
import type { HouseholdSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

const SOURCE_ICONS: Record<string, string> = {
  spreadsheet: "📄",
  audio: "🎤",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function HouseholdCard({ household }: { household: HouseholdSummary }) {
  const memberPreview = household.memberNames.slice(0, 3).join(", ");
  const extra = household.memberNames.length > 3 ? ` +${household.memberNames.length - 3}` : "";

  return (
    <Link
      href={`/households/${household.id}`}
      className="group relative overflow-hidden rounded-2xl border border-border-primary bg-bg-surface p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-accent"
    >
      <div className="absolute -right-12 -top-12 h-24 w-24 rounded-full bg-[image:var(--gradient-decorative-warm)] opacity-80 blur-xl transition group-hover:scale-110" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="line-clamp-3 break-words font-[family-name:var(--font-display)] text-xl font-semibold leading-tight text-text-primary">
            {household.name}
          </h3>
          <p className="mt-0.5 truncate text-sm text-text-tertiary">
            {memberPreview}{extra}
          </p>
          <p className="mt-0.5 text-xs text-text-quaternary">
            {household.memberCount} members · {household.accountCount} accounts
          </p>
        </div>
        <CompletionRing value={household.completenessScore} />
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-3 text-sm">
        <Metric label="Income" value={formatCurrency(household.income)} />
        <Metric label="Net Worth" value={formatCurrency(household.totalNetWorth)} />
        <Metric label="Liquid NW" value={formatCurrency(household.liquidNetWorth)} />
        <Metric
          label="Pending"
          value={String(household.pendingChanges)}
          highlight={household.pendingChanges > 0}
        />
      </div>

      {household.lastImportAt && (
        <div className="relative mt-3 flex items-center gap-1.5 text-xs text-text-quaternary">
          <span>{SOURCE_ICONS[household.lastImportType ?? ""] ?? "📋"}</span>
          <span>
            {household.lastImportType === "audio" ? "Audio enrichment" : "Spreadsheet import"}{" "}
            {timeAgo(household.lastImportAt)}
          </span>
        </div>
      )}
    </Link>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border-primary bg-bg-muted px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`mt-1 truncate font-semibold ${highlight ? "text-accent" : "text-text-primary"}`}>
        {value}
      </p>
    </div>
  );
}
