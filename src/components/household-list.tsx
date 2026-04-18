"use client";

import { useDeferredValue, useState } from "react";

import { HouseholdCard } from "@/components/household-card";
import type { HouseholdSummary } from "@/lib/types";

type SortKey = "name" | "netWorth" | "income" | "completeness";

export function HouseholdList({ households }: { households: HouseholdSummary[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const deferredSearch = useDeferredValue(search);

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const filtered = households.filter((household) => {
    if (!normalizedSearch) {
      return true;
    }
    if (household.name.toLowerCase().includes(normalizedSearch)) {
      return true;
    }
    return household.memberNames.some((name) =>
      name.toLowerCase().includes(normalizedSearch),
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "name") {
      return a.name.localeCompare(b.name);
    }
    if (sortKey === "netWorth") {
      return (b.totalNetWorth ?? -1) - (a.totalNetWorth ?? -1);
    }
    if (sortKey === "income") {
      return (b.income ?? -1) - (a.income ?? -1);
    }
    return b.completenessScore - a.completenessScore;
  });

  return (
    <section className="space-y-5">
      <div className="grid gap-3 rounded-2xl border border-border-primary bg-bg-surface p-4 md:grid-cols-[1fr_auto]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search households or members..."
          className="rounded-lg border border-border-primary bg-bg-muted px-4 py-2 text-sm text-text-primary outline-none ring-accent transition focus:ring-2"
        />
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
          className="rounded-lg border border-border-primary bg-bg-surface px-3 py-2 text-sm font-medium text-text-secondary"
        >
          <option value="name">Sort: Name</option>
          <option value="netWorth">Sort: Net Worth</option>
          <option value="income">Sort: Income</option>
          <option value="completeness">Sort: Completeness</option>
        </select>
      </div>

      {sorted.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((household) => (
            <HouseholdCard key={household.id} household={household} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border-primary bg-bg-surface p-8 text-center text-text-tertiary">
          No households found. Import a spreadsheet on the Upload page.
        </div>
      )}
    </section>
  );
}
