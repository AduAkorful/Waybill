'use client'

import { useState } from 'react'
import { isAddress } from 'viem'
import { encodeCurrentEscrowAction } from '@/integration/current-actions'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { formatDateTime, shortAddress } from '@/view/format'
import type { DealView, PendingChange } from '@/view/types'

type Which = 'payout' | 'refund'
type Who = 'buyer' | 'supplier'
type Dialog = { propose: Which } | { reject: Which } | { apply: Which } | null

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] mono outline-none focus:border-held'

const RULES: Record<Which, { title: string; proposer: Who; rejecter: Who; current: (d: DealView) => string | null; pending: (d: DealView) => PendingChange | null }> = {
  payout: { title: 'Where the supplier is paid', proposer: 'supplier', rejecter: 'buyer', current: (d) => d.supplierPayout, pending: (d) => d.pendingPayout },
  refund: { title: 'Where refunds go', proposer: 'buyer', rejecter: 'supplier', current: (d) => d.buyerRefund, pending: (d) => d.pendingRefund },
}

/**
 * Payout and refund addresses can change only through a 48-hour public delay: the person who is paid proposes, the
 * other side can reject while it waits, and anyone can apply it once the delay is over. Shows the part that applies to `viewer`.
 */
export function AddressChanges({ deal, viewer, onChanged }: { deal: DealView; viewer: Who; onChanged: () => void }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [next, setNext] = useState('')
  if (deal.state !== 'funded') return null
  const close = () => setDialog(null)
  const done = () => {
    setDialog(null)
    setNext('')
    onChanged()
  }

  return (
    <section aria-label="Addresses" className="mt-8 rounded-md border border-rule bg-sheet p-4">
      <p className="label">Addresses</p>
      {(['payout', 'refund'] as const).map((which) => {
        const rule = RULES[which]
        const current = rule.current(deal)
        const pending = rule.pending(deal)
        const isProposer = viewer === rule.proposer
        const isRejecter = viewer === rule.rejecter
        const ready = pending !== null && deal.chainTime >= pending.eta
        return (
          <div key={which} className="mt-3 border-t border-rule pt-3 first:mt-2 first:border-0 first:pt-0">
            <p className="text-[13px] font-semibold">{rule.title}</p>
            <p className="mono text-[12.5px] text-graphite">{current ? shortAddress(current) : 'not set'}</p>
            {pending ? (
              <div className="mt-2 rounded-md border border-held/40 bg-paper px-3 py-2 text-[12.5px]">
                <p>
                  Change to <span className="mono font-semibold">{shortAddress(pending.proposed)}</span> is waiting.{' '}
                  {ready ? 'The delay is over, so it can be applied.' : `It can be applied after ${formatDateTime(pending.eta)} UTC.`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {isRejecter ? (
                    <button type="button" onClick={() => setDialog({ reject: which })} className="rounded-md border border-hold/50 px-3 py-1.5 font-semibold text-hold">Reject the change</button>
                  ) : null}
                  {ready ? (
                    <button type="button" onClick={() => setDialog({ apply: which })} className="rounded-md bg-ink px-3 py-1.5 font-semibold text-paper">Apply the change</button>
                  ) : null}
                </div>
              </div>
            ) : isProposer ? (
              <button type="button" onClick={() => setDialog({ propose: which })} className="mt-1.5 text-[12.5px] underline">Change address</button>
            ) : null}
          </div>
        )
      })}
      <p className="mt-3 text-[11.5px] text-graphite">Changes wait 48 hours and are visible to both sides. The other side can reject until then.</p>

      {dialog && 'propose' in dialog ? (
        <Modal open onClose={close} label="Change address">
          <h2 className="text-[19px] font-semibold">{RULES[dialog.propose].title}</h2>
          <label className="label mt-4 block" htmlFor="new-address">New address</label>
          <input id="new-address" className={input} value={next} onChange={(e) => setNext(e.target.value)} placeholder="0x…" spellCheck={false} />
          <p className="mt-1.5 mb-4 text-[12.5px] text-graphite">It takes effect 48 hours after you send this, unless the other side rejects it. Money due before then still goes to the current address.</p>
          {isAddress(next.trim(), { strict: false }) ? (
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
              onDone={done}
            />
          ) : (
            <p className="text-[12.5px] text-graphite">Enter a full wallet address to continue.</p>
          )}
        </Modal>
      ) : null}

      {dialog && ('reject' in dialog || 'apply' in dialog) ? (
        <Modal open onClose={close} label="Address change">
          {(() => {
            const which = 'reject' in dialog ? dialog.reject : dialog.apply
            const reject = 'reject' in dialog
            const kind = reject ? (which === 'payout' ? 'rejectPayoutChange' : 'rejectRefundChange') : which === 'payout' ? 'applyPayoutChange' : 'applyRefundChange'
            return (
              <>
                <h2 className="text-[19px] font-semibold">{reject ? 'Reject this change?' : 'Apply this change?'}</h2>
                <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
                  {reject ? 'The waiting address is discarded and the current one stays.' : 'The new address replaces the current one from now on.'}
                </p>
                <TxFlow
                  confirmLabel={reject ? 'Reject' : 'Apply'}
                  tone={reject ? 'hold' : 'held'}
                  steps={[{ label: reject ? 'Reject the change' : 'Apply the change', action: encodeCurrentEscrowAction({ kind, dealId: deal.id }) }]}
                  onCancel={close}
                  onDone={done}
                />
              </>
            )
          })()}
        </Modal>
      ) : null}
    </section>
  )
}
