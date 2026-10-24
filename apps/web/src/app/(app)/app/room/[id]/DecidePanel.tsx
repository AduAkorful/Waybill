'use client'

import { useEffect, useState } from 'react'
import { useSignMessage } from 'wagmi'
import { encodeCurrentEscrowAction } from '@/integration/current-actions'
import { describeUploadError, sha256Hex, uploadEvidence } from '@/integration/evidence'
import { TxFlow } from '@/ui/TxFlow'
import { buyerFee } from '@/view/derive'
import { formatAmount } from '@/view/format'
import { describeVote, encodeVote, panelStanding } from '@/view/panel'
import { MIN_REASONING, percentToSplitBps, splitPrincipal } from '@/view/room'
import type { DealView, Tranche } from '@/view/types'
import { getBrowserNetwork } from '@/integration/network'

type Choice = 'supplier' | 'buyer' | 'split'
type Stage = { kind: 'form' } | { kind: 'working'; phase: 'wallet' | 'upload' } | { kind: 'ready'; choice: Choice; bps: number } | { kind: 'recorded' }

/** Reasoning already stored for this deal, part and wallet, kept in this browser so a reload does not ask for a second signature. */
interface Stored {
  choice: Choice
  bps: number
  split: string
  reasoning: string
}
const storageKey = (dealId: bigint, part: number, owner: string) =>
  `waybill:reasoning:${getBrowserNetwork().chainId}:${dealId.toString()}:${part}:${owner.toLowerCase()}`
function loadStored(key: string): Stored | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Stored | null
    return v && typeof v.reasoning === 'string' && ['supplier', 'buyer', 'split'].includes(v.choice) ? v : null
  } catch {
    return null
  }
}

/**
 * The arbiter's decision on one disputed part. The written reasoning is stored with the dispute's other files first,
 * where both sides can read it; the decision is sent only after it is stored. The contract takes the decision alone.
 * On a panel deal the same form casts this member's vote: any two matching votes decide the part.
 */
