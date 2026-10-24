'use client'

import Link from 'next/link'

/** Shown when a page throws while rendering. It states what is safe: nothing here can move money without a wallet signature. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">This page could not load</h1>
      <p role="alert" className="text-[14.5px] leading-relaxed text-graphite">
        Something went wrong while showing this page. Nothing was sent from your wallet. If you were in the middle of a payment, open the deal again and check its state before you try again.
      </p>
      {error.digest ? <p className="font-mono text-[12px] text-graphite">Reference {error.digest}</p> : null}
      <div className="flex gap-3">
        <button onClick={reset} className="rounded-md bg-ink px-4 py-2 text-[14px] text-paper">
          Try again
        </button>
        <Link href="/" className="rounded-md border border-rule px-4 py-2 text-[14px]">
          Home
        </Link>
      </div>
    </main>
  )
}
