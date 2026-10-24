'use client'

import Link from 'next/link'
import { earlyResolve, explorerBase } from '@/integration/network'
import { disputeStage } from '@/view/room'
import { ExplorerLink } from '@/ui/ExplorerLink'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useDeal } from '@/data/use-deal'
import { encodeEscrowAction, readMilestone } from '@/integration/escrow'
import { encodeCurrentEscrowAction } from '@/integration/current-actions'
import { getBrowserNetwork } from '@/integration/network'
import { Acceptances, missingAcceptances } from '@/ui/Acceptances'
import { LiveLedger, LiveWaybill } from '@/ui/Live'
import { AddressChanges } from '@/ui/AddressChanges'
import { PrivateTerms } from '@/ui/PrivateTerms'
import { DisputeDialog } from '@/ui/DisputeDialog'
import { EvidenceList } from '@/ui/EvidenceList'
import { Skeleton } from '@/ui/Skeleton'
import { NamedPartyBanner } from '@/ui/NamedPartyBanner'
import { Modal } from '@/ui/Modal'
import { TxFlow, type TxStep } from '@/ui/TxFlow'
import { fundingTotal, graceEnds, overdueStatus, reviewEnds } from '@/view/derive'
import { dealHeadline } from '@/view/status'
import { cancelReadiness, fundReadiness } from '@/view/readiness'
import { formatAmount, formatDateTime, formatUntil, shortAddress, shortHash } from '@/view/format'
import { describeEvent } from '@/view/timeline'
import type { DealView, Tranche } from '@/view/types'
import { FundDialog } from './FundDialog'

type Dialog = { kind: 'fund' } | { kind: 'evidence'; t: Tranche } | { kind: 'dispute'; t: Tranche } | { kind: 'withdraw'; t: Tranche } | { kind: 'approve'; t: Tranche } | { kind: 'confirm'; t: Tranche } | { kind: 'refund'; t: Tranche } | { kind: 'cancel' } | null

const stateLabel: Record<DealView['state'], string> = {
  proposed: 'Waiting for acceptance',
  accepted: 'Ready to fund',
  funded: 'Funded',
  settled: 'Settled',
  cancelled: 'Cancelled',
}