export function DecidePanel({ deal, part, owner, onDone }: { deal: DealView; part: Tranche; owner: `0x${string}`; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage()
  const isPanel = deal.panel !== null
  const mine = isPanel ? panelStanding(deal, part).find((s) => s.member.toLowerCase() === owner.toLowerCase()) : undefined
  const [choice, setChoice] = useState<Choice | null>(null)
  const [split, setSplit] = useState('50')
  const [reasoning, setReasoning] = useState('')
  const [error, setError] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'form' })
  const [stored, setStored] = useState<Stored | null>(null)
  const key = storageKey(deal.id, part.position, owner)
  useEffect(() => {
    const v = loadStored(key)
    if (!v) return
    setStored(v)
    setChoice(v.choice)
    setSplit(v.split)
    setReasoning(v.reasoning)
    setStage({ kind: 'ready', choice: v.choice, bps: v.bps })
  }, [key])
  const bps = choice === 'split' ? percentToSplitBps(split) : null
  const preview = bps !== null ? splitPrincipal(part.amount, bps) : null
  const ready = choice !== null && reasoning.trim().length >= MIN_REASONING && (choice !== 'split' || bps !== null)

  const store = async () => {
    if (!choice || !ready) return
    setError('')
    const decidedBps = choice === 'split' ? bps! : choice === 'supplier' ? 10_000 : 0
    // the same reasoning is already with the dispute's files: changing only the outcome needs no new signature
    if (stored && stored.reasoning === reasoning.trim()) {
      const next = { ...stored, choice, bps: decidedBps, split }
      window.localStorage.setItem(key, JSON.stringify(next))
      setStored(next)
      setStage({ kind: 'ready', choice, bps: decidedBps })
      return
    }
    setStage({ kind: 'working', phase: 'wallet' })
    try {
      const bytes = new TextEncoder().encode(reasoning.trim())
      await uploadEvidence({
        dealId: deal.id,
        part: part.position,
        signer: owner,
        files: [{ name: 'decision-reasoning.txt', mimeType: 'text/plain', bytes, sha256: await sha256Hex(bytes) }],
        sign: async (message) => {
          setStage({ kind: 'working', phase: 'wallet' })
          const signature = await signMessageAsync({ message })
          setStage({ kind: 'working', phase: 'upload' })
          return signature
        },
      })
      const next: Stored = { choice, bps: decidedBps, split, reasoning: reasoning.trim() }
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // private mode: the flow still works, only a reload asks again
      }
      setStored(next)
      setStage({ kind: 'ready', choice, bps: decidedBps })
    } catch (e) {
      setError(describeUploadError(e))
      setStage({ kind: 'form' })
    }
  }

  if (mine && mine.vote !== 0) {
    return (
      <div role="status" className="rounded-md border border-rule bg-sheet p-4 text-[13.5px]">
        <p className="font-semibold">You voted: {describeVote(mine.vote)}</p>
        <p className="mt-1 text-graphite">A vote cannot be changed. The part is decided as soon as a second member casts the same vote.</p>
      </div>
    )
  }

  if (stage.kind === 'recorded') {
    // the transaction is confirmed: no wallet prompt is left, only the chain read catching up
    return (
      <div role="status" data-decision-recorded className="rounded-md border border-released/40 bg-sheet p-4 text-[13.5px]">
        <p className="font-semibold">{isPanel ? 'Your vote is recorded.' : 'Your decision is recorded.'}</p>
        <p className="mt-1 text-graphite">Confirmed on Arc. The room updates in a moment.</p>
      </div>
    )
  }

  if (stage.kind === 'ready') {
    const action = isPanel
      ? encodeCurrentEscrowAction({
          kind: 'castPanelVote',
          dealId: deal.id,
          milestoneIndex: part.position,
          vote: encodeVote(stage.choice === 'split' ? { kind: 'split', supplierBps: stage.bps } : { kind: stage.choice }),
        })
      : stage.choice === 'split'
        ? encodeCurrentEscrowAction({ kind: 'resolveSplit', dealId: deal.id, milestoneIndex: part.position, supplierBps: stage.bps })
        : encodeCurrentEscrowAction({ kind: 'resolve', dealId: deal.id, milestoneIndex: part.position, toSupplier: stage.choice === 'supplier' })
    const amounts = stage.choice === 'split' ? splitPrincipal(part.amount, stage.bps) : null
    const summary =
      stage.choice === 'supplier'
        ? `Release ${formatAmount(part.amount)} USDC to the supplier`
        : stage.choice === 'buyer'
          ? `Refund ${formatAmount(part.amount)} USDC to the buyer${buyerFee(part, deal.feePayer) > 0n ? `, plus the ${formatAmount(buyerFee(part, deal.feePayer))} USDC fee they prepaid on it (${formatAmount(part.amount + buyerFee(part, deal.feePayer))} in all)` : ''}`
          : `Split: ${stage.bps / 100}% to the supplier, about ${formatAmount(amounts?.supplier ?? 0n)} USDC to the supplier and ${formatAmount(amounts?.buyer ?? 0n)} to the buyer, before fees`
    return (
      <div className="rounded-md border border-rule bg-sheet p-4">
        <p className="mb-3 rounded-md border border-released/40 bg-released-wash px-3 py-2 text-[13px]">Your reasoning is stored where both sides can read it. Now record {isPanel ? 'your vote' : 'the decision'}; once recorded it cannot be changed.</p>
        <p data-decision-summary className="mb-1 text-[14px] font-semibold">{isPanel ? 'Your vote: ' : 'Your decision: '}{summary}</p>
        <p className="mb-3 text-[12.5px] text-graphite">Part {part.index} · {formatAmount(part.amount)} USDC</p>
        {stored?.reasoning || reasoning.trim() ? (
          <div className="mb-3">
            <p className="label">Your stored reasoning</p>
            <blockquote data-stored-reasoning className="mt-1 whitespace-pre-wrap rounded-md border border-rule bg-paper px-3 py-2 text-[13px]">{stored?.reasoning ?? reasoning.trim()}</blockquote>
          </div>
        ) : null}
        <TxFlow confirmLabel={isPanel ? 'Record my vote' : 'Record my decision'} tone="hold" steps={[{ label: isPanel ? 'Record the vote' : 'Record the decision', action }]} onCancel={() => setStage({ kind: 'form' })} onDone={() => { try { window.localStorage.removeItem(key) } catch {} ; setStage({ kind: 'recorded' }); onDone() }} />
        <button type="button" onClick={() => setStage({ kind: 'form' })} className="mt-1 w-full py-2 text-[13px] font-semibold text-ink underline">Change my choice</button>
      </div>
    )
  }

  const busy = stage.kind === 'working'
  const option = (value: Choice, title: string, body: string) => (
    <label className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 ${choice === value ? 'border-ink bg-paper' : 'border-rule'}`}>
      <input type="radio" name="decision" checked={choice === value} onChange={() => setChoice(value)} disabled={busy} className="mt-1 accent-[var(--held)]" />
      <span>
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="block text-[12.5px] text-graphite">{body}</span>
      </span>
    </label>
  )

  return (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <p className="text-[15px] font-semibold">{isPanel ? 'Your vote' : 'Your decision'}</p>
      {isPanel ? <p className="mt-1 text-[12.5px] text-graphite">Three arbiters vote. When two of you choose the same outcome, the part is decided at once. A split counts only if the supplier&apos;s share matches exactly.</p> : null}
      <div className="mt-3 space-y-2">
        {option('supplier', 'Release to the supplier', `The supplier is paid ${formatAmount(part.amount)} USDC.`)}
        {option('buyer', 'Refund to the buyer', `The buyer gets ${formatAmount(part.amount)} USDC back${buyerFee(part, deal.feePayer) > 0n ? `, plus the ${formatAmount(buyerFee(part, deal.feePayer))} USDC fee they prepaid on it` : ''}.`)}
        {option('split', 'Split', 'Part to each side. You choose the supplier’s share.')}
      </div>
      {choice === 'split' ? (
        <div className="mt-3">
          <label className="label block" htmlFor="split">Supplier’s share, %</label>
          <input id="split" inputMode="decimal" value={split} onChange={(e) => setSplit(e.target.value)} disabled={busy} className="mono mt-1.5 w-28 rounded-md border border-rule bg-paper px-3 py-2 text-[14px]" />
          <p className="mt-1.5 text-[12.5px] text-graphite" role="status">
            {preview ? `About ${formatAmount(preview.supplier)} USDC to the supplier and ${formatAmount(preview.buyer)} to the buyer, before fees.` : 'Enter a share between 0.01 and 99.99.'}
          </p>
        </div>
      ) : null}
      <label className="label mt-4 block" htmlFor="reasoning">Your reasoning (shown to both sides)</label>
      <textarea id="reasoning" rows={4} value={reasoning} onChange={(e) => setReasoning(e.target.value)} disabled={busy} className="mt-1.5 w-full rounded-md border border-rule bg-paper p-2 text-[13px]" />
      <p className="mt-1 text-[12px] text-graphite">At least {MIN_REASONING} characters. It is stored with the dispute&apos;s files; the contract records only the decision.</p>
      {error ? <p role="alert" className="mt-2 text-[12.5px] text-hold">{error}</p> : null}
      {stage.kind === 'working' ? (
        <p role="status" className="mt-2 text-[12.5px] text-graphite">
          {stage.phase === 'wallet' ? 'Waiting for your wallet… Approve the message there. This costs nothing.' : 'Storing your reasoning with the dispute’s files…'}
        </p>
      ) : null}
      {stored && stage.kind === 'form' ? <p className="mt-2 text-[12.5px] text-graphite">Your reasoning is already stored. Keep it as is to change only the outcome without signing again.</p> : null}
      <button type="button" disabled={!ready || busy} onClick={() => void store()} className="mt-4 w-full rounded-md bg-hold py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40">
        {stage.kind === 'working' ? (stage.phase === 'wallet' ? 'Waiting for your wallet…' : 'Storing…') : stored && stored.reasoning === reasoning.trim() ? 'Continue' : 'Store reasoning and continue'}
      </button>
    </div>
  )
}
