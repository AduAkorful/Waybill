'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useDeal } from '@/data/use-deal'
import { encodeCurrentEscrowAction } from '@/integration/current-actions'
import { encodeEscrowAction } from '@/integration/escrow'
import { getBrowserNetwork } from '@/integration/network'
import { DisputeDialog } from '@/ui/DisputeDialog'
import { EvidenceList } from '@/ui/EvidenceList'
import { Modal } from '@/ui/Modal'
import { PrivateTerms } from '@/ui/PrivateTerms'
import { TxFlow } from '@/ui/TxFlow'
import { formatAmount, formatDateTime, shortAddress, shortHash } from '@/view/format'
import { describeVote, isArbiterOf, panelAccepted, panelOutcome, panelStanding } from '@/view/panel'
import { disputeStage } from '@/view/room'
import { describeEvent } from '@/view/timeline'
import type { DealView, Tranche } from '@/view/types'
import { DecidePanel } from './DecidePanel'

type Who = 'buyer' | 'supplier' | 'arbiter' | null
type Dialog = { kind: 'respond' | 'append'; t: Tranche } | { kind: 'accept' } | { kind: 'default'; t: Tranche } | null

/** The dispute room: every disputed or decided part of a deal, its clocks, files and history, with each party's real actions. */
export function RoomScreen({ idText }: { idText: string }) {
  const id = /^\d+$/.test(idText) ? BigInt(idText) : null
  const [refresh, setRefresh] = useState(0)
  const read = useDeal(id, refresh)
  const { address } = useAccount()
  const [dialog, setDialog] = useState<Dialog>(null)
  const explorer = getBrowserNetwork().explorerUrl.replace(/\/+$/, '')
  const done = () => {
    setDialog(null)
    setRefresh((n) => n + 1)
  }

  if (id === null) return <Notice title={`“${idText}” is not a deal number`} />
  if (read.status === 'loading' || !address) return <Notice title="Reading the deal from the chain…" quiet />
  if (read.status === 'error') return <Notice title="This deal could not be read" detail={read.message} />

  const d = read.deal
  const me = address.toLowerCase()
  const who: Who = me === d.buyer.toLowerCase() ? 'buyer' : me === d.supplier.toLowerCase() ? 'supplier' : isArbiterOf(d, me) ? 'arbiter' : null
  if (who === null) return <Notice title="This wallet is not named in the deal" detail={`Signed in as ${shortAddress(address)}.`} />

  const decided = d.tranches.filter((t) => t.state === 'resolved' || t.state === 'disputed')
  const accepted = panelAccepted(d)
  // a panel member already counted as accepted is not asked again; without the history the escrow itself refuses a repeat
  const needsAccept = who === 'arbiter' && d.state === 'proposed' && !d.arbiterAccepted && accepted?.[me] !== true

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <Link href={who === 'buyer' ? `/app/deals/${d.id}` : who === 'supplier' ? `/d/${d.id}` : '/app/arbiter'} className="text-[12.5px] text-graphite">← Back</Link>
      <p className="label mt-4">Dispute room · deal {String(d.id)}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight md:text-[30px]">
        {decided.length === 0 ? 'Nothing is disputed' : `${decided.filter((t) => t.state === 'disputed').length} open, ${decided.filter((t) => t.state === 'resolved').length} decided`}
      </h1>
      <p className="mt-1 text-[13.5px] text-graphite">
        You are {who === 'arbiter' && d.panel ? 'on the panel' : `the ${who}`}. Buyer <span className="mono">{shortAddress(d.buyer)}</span> · supplier <span className="mono">{shortAddress(d.supplier)}</span> · {d.panel ? 'panel' : 'arbiter'} <span className="mono">{d.panel ? d.panel.members.map(shortAddress).join(', ') : shortAddress(d.arbiter)}</span>
      </p>

      {needsAccept ? (
        <div className="mt-6 rounded-md border border-rule bg-sheet p-4">
          <p className="text-[15px] font-semibold">{d.panel ? 'You are named on the three-member panel of this deal' : 'You are named as the arbiter of this deal'}</p>
          <p className="mt-1 text-[13.5px] text-graphite">Accepting records only that you accept. {d.panel ? 'With two other arbiters you decide disputes on this deal: when two of you vote the same way, that outcome applies. The arbiter fee is credited to the first member on the panel. ' : 'You decide disputes on this deal, release, refund or split, and are paid your fee only if you decide in time. '}You can never send money to yourself.</p>
          <button type="button" onClick={() => setDialog({ kind: 'accept' })} className="mt-3 rounded-md bg-held px-4 py-2.5 text-[14px] font-semibold text-sheet">Accept this role</button>
        </div>
      ) : null}

      <PrivateTerms deal={d} wallet={address} />

      {decided.length === 0 && !needsAccept ? <p className="mt-8 text-[14px] text-graphite">When a part is disputed it appears here with its files and deadlines.</p> : null}

      <div className="mt-8 space-y-14">
        {decided.map((t) => (
          <PartRoom key={t.position} deal={d} part={t} who={who} owner={address} explorer={explorer} setDialog={setDialog} onDone={done} />
        ))}
      </div>

      <Modal open={dialog?.kind === 'accept'} onClose={() => setDialog(null)} label="Accept the arbiter role">
        {dialog?.kind === 'accept' ? (
          <>
            <h2 className="text-[19px] font-semibold">Accept this role</h2>
            <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">Records that you accept. Moves no money.</p>
            <TxFlow confirmLabel="Accept" steps={[{ label: 'Accept the arbiter role', action: encodeEscrowAction({ kind: 'acceptArbiter', dealId: d.id }) }]} onCancel={() => setDialog(null)} onDone={done} />
          </>
        ) : null}
      </Modal>
      {dialog && (dialog.kind === 'respond' || dialog.kind === 'append') ? (
        <Modal open onClose={() => setDialog(null)} label={dialog.kind === 'respond' ? 'Respond' : 'Add evidence'}>
          <DisputeDialog deal={d} part={dialog.t} owner={address} mode={dialog.kind} onCancel={() => setDialog(null)} onDone={done} />
        </Modal>
      ) : null}
      {dialog?.kind === 'default' ? (
        <Modal open onClose={() => setDialog(null)} label="Apply the default">
          <h2 className="text-[19px] font-semibold">Apply the default outcome</h2>
          <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">The arbiter missed the deadline. The default applies: a dispute the buyer raised is refunded to the buyer; one the supplier raised is paid to the supplier. The arbiter fee goes back to the buyer.</p>
          <TxFlow confirmLabel="Apply the default" steps={[{ label: 'Apply the default outcome', action: encodeEscrowAction({ kind: 'applyDefault', dealId: d.id, milestoneIndex: dialog.t.position }) }]} onCancel={() => setDialog(null)} onDone={done} />
        </Modal>
      ) : null}
    </main>
  )
}

