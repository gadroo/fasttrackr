export function CompletionRing({ value }: { value: number }) {
  const angle = Math.max(0, Math.min(100, value)) * 3.6;
  return (
    <div
      className="relative h-14 w-14 shrink-0 rounded-full p-[3px]"
      style={{
        background: `conic-gradient(var(--ring-accent) ${angle}deg, var(--ring-track) ${angle}deg)`,
      }}
    >
      <div className="flex h-full w-full items-center justify-center rounded-full bg-bg-surface text-xs font-bold text-text-secondary">
        {Math.round(value)}%
      </div>
    </div>
  );
}
