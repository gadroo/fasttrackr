export default function HouseholdDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border-primary bg-bg-surface p-6">
        <div className="h-6 w-48 animate-pulse rounded bg-bg-inset" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg bg-bg-muted px-3 py-2">
              <div className="h-3 w-16 animate-pulse rounded bg-bg-inset" />
              <div className="mt-1 h-4 w-24 animate-pulse rounded bg-border-primary" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 rounded-xl border border-border-primary bg-bg-surface p-2">
        {["Overview", "Members", "Accounts", "Changes"].map((tab) => (
          <div key={tab} className="h-9 w-24 animate-pulse rounded-lg bg-bg-inset" />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border-primary bg-bg-surface p-5">
            <div className="h-3 w-20 animate-pulse rounded bg-bg-inset" />
            <div className="mt-2 h-6 w-32 animate-pulse rounded bg-border-primary" />
          </div>
        ))}
      </div>
    </div>
  );
}
