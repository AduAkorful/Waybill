'use client'

import { overdueStatus } from '@/view/derive'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { isAddress } from 'viem'
import { usePrivy } from '@/auth'
import { useSignOut } from '@/components/use-sign-out'
import { useAccount } from 'wagmi'
import { encodeEscrowAction } from '@/integration/escrow'
import { earlyResolve } from '@/integration/network'
import { AddressChanges } from '@/ui/AddressChanges'
import { DisputeDialog } from '@/ui/DisputeDialog'
import { LiveWaybill } from '@/ui/Live'
import { PrivateTerms } from '@/ui/PrivateTerms'
import { useReloadOnAccountChange } from '@/components/use-account-sync'
import { NamedPartyBanner } from '@/ui/NamedPartyBanner'
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
export default function SupplierWallet(props: { deal: DealView; lang: Lang; autoLogin: boolean; onMounted: () => void; onChanged: () => void; onViewer?: (who: 'supplier' | 'buyer' | null) => void }) {
  return (
    <Providers>
      <Inner {...props} />
    </Providers>
  )
}

function Inner({ deal: d, lang, autoLogin, onMounted, onChanged, onViewer }: { deal: DealView; lang: Lang; autoLogin: boolean; onMounted: () => void; onChanged: () => void; onViewer?: (who: 'supplier' | 'buyer' | null) => void }) {
  const t = COPY[lang]
  const { ready, authenticated, login } = usePrivy()
  const { signOut, signingOut } = useSignOut(null)
  const { address } = useAccount()
  useReloadOnAccountChange(address)
  const [payout, setPayout] = useState('')
  const [dialog, setDialog] = useState<'accept' | { respond: Tranche } | { dispute: Tranche } | null>(null)
  const asked = useRef(false)
  // the payout field starts with the signed-in wallet, so it is plain where money goes; it can be replaced
  const prefilled = useRef(false)
  useEffect(() => {
    if (address && !prefilled.current) {
      prefilled.current = true
      setPayout((cur) => (cur.trim() === '' ? address : cur))
    }
  }, [address])
  const wasReady = useRef(false)

  // once the chain shows the supplier accepted, the accept dialog must go: a still-open dialog invites a second send
  const accepted = d.supplierPayout !== null || d.state !== 'proposed'
  useEffect(() => {
    if (accepted) setDialog((cur) => (cur === 'accept' ? null : cur))
  }, [accepted])

  useEffect(() => {
    if (ready) onMounted()
  }, [ready, onMounted])

  useEffect(() => {
    if (ready && !authenticated && autoLogin && !asked.current) {
      asked.current = true
      login({ loginMethods: ['email', 'wallet'] })
    }
  }, [ready, authenticated, autoLogin, login])

  // once shown, the wallet area stays: sign-in state can flicker while a real wallet sends, and returning null here
  // threw away an open Accept dialog in the middle of its transaction
  const isSupplier = !!address && address.toLowerCase() === d.supplier.toLowerCase()
  const isBuyer = !!address && !isSupplier && address.toLowerCase() === d.buyer.toLowerCase()
  // the public tiles say "paid to you" only to the signed-in supplier. Every hook runs before the early return below:
  // a hook after it changed the hook count when sign-in became ready and crashed the page (React #310)
  const viewer = authenticated && isSupplier ? 'supplier' : authenticated && isBuyer ? 'buyer' : null
  // a fresh mount starts signed out for a moment; reporting that would flip the tiles back and forth, so null is only
  // reported after this mount saw a signed-in party (a real sign-out)
  const reported = useRef(false)
  useEffect(() => {
    if (viewer === null && !reported.current) return
    reported.current = viewer !== null
    onViewer?.(viewer)
  }, [viewer, onViewer])

  if (!ready && !wasReady.current) return null
  if (ready) wasReady.current = true
  const expired = d.state === 'proposed' && d.chainTime > d.acceptanceDeadline
  const lower = address?.toLowerCase()
  // a named attestor or arbiter is not in the wrong place; their banner above says what to do
  const isNamedHere =
    lower !== undefined &&
    (d.arbiter.toLowerCase() === lower ||
      (d.panel?.members ?? []).some((m) => m.toLowerCase() === lower) ||
      d.tranches.some((p) => p.attestors.some((a) => a.toLowerCase() === lower)))
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
              <p className="mt-1 text-graphite">{earlyResolve() ? t.responded : t.respondedWait}</p>
            ) : (
              <button onClick={() => setDialog({ respond: p })} className="mt-2.5 rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-semibold">{t.respond}</button>
            )}
            <Link href={`/app/room/${d.id}`} className="mt-2.5 ml-2 inline-block rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-semibold">{t.room}</Link>
          </div>
        )
      } else if (d.state === 'funded' && overdueStatus(p, d.chainTime) === 'overdue') {
        actions[p.index] = (
          <div data-action className="text-[13px]">
            <p className="font-semibold">{t.overdueNote}</p>
            <button onClick={() => setDialog({ dispute: p })} className="mt-2.5 rounded-md border border-hold/50 px-3 py-1.5 text-[12.5px] font-semibold text-hold">{t.disputeOverdue}</button>
          </div>
        )
      }
    }
  }

  return (
    <>
      {authenticated && address && !isSupplier ? <NamedPartyBanner deal={d} wallet={address} /> : null}
      {authenticated && isBuyer ? (
        <div role="status" data-buyer-view className="mt-6 rounded-md border border-held/50 bg-sheet px-4 py-3">
          <p className="font-semibold">{lang === 'zh' ? '您是这笔交易的买方' : 'You are the buyer on this deal'}</p>
          <p className="mt-1 text-[13px]">{lang === 'zh' ? '此页面是发给供应商用于接受交易的链接。请在您的交易页面管理和注资。' : 'This page is the link you send the supplier so they can accept. You fund and manage the deal from your own deal page.'}</p>
          <Link href={`/app/deals/${d.id}`} className="mt-2 inline-block rounded-md bg-ink px-3.5 py-2 text-[13.5px] font-semibold text-paper">{lang === 'zh' ? '打开我的交易' : 'Open my deal'}</Link>
        </div>
      ) : null}
      {authenticated && address && !isSupplier && !isBuyer && !isNamedHere ? (
        <div role="alert" className="mt-6 rounded-md border border-hold/50 bg-hold-wash px-4 py-3">
          <p className="font-semibold">{t.wrongWallet}</p>
          <p className="mt-1 text-[13px]">{t.wrongWalletBody(shortAddress(d.supplier), shortAddress(address))}</p>
          <button type="button" onClick={() => void signOut()} disabled={signingOut} className="mt-2 text-[13px] underline">{signingOut ? '…' : t.signOut}</button>
        </div>
      ) : null}
      <div className="mt-6" data-wallet-session={authenticated ? (isSupplier ? "supplier" : isBuyer ? "buyer" : "other") : "none"}>
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

    {isSupplier ? <AddressChanges deal={d} viewer="supplier" onChanged={() => onChanged()} /> : null}
    <section className="mt-10" aria-label={t.tracker}>
      <h2 className="label mb-3">{t.tracker}</h2>
      <LiveWaybill deal={d} lang={lang} detail="summary" compact showLockStamp={false} actions={actions} />
    </section>
    {isSupplier && address ? <PrivateTerms deal={d} wallet={address} /> : null}

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
