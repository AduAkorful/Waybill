import Link from 'next/link'
import { PublicShell } from '@/ui/PublicShell'

export default function NotFound() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-md px-4 py-20">
        <h1 className="text-2xl font-semibold">We could not find that page</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-graphite">The link may be mistyped, or the deal does not exist on this network. Check the deal number in the link you were sent, or ask whoever sent it.</p>
        <Link href="/" className="mt-6 inline-block rounded-md border border-rule px-4 py-2 text-[14px]">
          Back to the front page
        </Link>
        <Link href="/signin" className="mt-6 ml-2 inline-block rounded-md border border-rule px-4 py-2 text-[14px]">
          Sign in to see your deals
        </Link>
      </main>
    </PublicShell>
  )
}
