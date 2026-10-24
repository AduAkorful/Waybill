'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useDeal } from '@/data/use-deal'
import { encodeEscrowAction } from '@/integration/escrow'
import { encodeCurrentEscrowAction } from '@/integration/current-actions'
import { getBrowserNetwork } from '@/integration/network'
import { Acceptances, missingAcceptances } from '@/ui/Acceptances'
import { LiveLedger, LiveWaybill } from '@/ui/Live'
import { AddressChanges } from '@/ui/AddressChanges'
import { PrivateTerms } from '@/ui/PrivateTerms'
import { DisputeDialog } from '@/ui/DisputeDialog'
import { EvidenceList } from '@/ui/EvidenceList'
import { Modal } from '@/ui/Modal'
import { TxFlow, type TxStep } from '@/ui/TxFlow'
import { fundingTotal, reviewEnds } from '@/view/derive'
import { dealHeadline } from '@/view/status'
import { cancelReadiness, fundReadiness } from '@/view/readiness'
import { formatAmount, formatDateTime, shortAddress, shortHash } from '@/view/format'
import { describeEvent } from '@/view/timeline'
import type { DealView, Tranche } from '@/view/types'
import { FundDialog } from './FundDialog'

type Dialog = { kind: 'fund' } | { kind: 'evidence'; t: Tranche } | { kind: 'dispute'; t: Tranche } | { kind: 'withdraw'; t: Tranche } | { kind: 'approve'; t: Tranche } | { kind: 'refund'; t: Tranche } | { kind: 'cancel' } | null

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
  const explorer = getBrowserNetwork().explorerUrl.replace(/\/+$/, '')

  const close = () => setDialog(null)
  const finished = () => {
    setDialog(null)
    setRefresh((n) => n + 1)
  }

  if (id === null) return <Message title={`“${idText}” is not a deal number`} />
  if (read.status === 'loading') return <Message title="Reading the deal from the chain…" quiet />
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
              Confirmed. Your review closes <span className="mono font-semibold">{formatDateTime(ends)}</span>; the part releases then if you do nothing.
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
              {t.buyerRaisedDispute ? 'The supplier' : 'You'} can respond until {formatDateTime(t.responseDeadline)}. Then the arbiter decides; other parts are not affected.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Link href={`/app/room/${d.id}`} className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-semibold">Open dispute room</Link>
              {t.buyerRaisedDispute ? (
                <button onClick={() => setDialog({ kind: 'withdraw', t })} className="rounded-md px-2.5 py-1.5 text-[12.5px] text-graphite hover:text-ink">
                  Withdraw dispute
                </button>
              ) : null}
            </div>
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

        <div className="mt-8">
          <LiveWaybill deal={d} detail="summary" compact showLockStamp={false} actions={actions} />
        </div>

        {address ? <PrivateTerms deal={d} wallet={address} /> : null}

        {isBuyer || (!!address && address.toLowerCase() === d.supplier.toLowerCase()) ? (
          <AddressChanges deal={d} viewer={isBuyer ? 'buyer' : 'supplier'} onChanged={() => setRefresh((n) => n + 1)} />
        ) : null}

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
                <p className="mono text-[11.5px] text-graphite">
                  {e.time === null ? 'time unknown' : formatDateTime(e.time)} ·{' '}
                  <a className="underline" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                    {shortHash(e.txHash)} ↗
                  </a>
                </p>
              </li>
            ))}
          </ol>
        ) : null}
      </aside>

      <Modal open={dialog?.kind === 'fund'} onClose={close} label="Fund this deal">
        {dialog?.kind === 'fund' && address ? <FundDialog deal={d} owner={address} onCancel={close} onDone={finished} /> : null}
      </Modal>

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
            steps={[step('Refund this part', encodeEscrowAction({ kind: 'refund', dealId: d.id, milestoneIndex: dialog.t.position }))]}
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

