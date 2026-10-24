import Link from 'next/link'
import { PublicShell } from '@/ui/PublicShell'

export default function NotFound() {
  return (
    <PublicShell>
      <main className="mx-auto flex max-w-xl flex-col items-start px-4 py-24 md:py-36">
        <h1 className="text-[34px] leading-tight font-semibold tracking-tight">We could not find that page</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-graphite">The link may be mistyped, or the deal does not exist on this network. Check the deal number in the link you were sent, or ask whoever sent it.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">Back to the front page</Link>
          <Link href="/attestors" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">Attestors</Link>
          <Link href="/signin" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">Sign in to see your deals</Link>
        </div>
      </main>
    </PublicShell>
  )
}
