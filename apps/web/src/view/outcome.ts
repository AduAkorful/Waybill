import { buyerFee, splitBuyerReceives, supplierFee } from './derive'
import { formatAmount } from './format'
import type { DealEvent, DealView, Tranche } from './types'

/** How a decided part ended, read from the decision's own event. */
export type PartOutcome =
  | { kind: 'release'; supplierAmount: bigint }
  | { kind: 'refund'; buyerAmount: bigint; principal: bigint; fee: bigint }
  | { kind: 'split'; supplierBps: number; supplierAmount: bigint; buyerAmount: bigint; buyerPrincipal: bigint; buyerFeeBack: bigint }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null

/** The decision on one part: a TrancheSplit wins, then the arbiter's or panel's whole-part decision, then an applied default. */
export function partOutcome(d: DealView, t: Tranche): PartOutcome | null {
  const evs: readonly DealEvent[] = (d.events ?? []).filter((e) => e.position === t.position)
  const split = d.splits?.find((s) => s.position === t.position)
  if (split) {
    const buyerAmount = splitBuyerReceives(d, t, split)
    return { kind: 'split', supplierBps: split.supplierBps, supplierAmount: split.supplierAmount, buyerAmount, buyerPrincipal: split.buyerPrincipal, buyerFeeBack: buyerAmount - split.buyerPrincipal }
  }
  let toSupplier: boolean | null = null
  for (const e of evs) {
    if ((e.name === 'DisputeResolved' || e.name === 'DefaultApplied') && typeof e.args.toSupplier === 'boolean') toSupplier = e.args.toSupplier
    if (e.name === 'PanelResolved') {
      const v = num(e.args.winningVote)
      if (v === 1) toSupplier = false
      if (v === 2) toSupplier = true
    }
  }
  if (toSupplier === null) return null
  return toSupplier
    ? { kind: 'release', supplierAmount: t.amount - supplierFee(t, d.feePayer) }
    : { kind: 'refund', buyerAmount: t.amount + buyerFee(t, d.feePayer), principal: t.amount, fee: buyerFee(t, d.feePayer) }
}

const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`

/** Short state word for the part's header. */
export function outcomeWord(o: PartOutcome, zh = false): string {
  if (o.kind === 'release') return zh ? '裁决：付给供应商' : 'Released to supplier'
  if (o.kind === 'refund') return zh ? '裁决：退还买方' : 'Refunded to buyer'
  return zh ? `裁决：分配 ${pct(o.supplierBps)}` : `Split ${pct(o.supplierBps)} / ${pct(10_000 - o.supplierBps)}`
}

/** One line with the amounts each side received. */
export function outcomeText(o: PartOutcome, zh = false): string {
  if (o.kind === 'release') return zh ? `仲裁：${formatAmount(o.supplierAmount)} USDC 付给供应商` : `Arbiter released ${formatAmount(o.supplierAmount)} USDC to the supplier`
  if (o.kind === 'refund') {
    if (o.fee === 0n) return zh ? `仲裁：${formatAmount(o.buyerAmount)} USDC 退还买方` : `Arbiter refunded ${formatAmount(o.buyerAmount)} USDC to the buyer`
    return zh
      ? `仲裁：${formatAmount(o.buyerAmount)} USDC 退还买方（部分 ${formatAmount(o.principal)} + 预付费用 ${formatAmount(o.fee)}）`
      : `Arbiter refunded ${formatAmount(o.buyerAmount)} USDC to the buyer (${formatAmount(o.principal)} part + ${formatAmount(o.fee)} prepaid fee)`
  }
  if (o.buyerFeeBack === 0n)
    return zh
      ? `仲裁分配：供应商 ${formatAmount(o.supplierAmount)}，买方 ${formatAmount(o.buyerAmount)} USDC`
      : `Arbiter split it ${pct(o.supplierBps)} to the supplier: supplier ${formatAmount(o.supplierAmount)}, buyer ${formatAmount(o.buyerAmount)} USDC`
  return zh
    ? `仲裁分配：供应商 ${formatAmount(o.supplierAmount)}，买方 ${formatAmount(o.buyerAmount)} USDC（${formatAmount(o.buyerPrincipal)} + 退回预付费用 ${formatAmount(o.buyerFeeBack)}）`
    : `Arbiter split it ${pct(o.supplierBps)} to the supplier: supplier ${formatAmount(o.supplierAmount)}, buyer ${formatAmount(o.buyerAmount)} USDC (${formatAmount(o.buyerPrincipal)} + ${formatAmount(o.buyerFeeBack)} prepaid fee back)`
}
