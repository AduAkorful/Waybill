import Link from 'next/link'
import { DealLookup } from '@/ui/DealLookup'
import { PublicShell } from '@/ui/PublicShell'

export default function NotFound() {
  return (
    <PublicShell>
      <main className="mx-auto flex min-h-[55vh] w-full max-w-6xl flex-col items-start justify-center px-4 py-16 md:px-8 md:py-24">
        <h1 className="max-w-xl text-[34px] leading-tight font-semibold tracking-tight">We could not find that page</h1>
        <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-graphite">The link may be mistyped. If it was a deal link, the deal may not exist on this network: check the number in the link you were sent, or ask whoever sent it.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">Back to the front page</Link>
          <Link href="/attestors" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">Attestors</Link>
          <Link href="/signin" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">Sign in to see your deals</Link>
        </div>
        <DealLookup />
      </main>
    </PublicShell>
  )
}
