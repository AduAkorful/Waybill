'use client'

/** Last resort when the root layout itself fails. Plain markup only: no fonts, providers or styles can be assumed. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 440, margin: '20vh auto', padding: 16 }}>
        <h1>Waybill could not load</h1>
        <p role="alert">Nothing was sent from your wallet. Reload, and check the deal&apos;s state before you try again.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  )
}
