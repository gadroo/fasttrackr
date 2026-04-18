"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-surface/80 backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[image:var(--gradient-brand)] shadow-[0_10px_25px_-12px_var(--accent)]" />
          <div>
            <p className="font-[family-name:var(--font-display)] text-sm uppercase tracking-[0.22em] text-text-tertiary">
              FastTrackr
            </p>
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold leading-none text-text-primary">
              Household Intelligence
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-2 rounded-full border border-border-primary bg-bg-surface/90 p-1 shadow-sm">
            <NavLink href="/">Households</NavLink>
            <NavLink href="/upload">Upload</NavLink>
            <NavLink href="/insights">Insights</NavLink>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <a
      href={href}
      className={`
        rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200
        ${isActive
          ? "bg-accent text-accent-on shadow-md ring-1 ring-accent/40"
          : "text-text-secondary hover:bg-bg-muted hover:text-text-primary"
        }
      `}
      aria-current={isActive ? "page" : undefined}
    >
      {children}
    </a>
  );
}
