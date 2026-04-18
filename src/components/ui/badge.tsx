import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "info";
}) {
  const styles = {
    neutral: "bg-bg-muted text-text-secondary border-border-primary",
    success: "bg-success-subtle text-success-text border-success-border",
    warning: "bg-warning-subtle text-warning-text border-warning-border",
    info: "bg-info-subtle text-info-text border-info-border",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-wide",
        styles[tone],
      )}
    >
      {children}
    </span>
  );
}
