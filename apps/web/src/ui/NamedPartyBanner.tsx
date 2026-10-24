import Link from 'next/link'
import { needsFrom } from '@/view/inbox'
import type { DealView } from '@/view/types'

/**
 * For a wallet that is named on a deal as attestor or arbiter and has not accepted yet: says so where they landed,
 * and links to the one place that role accepts. Shows nothing for anyone else.
 */
export function NamedPartyBanner({ deal, wallet }: { deal: DealView; wallet: `0x${string}` }) {
  const asAttestor = needsFrom('attestor', deal, wallet) === 'Accept'
  const asArbiter = needsFrom('arbiter', deal, wallet) === 'Accept'
  const toSign = needsFrom('attestor', deal, wallet) === 'Sign'
  const attestorAnywhere = deal.tranches.some((t) => t.attestors.some((a) => a.toLowerCase() === wallet.toLowerCase()))
  if (!asAttestor && !asArbiter && attestorAnywhere) {
    // an attestor who has accepted still needs a way to the one page where they sign
    return (
      <div role="status" data-attestor-link className="mt-4 rounded-md border border-held/50 bg-sheet px-4 py-3">
        <p className="text-[14.5px] font-semibold">You are an attestor on deal {String(deal.id)}</p>
        <p className="mt-1 text-[13px] text-graphite">{toSign ? 'A part is waiting for your signed confirmation.' : 'Your attestor page shows what you confirmed and what is left.'}</p>
        <Link href={`/app/attest/${deal.id}`} className="mt-2 inline-block rounded-md bg-held px-3.5 py-2 text-[13.5px] font-semibold text-sheet">{toSign ? 'Open the attestor page and sign' : 'Open the attestor page'}</Link>
      </div>
    )
  }
  if (!asAttestor && !asArbiter) return null
  return (
    <div role="status" className="mt-4 rounded-md border border-held/50 bg-sheet px-4 py-3">
      <p className="text-[14.5px] font-semibold">
        You are named on deal {String(deal.id)} as {asArbiter && asAttestor ? 'an attestor and the arbiter' : asArbiter ? (deal.panel ? 'an arbiter on the panel' : 'the arbiter') : 'an attestor'}
      </p>
      <p className="mt-1 text-[13px] text-graphite">Accepting only records that you agree. It moves no money, and the deal cannot be funded until everyone named has accepted.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {asAttestor ? <Link href={`/app/attest/${deal.id}`} className="rounded-md bg-held px-3.5 py-2 text-[13.5px] font-semibold text-sheet">Accept as attestor</Link> : null}
        {asArbiter ? <Link href={`/app/room/${deal.id}`} className="rounded-md bg-held px-3.5 py-2 text-[13.5px] font-semibold text-sheet">Accept as arbiter</Link> : null}
      </div>
    </div>
  )
}
