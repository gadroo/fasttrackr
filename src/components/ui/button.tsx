import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

const variantClass: Record<Variant, string> = {
  primary:
    "bg-text-primary text-bg-surface shadow-[var(--shadow-card)] hover:opacity-90",
  secondary: "bg-accent text-accent-on hover:bg-accent-hover",
  ghost: "bg-transparent text-text-secondary hover:bg-bg-muted",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export function Button({ className, variant = "primary", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
