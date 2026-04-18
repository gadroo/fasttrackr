"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      menuRef.current &&
      !menuRef.current.contains(e.target as Node) &&
      toggleRef.current &&
      !toggleRef.current.contains(e.target as Node)
    ) {
      setMobileOpen(false);
    }
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [mobileOpen, handleClickOutside]);

  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-surface/80 backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="h-7 w-7 shrink-0 rounded-lg bg-[image:var(--gradient-brand)] shadow-[0_10px_25px_-12px_var(--accent)] sm:h-8 sm:w-8" />
          <div className="min-w-0">
            <p className="font-[family-name:var(--font-display)] text-[11px] uppercase tracking-[0.22em] text-text-tertiary sm:text-sm">
              FastTrackr
            </p>
            <p className="truncate font-[family-name:var(--font-display)] text-base font-semibold leading-none text-text-primary sm:text-lg">
              Household Intelligence
            </p>
          </div>
        </div>

        {/* Desktop nav + toggle */}
        <div className="hidden items-center gap-3 md:flex">
          <nav className="flex items-center gap-2 rounded-full border border-border-primary bg-bg-surface/90 p-1 shadow-sm">
            <NavLink href="/">Households</NavLink>
            <NavLink href="/upload">Upload</NavLink>
            <NavLink href="/insights">Insights</NavLink>
          </nav>
          <ThemeToggle />
        </div>

        {/* Mobile: theme toggle + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border-primary bg-bg-surface text-text-secondary shadow-sm transition-all hover:bg-bg-muted hover:text-text-primary"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
          >
            <span className="sr-only">Menu</span>
            <svg
              className={`h-4.5 w-4.5 transition-transform duration-200 ${mobileOpen ? "rotate-90 opacity-0" : "rotate-0 opacity-100"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              style={{ position: "absolute" }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            <svg
              className={`h-4.5 w-4.5 transition-transform duration-200 ${mobileOpen ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              style={{ position: "absolute" }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      <div
        ref={menuRef}
        className={`overflow-hidden border-t border-border-subtle transition-all duration-200 ease-out md:hidden ${
          mobileOpen ? "max-h-60 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
          <MobileNavLink href="/">Households</MobileNavLink>
          <MobileNavLink href="/upload">Upload</MobileNavLink>
          <MobileNavLink href="/insights">Insights</MobileNavLink>
        </nav>
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

function MobileNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <a
      href={href}
      className={`
        rounded-xl px-4 py-3 text-sm font-semibold transition-colors duration-150
        ${isActive
          ? "bg-accent text-accent-on"
          : "text-text-secondary hover:bg-bg-muted hover:text-text-primary"
        }
      `}
      aria-current={isActive ? "page" : undefined}
    >
      {children}
    </a>
  );
}
