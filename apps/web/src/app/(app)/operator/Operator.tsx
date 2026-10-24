'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { encodeOperatorAction } from '@/integration/operator-actions'
import { getBrowserNetwork } from '@/integration/network'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { formatAmount, formatDateTime, shortAddress, shortHash } from '@/view/format'
import { describeChange, gasToUsdcUnits, lagOf, parseOperatorSummary, type OperatorSummary } from '@/view/operator'

const REFRESH_MS = 30_000

type Read = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; summary: OperatorSummary; health: { ready: boolean; components: { name: string; ok: boolean; detail?: string }[] } | null }

/**
 * Read-only monitor of the whole deployment, and the one control the pauser has: stop or resume creating and funding
 * new deals. Nothing on this page can move, freeze or redirect money already in escrow.
 */
export function Operator() {
  const [read, setRead] = useState<Read>({ kind: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const network = useMemo(() => getBrowserNetwork(), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const base = loadBrowserApiBaseUrl()
        const summary = parseOperatorSummary(await createWaybillApiClient(base, fetch, network).getOperatorSummary())
        let health: Extract<Read, { kind: 'ready' }>['health'] = null
        try {
          const response = await fetch(`${base}/health`)
          health = await response.json()
        } catch {
          health = null
        }
        if (!cancelled) setRead({ kind: 'ready', summary, health })
      } catch (e) {
        if (!cancelled) setRead((prev) => (prev.kind === 'ready' ? prev : { kind: 'error', message: e instanceof Error ? e.message : String(e) }))
      }
    }
    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [network, refresh])

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-rule px-4 py-2.5 md:px-6">
        <div className="flex items-baseline gap-3">
          <Link href="/" aria-label="Waybill home"><Wordmark /></Link>
          <span className="label">Operator</span>
        </div>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-20 md:px-8 md:pt-10">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Operator console</h1>
        <p className="mt-1 max-w-2xl text-[13.5px] text-graphite">Read-only. Nobody at Waybill can move, freeze or redirect money in escrow, and nothing here can. The only control is the pause on new deals.</p>
        {read.kind === 'loading' ? <p role="status" className="mt-8 text-[14px] text-graphite">Reading the deployment…</p> : null}
        {read.kind === 'error' ? <p role="alert" className="mt-8 text-[14px] text-hold">The monitor could not be loaded, so no figures are shown: {read.message}</p> : null}
        {read.kind === 'ready' ? <Monitor summary={read.summary} health={read.health} onChanged={() => setRefresh((n) => n + 1)} /> : null}
      </main>
    </div>
  )
}

