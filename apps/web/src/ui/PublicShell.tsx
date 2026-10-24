import Link from 'next/link'
import { Wordmark } from './Chrome'
import { SiteHeader } from './SiteHeader'

/** Header and footer for the public pages. Links point only at pages that exist. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <SiteHeader />
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
