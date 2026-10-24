import Link from 'next/link'

/** A mistyped address inside the signed-in app keeps the app's own header and offers the way back. */
export default function AppNotFound() {
  return (
    <main className="px-4 py-16 md:px-8 md:py-24">
      <h1 className="max-w-xl text-[30px] leading-tight font-semibold tracking-tight">We could not find that page</h1>
      <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-graphite">The address may be mistyped. Your deals, new deals and settings are one tap away.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/app" className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-[14px] font-semibold text-paper">Back to your deals</Link>
        <Link href="/app/new" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">New deal</Link>
        <Link href="/app/settings" className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px]">Settings</Link>
      </div>
    </main>
  )
}
