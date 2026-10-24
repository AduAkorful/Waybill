'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useDeal } from '@/data/use-deal'
import { reviewEnds } from '@/view/derive'
import { PrivateTerms } from '@/ui/PrivateTerms'
import { formatAmount, formatDateTime, shortAddress } from '@/view/format'
import type { DealView, Tranche } from '@/view/types'
import { AcceptPanel } from './AcceptPanel'
import { Statement } from './Statement'
import { WorkPanel } from './WorkPanel'

/** What an attestor sees for one deal: each part naming this wallet, its statement, and the one thing to do next. */
export function AttestScreen({ idText }: { idText: string }) {
  const id = /^\d+$/.test(idText) ? BigInt(idText) : null
  const [refresh, setRefresh] = useState(0)
  const read = useDeal(id, refresh)
  const { address } = useAccount()
  const done = () => setRefresh((n) => n + 1)

  if (id === null) return <Notice title={`“${idText}” is not a deal number`} />
  if (read.status === 'loading' || !address) return <Notice title="Reading the deal from the chain…" quiet />
  if (read.status === 'error') return <Notice title="This deal could not be read" detail={read.message} />

  const d = read.deal
  const mine = d.tranches.filter((t) => t.condition === 'attestation' && t.attestors.some((a) => a.toLowerCase() === address.toLowerCase()))
  if (mine.length === 0) return <Notice title="This wallet is not named to confirm anything in this deal" detail={`Signed in as ${shortAddress(address)}.`} />

  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <Link href="/app/attestor" className="text-[12.5px] text-graphite">← Your work</Link>
      <p className="label mt-4">Deal {String(d.id)}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight md:text-[30px]">
        You are asked to confirm {mine.length === 1 ? `part ${mine[0]!.index}` : `${mine.length} parts`} of {d.tranches.length}
      </h1>
      <p className="mt-1 text-[14px] text-graphite">
        {formatAmount(d.totalAmount)} USDC from <span className="mono">{shortAddress(d.buyer)}</span> to <span className="mono">{shortAddress(d.supplier)}</span>
      </p>
      <PrivateTerms deal={d} wallet={address} />
      <div className="mt-8 space-y-12">
        {mine.map((p) => (
          <PartSection key={p.position} deal={d} part={p} owner={address} onDone={done} />
        ))}
      </div>
    </main>
  )
}

function PartSection({ deal, part, owner, onDone }: { deal: DealView; part: Tranche; owner: `0x${string}`; onDone: () => void }) {
  const ends = reviewEnds(part)
  let action: React.ReactNode
  if (deal.state === 'proposed' && !part.attestorAccepted) action = <AcceptPanel deal={deal} part={part} owner={owner} onDone={onDone} />
  else if (deal.state === 'proposed' || deal.state === 'accepted') action = <Info tone="released" title="You accepted this role." body="We will see the deal funded on the chain. Don't inspect before then." />
  else if (deal.state === 'cancelled') action = <Info title="This deal was cancelled before it was funded." />
  else if (part.state === 'waiting' || part.state === 'overdue') {
    action = part.attested ? <Info tone="released" title="Your confirmation is recorded." body={`${part.attestCount} of ${part.threshold} attestors have signed.`} /> : <WorkPanel deal={deal} part={part} owner={owner} onDone={onDone} />
  } else if (part.state === 'in_review') {
    action = <Info tone="released" title="Signed." body={ends ? `The buyer's review closes ${formatDateTime(ends)} UTC. The part is paid then unless they dispute it.` : undefined} />
  } else if (part.state === 'released' || part.state === 'claimable') action = <Info tone="released" title="This part has been paid to the supplier." />
  else if (part.state === 'disputed') action = <Info tone="hold" title="The buyer disputed this part." body="The arbiter decides. Your signed statement and files are part of the record." />
  else action = <Info title={`This part is ${part.state.replace('_', ' ')}.`} />

  return (
    <section aria-label={`Part ${part.index}`} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Statement deal={deal} part={part} signer={owner} />
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px] sm:grid-cols-3">
          {[
            ['This part', `${formatAmount(part.amount)} USDC`],
            ['Due', `${formatDateTime(part.deadline)} UTC`],
            ['Buyer’s review', `${Math.round(part.reviewWindow / 3600)} h after signing`],
          ].map(([k, v]) => (
            <div key={k} className="bg-sheet px-3 py-2.5">
              <dt className="label">{k}</dt>
              <dd className="mono mt-0.5 text-[13.5px]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <aside className="lg:sticky lg:top-20 lg:self-start">{action}</aside>
    </section>
  )
}

function Info({ title, body, tone }: { title: string; body?: string; tone?: 'released' | 'hold' }) {
  const cls = tone === 'released' ? 'border-released/40 bg-released-wash' : tone === 'hold' ? 'border-hold/50 bg-hold-wash' : 'border-rule bg-sheet'
  return (
    <div role="status" className={`rounded-md border p-4 ${cls}`}>
      <p className="text-[15px] font-semibold">{title}</p>
      {body ? <p className="mt-1 text-[13px]">{body}</p> : null}
    </div>
  )
}

function Notice({ title, detail, quiet }: { title: string; detail?: string; quiet?: boolean }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 role={quiet ? 'status' : 'alert'} className="text-[22px] font-semibold">{title}</h1>
      {detail ? <p className="mt-2 text-[13px] text-graphite">{detail}</p> : null}
      <Link href="/app" className="mt-4 inline-block text-[13.5px] underline">Back to your deals</Link>
    </main>
  )
}
