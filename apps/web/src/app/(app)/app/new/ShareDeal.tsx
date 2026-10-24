'use client'

import Link from 'next/link'
import { useState } from 'react'
import { shortAddress } from '@/view/format'

/** After creation: the supplier's link, ready to send. The link only opens the deal; accepting needs the supplier's own wallet. */
export function ShareDeal({ dealId, supplier }: { dealId: bigint; supplier: string }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/d/${dealId}`
  const message = `Please review and accept deal ${dealId} on Waybill: ${link}\nSign in with the wallet ${shortAddress(supplier)} to accept.`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch {
      setCopied(false)
    }
  }
  return (
    <main className="mx-auto max-w-xl px-4 py-12 md:px-8">
      <p className="label">Deal {String(dealId)} created</p>
      <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Send this link to your supplier</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-graphite">
        They review the terms and accept with the wallet <span className="mono">{shortAddress(supplier)}</span>. Everyone you named must accept before you can fund. Nothing is locked yet.
      </p>
      <div className="mt-6 rounded-md border border-rule bg-sheet p-3.5">
        <p className="mono break-all text-[13px]">{link}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
          <button type="button" onClick={() => void copy()} className="rounded-md bg-ink px-3.5 py-2 font-semibold text-paper">{copied ? 'Link copied ✓' : 'Copy link'}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="rounded-md border border-rule px-3.5 py-2 font-semibold hover:bg-paper">Send on WhatsApp</a>
          <button type="button" onClick={() => navigator.clipboard?.writeText(message)} className="rounded-md border border-rule px-3.5 py-2 font-semibold hover:bg-paper">Copy message (WeChat)</button>
        </div>
      </div>
      <Link href={`/app/deals/${dealId}`} className="mt-6 inline-block text-[14px] font-semibold underline">Open the deal</Link>
    </main>
  )
}