function Monitor({ summary: s, health, onChanged }: { summary: OperatorSummary; health: Extract<Read, { kind: 'ready' }>['health']; onChanged: () => void }) {
  const explorer = getBrowserNetwork().explorerUrl.replace(/\/+$/, '')
  const pct = s.chain.maxLocked === 0n ? 0 : Number((s.chain.currentLocked * 10_000n) / s.chain.maxLocked) / 100
  const states = Object.entries(s.index.dealsByState).sort(([a], [b]) => a.localeCompare(b))
  const indexed = states.reduce((n, [, v]) => n + v, 0)

  return (
    <>
      <PauseCard summary={s} onChanged={onChanged} />

      <section className="mt-8" aria-label="Money in escrow">
        <h2 className="label mb-2">Money in escrow now · {s.network} · chain {s.chainId}</h2>
        <div className="rounded-md border border-rule bg-sheet p-4">
          <p className="mono text-[26px]">{formatAmount(s.chain.currentLocked)} <span className="text-[14px] text-graphite">of {formatAmount(s.chain.maxLocked)} USDC early-access cap</span></p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-rule" role="img" aria-label={`${pct.toFixed(2)} percent of the cap in use`}>
            <div className="h-full bg-held" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-graphite">Largest single deal allowed: {formatAmount(s.chain.maxDealAmount)} USDC. Read from the escrow just now.</p>
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-3" aria-label="Deals">
        <Tile label="Deals created, all time" value={String(s.chain.totalDeals)} note="From the escrow" />
        <Tile label="Deals the index has seen" value={String(indexed)} note={states.map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · ') || 'none yet'} />
        <Tile label="Open disputes" value={String(s.index.openDisputes)} note="Parts disputed and not yet decided, from the index" />
      </section>

      <section className="mt-8" aria-label="Volume">
        <h2 className="label mb-2">Volume by label</h2>
        <div className="overflow-x-auto rounded-md border border-rule">
          <table className="w-full min-w-[34rem] text-left text-[13px]">
            <thead className="bg-sheet text-graphite">
              <tr><th className="px-3 py-2 font-medium">Label</th><th className="px-3 py-2 font-medium">Deals created</th><th className="px-3 py-2 font-medium">Created USDC</th><th className="px-3 py-2 font-medium">Deals funded</th><th className="px-3 py-2 font-medium">Funded USDC</th></tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {s.index.volume.length === 0 ? <tr><td className="px-3 py-3 text-graphite" colSpan={5}>No deals indexed yet.</td></tr> : null}
              {s.index.volume.map((v) => (
                <tr key={`${v.label}-${v.isTest}`}>
                  <td className="px-3 py-2">{v.label ?? 'No label set'}{v.isTest ? <span className="ml-1.5 rounded border border-dashed border-graphite/60 px-1 text-[10px] text-graphite">TEST</span> : null}</td>
                  <td className="mono px-3 py-2">{v.created.deals}</td>
                  <td className="mono px-3 py-2">{formatAmount(v.created.amount)}</td>
                  <td className="mono px-3 py-2">{v.funded.deals}</td>
                  <td className="mono px-3 py-2">{formatAmount(v.funded.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-graphite">Only the deals the index has recorded are counted. Team and test deals show here only once they carry a label; this console does not set labels, so unlabelled volume must not be presented as third-party volume.</p>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2" aria-label="Health">
        <div>
          <h2 className="label mb-2">Health</h2>
          <ul className="divide-y divide-rule rounded-md border border-rule bg-paper text-[13px]">
            {health === null ? <li className="px-3 py-2.5 text-hold">The health check could not be read.</li> : null}
            {health?.components.map((c) => (
              <li key={c.name} className="flex justify-between px-3 py-2.5">
                <span>{c.name}</span>
                <span className={c.ok ? 'text-released' : 'text-hold'}>{c.ok ? 'ok' : 'failing'}{c.detail ? ` · ${c.detail}` : ''}</span>
              </li>
            ))}
            {s.index.cursors.map((c) => {
              const lag = lagOf(s.chain.head, c.block)
              return (
                <li key={c.stream} className="flex justify-between px-3 py-2.5">
                  <span>{c.stream}</span>
                  <span className={`mono ${lag > 100n ? 'text-hold' : ''}`}>block {String(c.block)} · {String(lag)} behind</span>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[12px] text-graphite">Chain head {String(s.chain.head)}. A stream far behind the head means the figures above lag the chain.</p>
        </div>
        <div>
          <h2 className="label mb-2">Relayer</h2>
          <div className="rounded-md border border-rule bg-sheet p-4 text-[13px]">
            <p className="mono break-all">{s.chain.relayer.address}</p>
            <p className="mt-2">Gas balance: <span className="mono">{formatAmount(gasToUsdcUnits(s.chain.relayer.gasBalance))} USDC</span></p>
            <p className="mt-1 text-[12px] text-graphite">It pays gas for claims and refunds only and holds no deal money. Pauser <span className="mono">{shortAddress(s.chain.pauser)}</span> · treasury <span className="mono">{shortAddress(s.chain.treasury)}</span></p>
          </div>
        </div>
      </section>

      <section className="mt-8" aria-label="Change log">
        <h2 className="label mb-2">Changes to the escrow&apos;s settings</h2>
        {s.index.adminLog.length === 0 ? <p className="text-[13px] text-graphite">None in the indexed range.</p> : (
          <ol className="divide-y divide-rule rounded-md border border-rule bg-paper text-[13px]">
            {s.index.adminLog.map((e) => (
              <li key={`${e.block}-${e.txHash}-${e.name}`} className="flex flex-wrap justify-between gap-2 px-3 py-2.5">
                <span>{describeChange(e.name)}</span>
                <span className="mono text-[12px] text-graphite">
                  {e.time === null ? `block ${String(e.block)}` : `${formatDateTime(BigInt(e.time))} UTC`} · <a className="underline" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">{shortHash(e.txHash)} ↗</a>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <p className="label">{label}</p>
      <p className="mono mt-1 text-[26px]">{value}</p>
      <p className="mt-1 text-[12px] text-graphite">{note}</p>
    </div>
  )
}

function PauseCard({ summary: s, onChanged }: { summary: OperatorSummary; onChanged: () => void }) {
  const { address } = useAccount()
  const [open, setOpen] = useState(false)
  const isPauser = !!address && address.toLowerCase() === s.chain.pauser.toLowerCase()
  const paused = s.chain.newDealsPaused
  const action = paused ? 'unpauseNewDeals' : 'pauseNewDeals'
  return (
    <section aria-label="New deals" className={`mt-8 rounded-md border p-4 ${paused ? 'border-hold/50 bg-hold-wash' : 'border-rule bg-sheet'}`}>
      <p className="label">New deals</p>
      <p className="mt-1 text-[18px] font-semibold">{paused ? 'Paused' : 'Open'}</p>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed">
        Pausing stops anyone creating or funding <em>new</em> deals. Claims, refunds, disputes, arbiter decisions, retries and withdrawals on deals that already exist keep working; money already in escrow is untouched.
      </p>
      {isPauser ? (
        <button type="button" onClick={() => setOpen(true)} className={`mt-3 rounded-md px-4 py-2.5 text-[14px] font-semibold ${paused ? 'bg-held text-sheet' : 'bg-hold text-sheet'}`}>
          {paused ? 'Resume new deals' : 'Pause new deals'}
        </button>
      ) : (
        <p className="mt-3 text-[12.5px] text-graphite">Only the pauser wallet <span className="mono">{shortAddress(s.chain.pauser)}</span> can change this{address ? ` (you are connected as ${shortAddress(address)})` : '; connect it to see the control'}.</p>
      )}
      <Modal open={open} onClose={() => setOpen(false)} label={paused ? 'Resume new deals' : 'Pause new deals'}>
        {open ? (
          <>
            <h2 className="text-[19px] font-semibold">{paused ? 'Resume new deals?' : 'Pause new deals?'}</h2>
            <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
              {paused ? 'People can create and fund new deals again.' : 'No new deal can be created or funded until you resume. Existing deals are not affected.'}
            </p>
            <TxFlow
              confirmLabel={paused ? 'Resume' : 'Pause'}
              tone={paused ? 'held' : 'hold'}
              steps={[{ label: paused ? 'Resume new deals' : 'Pause new deals', action: encodeOperatorAction(action) }]}
              onCancel={() => setOpen(false)}
              onDone={() => { setOpen(false); onChanged() }}
            />
          </>
        ) : null}
      </Modal>
    </section>
  )
}
