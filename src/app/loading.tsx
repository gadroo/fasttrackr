export default function Loading() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-40 animate-pulse rounded-2xl border border-border-primary bg-bg-surface/70"
        />
      ))}
    </div>
  );
}
