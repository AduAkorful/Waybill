import type { Metadata } from 'next'
import { explorerBase } from '@/integration/network'
import { ExplorerLink } from '@/ui/ExplorerLink'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBrowserNetwork } from '@/integration/network'
import { dealHeadline } from '@/view/status'
import { getPublicDeal } from '@/server/deal'
import { Acceptances } from '@/ui/Acceptances'
import { Ledger } from '@/ui/Ledger'
import { HistoryRows } from '@/ui/HistoryRows'
import { groupHistory } from '@/view/attestor'
import { PublicShell } from '@/ui/PublicShell'
import { Waybill } from '@/ui/Waybill'
import { formatAmount, formatDateTime, shortAddress, shortHash } from '@/view/format'
import { describeEvent } from '@/view/timeline'
import type { DealState, DealView } from '@/view/types'

// The record is read from the chain at render time and refreshed on this interval.
export const revalidate = 30

const parseId = (raw: string) => (/^\d+$/.test(raw) ? BigInt(raw) : null)

const statusText: Record<DealState, string> = {
  proposed: 'Not funded',
  accepted: 'Not funded',
  funded: 'Funded',
  settled: 'Settled',
  cancelled: 'Cancelled before funding',
}

const isPublic = (d: DealView) => d.state === 'funded' || d.state === 'settled' || d.state === 'cancelled'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = parseId((await params).id)
  if (id === null) return { title: 'Deal not found' }
  const read = await getPublicDeal(id)
  if (read.status === 'missing' || !isPublic(read.deal)) return { title: `Deal ${id}`, description: 'This deal record is not public yet.' }
  const d = read.deal
  const description = `${d.tranches.length} ${d.tranches.length === 1 ? 'part' : 'parts'} · ${formatAmount(d.totalAmount)} USDC · ${dealHeadline(d)}`
  return {
    title: `Deal ${d.id}`,
    description,
    openGraph: { title: `Waybill deal ${d.id}`, description, type: 'article', url: `/record/${d.id}` },
  }
}

export default async function PublicRecord({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id)
  if (id === null) notFound()
  const read = await getPublicDeal(id)
  if (read.status === 'missing') notFound()
  const { deal, history } = read
  const explorer = explorerBase()

  if (!isPublic(deal)) {
    return (
      <PublicShell>
        <main className="mx-auto max-w-2xl px-4 py-24">
          <p className="label">Deal {deal.id.toString()}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">This deal isn't public yet</h1>
          <p className="mt-2 text-[15px] text-graphite">
            A public record appears once the buyer funds the deal and the money is locked. Until then only the people named in it should be given the link.
          </p>
        </main>
      </PublicShell>
    )
  }

  return (
    <PublicShell>
      <main className="mx-auto max-w-6xl px-4 pt-4 pb-20 md:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="label">Public record · deal {deal.id.toString()}</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight md:text-[26px]">{dealHeadline(deal)}</h1>
          </div>
          <Link href={`/record/${deal.id}/print`} className="hidden min-h-11 items-center rounded-md border border-rule px-3 text-[13px] font-semibold hover:bg-sheet md:inline-flex">
            Print or save as PDF
          </Link>
        </div>

        <section className="mt-6">
          <Waybill deal={deal} redacted />
        </section>

        <section className="mt-8">
          <h2 className="text-[17px] font-semibold tracking-tight">Where the money is</h2>
          <div className="mt-3">
            <Ledger deal={deal} voice="public" />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-[17px] font-semibold tracking-tight">Who has agreed</h2>
          <div className="mt-3">
            <Acceptances deal={deal} />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-[17px] font-semibold tracking-tight">History</h2>
          {history.status === 'unconfigured' ? <p className="mt-2 text-graphite">This site has no history source configured, so none is shown.</p> : null}
          {history.status === 'error' ? <p role="alert" className="mt-2 text-hold">History is unavailable right now: {history.message}</p> : null}
          {history.status === 'ready' && (deal.events ?? []).length === 0 ? <p className="mt-2 text-graphite">No events have been indexed for this deal yet.</p> : null}
          {history.status === 'ready' && (deal.events ?? []).length > 0 ? (
            <div className="mt-3">
              <HistoryRows groups={groupHistory(deal.events ?? [], describeEvent)} explorer={explorer} />
            </div>
          ) : null}
        </section>

        <section className="mt-8 text-[13px] text-graphite">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">On-chain details</h2>
          <dl className="mono mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
            <dt>Buyer</dt>
            <dd>{shortAddress(deal.buyer)}</dd>
            <dt>Supplier</dt>
            <dd>{shortAddress(deal.supplier)}</dd>
            <dt>{deal.panel ? 'Arbiter panel' : 'Arbiter'}</dt>
            <dd>{deal.panel ? deal.panel.members.map(shortAddress).join(', ') : shortAddress(deal.arbiter)}</dd>
            <dt>Escrow contract</dt>
            <dd>
              <ExplorerLink className="inline-flex min-h-11 items-center underline" href={`${explorer}/address/${getBrowserNetwork().contracts.escrow}`}>
                {shortAddress(getBrowserNetwork().contracts.escrow)} ↗
              </ExplorerLink>
            </dd>
          </dl>
          <p className="mt-4">Everything on this page is read from the escrow contract on {getBrowserNetwork().network === 'testnet' ? 'the Arc test network' : 'Arc'}. Read as of {formatDateTime(deal.chainTime)}.</p>
        </section>
      </main>
    </PublicShell>
  )
}
