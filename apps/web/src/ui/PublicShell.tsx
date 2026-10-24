import Link from 'next/link'
import { ThemeToggle, Wordmark } from './Chrome'

/** Header and footer for the public pages. Links point only at pages that exist. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8">
        <Link href="/" aria-label="Waybill home">
          <Wordmark className="text-[17px]" />
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/attestors" className="text-[13.5px] text-graphite hover:text-ink">
            Attestors
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-4 py-8 text-[12.5px] leading-relaxed text-graphite md:px-8">
          <Wordmark className="text-[13px] text-ink" />
          <p className="mt-2 max-w-md">Business use only · Early access · Not a bank, custodian or lender. Nobody at Waybill can move escrowed money.</p>
          <p className="mt-2"><Link href="/legal" className="underline">Terms, privacy and security</Link></p>
        </div>
      </footer>
    </div>
  )
}
