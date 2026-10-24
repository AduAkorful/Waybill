'use client'

import { useState } from 'react'
import { isAddress } from 'viem'
import { encodeCurrentEscrowAction } from '@/integration/current-actions'
import { getBrowserNetwork } from '@/integration/network'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { formatDateTime, shortAddress } from '@/view/format'
import type { DealView, PendingChange } from '@/view/types'

type Which = 'payout' | 'refund'
type Who = 'buyer' | 'supplier'
type Dialog = { propose: Which } | { reject: Which } | { apply: Which } | null

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] mono focus:border-held'

const RULES: Record<Which, { title: string; proposer: Who; rejecter: Who; current: (d: DealView) => string | null; pending: (d: DealView) => PendingChange | null }> = {
  payout: { title: 'Where the supplier is paid', proposer: 'supplier', rejecter: 'buyer', current: (d) => d.supplierPayout, pending: (d) => d.pendingPayout },
  refund: { title: 'Where refunds go', proposer: 'buyer', rejecter: 'supplier', current: (d) => d.buyerRefund, pending: (d) => d.pendingRefund },
}

/** A full address that wraps rather than truncates, with a copy button, so a person can check every character. */
function FullAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="flex items-start gap-2">
      <span className="mono min-w-0 text-[12.5px] break-all">{value}</span>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {})}
        className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-rule px-2.5 text-[12px] font-semibold hover:bg-paper md:min-h-0 md:py-1"
        aria-label={`Copy address ending ${value.slice(-4)}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

/** What the wallet will be asked to sign, in plain words, shown before it opens (wallets often cannot simulate this contract). */
function SignSummary({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="mb-4 rounded-md border border-rule bg-paper px-3 py-2.5">
      <p className="label">What you are signing</p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-graphite">{k}</dt>
            <dd className="min-w-0">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const SECONDARY = 'inline-flex min-h-11 items-center justify-center rounded-md border border-rule px-4 text-[13.5px] font-semibold text-ink hover:bg-paper'

/**
 * Payout and refund addresses can change only through a 48-hour public delay: the person who is paid proposes, the
 * other side can reject while it waits, and anyone can apply it once the delay is over. Shows the part that applies to `viewer`.
 */
export function AddressChanges({ deal, viewer, onChanged }: { deal: DealView; viewer: Who; onChanged: () => void }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [next, setNext] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  if (deal.state !== 'funded') return null
  const escrow = getBrowserNetwork().contracts.escrow
  const close = () => setDialog(null)
  const done = (message: string) => {
    setDialog(null)
    setNext('')
    setNotice(message)
    onChanged()
  }
  const anyPending = deal.pendingPayout !== null || deal.pendingRefund !== null

  return (
    <section aria-label="Addresses" className="mt-8 rounded-md border border-rule bg-sheet p-4">
      <p className="label">Addresses</p>
      {notice ? (
        <p role="status" className="mt-2 rounded-md border border-released/40 bg-released-wash px-3 py-2 text-[13px]">{notice}</p>
      ) : null}
      <div className="mt-2 grid gap-4 md:grid-cols-2 md:gap-6">
        {(['payout', 'refund'] as const).map((which) => {
          const rule = RULES[which]
          const current = rule.current(deal)
          const pending = rule.pending(deal)
          const isProposer = viewer === rule.proposer
          const isRejecter = viewer === rule.rejecter
          const ready = pending !== null && deal.chainTime >= pending.eta
          return (
            <div key={which} className="min-w-0">
              <p className="text-[13px] font-semibold">{rule.title}</p>
              <div className="mt-1">{current ? <FullAddress value={current} /> : <span className="text-[12.5px] text-graphite">not set</span>}</div>
              {pending ? (
                <div className="mt-2 rounded-md border border-held/40 bg-paper px-3 py-2 text-[12.5px]">
                  <p>
                    {isProposer ? 'You' : `The ${rule.proposer}`} proposed changing it to:
                  </p>
                  <div className="mt-1"><FullAddress value={pending.proposed} /></div>
                  <p className="mt-1 text-graphite">
                    {ready
                      ? `The 48-hour delay ended ${formatDateTime(pending.eta)}, so anyone named in the deal can apply it now.`
                      : `It can be applied from ${formatDateTime(pending.eta)}. Until then the ${rule.rejecter} can reject it.`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isRejecter ? (
                      <button type="button" onClick={() => setDialog({ reject: which })} className="inline-flex min-h-11 items-center rounded-md border border-hold/50 px-3 font-semibold text-hold md:min-h-0 md:py-1.5">Reject the change</button>
                    ) : null}
                    {ready ? (
                      <button type="button" onClick={() => setDialog({ apply: which })} className="inline-flex min-h-11 items-center rounded-md bg-ink px-3 font-semibold text-paper md:min-h-0 md:py-1.5">Apply the change</button>
                    ) : null}
                  </div>
                </div>
              ) : isProposer ? (
                <button type="button" onClick={() => setDialog({ propose: which })} className="mt-1 inline-flex min-h-11 items-center text-[12.5px] underline md:min-h-0">Change address</button>
              ) : null}
            </div>
          )
        })}
      </div>
      {anyPending ? <p className="mt-3 text-[12px] text-graphite">Changes wait 48 hours and are visible to both sides. The other side can reject until then.</p> : null}

      {dialog && 'propose' in dialog ? (
        <Modal open onClose={close} label="Change address">
          <h2 className="text-[19px] font-semibold">{RULES[dialog.propose].title}</h2>
          <label className="label mt-4 block" htmlFor="new-address">New address</label>
          <input id="new-address" className={input} value={next} onChange={(e) => setNext(e.target.value)} placeholder="0x…" spellCheck={false} />
          <p className="mt-1.5 mb-4 text-[12.5px] text-graphite">It takes effect 48 hours after you send this, unless the other side rejects it. Money due before then still goes to the current address.</p>
          {isAddress(next.trim(), { strict: false }) ? (
            <>
              <SignSummary
                rows={[
                  ['Contract', <span key="c" className="mono break-all">Waybill escrow {escrow}</span>],
                  ['Action', dialog.propose === 'payout' ? 'Propose a new payout address' : 'Propose a new refund address'],
                  ['Deal', `Deal ${deal.id.toString()}`],
                  ['From', <span key="f" className="mono break-all">{RULES[dialog.propose].current(deal) ?? 'not set'}</span>],
                  ['To', <span key="t" className="mono break-all">{next.trim()}</span>],
                  ['Cost', 'Only the network fee, paid in USDC. No money moves.'],
                ]}
              />
              <div className="min-h-[7.5rem]">
                <TxFlow
                  confirmLabel="Propose change"
                  steps={[
                    {
                      label: 'Propose the new address',
                      action: encodeCurrentEscrowAction(
                        dialog.propose === 'payout'
                          ? { kind: 'proposePayout', dealId: deal.id, newAddr: next.trim() as `0x${string}` }
                          : { kind: 'proposeRefundAddress', dealId: deal.id, newAddr: next.trim() as `0x${string}` },
                      ),
                    },
                  ]}
                  onCancel={close}
                  onDone={() => done(`Change proposed: ${shortAddress(next.trim())}. It can be applied after 48 hours unless the other side rejects it.`)}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-[12.5px] text-graphite">{next.trim() === '' ? 'Enter a full wallet address to continue.' : 'That is not a full wallet address (0x followed by 40 characters).'}</p>
              <button type="button" onClick={close} className={`${SECONDARY} mt-3 w-full`}>Cancel</button>
            </>
          )}
        </Modal>
      ) : null}

      {dialog && ('reject' in dialog || 'apply' in dialog) ? (
        <Modal open onClose={close} label="Address change">
          {(() => {
            const which = 'reject' in dialog ? dialog.reject : dialog.apply
            const reject = 'reject' in dialog
            const rule = RULES[which]
            const from = rule.current(deal)
            const to = rule.pending(deal)?.proposed ?? null
            const kind = reject ? (which === 'payout' ? 'rejectPayoutChange' : 'rejectRefundChange') : which === 'payout' ? 'applyPayoutChange' : 'applyRefundChange'
            return (
              <>
                <h2 className="text-[19px] font-semibold">{reject ? 'Reject this change?' : 'Apply this change?'}</h2>
                <p className="mt-2 mb-3 text-[13.5px] leading-relaxed">
                  {reject ? 'The waiting address is discarded and the current one stays.' : 'The new address replaces the current one from now on.'}
                </p>
                <SignSummary
                  rows={[
                    ['Contract', <span key="c" className="mono break-all">Waybill escrow {escrow}</span>],
                    ['Action', `${reject ? 'Reject' : 'Apply'} the ${which} address change`],
                    ['Deal', `Deal ${deal.id.toString()}`],
                    ['From', <span key="f" className="mono break-all">{from ?? 'not set'}</span>],
                    ['To', <span key="t" className="mono break-all">{to ?? '—'}</span>],
                    ['Cost', 'Only the network fee, paid in USDC. No money moves.'],
                  ]}
                />
                <div className="min-h-[7.5rem]">
                  <TxFlow
                    confirmLabel={reject ? 'Reject' : 'Apply'}
                    tone={reject ? 'hold' : 'held'}
                    steps={[{ label: reject ? 'Reject the change' : 'Apply the change', action: encodeCurrentEscrowAction({ kind, dealId: deal.id }) }]}
                    onCancel={close}
                    onDone={() => done(reject ? `Change rejected. ${rule.title} stays ${from ? shortAddress(from) : 'as it was'}.` : `Change applied. ${rule.title} is now ${to ? shortAddress(to) : 'the new address'}.`)}
                  />
                </div>
              </>
            )
          })()}
        </Modal>
      ) : null}
    </section>
  )
}
