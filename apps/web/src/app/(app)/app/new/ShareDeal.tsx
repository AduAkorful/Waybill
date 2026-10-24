'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { saveTerms } from '@/integration/terms'
import { plainError } from '@/integration/transactions'
import { shortAddress } from '@/view/format'
import type { DealTerms } from '@/view/types'

/** After creation: the supplier's link, ready to send. The link only opens the deal; accepting needs the supplier's own wallet. */
export function ShareDeal({ dealId, supplier, buyer, terms, isPublic }: { dealId: bigint; supplier: string; buyer: string; terms: DealTerms | null; isPublic: boolean }) {
  const [copied, setCopied] = useState(false)
  const { signMessageAsync } = useSignMessage()
  const [saved, setSaved] = useState<{ kind: 'todo' } | { kind: 'working' } | { kind: 'done' } | { kind: 'error'; message: string }>({ kind: 'todo' })
  const saveDetails = async () => {
    if (!terms) return
    setSaved({ kind: 'working' })
    try {
      await saveTerms({ dealId, signer: buyer, terms, isPublic, sign: (message) => signMessageAsync({ message }) })
      setSaved({ kind: 'done' })
    } catch (e) {
      setSaved({ kind: 'error', message: plainError(e) })
    }
  }
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
    <main className="max-w-xl px-4 py-12 md:px-8">
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
      {terms ? (
        <div className="mt-6 rounded-md border border-rule bg-sheet p-3.5" aria-label="Details">
          <p className="text-[14px] font-semibold">Save the details you entered</p>
          <p className="mt-1 text-[13px] text-graphite">One free wallet signature stores them{isPublic ? ' and makes them public' : ' for the people named in the deal'}. The deal itself does not depend on them, and you can do this until it is funded.</p>
          {saved.kind === 'done' ? <p role="status" className="mt-2 text-[13px] text-released">Saved.</p> : (
            <button type="button" disabled={saved.kind === 'working'} onClick={() => void saveDetails()} className="mt-3 rounded-md bg-held px-4 py-2 text-[13.5px] font-semibold text-sheet disabled:opacity-40">
              {saved.kind === 'working' ? 'Waiting for your wallet…' : saved.kind === 'error' ? 'Try again' : 'Sign and save details'}
            </button>
          )}
          {saved.kind === 'error' ? <p role="alert" className="mt-2 text-[12.5px] text-hold">{saved.message}</p> : null}
        </div>
      ) : null}
      <Link href={`/app/deals/${dealId}`} className="mt-6 inline-block text-[14px] font-semibold underline">Open the deal</Link>
    </main>
  )
}
