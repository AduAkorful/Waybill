'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { isAddress } from 'viem'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
import { encodeEscrowAction } from '@/integration/escrow'
import { AddressChanges } from '@/ui/AddressChanges'
import { DisputeDialog } from '@/ui/DisputeDialog'
import { LiveWaybill } from '@/ui/Live'
import { PrivateTerms } from '@/ui/PrivateTerms'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { formatAmount, shortAddress } from '@/view/format'
import type { DealView, Tranche } from '@/view/types'
import { Providers } from '@/app/(app)/providers'
import { COPY, type Lang } from './copy'

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] focus:border-held'

/**
 * Everything on the supplier page that needs a wallet: sign-in, accepting, the per-part actions and the address
 * changes. It is loaded only when the supplier signs in or already has a session, so a first look at the terms
 * never downloads the wallet stack.
 */
export default function SupplierWallet(props: { deal: DealView; lang: Lang; autoLogin: boolean; onMounted: () => void; onChanged: () => void }) {
  return (
    <Providers>
      <Inner {...props} />
    </Providers>
  )
}

function Inner({ deal: d, lang, autoLogin, onMounted, onChanged }: { deal: DealView; lang: Lang; autoLogin: boolean; onMounted: () => void; onChanged: () => void }) {
  const t = COPY[lang]
  const { ready, authenticated, login, logout } = usePrivy()
  const { address } = useAccount()
  const [payout, setPayout] = useState('')
  const [dialog, setDialog] = useState<'accept' | { respond: Tranche } | { dispute: Tranche } | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    if (ready) onMounted()
  }, [ready, onMounted])

  useEffect(() => {
    if (ready && !authenticated && autoLogin && !asked.current) {
      asked.current = true
      login({ loginMethods: ['email', 'wallet'] })
    }
  }, [ready, authenticated, autoLogin, login])

  if (!ready) return null

  const isSupplier = !!address && address.toLowerCase() === d.supplier.toLowerCase()
  const expired = d.state === 'proposed' && d.chainTime > d.acceptanceDeadline
  const mustAccept = d.state === 'proposed' && d.supplierPayout === null && !expired
  const actions: Record<number, React.ReactNode> = {}
  if (isSupplier) {
    for (const p of d.tranches) {
      if (p.state === 'disputed') {
        const mine = p.disputeRaiser !== null && p.disputeRaiser.toLowerCase() === address!.toLowerCase()
        actions[p.index] = (
          <div data-action className="text-[13px]">
            <p className="font-semibold text-hold">{mine ? t.youDisputed : t.disputedNote}</p>
            {mine ? null : p.responseSubmitted ? (
              <p className="mt-1 text-graphite">{t.responded}</p>
            ) : (
              <button onClick={() => setDialog({ respond: p })} className="mt-2.5 rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-semibold">{t.respond}</button>
            )}
            <Link href={`/app/room/${d.id}`} className="mt-2.5 ml-2 inline-block rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-semibold">{t.room}</Link>
          </div>
        )
      } else if (p.state === 'overdue' && d.chainTime <= p.deadline + BigInt(p.gracePeriod)) {
        actions[p.index] = (
          <div data-action className="text-[13px]">
            <p className="font-semibold">{t.overdueNote}</p>
            <button onClick={() => setDialog({ dispute: p })} className="mt-2.5 rounded-md border border-hold/50 px-3 py-1.5 text-[12.5px] font-semibold text-hold">{t.dispute}</button>
          </div>
        )
      }
    }
  }

  return (
    <>
      {authenticated && address && !isSupplier ? (
        <div role="alert" className="mt-6 rounded-md border border-hold/50 bg-hold-wash px-4 py-3">
          <p className="font-semibold">{t.wrongWallet}</p>
          <p className="mt-1 text-[13px]">{t.wrongWalletBody(shortAddress(d.supplier), shortAddress(address))}</p>
          <button type="button" onClick={() => void logout()} className="mt-2 text-[13px] underline">{t.signOut}</button>
        </div>
      ) : null}
      <div className="mt-6">
    {mustAccept ? (
      !ready ? null : !authenticated ? (
        <div>
          <button type="button" onClick={() => login({ loginMethods: ['email', 'wallet'] })} className="rounded-md bg-ink px-5 py-3 text-[15px] font-semibold text-paper">{t.signIn}</button>
          <p className="mt-2 text-[12.5px] text-graphite">{t.signInHelp}</p>
        </div>
      ) : !address ? (
        <p role="status" className="text-[13px] text-graphite">…</p>
      ) : !isSupplier ? null : (
        <div>
          <label className="label block" htmlFor="payout">{t.payout}</label>
          <input id="payout" className={`${input} mono`} value={payout} onChange={(e) => setPayout(e.target.value)} placeholder={address} spellCheck={false} />
          <p className="mt-1 text-[12px] text-graphite">{t.payoutHelp}</p>
          <button type="button" onClick={() => setDialog('accept')} disabled={payout.trim() !== '' && !isAddress(payout.trim(), { strict: false })} className="mt-4 rounded-md bg-held px-5 py-2.5 text-[14px] font-semibold text-sheet disabled:opacity-40">{t.accept}</button>
        </div>
      )
    ) : null}
      </div>

    <section className="mt-10" aria-label={t.tracker}>
      <h2 className="label mb-3">{t.tracker}</h2>
      <LiveWaybill deal={d} lang={lang} detail="summary" compact showLockStamp={false} actions={actions} />
    </section>
    {isSupplier && address ? <PrivateTerms deal={d} wallet={address} /> : null}
    {isSupplier ? <AddressChanges deal={d} viewer="supplier" onChanged={() => onChanged()} /> : null}

    <Modal open={dialog === 'accept'} onClose={() => setDialog(null)} label={t.accept}>
      {dialog === 'accept' && address ? (
        <AcceptDialog deal={d} payoutText={payout.trim() === '' ? address : payout.trim()} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} />
      ) : null}
    </Modal>
    {dialog && typeof dialog === 'object' && address ? (
      <Modal open onClose={() => setDialog(null)} label={'respond' in dialog ? t.respond : t.dispute}>
        <DisputeDialog deal={d} part={'respond' in dialog ? dialog.respond : dialog.dispute} owner={address} mode={'respond' in dialog ? 'respond' : 'dispute'} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); onChanged() }} />
      </Modal>
    ) : null}
    </>
  )
}

function AcceptDialog({ deal, payoutText, onCancel, onDone }: { deal: DealView; payoutText: string; onCancel: () => void; onDone: () => void }) {
  return (
    <>
      <p className="label">Deal {String(deal.id)}</p>
      <h2 className="mt-1 text-[19px] font-semibold">Accept this deal</h2>
      <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
        You will be paid {formatAmount(deal.totalAmount)} USDC in {deal.tranches.length} {deal.tranches.length === 1 ? 'payment' : 'payments'} to <span className="mono">{shortAddress(payoutText)}</span>, as each is confirmed. Nothing moves until the buyer funds the deal.
      </p>
      <TxFlow
        confirmLabel="Accept"
        steps={[{ label: 'Accept the deal', action: encodeEscrowAction({ kind: 'acceptSupplier', dealId: deal.id, payoutAddress: payoutText as `0x${string}` }) }]}
        onCancel={onCancel}
        onDone={() => onDone()}
      />
    </>
  )
}
