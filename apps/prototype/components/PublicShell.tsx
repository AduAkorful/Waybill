import Link from "next/link";
import { DemoMark, ThemeToggle, Wordmark } from "./Chrome";

const nav = [
  { href: "/#how", label: "How it works" },
  { href: "/#suppliers", label: "For suppliers" },
  { href: "/attestors", label: "For forwarders" },
  { href: "/#rules", label: "Safety" },
  { href: "/#fees", label: "Fees" },
];

/** Header and footer for every public page: landing, attestor directory, deal record, sign-in. */
export function PublicShell({ children, active }: { children: React.ReactNode; active?: string }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
        <Link href="/" aria-label="Waybill home">
          <Wordmark className="text-[17px]" />
        </Link>
        <nav className="hidden gap-7 text-[13.5px] text-graphite md:flex" aria-label="Main">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={active === n.href ? "font-semibold text-ink" : "hover:text-ink"}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <DemoMark className="hidden sm:inline-flex" />
          <ThemeToggle />
          <Link href="/signin" className="rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper">
            Sign in
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6 px-4 py-10 text-[12.5px] text-graphite md:px-8">
          <div>
            <Wordmark className="text-[13px] text-ink" />
            <p className="mt-2 max-w-sm leading-relaxed">Business use only · Early access · Not a bank, custodian or lender. Nobody at Waybill can move your escrowed money.</p>
          </div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-1.5" aria-label="Footer">
            <Link href="/attestors" className="hover:text-ink">
              Find an attestor
            </Link>
            <Link href="/legal#terms" className="hover:text-ink">
              Terms
            </Link>
            <Link href="/record/WB-0388" className="hover:text-ink">
              Example deal record
            </Link>
            <Link href="/legal#privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/prototype" className="hover:text-ink">
              Prototype index
            </Link>
            <Link href="/legal#security" className="hover:text-ink">
              Security contact
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