function PartRoom({ deal, part, who, owner, explorer, setDialog, onDone }: { deal: DealView; part: Tranche; who: Exclude<Who, null>; owner: `0x${string}`; explorer: string; setDialog: (d: Dialog) => void; onDone: () => void }) {
  const open = part.state === 'disputed'
  const stage = disputeStage(part, deal.chainTime)
  const raiser = part.disputeRaiser && part.disputeRaiser.toLowerCase() === deal.buyer.toLowerCase() ? 'buyer' : 'supplier'
  const iRaised = who === raiser
  const events = (deal.events ?? []).filter((e) => e.position === part.position && /^Dispute|^Tranche(Split|Refunded)|DefaultApplied/.test(e.name))

  return (
    <section aria-label={`Part ${part.index}`} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <header>
          <p className="label">Part {part.index} · {formatAmount(part.amount)} USDC · {open ? 'open' : 'decided'}</p>
          {open ? (
            <p className="mt-1 text-[14px]">
              Disputed by the {raiser} on {formatDateTime(part.disputeTime)}. Other parts are not affected.
            </p>
          ) : null}
        </header>

        {open ? (
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px] sm:grid-cols-3">
            <Clock label="Other side may respond until" value={part.responseDeadline} active={stage === 'response_open'} />
            <Clock label="Arbiter decides by" value={part.arbiterDeadline} active={stage === 'decision_open'} />
            <div className="bg-sheet px-3 py-2.5">
              <dt className="label">Response</dt>
              <dd className="mt-0.5 text-[13.5px]">{part.responseSubmitted ? 'Filed' : stage === 'response_open' ? 'Not yet' : 'None was filed'}</dd>
            </div>
          </dl>
        ) : null}

        {deal.panel ? <PanelVotes deal={deal} part={part} /> : null}

        <div>
          <h2 className="label mb-2">Files and notes</h2>
          <EvidenceList dealId={deal.id} owner={owner} part={part.position} />
        </div>

        <div>
          <h2 className="label mb-2">History</h2>
          {events.length === 0 ? <p className="text-[13px] text-graphite">No dispute events indexed yet.</p> : (
            <ol className="space-y-2 text-[13px]">
              {events.map((e) => (
                <li key={`${e.blockNumber}-${e.logIndex}`}>
                  {describeEvent(e)}
                  <span className="mono ml-2 text-[11.5px] text-graphite">
                    {e.time === null ? 'time unknown' : `${formatDateTime(e.time)}`} ·{' '}
                    <a className="underline" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">{shortHash(e.txHash)} ↗</a>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        {!open ? (
          <div role="status" className="rounded-md border border-rule bg-sheet p-4 text-[14px]">This part has been decided.</div>
        ) : stage === 'deadline_passed' ? (
          <div role="status" className="rounded-md border border-hold/50 bg-hold-wash p-4">
            <p className="text-[15px] font-semibold">The arbiter&apos;s deadline has passed</p>
            <p className="mt-1 text-[13px]">The default applies. Anyone named in the deal can apply it; Waybill&apos;s relayer also does.</p>
            <button type="button" onClick={() => setDialog({ kind: 'default', t: part })} className="mt-3 rounded-md bg-ink px-4 py-2 text-[13.5px] font-semibold text-paper">Apply the default</button>
          </div>
        ) : who === 'arbiter' ? (
          stage === 'response_open' ? (
            <div role="status" className="rounded-md border border-rule bg-sheet p-4 text-[13.5px]">
              <p className="font-semibold">The other side is still within their response window</p>
              <p className="mt-1 text-graphite">You can decide from {formatDateTime(part.responseDeadline + 1n)}, once it closes.</p>
            </div>
          ) : deal.arbiterAccepted ? (
            <DecidePanel deal={deal} part={part} owner={owner} onDone={onDone} />
          ) : (
            <div role="status" className="rounded-md border border-rule bg-sheet p-4 text-[13.5px]">Accept the role first, at the top of this page.</div>
          )
        ) : (
          <div className="space-y-2 rounded-md border border-rule bg-sheet p-4">
            {!iRaised && !part.responseSubmitted && stage === 'response_open' ? (
              <button type="button" onClick={() => setDialog({ kind: 'respond', t: part })} className="w-full rounded-md bg-held py-2.5 text-[14px] font-semibold text-sheet">Respond to the dispute</button>
            ) : null}
            <button type="button" onClick={() => setDialog({ kind: 'append', t: part })} className="w-full rounded-md border border-rule py-2.5 text-[14px] font-semibold">Add evidence</button>
            <p className="text-[12px] text-graphite">{stage === 'response_open' ? 'The arbiter decides after the response window closes.' : 'The window to respond has closed. The arbiter is deciding.'}</p>
          </div>
        )}
      </aside>
    </section>
  )
}

function PanelVotes({ deal, part }: { deal: DealView; part: Tranche }) {
  const standing = panelStanding(deal, part)
  const accepted = panelAccepted(deal)
  return (
    <div>
      <h2 className="label mb-2">Panel votes · {panelOutcome(standing) === 'decided' ? 'decided' : 'two matching votes decide'}</h2>
      <ul className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px]">
        {standing.map((s) => (
          <li key={s.member} className="flex flex-wrap items-baseline justify-between gap-2 bg-sheet px-3 py-2.5">
            <span className="mono text-[12.5px]">{shortAddress(s.member)}</span>
            <span className={s.vote === 0 ? 'text-graphite' : 'font-semibold'}>
              {s.vote === 0 ? (accepted?.[s.member.toLowerCase()] === false ? 'Has not accepted the role' : 'Not voted') : describeVote(s.vote)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Clock({ label, value, active }: { label: string; value: bigint; active: boolean }) {
  return (
    <div className={`px-3 py-2.5 ${active ? 'bg-paper' : 'bg-sheet'}`}>
      <dt className="label">{label}</dt>
      <dd className={`mono mt-0.5 text-[13px] ${active ? 'marked font-semibold' : ''}`}>{formatDateTime(value)}</dd>
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
