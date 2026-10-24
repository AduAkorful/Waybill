'use client'

import { DEV_WALLET_AUTH, DEV_WALLET_SESSION_KEY } from '@/integration/dev-wallet-flag'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useDeal } from '@/data/use-deal'
import { getBrowserNetwork } from '@/integration/network'
import { SiteHeader } from '@/ui/SiteHeader'
import { LiveWaybill } from '@/ui/Live'
import { heldFor, refundedFor, releasedFor } from '@/view/derive'
import { formatAmount, formatCents, formatDateTime, formatDateTimeZh, toCents } from '@/view/format'
import type { DealView } from '@/view/types'
import { COPY, type Lang } from './copy'

// The wallet stack (Privy, wagmi) is a separate chunk that loads only when it is needed.
const SupplierWallet = dynamic(() => import('./SupplierWallet'), { ssr: false })

/** A returning supplier already has a Privy session in this browser; their actions need the wallet without another click. */
/** wagmi's persisted store names the connection it will reconnect, under state.current. */
function wagmiHasCurrent(): boolean {
  try {
    const raw = localStorage.getItem('wagmi.store')
    return raw !== null && Boolean((JSON.parse(raw) as { state?: { current?: unknown } }).state?.current)
  } catch {
    return false
  }
}

function hasWalletSession(): boolean {
  try {
    if (localStorage.getItem('privy:token') !== null) return true
    if (!DEV_WALLET_AUTH) return false
    // dev wallet mode: /app counts any wagmi-connected injected wallet as signed in, even one reconnected without our
    // flag (an /app session restored by wagmi), so /d must recognise the same session
    return localStorage.getItem(DEV_WALLET_SESSION_KEY) !== null || localStorage.getItem('wagmi.recentConnectorId') !== null || localStorage.getItem('wagmi.injected.connected') !== null || wagmiHasCurrent()
  } catch {
    return false
  }
}

function useLang(): [Lang, (l: Lang) => void, boolean] {
  const [lang, setLang] = useState<Lang>('en')
  // a browser set to Chinese, with no choice made yet, is offered the Chinese page; it is never switched without asking
  const [suggestZh, setSuggestZh] = useState(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wb-lang')
      if (saved === 'en' || saved === 'zh') setLang(saved)
      else if (navigator.language.toLowerCase().startsWith('zh')) setSuggestZh(true)
    } catch {}
  }, [])
  return [
    lang,
    (l) => {
      setLang(l)
      setSuggestZh(false)
      try {
        localStorage.setItem('wb-lang', l)
      } catch {}
    },
    suggestZh,
  ]
}

/**
 * The supplier's page: the terms render without an account and without any wallet code. The wallet part loads when
 * the supplier signs in, or at once if this browser already holds a session.
 */
