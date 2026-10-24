"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { arbiter, buyer, inspector } from "@/demo/deal";
import { act } from "@/demo/store";
import { DemoMark, ThemeToggle, Wordmark } from "./Chrome";

interface NavItem {
  href: string;
  label: string;
  match: (p: string) => boolean;
}

/** One app frame for every role. On phones the nav becomes a bottom tab bar so it stays in thumb reach. */
export function RoleShell({
  home,
  role,
  nav,
  person,
  children,
}: {
  home: string;
  role?: string;
  nav: NavItem[];
  person: { name: string; initials: string };
  children: React.ReactNode;
}) {
  const path = usePathname();
  return (
    <div className="flex min-h-dvh flex-col pb-16 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-7">
            <Link href={home} className="flex items-baseline gap-2">
              <Wordmark />
              {role ? <span className="label hidden sm:inline">{role}</span> : null}
            </Link>
            <nav className="hidden gap-5 text-[13px] md:flex" aria-label="Main">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className={n.match(path) ? "font-semibold text-ink" : "text-graphite hover:text-ink"}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <DemoMark className="hidden sm:inline-flex" />
            <button
              onClick={() => {
                if (confirm("Reset every demo deal to its starting state?")) act.reset();
              }}
              className="hidden rounded-full border border-rule px-2.5 py-1 text-[10.5px] text-graphite uppercase hover:text-ink sm:inline-block"
            >
              Reset demo
            </button>
            <ThemeToggle />
            <span className="ml-1 flex items-center gap-2 text-[12.5px]">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10.5px] font-semibold text-paper">{person.initials}</span>
              <span className="hidden sm:inline">{person.name}</span>
            </span>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-paper/95 backdrop-blur md:hidden" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={`flex-1 py-3 text-center text-[12.5px] ${n.match(path) ? "font-semibold text-ink" : "text-graphite"}`}>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleShell
      home="/app"
      person={buyer}
      nav={[
        { href: "/app", label: "Deals", match: (p) => p === "/app" || p.startsWith("/app/deals") },
        { href: "/app/new", label: "New deal", match: (p) => p.startsWith("/app/new") },
        { href: "/app/attestors", label: "Attestors", match: (p) => p.startsWith("/app/attestors") },
        { href: "/app/settings", label: "Settings", match: (p) => p.startsWith("/app/settings") },
      ]}
    >
      {children}
    </RoleShell>
  );
}

export function OperatorShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleShell
      home="/operator"
      role="Operator"
      person={{ name: "Waybill team", initials: "WT" }}
      nav={[
        { href: "/operator", label: "Monitor", match: (p) => p === "/operator" },
        { href: "/operator/pause", label: "New-deal pause", match: (p) => p.startsWith("/operator/pause") },
      ]}
    >
      {children}
    </RoleShell>
  );
}

export function AttestorShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleShell
      home="/attest"
      role="Attestor"
      person={inspector}
      nav={[
        { href: "/attest", label: "Work", match: (p) => p === "/attest" || p.startsWith("/attest/WB") || p.startsWith("/attest/invite") },
        { href: "/attest/fees", label: "Fees", match: (p) => p.startsWith("/attest/fees") },
        { href: "/attest/profile", label: "Profile", match: (p) => p.startsWith("/attest/profile") },
      ]}
    >
      {children}
    </RoleShell>
  );
}

export function ArbiterShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleShell
      home="/arbiter"
      role="Arbiter"
      person={arbiter}
      nav={[
        { href: "/arbiter", label: "Disputes", match: (p) => p === "/arbiter" || p.startsWith("/arbiter/WB") },
        { href: "/arbiter/fees", label: "Fees", match: (p) => p.startsWith("/arbiter/fees") },
      ]}
    >
      {children}
    </RoleShell>
  );
}
