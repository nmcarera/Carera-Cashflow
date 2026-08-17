"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/login/actions";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/import", label: "Import" },
  { href: "/rules", label: "Rules" },
  { href: "/review", label: "Review" },
  { href: "/settings", label: "Settings" },
  { href: "/diagnostics", label: "Diagnostics" },
];

function LogoutButton({ className }: { className: string }) {
  return (
    <form action={logoutAction}>
      <button type="submit" className={className}>
        Log out
      </button>
    </form>
  );
}

export function NavBar({ authEnabled }: { authEnabled: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  if (pathname === "/login") {
    return (
      <header className="border-b border-border bg-surface">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 flex items-center h-16">
          <span className="font-semibold tracking-tight text-lg">Carera&apos;s Cash Flow</span>
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-border bg-surface">
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="font-semibold tracking-tight text-lg" onClick={() => setOpen(false)}>
          Carera&apos;s Cash Flow
        </Link>
        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => {
            const current = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={`px-3 py-2 rounded-md text-sm transition-colors ${
                  current ? "text-foreground bg-background" : "text-muted hover:text-foreground hover:bg-background"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          {authEnabled && (
            <LogoutButton className="px-3 py-2 rounded-md text-sm text-muted hover:text-foreground hover:bg-background" />
          )}
        </nav>
        <button
          type="button"
          className="md:hidden rounded-md p-2 text-muted hover:text-foreground hover:bg-background"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>
      {open && (
        <nav id={menuId} aria-label="Primary" className="md:hidden border-t border-border px-4 sm:px-6 py-2">
          {LINKS.map((l) => {
            const current = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`block px-2 py-2.5 rounded-md text-sm ${
                  current ? "text-foreground bg-background" : "text-muted hover:text-foreground hover:bg-background"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          {authEnabled && (
            <LogoutButton className="block w-full text-left px-2 py-2.5 rounded-md text-sm text-muted hover:text-foreground hover:bg-background" />
          )}
        </nav>
      )}
    </header>
  );
}