export function SupplierLink({ idText, initial }: { idText: string; initial: DealView | null }) {
  const [lang, setLang, suggestZh] = useLang()
  const t = COPY[lang]
  const id = /^\d+$/.test(idText) ? BigInt(idText) : null
  const [refresh, setRefresh] = useState(0)
  const read = useDeal(id, refresh, initial)
  const [walletOn, setWalletOn] = useState(false)
  const [signInAsked, setSignInAsked] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const [viewer, setViewer] = useState<'supplier' | 'buyer' | null>(null)

  useEffect(() => {
    if (hasWalletSession()) setWalletOn(true)
  }, [])

  // the page's language is the document's language, for screen readers and translation tools
  useEffect(() => {
    const el = document.documentElement
    const before = el.lang
    el.lang = lang === 'zh' ? 'zh-CN' : 'en'
    return () => {
      el.lang = before
    }
  }, [lang])

  return (
    <div translate="no" lang={lang === 'zh' ? 'zh-Hans' : 'en'} className="min-h-dvh">
      <SiteHeader
        max="max-w-6xl"
        signIn="signed-in"
        extra={
          <div role="group" aria-label={t.language} className="inline-flex items-center rounded-full border border-rule p-0.5 text-[13px]">
            <span aria-hidden className="hidden px-2 text-graphite sm:inline">文 / A</span>
            {(['en', 'zh'] as const).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`min-h-11 min-w-11 rounded-full px-3 ${lang === l ? 'bg-ink text-paper' : 'text-graphite'}`}>{l === 'en' ? 'EN' : '中文'}</button>
            ))}
          </div>
        }
      />

      {suggestZh && lang === 'en' ? (
        <div role="status" className="mx-auto max-w-6xl px-4 md:px-8">
          <button type="button" onClick={() => setLang('zh')} className="w-full rounded-md border border-held/50 bg-sheet px-4 py-2.5 text-left text-[14px]">
            <span className="font-semibold">查看中文版本</span> · View this page in Chinese
          </button>
        </div>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 pb-20 md:px-8">
        {id === null ? <p role="alert" className="text-hold">{t.notFound}</p> : null}
        {id !== null && read.status === 'loading' ? <p role="status" className="text-graphite">{t.loading}</p> : null}
        {id !== null && read.status === 'error' ? <p role="alert" className="text-hold">{t.notFound}: {read.message}</p> : null}
        {id !== null && read.status === 'ready' ? (() => {
          const d = read.deal
          const expired = d.state === 'proposed' && d.chainTime > d.acceptanceDeadline
          const mustAccept = d.state === 'proposed' && d.supplierPayout === null && !expired
          // a part the buyer disputed waits for the supplier's side; the public view must offer a way in
          const mustRespond = d.tranches.some((p) => p.state === 'disputed' && !p.responseSubmitted && p.disputeRaiser !== null && p.disputeRaiser.toLowerCase() !== d.supplier.toLowerCase())
          return (
            <>
              <p className="label">{t.eyebrow} {String(d.id)}</p>
              <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{d.state === 'proposed' ? t.title : t.titleOngoing}</h1>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-graphite">{d.state === 'proposed' ? t.intro : t.introOngoing}</p>

              <div className={`mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-rule bg-sheet px-4 py-3.5 ${refundedFor(d) > 0n ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                <div className="col-span-2 sm:col-span-1"><p className="label">{t.total}</p><p className="mono text-[22px] whitespace-nowrap sm:text-[26px]">{formatAmount(d.totalAmount)} <span className="text-[14px] text-graphite">USDC</span></p></div>
                <div><p className="label">{viewer === 'supplier' ? t.releasedTile : t.releasedTileNeutral}</p><p className="mono text-[22px] whitespace-nowrap sm:text-[26px] text-released" aria-label={`${formatAmount(releasedFor(d))} USDC`}>{formatCents(toCents(releasedFor(d)))} <span className="text-[14px] text-graphite">USDC</span></p></div>
                <div><p className="label">{t.heldTile}</p><p className="mono text-[22px] whitespace-nowrap sm:text-[26px] text-held" aria-label={`${formatAmount(heldFor(d))} USDC`}>{formatCents(toCents(heldFor(d)))} <span className="text-[14px] text-graphite">USDC</span></p><p className="text-[12px] text-graphite">{t.inclFees}</p></div>
                {refundedFor(d) > 0n ? (
                  <div data-refunded-tile><p className="label">{t.refundedTile}</p><p className="mono text-[22px] whitespace-nowrap sm:text-[26px] text-refunded" aria-label={`${formatAmount(refundedFor(d))} USDC`}>{formatCents(toCents(refundedFor(d)))} <span className="text-[14px] text-graphite">USDC</span></p></div>
                ) : null}
              </div>
              {releasedFor(d) % 10_000n !== 0n || heldFor(d) % 10_000n !== 0n || d.totalAmount % 10_000n !== 0n ? (
                <p data-exact className="mt-1.5 text-[12px] text-graphite">{t.exact(formatAmount(releasedFor(d)), formatAmount(heldFor(d)))}</p>
              ) : null}

              <div className="mt-6">
                {d.state === 'funded' ? <Banner tone="released" title={t.funded} body={t.fundedBody} /> : null}
                {d.state === 'settled' ? <Banner tone="released" title={t.settled} /> : null}
                {d.state === 'cancelled' ? <Banner tone="rule" title={t.cancelled} /> : null}
                {expired ? <Banner tone="hold" title={t.expired} /> : null}
                {d.state === 'accepted' || (d.state === 'proposed' && d.supplierPayout !== null) ? <Banner tone="rule" title={t.acceptedWaiting} /> : null}
              </div>

              {walletOn ? (
                <SupplierWallet deal={d} lang={lang} autoLogin={signInAsked} onMounted={() => setWalletReady(true)} onChanged={() => setRefresh((n) => n + 1)} onViewer={setViewer} />
              ) : null}
              {!walletReady ? (
                <>
                  {mustAccept || mustRespond ? (
                    <div className="mt-6">
                      {walletOn ? (
                        <p role="status" className="text-[13px] text-graphite">{t.loading}</p>
                      ) : (
                        <>
                          <button type="button" onClick={() => { setSignInAsked(true); setWalletOn(true) }} className="rounded-md bg-ink px-5 py-3 text-[15px] font-semibold text-paper">{mustAccept ? t.signIn : t.signInRespond}</button>
                          <p className="mt-2 text-[12.5px] text-graphite">{mustAccept ? t.signInHelp : t.signInRespondHelp}</p>
                        </>
                      )}
                    </div>
                  ) : !walletOn && (d.state === 'funded' || d.state === 'accepted' || d.state === 'proposed') ? (
                    <div className="mt-6">
                      <button type="button" onClick={() => { setSignInAsked(true); setWalletOn(true) }} className="inline-flex min-h-11 items-center rounded-md border border-rule px-4 text-[14px] font-semibold hover:bg-sheet">{t.signInParty}</button>
                      <p className="mt-2 text-[12.5px] text-graphite">{t.signInPartyHelp}</p>
                    </div>
                  ) : walletOn ? (
                    <p role="status" className="mt-6 text-[13px] text-graphite">{t.loading}</p>
                  ) : null}
                  <section className="mt-10" aria-label={t.tracker}>
                    <h2 className="label mb-3">{t.tracker}</h2>
                    <LiveWaybill deal={d} lang={lang} detail="summary" compact showLockStamp={false} />
                  </section>
                </>
              ) : null}
              <p className="mt-8 text-[12px] text-graphite">{lang === "zh" ? formatDateTimeZh(d.chainTime) : formatDateTime(d.chainTime)} · {getBrowserNetwork().network === 'mainnet' ? 'Arc' : 'Arc testnet'}</p>
            </>
          )
        })() : null}
      </main>
      <footer className="mx-auto max-w-6xl border-t border-rule px-4 py-6 text-[12px] text-graphite md:px-8">
        <p>{t.footer}</p>
        <p className="mt-1"><Link href="/legal" className="inline-flex min-h-11 items-center underline">{t.legal}</Link></p>
      </footer>
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

