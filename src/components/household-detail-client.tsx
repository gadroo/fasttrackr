"use client";

import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ChangeProposalView,
  EnrichmentView,
  FieldProvenanceView,
  HouseholdDetail,
  MemberDetail,
} from "@/lib/types";
import { formatCurrency, formatDate, formatPercent, formatSeconds } from "@/lib/utils";

type TabKey =
  | "overview"
  | "members"
  | "accounts"
  | "bank"
  | "changes"
  | "enrichment"
  | "sources";

const PROVENANCE_ICONS: Record<string, string> = {
  spreadsheet: "📄",
  audio: "🎤",
  user_edit: "✏️",
};

const PROVENANCE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

function formatProvenanceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return PROVENANCE_DATE_FORMATTER.format(date);
}

function ProvenanceChip({ prov }: { prov: FieldProvenanceView | undefined }) {
  if (!prov) return null;
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-bg-muted px-1.5 py-0.5 text-[10px] text-text-tertiary"
      title={`Source: ${prov.sourceType} (${formatProvenanceDate(prov.setAt)})`}
    >
      {PROVENANCE_ICONS[prov.sourceType] ?? "📋"}{" "}
      {prov.sourceType.replace("_", " ")}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 90 ? "bg-success" : pct >= 70 ? "bg-warning" : "bg-error";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-bg-inset">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-text-secondary">{pct}%</span>
    </div>
  );
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  const tones: Record<string, "info" | "warning" | "success"> = {
    update: "info",
    correction: "warning",
    new_info: "success",
    preference: "info",
    goal: "success",
  };
  return (
    <Badge tone={tones[category] ?? "info"}>
      {category.replace("_", " ")}
    </Badge>
  );
}

