import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getBrowserNetwork } from '@/integration/network'
import { getPublicDeal } from '@/server/deal'
import { PrintButton } from './PrintButton'
import { formatAmount, formatDateTime, shortHash } from '@/view/format'
import { releasedFor, refundedFor, heldFor, fundingTotal, unknownSplitParts } from '@/view/derive'
import { trancheName } from '@/view/labels'
import { describeEvent } from '@/view/timeline'

export const revalidate = 30
export const metadata: Metadata = { title: 'Deal record', robots: { index: false } }

/** A plain, always-white record of one deal for printing or saving as PDF. */
export default async function PrintRecord({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id
  if (!/^\d+$/.test(raw)) notFound()
  const read = await getPublicDeal(BigInt(raw))
  if (read.status === 'missing') notFound()
  const { deal, history } = read
  const net = getBrowserNetwork()
  const open = unknownSplitParts(deal).length > 0

  return (
    <main className="print-sheet mx-auto max-w-3xl bg-white px-8 py-10 text-[13px] text-black">
      <style>{`@media print { .no-print { display: none } body { background: #fff } } .print-sheet { color-scheme: light }`}</style>
      <div className="no-print mb-6 flex justify-end">
        <PrintButton />
      </div>
      <h1 className="text-[22px] font-semibold">Waybill deal record · deal {deal.id.toString()}</h1>
      <p className="mt-1">
        {deal.state} · {net.network === 'testnet' ? 'Arc test network' : 'Arc'} · read {formatDateTime(deal.chainTime)}
      </p>

      <table className="mt-6 w-full border-collapse">
        <tbody>
          <Row k="Buyer" v={deal.buyer} />
          <Row k="Supplier" v={deal.supplier} />
          <Row k="Arbiter" v={deal.arbiter} />
          <Row k="Escrow contract" v={net.contracts.escrow} />
          <Row k="Total" v={`${formatAmount(deal.totalAmount)} USDC`} />
          <Row k="Locked at funding" v={`${formatAmount(fundingTotal(deal))} USDC`} />
        </tbody>
      </table>

      <h2 className="mt-6 text-[15px] font-semibold">Parts</h2>
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">Part</th>
            <th>Share</th>
            <th className="text-right">Amount (USDC)</th>
            <th className="text-right">State</th>
          </tr>
        </thead>
        <tbody>
          {deal.tranches.map((t) => (
            <tr key={t.index} className="border-b border-neutral-300">
              <td className="py-1">
                {t.index} · {trancheName(t)}
              </td>
              <td>{(t.bps / 100).toString()}%</td>
              <td className="text-right">{formatAmount(t.amount)}</td>
              <td className="text-right">{t.state.replace('_', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3">
        Paid to supplier {formatAmount(releasedFor(deal))} USDC · returned to buyer {formatAmount(refundedFor(deal))} USDC · held in escrow {formatAmount(heldFor(deal))} USDC
        {open ? ' · figures leave out an arbiter-split part whose decision was not found' : ''}
      </p>

      <h2 className="mt-6 text-[15px] font-semibold">History</h2>
      {history.status !== 'ready' ? (
        <p className="mt-2">History is not available in this copy.</p>
      ) : (
        <ol className="mt-2">
          {(deal.events ?? []).map((e) => (
            <li key={`${e.blockNumber}-${e.logIndex}`} className="border-b border-neutral-300 py-1">
              {e.time === null ? 'time unknown' : formatDateTime(e.time)} · {describeEvent(e)} · {shortHash(e.txHash)}
            </li>
          ))}
        </ol>
      )}
    </main>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-b border-neutral-300">
      <th className="w-40 py-1 text-left font-normal">{k}</th>
      <td className="break-all">{v}</td>
    </tr>
  )
}