/** One deal, read from the escrow and its indexed history. The buyer's own actions are real wallet signatures. */
export function DealScreen({ idText }: { idText: string }) {
  const valid = /^\d+$/.test(idText)
  const id = valid ? BigInt(idText) : null
  const [refresh, setRefresh] = useState(0)
  const read = useDeal(id, refresh)
  const { address } = useAccount()
  const [dialog, setDialog] = useState<Dialog>(null)
  const explorer = explorerBase()

  const close = () => setDialog(null)
  const finished = () => {
    setDialog(null)
    setRefresh((n) => n + 1)
  }

  if (id === null) return <Message title={`“${idText}” is not a deal number`} />
  if (read.status === 'loading') return <Skeleton label="Reading the deal from the chain…" />
  if (read.status === 'error') return <Message title="This deal could not be read" detail={read.message} />

  const d = read.deal
  const isBuyer = !!address && address.toLowerCase() === d.buyer.toLowerCase()
  const funded = d.state === 'funded' || d.state === 'settled'

  const actions: Record<number, React.ReactNode> = {}
  if (isBuyer) {
    for (const t of d.tranches) {
      const ends = reviewEnds(t)
      if (t.state === 'in_review' && ends !== null) {
        actions[t.index] = (
          <div data-action>
            <p className="text-[13px] leading-snug">
              Confirmed. Your review closes <span className="mono font-semibold">{formatUntil(ends, d.chainTime)}</span>; the part releases then if you do nothing.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setDialog({ kind: 'evidence', t })} className="rounded-md border border-rule px-3.5 py-2 text-[13px] font-semibold hover:bg-sheet">
                Review evidence
              </button>
              <button onClick={() => setDialog({ kind: 'approve', t })} className="rounded-md bg-held px-3.5 py-2 text-[13px] font-semibold text-sheet hover:opacity-90">
                Approve and release
              </button>
              <button onClick={() => setDialog({ kind: 'dispute', t })} className="rounded-md px-3 py-2 text-[13px] font-semibold text-hold hover:bg-hold-wash">
                Dispute
              </button>
            </div>
          </div>
        )
      } else if (t.state === 'disputed') {
        actions[t.index] = (
          <div data-action className="text-[13px]">
            <p className="font-semibold text-hold">{t.buyerRaisedDispute ? 'You disputed this part.' : 'The supplier disputed this part.'}</p>
            <p className="mt-1 text-[12.5px] text-graphite">
              {t.responseSubmitted
                ? earlyResolve()
                  ? 'The other side has responded, so the arbiter can decide now. Other parts are not affected.'
                  : <>The other side has responded. The arbiter can decide after {formatUntil(t.responseDeadline, d.chainTime)}. Other parts are not affected.</>
                : <>{t.buyerRaisedDispute ? 'The supplier' : 'You'} can respond until {formatUntil(t.responseDeadline, d.chainTime)}. The arbiter can decide after that{earlyResolve() ? '; a response lets them decide straight away' : ''}. Other parts are not affected.</>}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Link href={`/app/room/${d.id}`} className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-[12.5px] font-semibold md:min-h-0 md:py-1.5">Open dispute room</Link>
              {t.buyerRaisedDispute ? (
                <button onClick={() => setDialog({ kind: 'withdraw', t })} className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-[12.5px] font-semibold text-ink md:min-h-0 md:py-1.5">
                  Withdraw dispute
                </button>
              ) : null}
            </div>
          </div>
        )
      } else if (d.state === 'funded' && overdueStatus(t, d.chainTime) === 'overdue') {
        actions[t.index] = (
          <div data-action data-overdue className="text-[13px]">
            <p className="leading-snug">
              Overdue: the due time {formatDateTime(t.deadline)} passed without a confirmation. The supplier can dispute until {formatUntil(graceEnds(t), d.chainTime)}; after that you can take this part back.
            </p>
            {t.condition === 'buyer_approval' ? (
              <button onClick={() => setDialog({ kind: 'confirm', t })} className="mt-3 rounded-md border border-rule px-3.5 py-2 text-[13px] font-semibold hover:bg-sheet">
                Confirm delivery anyway
              </button>
            ) : null}
          </div>
        )
      } else if (d.state === 'funded' && overdueStatus(t, d.chainTime) === 'default') {
        actions[t.index] = (
          <div data-action data-default className="text-[13px]">
            <p className="font-semibold">Grace period over. No one confirmed this part.</p>
            <button onClick={() => setDialog({ kind: 'refund', t })} className="mt-3 rounded-md bg-refunded px-3.5 py-2 text-[13px] font-semibold text-sheet">
              Refund {formatAmount(t.amount + (d.feePayer === 'buyer' ? t.fee : 0n))} USDC to me
            </button>
            <p className="mt-1.5 text-[12px] text-graphite">One signature from you applies the default the contract allows. Waybill's relayer then returns the money; if it hasn't yet, you sign the refund too. No one else needs to sign.</p>
          </div>
        )
      } else if (t.state === 'waiting' && t.condition === 'buyer_approval' && d.state === 'funded') {
        // the contract has no supplier "delivered" call: a buyer-approval part waits for the buyer, whose approve
        // either starts the review window (dispute still possible until it closes) or, with no window, makes it claimable
        actions[t.index] = (
          <div data-action data-confirm-delivery className="text-[13px]">
            <p className="leading-snug">
              Waiting on you. When this part is delivered, confirm it here. {t.reviewWindow > 0
                ? <>That starts your {reviewLength(t.reviewWindow)} review: you can still dispute until it closes, then the supplier can claim the money.</>
                : <>The supplier can then claim the money straight away.</>}
              {' '}Due {formatDateTime(t.deadline)}; if it is not confirmed by then the supplier can dispute during the grace period, and after that you can take a refund.
            </p>
            <button onClick={() => setDialog({ kind: 'confirm', t })} className="mt-3 rounded-md bg-held px-3.5 py-2 text-[13px] font-semibold text-sheet hover:opacity-90">
              Confirm delivery
            </button>
          </div>
        )
      } else if (t.state === 'refundable') {
        actions[t.index] = (
          <div data-action className="text-[13px]">
            <p className="font-semibold">Grace period over. No one confirmed this part.</p>
            <button onClick={() => setDialog({ kind: 'refund', t })} className="mt-3 rounded-md bg-refunded px-3.5 py-2 text-[13px] font-semibold text-sheet">
              Refund {formatAmount(t.amount + (d.feePayer === 'buyer' ? t.fee : 0n))} USDC to me
            </button>
            <p className="mt-1.5 text-[12px] text-graphite">No one else needs to sign.</p>
          </div>
        )
      }
    }
  }

  if (!isBuyer && address && address.toLowerCase() === d.supplier.toLowerCase() && d.state === 'funded') {
    for (const t of d.tranches) {
      const late = overdueStatus(t, d.chainTime)
      if (late === 'overdue') {
        actions[t.index] = (
          <div data-action data-overdue className="text-[13px]">
            <p className="font-semibold">This part was not confirmed by {formatDateTime(t.deadline)}. You can dispute it until {formatUntil(graceEnds(t), d.chainTime)}.</p>
            <button onClick={() => setDialog({ kind: 'dispute', t })} className="mt-2.5 rounded-md border border-hold/50 px-3 py-1.5 text-[12.5px] font-semibold text-hold">Dispute (overdue)</button>
          </div>
        )
        continue
      }
      if (late === 'default') {
        actions[t.index] = (
          <div data-action data-default className="text-[13px] text-graphite">
            <p className="leading-snug">The grace period ended {formatDateTime(graceEnds(t))} with no confirmation and no dispute. The buyer can now take this part back.</p>
          </div>
        )
        continue
      }
      if (t.state !== 'waiting' || t.condition !== 'buyer_approval') continue
      actions[t.index] = (
        <div data-action data-waiting-buyer className="text-[13px] text-graphite">
          <p className="leading-snug">
            Waiting for the buyer to confirm delivery. There is nothing for you to sign here: deliver, then ask the buyer to confirm.
            {t.reviewWindow > 0 ? ` Their confirmation starts a ${reviewLength(t.reviewWindow)} review; after it you can claim.` : ' After it you can claim.'}
            {' '}If they have not confirmed by {formatDateTime(t.deadline)}, you can dispute during the grace period.
          </p>
        </div>
      )
    }
  }

  if (!isBuyer && address) {
    // the arbiter, a panel member or the supplier: the room is where a disputed part is answered or decided
    const lower = address.toLowerCase()
    const judges = d.arbiter.toLowerCase() === lower || (d.panel?.members ?? []).some((m) => m.toLowerCase() === lower)
    for (const t of d.tranches) {
      if (t.state !== 'disputed') continue
      actions[t.index] = (
        <div data-action className="text-[13px]">
          <p className="font-semibold text-hold">{t.buyerRaisedDispute ? 'The buyer disputed this part.' : 'The supplier disputed this part.'}</p>
          <p className="mt-1 text-[12.5px] text-graphite">
            {judges
              ? disputeStage(t, d.chainTime, earlyResolve()) === 'decision_open'
                ? t.responseSubmitted ? 'The other side has responded, so you can decide now.' : 'The window to respond has closed, so you can decide now.'
                : earlyResolve()
                  ? <>You can decide after {formatDateTime(t.responseDeadline)}, or straight away if the other side responds sooner.</>
                  : <>You can decide after {formatDateTime(t.responseDeadline)}, when the window to respond ends.</>
              : 'Files, responses and the decision are in the dispute room.'}
          </p>
          <Link href={`/app/room/${d.id}`} className="mt-2.5 inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-[12.5px] font-semibold md:min-h-0 md:py-1.5">{judges ? 'Open the dispute room to decide' : 'Open dispute room'}</Link>
        </div>
      )
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px]">
      <main className="min-w-0 px-4 pt-6 pb-10 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="label">
              <Link href="/app" className="hover:text-ink">
                ← Deals ·{' '}
              </Link>
              Deal {String(d.id)} · {d.state === 'funded' ? dealHeadline(d) : stateLabel[d.state]}
            </p>
            <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight md:text-[28px]">
              {d.terms?.goods ?? `${d.tranches.length} ${d.tranches.length === 1 ? 'part' : 'parts'}`} · {shortAddress(isBuyer ? d.supplier : d.buyer)}
            </h1>
          </div>
          {funded || d.state === 'cancelled' ? (
            <Link href={`/record/${d.id}`} target="_blank" className="rounded-md border border-rule px-3 py-1.5 text-[13px] hover:bg-sheet">
              Public record ↗
            </Link>
          ) : null}
        </div>

        {read.fresh === false ? <p role="status" className="mt-3 text-[12px] text-graphite">Showing what was read a moment ago. Updating from the chain…</p> : null}
        {address && !isBuyer ? <NamedPartyBanner deal={d} wallet={address} /> : null}

        {read.history.status === 'error' ? (
          <p role="alert" className="mt-4 text-[12.5px] text-hold">History is unavailable right now: {read.history.message}</p>
        ) : null}

        <div className="mt-6">
          {d.state === 'proposed' || d.state === 'accepted' ? (
            <div className="space-y-3">
              <Acceptances deal={d} />
              {isBuyer ? (
                <div>
                  {(() => {
                    const fund = fundReadiness(d, missingAcceptances(d))
                    const cancel = cancelReadiness(d)
                    return (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={!fund.ok}
                            aria-describedby="fund-note"
                            onClick={() => setDialog({ kind: 'fund' })}
                            className="rounded-md bg-held px-5 py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Fund {formatAmount(fundingTotal(d))} USDC
                          </button>
                          {d.state === 'proposed' ? (
                            <button
                              disabled={!cancel.ok}
                              aria-describedby="fund-note"
                              onClick={() => setDialog({ kind: 'cancel' })}
                              className="rounded-md px-3 py-2.5 text-[13.5px] text-graphite hover:text-hold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-graphite"
                            >
                              Cancel deal
                            </button>
                          ) : null}
                        </div>
                        <p id="fund-note" className="mt-2 text-[12.5px] text-graphite">
                          {!fund.ok ? fund.reason : null}
                          {!fund.ok && !cancel.ok && d.state === 'proposed' ? ' ' : null}
                          {d.state === 'proposed' && !cancel.ok ? cancel.reason : null}
                        </p>
                      </>
                    )
                  })()}
                </div>
              ) : null}
            </div>
          ) : d.state === 'cancelled' ? (
            <p className="rounded-md border border-rule bg-sheet p-4 text-[14px]">This deal was cancelled before funding. Nothing was locked and it can&apos;t be funded now.</p>
          ) : (
            <LiveLedger deal={d} voice={isBuyer ? 'buyer' : 'public'} />
          )}
        </div>

        {isBuyer || (!!address && address.toLowerCase() === d.supplier.toLowerCase()) ? (
          <AddressChanges deal={d} viewer={isBuyer ? 'buyer' : 'supplier'} onChanged={() => setRefresh((n) => n + 1)} />
        ) : null}
        <div className="mt-8">
          <LiveWaybill deal={d} detail="summary" compact showLockStamp={false} actions={actions} />
        </div>

        {address ? <PrivateTerms deal={d} wallet={address} /> : null}


        <p className="mt-10 max-w-2xl text-[12.5px] leading-relaxed text-graphite">
          {funded ? 'Terms froze when the deal was funded. ' : 'Terms freeze when the buyer funds. '}Nobody, including Waybill, can move this money except by these rules. Read from the escrow as of {formatDateTime(d.chainTime)}.
        </p>
      </main>

      <aside className="border-t border-rule px-5 py-6 lg:border-t-0 lg:border-l" aria-label="History">
        <h2 className="label mb-3">History</h2>
        {read.history.status === 'unconfigured' ? <p className="text-[12.5px] text-graphite">No history source is configured for this site.</p> : null}
        {read.history.status === 'ready' && (d.events ?? []).length === 0 ? <p className="text-[12.5px] text-graphite">No events indexed for this deal yet.</p> : null}
        {(d.events ?? []).length > 0 ? (
          <ol className="space-y-3 text-[13px]">
            {(d.events ?? []).map((e) => (
              <li key={`${e.blockNumber}-${e.logIndex}`}>
                <p>{describeEvent(e)}</p>
                <p className="mono text-[12px] text-graphite">
                  {e.time === null ? 'time unknown' : formatDateTime(e.time)} ·{' '}
                  <ExplorerLink className="underline" href={`${explorer}/tx/${e.txHash}`}>
                    {shortHash(e.txHash)} ↗
                  </ExplorerLink>
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </aside>

      <Modal open={dialog?.kind === 'fund'} onClose={close} label="Fund this deal">
        {dialog?.kind === 'fund' && address ? <FundDialog deal={d} owner={address} onCancel={close} onDone={finished} /> : null}
      </Modal>

      {dialog?.kind === 'confirm' ? (
        <Modal open onClose={close} label="Confirm delivery">
          <p className="label">Part {dialog.t.index}</p>
          <h2 className="mt-1 text-[19px] leading-tight font-semibold">Confirm part {dialog.t.index} was delivered?</h2>
          <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
            {dialog.t.reviewWindow > 0
              ? <>This starts your {reviewLength(dialog.t.reviewWindow)} review of {formatAmount(dialog.t.amount)} USDC. You can still dispute until it closes; then the supplier can claim it.</>
              : <>The supplier can then claim {formatAmount(dialog.t.amount)} USDC straight away, and Waybill can&apos;t return it.</>}
          </p>
          <TxFlow
            confirmLabel="Confirm delivery"
            steps={[step('Confirm delivery', encodeEscrowAction({ kind: 'approveMilestone', dealId: d.id, milestoneIndex: dialog.t.position }))]}
            onCancel={close}
            onDone={finished}
          />
        </Modal>
      ) : null}

      {dialog?.kind === 'approve' ? (
        <Modal open onClose={close} label="Approve and release">
          <p className="label">Part {dialog.t.index}</p>
          <h2 className="mt-1 text-[19px] leading-tight font-semibold">
            Release {formatAmount(dialog.t.amount)} USDC to {shortAddress(d.supplierPayout ?? d.supplier)} now?
          </h2>
          <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
            This ends your review early. The money goes to their payout address and Waybill can&apos;t return it. Other parts stay locked.
          </p>
          <TxFlow
            confirmLabel="Approve and release"
            steps={[step('Approve this part', encodeEscrowAction({ kind: 'approveMilestone', dealId: d.id, milestoneIndex: dialog.t.position }))]}
            onCancel={close}
            onDone={finished}
          />
        </Modal>
      ) : null}

      {dialog?.kind === 'evidence' && address ? (
        <Modal open onClose={close} label="Evidence">
          <p className="label">Part {dialog.t.index}</p>
          <h2 className="mt-1 mb-3 text-[19px] font-semibold">Evidence for this part</h2>
          <EvidenceList dealId={d.id} owner={address} part={dialog.t.position} />
        </Modal>
      ) : null}

      {dialog?.kind === 'dispute' && address ? (
        <Modal open onClose={close} label="Dispute this part">
          <DisputeDialog deal={d} part={dialog.t} owner={address} onCancel={close} onDone={finished} />
        </Modal>
      ) : null}

      {dialog?.kind === 'withdraw' ? (
        <Modal open onClose={close} label="Withdraw the dispute">
          <p className="label">Part {dialog.t.index}</p>
          <h2 className="mt-1 text-[19px] leading-tight font-semibold">Withdraw this dispute?</h2>
          <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">The part goes back to where it was before you disputed it. You can only withdraw until the arbiter decides.</p>
          <TxFlow
            confirmLabel="Withdraw dispute"
            steps={[step('Withdraw the dispute', encodeCurrentEscrowAction({ kind: 'withdrawDispute', dealId: d.id, milestoneIndex: dialog.t.position }))]}
            onCancel={close}
            onDone={finished}
          />
        </Modal>
      ) : null}

      {dialog?.kind === 'refund' ? (
        <Modal open onClose={close} label="Take this part back">
          <p className="label">Part {dialog.t.index}</p>
          <h2 className="mt-1 text-[19px] leading-tight font-semibold">Take {formatAmount(dialog.t.amount)} USDC back?</h2>
          <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
            The grace period is over and no one confirmed this part. It returns to your refund address, with its fee if you prepaid it.
          </p>
          <TxFlow
            confirmLabel="Refund"
            tone="refunded"
            steps={[
              // a part past grace still reads WAITING/OVERDUE until someone applies the default, which makes it REFUNDABLE
              ...(dialog.t.state === 'refundable' ? [] : [step('Apply the default', encodeEscrowAction({ kind: 'applyDefault', dealId: d.id, milestoneIndex: dialog.t.position }))]),
              {
                ...step('Refund this part', encodeEscrowAction({ kind: 'refund', dealId: d.id, milestoneIndex: dialog.t.position })),
                // Waybill's relayer refunds a REFUNDABLE part on its own; a second signature then reverts with InvalidDealState
                alreadyDone: async (client) => (await readMilestone(client, BigInt(d.id), dialog.t.position)).state === MILESTONE_REFUNDED,
                doneNote: `Refunded. ${formatAmount(dialog.t.amount + (d.feePayer === 'buyer' ? dialog.t.fee : 0n))} USDC went back to your refund address; Waybill's relayer sent it, so there was nothing more to sign.`,
              },
            ]}
            onCancel={close}
            onDone={finished}
          />
        </Modal>
      ) : null}

      {dialog?.kind === 'cancel' ? (
        <Modal open onClose={close} label="Cancel this deal">
          <h2 className="text-[19px] leading-tight font-semibold">Cancel this deal?</h2>
          <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">Nothing has been locked, so nothing moves. The deal can&apos;t be funded afterwards.</p>
          <TxFlow
            confirmLabel="Cancel deal"
            tone="hold"
            steps={[step('Cancel the deal', encodeCurrentEscrowAction({ kind: 'cancelUnaccepted', dealId: d.id }))]}
            onCancel={close}
            onDone={finished}
          />
        </Modal>
      ) : null}
    </div>
  )
}

/** MilestoneState.REFUNDED in the escrow */
const MILESTONE_REFUNDED = 6

function step(label: string, action: TxStep['action']): TxStep {
  return { label, action }
}

function Message({ title, detail, quiet }: { title: string; detail?: string; quiet?: boolean }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 role={quiet ? 'status' : 'alert'} className="text-[22px] font-semibold">{title}</h1>
      {detail ? <p className="mt-2 text-[13px] text-graphite">{detail}</p> : null}
      <Link href="/app" className="mt-4 inline-block text-[13.5px] underline">Back to deals</Link>
    </main>
  )
}

function reviewLength(hours: number): string {
  const h = hours
  return h % 24 === 0 ? `${h / 24}-day` : `${h}-hour`
}
