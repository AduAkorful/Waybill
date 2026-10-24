import Link from 'next/link'
import { ThemeToggle, Wordmark } from './Chrome'

/** Header and footer for the public pages. Links point only at pages that exist. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-2 md:gap-4 md:px-8 md:py-4">
        <Link href="/" aria-label="Waybill home" className="inline-flex min-h-11 items-center">
          <Wordmark className="text-[17px]" />
        </Link>
        <div className="flex items-center gap-2 md:gap-5">
          <Link href="/attestors" className="inline-flex min-h-11 items-center px-1 text-[13.5px] text-graphite hover:text-ink">
            Attestors
          </Link>
          <Link href="/signin" className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-[13px] font-semibold whitespace-nowrap hover:bg-sheet md:min-h-0 md:py-1.5">
            Sign in
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-4 py-8 text-[12.5px] leading-relaxed text-graphite md:px-8">
          <Wordmark className="text-[13px] text-ink" />
          <p className="mt-2 max-w-md">Business use only · Early access · Not a bank, custodian or lender. Nobody at Waybill can move escrowed money.</p>
          <p className="mt-2"><Link href="/legal" className="inline-flex min-h-11 items-center underline">Terms, privacy and security</Link></p>
        </div>
      </footer>
    </div>
  )
}
