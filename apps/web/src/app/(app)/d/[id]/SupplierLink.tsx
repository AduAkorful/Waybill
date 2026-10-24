'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { isAddress } from 'viem'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
import { useDeal } from '@/data/use-deal'
import { encodeEscrowAction } from '@/integration/escrow'
import { getBrowserNetwork } from '@/integration/network'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'
import { AddressChanges } from '@/ui/AddressChanges'
import { DisputeDialog } from '@/ui/DisputeDialog'
import { LiveWaybill } from '@/ui/Live'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { formatAmount, formatDateTime, shortAddress } from '@/view/format'
import type { DealView, Tranche } from '@/view/types'
import { COPY, type Lang } from './copy'

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] outline-none focus:border-held'

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>('en')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wb-lang')
      if (saved === 'en' || saved === 'zh') setLang(saved)
    } catch {}
  }, [])
  return [
    lang,
    (l) => {
      setLang(l)
      try {
        localStorage.setItem('wb-lang', l)
      } catch {}
    },
  ]
}

/** The supplier's page: opens without an account, shows the terms, and accepts with the wallet the buyer named. */
export function SupplierLink({ idText }: { idText: string }) {
  const [lang, setLang] = useLang()
  const t = COPY[lang]
  const id = /^\d+$/.test(idText) ? BigInt(idText) : null
  const [refresh, setRefresh] = useState(0)
  const read = useDeal(id, refresh)
  const { ready, authenticated, login, logout } = usePrivy()
  const { address } = useAccount()
  const [payout, setPayout] = useState('')
  const [dialog, setDialog] = useState<'accept' | { respond: Tranche } | { dispute: Tranche } | null>(null)

  return (
    <div translate="no" className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 md:px-8">
        <Link href="/" aria-label="Waybill home"><Wordmark /></Link>
        <div className="flex items-center gap-2">
          <div role="group" aria-label={t.language} className="inline-flex rounded-full border border-rule p-0.5 text-[12px]">
            {(['en', 'zh'] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`rounded-full px-2.5 py-1 ${lang === l ? 'bg-ink text-paper' : 'text-graphite'}`}>{l === 'en' ? 'English' : '中文'}</button>
            ))}
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20 md:px-8">
        {id === null ? <p role="alert" className="text-hold">{t.notFound}</p> : null}
        {id !== null && read.status === 'loading' ? <p role="status" className="text-graphite">{t.loading}</p> : null}
        {id !== null && read.status === 'error' ? <p role="alert" className="text-hold">{t.notFound}: {read.message}</p> : null}
        {id !== null && read.status === 'ready' ? (() => {
          const d = read.deal
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
              <p className="label">{t.eyebrow} {String(d.id)}</p>
              <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{t.title}</h1>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-graphite">{t.intro}</p>

              <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-md border border-rule bg-sheet px-4 py-3.5">
                <div><p className="label">{t.total}</p><p className="mono text-[26px]">{formatAmount(d.totalAmount)} <span className="text-[14px] text-graphite">USDC</span></p></div>
                <div><p className="label">{t.parts}</p><p className="mono text-[26px]">{d.tranches.length}</p></div>
              </div>

              <div className="mt-6">
                {d.state === 'funded' ? <Banner tone="released" title={t.funded} body={t.fundedBody} /> : null}
                {d.state === 'settled' ? <Banner tone="released" title={t.settled} /> : null}
                {d.state === 'cancelled' ? <Banner tone="rule" title={t.cancelled} /> : null}
                {expired ? <Banner tone="hold" title={t.expired} /> : null}
                {d.state === 'accepted' || (d.state === 'proposed' && d.supplierPayout !== null) ? <Banner tone="rule" title={t.acceptedWaiting} /> : null}

                {mustAccept ? (
                  !ready ? null : !authenticated ? (
                    <div>
                      <button type="button" onClick={() => login({ loginMethods: ['email', 'wallet'] })} className="rounded-md bg-ink px-5 py-3 text-[15px] font-semibold text-paper">{t.signIn}</button>
                      <p className="mt-2 text-[12.5px] text-graphite">{t.signInHelp}</p>
                    </div>
                  ) : !address ? (
                    <p role="status" className="text-[13px] text-graphite">…</p>
                  ) : !isSupplier ? (
                    <div role="alert" className="rounded-md border border-hold/50 bg-hold-wash px-4 py-3">
                      <p className="font-semibold">{t.wrongWallet}</p>
                      <p className="mt-1 text-[13px]">{t.wrongWalletBody(shortAddress(d.supplier), shortAddress(address))}</p>
                      <button type="button" onClick={() => void logout()} className="mt-2 text-[13px] underline">{t.signOut}</button>
                    </div>
                  ) : (
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
              {isSupplier ? <AddressChanges deal={d} viewer="supplier" onChanged={() => setRefresh((n) => n + 1)} /> : null}
              <p className="mt-8 text-[12px] text-graphite">{formatDateTime(d.chainTime)} UTC · {getBrowserNetwork().network}</p>

              <Modal open={dialog === 'accept'} onClose={() => setDialog(null)} label={t.accept}>
                {dialog === 'accept' && address ? (
                  <AcceptDialog deal={d} payoutText={payout.trim() === '' ? address : payout.trim()} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); setRefresh((n) => n + 1) }} />
                ) : null}
              </Modal>
              {dialog && typeof dialog === 'object' && address ? (
                <Modal open onClose={() => setDialog(null)} label={'respond' in dialog ? t.respond : t.dispute}>
                  <DisputeDialog deal={d} part={'respond' in dialog ? dialog.respond : dialog.dispute} owner={address} mode={'respond' in dialog ? 'respond' : 'dispute'} onCancel={() => setDialog(null)} onDone={() => { setDialog(null); setRefresh((n) => n + 1) }} />
                </Modal>
              ) : null}
            </>
          )
        })() : null}
      </main>
    </div>
  )
}

function Banner({ tone, title, body }: { tone: 'released' | 'hold' | 'rule'; title: string; body?: string }) {
  const cls = tone === 'released' ? 'border-released/40 bg-released-wash' : tone === 'hold' ? 'border-hold/50 bg-hold-wash' : 'border-rule bg-sheet'
  return (
    <div role="status" className={`rounded-md border px-4 py-3 ${cls}`}>
      <p className="text-[14.5px] font-semibold">{title}</p>
      {body ? <p className="mt-1 text-[13px] leading-relaxed">{body}</p> : null}
    </div>
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
