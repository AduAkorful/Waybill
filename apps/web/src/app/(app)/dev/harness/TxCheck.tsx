'use client'

import { useMemo, useState } from 'react'
import { encodeEscrowAction } from '@/integration/escrow'
import { NetworkGuard } from '@/ui/NetworkGuard'
import { TxFlow } from '@/ui/TxFlow'

const KINDS = ['claim', 'refund', 'applyDefault'] as const

/**
 * Development check for the real transaction flow and the network guard. It signs a fixed escrow action for a
 * deal and part the developer names, through their own wallet. The contract decides whether it can take effect.
 */
export function TxCheck() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('claim')
  const [deal, setDeal] = useState('')
  const [part, setPart] = useState('')
  const [open, setOpen] = useState(false)
  const valid = /^\d+$/.test(deal) && /^\d+$/.test(part) && Number(part) <= 255
  const steps = useMemo(
    () =>
      valid
        ? [{ label: kind, action: encodeEscrowAction({ kind, dealId: BigInt(deal), milestoneIndex: Number(part) }) }]
        : [],
    [valid, kind, deal, part],
  )

  return (
    <section className="mt-8 max-w-md" aria-labelledby="txcheck">
      <h2 id="txcheck" className="text-[17px] font-semibold">Transaction flow</h2>
      <NetworkGuard signedOut={<p className="text-graphite">Connect a wallet above to try the flow.</p>}>
        {open && steps.length > 0 ? (
          <TxFlow steps={steps} confirmLabel={`Send ${kind}`} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
        ) : (
          <form
            className="flex flex-wrap items-end gap-2 text-[13px]"
            onSubmit={(e) => {
              e.preventDefault()
              if (valid) setOpen(true)
            }}
          >
            <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} className="rounded border border-rule bg-paper px-2 py-1">
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
            <label>Deal <input value={deal} onChange={(e) => setDeal(e.target.value.replace(/\D/g, ''))} className="mono w-20 rounded border border-rule bg-paper px-2 py-1" /></label>
            <label>Part (from 0) <input value={part} onChange={(e) => setPart(e.target.value.replace(/\D/g, ''))} className="mono w-16 rounded border border-rule bg-paper px-2 py-1" /></label>
            <button disabled={!valid} className="rounded border border-rule px-2.5 py-1 font-semibold hover:bg-sheet disabled:opacity-50">Prepare</button>
          </form>
        )}
      </NetworkGuard>
    </section>
  )
}
