import { ImageResponse } from 'next/og'
import { getPublicDeal } from '@/server/deal'
import { formatAmount } from '@/view/format'
import { dealHeadline } from '@/view/status'

export const alt = 'Waybill deal record'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 30

/** A plain card for link previews. It states only what the public record shows; an unfunded deal shows no figures. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id
  let line = 'Deal record'
  let sub = 'Waybill · staged payments in USDC on Arc'
  if (/^\d+$/.test(raw)) {
    try {
      const read = await getPublicDeal(BigInt(raw))
      if (read.status === 'ready' && ['funded', 'settled', 'cancelled'].includes(read.deal.state)) {
        line = `Deal ${raw} · ${dealHeadline(read.deal)}`
        sub = `${formatAmount(read.deal.totalAmount)} USDC · ${read.deal.tranches.length} ${read.deal.tranches.length === 1 ? 'part' : 'parts'}`
      } else if (read.status === 'ready') line = `Deal ${raw}`
    } catch {
      line = `Deal ${raw}`
    }
  }
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#f6f1e4', color: '#16181d' }}>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Waybill</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>{line}</div>
          <div style={{ fontSize: 38, marginTop: 20, color: '#555a63' }}>{sub}</div>
        </div>
        <div style={{ fontSize: 26, color: '#555a63' }}>Non-custodial escrow · Arc</div>
      </div>
    ),
    size,
  )
}
