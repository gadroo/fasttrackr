import Link from "next/link";

export default function HouseholdNotFound() {
  return (
    <div className="rounded-2xl border border-border-primary bg-bg-surface p-8 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-text-primary">Household Not Found</h1>
      <p className="mt-2 text-sm text-text-secondary">The requested household ID does not exist.</p>
      <Link
        href="/"
        className="mt-4 inline-flex rounded-lg bg-text-primary px-4 py-2 text-sm font-semibold text-bg-surface"
      >
        Back to Listing
      </Link>
    </div>
  );
}