export function HouseholdDetailClient({
  household,
  changes,
  enrichment,
  sources,
  provenance = [],
}: {
  household: HouseholdDetail;
  changes: ChangeProposalView[];
  enrichment: EnrichmentView;
  sources: Array<{
    id: string;
    type: string;
    filename: string;
    status: string;
    createdAt: string | Date;
  }>;
  provenance?: FieldProvenanceView[];
}) {
  const hasBankOrBeneficiaries =
    household.bankDetails.length > 0 || household.beneficiaries.length > 0;
  const pendingCount = changes.filter((c) => c.status === "pending").length;

  const tabs = useMemo(() => {
    const base: Array<[TabKey, string]> = [
      ["overview", "Overview"],
      ["members", `Members (${household.members.length})`],
      ["accounts", `Accounts (${household.accounts.length})`],
    ];
    if (hasBankOrBeneficiaries) {
      base.push(["bank", "Bank & Beneficiaries"]);
    }
    base.push(
      ["changes", `Changes${pendingCount > 0 ? ` (${pendingCount})` : ""}`],
      ["enrichment", "Enrichment"],
      ["sources", "Sources"],
    );
    return base;
  }, [household, hasBankOrBeneficiaries, pendingCount]);

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();

  const provMap = useMemo(() => {
    const m = new Map<string, FieldProvenanceView>();
    for (const p of provenance) {
      m.set(p.fieldName, p);
    }
    return m;
  }, [provenance]);

  const handleProposalAction = async (proposalId: string, action: "accept" | "dismiss") => {
    setBusyId(proposalId);
    try {
      await fetch(`/api/changes/${proposalId}/${action}`, { method: "POST" });
      startTransition(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  };

  const groupedMembers = useMemo(() => {
    const order: Record<string, number> = {
      primary: 0,
      spouse: 1,
      child: 2,
      parent: 3,
      other: 4,
      business_entity: 5,
    };
    return [...household.members].sort(
      (a, b) => (order[a.relationship] ?? 99) - (order[b.relationship] ?? 99),
    );
  }, [household.members]);

  const businessMembers = groupedMembers.filter(
    (m) => m.relationship === "business_entity",
  );
  const familyMembers = groupedMembers.filter(
    (m) => m.relationship !== "business_entity",
  );

  const ownershipSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of household.accounts) {
      const t = a.ownershipType ?? "unknown";
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [household.accounts]);

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-border-primary bg-bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-text-tertiary">Household</p>
            <h1 className="break-words font-[family-name:var(--font-display)] text-2xl font-semibold text-text-primary sm:text-3xl">
              {household.name}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {household.address ?? "No address on file"}
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 text-sm sm:w-auto">
            <Stat title="Income" value={formatCurrency(household.income)} />
            <Stat title="Net Worth" value={formatCurrency(household.totalNetWorth)} />
            <Stat title="Completeness" value={formatPercent(household.completenessScore)} />
            <Stat title="Pending" value={String(household.pendingChanges)} highlight={household.pendingChanges > 0} />
          </div>
        </div>
      </header>

      <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide sm:-mx-0 sm:px-0">
        <div className="inline-flex min-w-full gap-1.5 rounded-xl border border-border-primary bg-bg-surface p-1.5 sm:gap-2 sm:p-2">
          {tabs.map(([tabKey, label]) => (
            <button
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                activeTab === tabKey
                  ? "bg-text-primary text-bg-surface"
                  : "text-text-secondary hover:bg-bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FieldCard label="Tax Bracket" value={household.taxBracketRaw ?? "—"} prov={provMap.get("taxBracketRaw")} />
          <FieldCard label="Expense Range" value={household.expenseRange ?? "—"} prov={provMap.get("expenseRange")} />
          <FieldCard label="Risk Tolerance" value={household.riskTolerance ?? "—"} prov={provMap.get("riskTolerance")} />
          <FieldCard label="Time Horizon" value={household.timeHorizon ?? "—"} prov={provMap.get("timeHorizon")} />
          <FieldCard label="Investment Objective" value={household.investmentObjective ?? "—"} prov={provMap.get("investmentObjective")} />
          <FieldCard label="Liquid Net Worth" value={formatCurrency(household.liquidNetWorth)} prov={provMap.get("liquidNetWorth")} />
          <FieldCard label="Annual Income" value={formatCurrency(household.income)} prov={provMap.get("income")} />
          <FieldCard label="Total Net Worth" value={formatCurrency(household.totalNetWorth)} prov={provMap.get("totalNetWorth")} />
          <FieldCard label="Address" value={household.address ?? "—"} prov={provMap.get("address")} />
        </section>
      )}

      {activeTab === "members" && (
        <section className="space-y-6">
          {familyMembers.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-quaternary">
                Family Members
              </h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {familyMembers.map((member) => (
                  <MemberCard key={member.id} member={member} />
                ))}
              </div>
            </div>
          )}
          {businessMembers.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-quaternary">
                Business Entities
              </h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {businessMembers.map((member) => (
                  <MemberCard key={member.id} member={member} isBusiness />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === "accounts" && (
        <section className="space-y-4">
          {ownershipSummary.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ownershipSummary.map(([type, count]) => (
                <span
                  key={type}
                  className="rounded-full border border-border-primary bg-bg-muted px-3 py-1 text-xs font-medium text-text-secondary"
                >
                  {type.toUpperCase()} × {count}
                </span>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-border-primary bg-bg-surface">
            <table className="min-w-full divide-y divide-border-primary text-sm">
              <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Custodian</th>
                  <th className="px-4 py-3">Ownership</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {household.members.flatMap((member) =>
                  member.accounts.map((account) => (
                    <tr key={account.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{account.accountTypeNorm}</p>
                        {account.accountTypeRaw !== account.accountTypeNorm && (
                          <p className="text-xs text-text-tertiary">{account.accountTypeRaw}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{member.displayName}</td>
                      <td className="px-4 py-3">{account.custodian ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium">
                          {(account.ownershipType ?? "unknown").toUpperCase()}
                        </span>
                        {account.ownershipPct ? (
                          <span className="ml-1 text-text-tertiary">({account.ownershipPct}%)</span>
                        ) : null}
                        {account.coOwnerName ? (
                          <p className="text-xs text-text-tertiary">w/ {account.coOwnerName}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{formatCurrency(account.accountValue)}</td>
                      <td className="px-4 py-3">
                        {account.isUncertain ? (
                          <Badge tone="warning">Uncertain</Badge>
                        ) : null}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "bank" && hasBankOrBeneficiaries && (
        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-border-primary bg-bg-surface p-5">
            <h3 className="font-semibold text-text-primary">Bank Details</h3>
            <div className="mt-3 space-y-2 text-sm text-text-secondary">
              {household.bankDetails.length ? (
                household.bankDetails.map((row) => (
                  <div key={row.id} className="rounded-lg border border-border-primary bg-bg-muted p-3">
                    <p className="font-medium">
                      {row.bankName ?? "Unknown bank"} ({row.bankType ?? "n/a"})
                    </p>
                    <p>Account: {row.accountNumber ?? "—"}</p>
                    {row.routingNumber && <p>Routing: {row.routingNumber}</p>}
                  </div>
                ))
              ) : (
                <p>No bank details available.</p>
              )}
            </div>
          </article>
          <article className="rounded-2xl border border-border-primary bg-bg-surface p-5">
            <h3 className="font-semibold text-text-primary">Beneficiaries</h3>
            <div className="mt-3 space-y-2 text-sm text-text-secondary">
              {household.beneficiaries.length ? (
                household.beneficiaries.map((b) => (
                  <div key={b.id} className="rounded-lg border border-border-primary bg-bg-muted p-3">
                    <p className="font-medium">{b.name}</p>
                    <p>
                      Ordinal {b.ordinal}
                      {b.percentage ? ` · ${b.percentage}%` : ""}
                      {b.dob ? ` · DOB: ${formatDate(b.dob)}` : ""}
                    </p>
                  </div>
                ))
              ) : (
                <p>No beneficiaries available.</p>
              )}
            </div>
          </article>
        </section>
      )}

      {activeTab === "changes" && (
        <section className="space-y-3">
          {changes.length ? (
            changes.map((change) => (
              <article
                key={change.id}
                className={`rounded-2xl border bg-bg-surface p-5 ${
                  change.status === "pending"
                    ? "border-warning-border shadow-[0_0_0_1px_var(--semantic-warning-border)]"
                    : "border-border-primary"
                }`}
              >
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <span>{change.source.type === "audio" ? "🎤" : "📄"}</span>
                  <span>
                    From {change.source.type} import ({change.source.filename})
                  </span>
                  {change.source.artifacts[0]?.detail && (
                    <span className="text-text-quaternary">· {change.source.artifacts[0].detail}</span>
                  )}
                  <CategoryBadge category={change.category} />
                </div>

                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    {change.memberName ? `${change.memberName} → ` : ""}
                    {change.fieldName}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="rounded-lg border border-error-border bg-error-subtle px-3 py-1.5 text-sm line-through decoration-error">
                      {change.oldValue ?? "—"}
                    </span>
                    <span className="text-text-quaternary">→</span>
                    <span className="rounded-lg border border-success-border bg-success-subtle px-3 py-1.5 text-sm font-semibold">
                      {change.newValue}
                    </span>
                  </div>
                </div>

                <div className="mt-3">
                  <ConfidenceBar value={change.confidence} />
                </div>

                {change.verbatimQuote && (
                  <blockquote className="mt-3 rounded-lg border-l-4 border-warning bg-warning-subtle px-3 py-2 text-sm italic text-text-secondary">
                    &ldquo;{change.verbatimQuote}&rdquo;
                    {change.source.artifacts[0]?.timestampStart != null && (
                      <span className="ml-2 not-italic text-xs text-warning">
                        ▶ {formatSeconds(change.source.artifacts[0].timestampStart)}
                        {change.source.artifacts[0].timestampEnd != null &&
                          ` – ${formatSeconds(change.source.artifacts[0].timestampEnd)}`}
                      </span>
                    )}
                  </blockquote>
                )}

                {change.ambiguityNote && (
                  <p className="mt-2 text-xs text-warning">⚠ {change.ambiguityNote}</p>
                )}

                <div className="mt-4 flex items-center gap-2">
                  <Badge tone={change.status === "pending" ? "warning" : change.status === "accepted" || change.status === "auto_applied" ? "success" : "info"}>
                    {change.status.replace("_", " ")}
                  </Badge>
                  {change.status === "pending" && (
                    <>
                      <Button
                        disabled={busyId === change.id}
                        onClick={() => handleProposalAction(change.id, "accept")}
                        variant="secondary"
                      >
                        Accept
                      </Button>
                      <Button
                        disabled={busyId === change.id}
                        onClick={() => handleProposalAction(change.id, "dismiss")}
                        variant="ghost"
                      >
                        Dismiss
                      </Button>
                    </>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border-primary bg-bg-surface p-6 text-center text-text-tertiary">
              No change proposals yet. Upload audio or re-import a spreadsheet to generate proposals.
            </div>
          )}
        </section>
      )}

      {activeTab === "enrichment" && (
        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-border-primary bg-bg-surface p-5">
            <h3 className="font-semibold text-text-primary">Transcript</h3>
            <div className="mt-3 max-h-[520px] space-y-1.5 overflow-auto pr-2 text-sm">
              {enrichment.transcript?.segments.length ? (
                enrichment.transcript.segments.map((segment) => {
                  const hasFacts = segment.extractedFacts.length > 0;
                  return (
                    <div
                      key={segment.id}
                      className={`rounded-lg border p-3 transition ${
                        hasFacts
                          ? "border-warning-border bg-warning-subtle shadow-sm"
                          : "border-border-primary bg-bg-muted"
                      }`}
                    >
                      <p className="flex items-center gap-2 text-xs font-semibold text-text-tertiary">
                        <span className="rounded bg-bg-inset px-1.5 py-0.5 font-mono">
                          {formatSeconds(segment.start)} – {formatSeconds(segment.end)}
                        </span>
                        {hasFacts && (
                          <span className="rounded-full bg-warning-subtle border border-warning-border px-2 py-0.5 text-warning-text">
                            {segment.extractedFacts.length} fact{segment.extractedFacts.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                      <p className="mt-1.5 leading-relaxed text-text-secondary">{segment.text}</p>
                    </div>
                  );
                })
              ) : (
                <p className="text-text-tertiary">
                  No transcript enrichment available. Upload audio on the Upload page.
                </p>
              )}
            </div>
          </article>
          <article className="rounded-2xl border border-border-primary bg-bg-surface p-5">
            <h3 className="font-semibold text-text-primary">Extracted Facts</h3>
            <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-2 text-sm">
              {enrichment.extractedFacts.length ? (
                enrichment.extractedFacts.map((fact) => (
                  <div key={fact.id} className="rounded-lg border border-border-primary bg-bg-muted p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-text-primary">{fact.field}</p>
                      <Badge
                        tone={
                          fact.status === "accepted" || fact.status === "auto_applied"
                            ? "success"
                            : fact.status === "dismissed"
                              ? "info"
                              : "warning"
                        }
                      >
                        {fact.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      {fact.oldValue && (
                        <>
                          <span className="rounded border border-error-border bg-error-subtle px-2 py-0.5 text-xs line-through decoration-error">
                            {fact.oldValue}
                          </span>
                          <span className="text-text-quaternary">→</span>
                        </>
                      )}
                      <span className="rounded border border-success-border bg-success-subtle px-2 py-0.5 text-xs font-semibold">
                        {fact.newValue}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <ConfidenceBar value={fact.confidence} />
                    </div>
                    {fact.verbatimQuote && (
                      <p className="mt-1.5 text-xs italic text-text-tertiary">
                        &ldquo;{fact.verbatimQuote}&rdquo;
                      </p>
                    )}
                    {fact.ambiguityNote && (
                      <p className="mt-1 text-xs text-warning">⚠ {fact.ambiguityNote}</p>
                    )}
                    <p className="mt-1.5 text-xs text-text-quaternary">
                      Segments: {fact.segmentIndices.length ? fact.segmentIndices.join(", ") : "n/a"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-text-tertiary">
                  No extracted facts available. Upload audio to enrich this household.
                </p>
              )}
            </div>
          </article>
        </section>
      )}

      {activeTab === "sources" && (
        <section className="rounded-2xl border border-border-primary bg-bg-surface p-5">
          <h3 className="font-semibold text-text-primary">Import Timeline</h3>
          <div className="mt-4 space-y-3">
            {sources.length ? (
              sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center gap-4 rounded-lg border border-border-primary bg-bg-muted px-4 py-3"
                >
                  <span className="text-xl">
                    {source.type === "audio" ? "🎤" : "📄"}
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">{source.filename}</p>
                    <p className="text-xs text-text-tertiary">
                      {source.type} · {source.status} · {formatDate(source.createdAt)}
                    </p>
                  </div>
                  <Badge tone={source.status === "completed" ? "success" : source.status === "failed" ? "warning" : "info"}>
                    {source.status}
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-text-tertiary">No sources found.</p>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

function MemberCard({ member, isBusiness = false }: { member: MemberDetail; isBusiness?: boolean }) {
  const relationBadgeTone = (() => {
    switch (member.relationship) {
      case "primary":
        return "success" as const;
      case "spouse":
        return "info" as const;
      case "business_entity":
        return "warning" as const;
      default:
        return "info" as const;
    }
  })();

  return (
    <article
      className={`rounded-2xl border p-5 ${
        isBusiness
          ? "border-warning-border bg-warning-subtle"
          : "border-border-primary bg-bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-text-primary">{member.displayName}</h3>
        <Badge tone={relationBadgeTone}>
          {member.relationship.replace("_", " ")}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-text-secondary">
        <p>DOB: {formatDate(member.dob)}</p>
        <p>Phone: {member.phone ?? "—"}</p>
        <p>Email: {member.email ?? "—"}</p>
        <p>Occupation: {member.occupation ?? "—"}</p>
        <p>Employer: {member.employer ?? "—"}</p>
        <p>Marital: {member.maritalStatus ?? "—"}</p>
      </div>
      {member.accounts.length > 0 && (
        <div className="mt-3 border-t border-border-primary pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-quaternary">
            {member.accounts.length} Account{member.accounts.length > 1 ? "s" : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {member.accounts.map((a) => (
              <span
                key={a.id}
                className="rounded-full border border-border-primary bg-bg-muted px-2.5 py-0.5 text-xs text-text-secondary"
              >
                {a.accountTypeNorm}
                {a.isUncertain ? " ?" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function Stat({ title, value, highlight = false }: { title: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border-primary bg-bg-muted px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-text-tertiary">{title}</p>
      <p className={`font-semibold ${highlight ? "text-accent" : "text-text-primary"}`}>{value}</p>
    </div>
  );
}

function FieldCard({
  label,
  value,
  prov,
}: {
  label: string;
  value: string;
  prov?: FieldProvenanceView;
}) {
  return (
    <article className="rounded-2xl border border-border-primary bg-bg-surface p-5">
      <div className="flex items-center gap-1">
        <p className="text-xs uppercase tracking-wide text-text-tertiary">{label}</p>
        <ProvenanceChip prov={prov} />
      </div>
      <p className="mt-2 text-lg font-semibold text-text-primary">{value}</p>
    </article>
  );
}
