'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { readNextDealId } from '@/integration/escrow'
import { getBrowserNetwork } from '@/integration/network'
import { getReadClient } from '@/integration/read-client'
import { useBuilderLimits } from '@/data/builder-reads'
import { parseAttestors, type Attestor } from '@/view/attestor'
import { formatAmount, formatAmountsAligned, shortAddress } from '@/view/format'
import { loadDealView } from '@/view/from-chain'
import type { DealView } from '@/view/types'

/** Deals are read newest first, this many at a time, until enough public ones are found or the limit is reached. */
const BATCH = 8
const SCAN_LIMIT = 48
const SHOW = 4
/** A read that has not answered by now is reported, with a way to try again. */
const SLOW_MS = 10_000

type Recent = { status: 'loading' } | { status: 'error' } | { status: 'ready'; total: bigint; deals: DealView[]; fresh: boolean }
type People = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; top: Attestor[]; fresh: boolean }

/** The last good reads of this visit, shown at once and marked "updating" until a fresh read replaces them. */
let lastRecent: Extract<Recent, { status: 'ready' }> | undefined
let lastPeople: Extract<People, { status: 'ready' }> | undefined

const stateWord: Record<string, string> = { funded: 'Funded', settled: 'Settled' }
const disputed = (d: DealView) => d.tranches.filter((t) => t.state === 'disputed').length

/**
 * Live figures for the network, read from the escrow and the registry when the page opens: how many deals exist, how
 * much is held now, the newest funded or settled deals (each opens its public record), and the attestors who have
 * signed the most. Every figure is a real read; one that cannot be read, or is slow, is said so with a Retry.
 */
export function NetworkSnapshot({ compact = false }: { compact?: boolean }) {
  const [attempt, setAttempt] = useState(0)
  return <Snapshot key={attempt} compact={compact} onRetry={() => setAttempt((n) => n + 1)} />
}

function Snapshot({ compact, onRetry }: { compact: boolean; onRetry: () => void }) {
  const network = useMemo(() => getBrowserNetwork(), [])
  const limits = useBuilderLimits()
  const [recent, setRecent] = useState<Recent>(lastRecent ?? { status: 'loading' })
  const [people, setPeople] = useState<People>(lastPeople ?? { status: 'loading' })
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    // a read with no answer by now is given up on, so a first visit with nothing cached ends in "Try again", not "…"
    const timer = setTimeout(() => {
      setSlow(true)
      setRecent((prev) => (prev.status === 'loading' ? { status: 'error' } : prev))
      setPeople((prev) => (prev.status === 'loading' ? { status: 'unavailable' } : prev))
    }, SLOW_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const client = getReadClient()
    void (async () => {
      try {
        const total = await readNextDealId(client, network)
        const found: DealView[] = []
        let next = total - 1n
        let scanned = 0
        while (next >= 0n && found.length < SHOW && scanned < SCAN_LIMIT) {
          const ids: bigint[] = []
          for (; next >= 0n && ids.length < BATCH; next--) ids.push(next)
          scanned += ids.length
          const reads = await Promise.allSettled(ids.map((id) => loadDealView(client, network, id)))
          for (const r of reads) if (r.status === 'fulfilled' && (r.value.state === 'funded' || r.value.state === 'settled')) found.push(r.value)
        }
        const value = { status: 'ready' as const, total, deals: found.slice(0, SHOW), fresh: true }
        lastRecent = value
        if (!cancelled) setRecent(value)
      } catch {
        if (!cancelled) setRecent((prev) => (prev.status === 'ready' ? prev : { status: 'error' }))
      }
    })()
    void (async () => {
      try {
        const api = createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, network)
        const all = parseAttestors(await api.getAttestors())
        const value = { status: 'ready' as const, top: [...all].sort((a, b) => b.attested - a.attested).slice(0, 3), fresh: true }
        lastPeople = value
        if (!cancelled) setPeople(value)
      } catch {
        if (!cancelled) setPeople((prev) => (prev.status === 'ready' ? prev : { status: 'unavailable' }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [network])

  const limitsFresh = limits.status === 'ready' && limits.fresh !== false
  const [heldText, capText, perDealText] =
    limits.status === 'ready'
      ? formatAmountsAligned(limits.value.currentLocked, limits.value.maxLocked, limits.value.maxDealAmount)
      : ['', '', '']
  const stillWaiting = slow && limits.status === 'loading'
  const failed = limits.status === 'error' || recent.status === 'error' || people.status === 'unavailable' || stillWaiting
  const updating = (limits.status === 'ready' && !limitsFresh) || (recent.status === 'ready' && !recent.fresh)

  const tile = (label: string, value: string | null, note?: string, mark?: boolean) => (
    <div className="bg-sheet px-4 py-3.5">
      <dt className="label">{label}</dt>
      <dd className="mt-1">
        <span className="mono block text-[20px] md:text-[22px]">{value ?? (slow ? '—' : '…')}</span>
        {mark ? <span className="mt-0.5 block text-[12px] text-graphite">updating…</span> : note ? <span className="mt-0.5 block text-[12px] text-graphite">{note}</span> : null}
      </dd>
    </div>
  )

  return (
    <section aria-labelledby="snapshot-h" className="mt-12 border-t border-rule pt-8">
      <h2 id="snapshot-h" className="text-[20px] font-semibold tracking-tight">On this network right now</h2>
      <p className="mt-1 text-[13px] text-graphite">Read from {network.network === 'testnet' ? 'the Arc test network' : 'Arc'} when this page opened. {network.network === 'testnet' ? 'Test money only.' : ''}</p>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
        {tile('Deals created', recent.status === 'ready' ? recent.total.toString() : null, undefined, recent.status === 'ready' && !recent.fresh)}
        {tile('Held in escrow now', limits.status === 'ready' ? `${heldText} USDC` : null, limits.status === 'ready' ? `of ${capText} USDC early-access cap · largest deal ${perDealText}` : undefined, limits.status === 'ready' && !limitsFresh)}
      </dl>

      {failed ? (
        <p role="alert" className="mt-3 text-[13px] text-hold">
          {stillWaiting ? 'This is taking longer than usual. ' : 'Some figures could not be read just now. '}
          <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center font-semibold underline">Try again</button>
        </p>
      ) : updating ? <p role="status" className="mt-2 text-[12px] text-graphite">Showing the last reading while a fresh one loads.</p> : null}

      <div className={`mt-6 gap-8 md:grid-cols-2 ${compact ? 'hidden md:grid' : 'grid'}`}>
        <div>
          <h3 className="label">Newest funded or settled deals</h3>
          {recent.status === 'loading' ? <p role="status" className="mt-3 text-[13px] text-graphite">Reading the escrow…</p> : null}
          {recent.status === 'error' ? <p className="mt-3 text-[13px] text-graphite">Recent deals are not available right now.</p> : null}
          {recent.status === 'ready' && recent.deals.length === 0 ? <p className="mt-3 text-[13px] text-graphite">No funded or settled deal found among the newest {SCAN_LIMIT}.</p> : null}
          {recent.status === 'ready' && recent.deals.length > 0 ? (
            <ul className="mt-2 divide-y divide-rule rounded-md border border-rule bg-sheet">
              {recent.deals.map((d) => {
                const parts = `${d.tranches.length} ${d.tranches.length === 1 ? 'part' : 'parts'}`
                const inDispute = disputed(d)
                const state = `${stateWord[d.state] ?? d.state}${inDispute > 0 ? `, ${inDispute} in dispute` : ''}`
                return (
                  <li key={String(d.id)}>
                    <Link href={`/record/${d.id}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] hover:bg-paper">
                      <span>
                        <span className="font-semibold">Deal {String(d.id)}</span>
                        <span className="sr-only">, </span><span className="ml-2 text-graphite">{parts}</span>
                      </span>
                      <span className="sr-only">, </span>
                      <span className="mono text-right text-[13px]">{formatAmount(d.totalAmount)} USDC<span className="sr-only">, </span><span className="block text-[12px] text-graphite sm:inline sm:before:content-['_·_']">{state}</span></span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        <div>
          <h3 className="label">Attestors with the most signed statements</h3>
          {people.status === 'loading' ? <p role="status" className="mt-3 text-[13px] text-graphite">Reading the registry…</p> : null}
          {people.status === 'unavailable' ? <p className="mt-3 text-[13px] text-graphite">The attestor list is not available right now.</p> : null}
          {people.status === 'ready' && people.top.length === 0 ? <p className="mt-3 text-[13px] text-graphite">No attestor has signed anything yet.</p> : null}
          {people.status === 'ready' && people.top.length > 0 ? (
            <ul className="mt-2 divide-y divide-rule rounded-md border border-rule bg-sheet">
              {people.top.map((a) => (
                <li key={a.address}>
                  <Link href={`/attestors/${a.address}`} aria-label={`${a.profile?.name ?? 'Attestor'} ${shortAddress(a.address)}, ${a.attested} signed${a.upheld > 0 ? `, ${a.upheld} upheld against` : ''}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] hover:bg-paper">
                    <span className="min-w-0">
                      <span className="font-semibold">{a.profile?.name ?? shortAddress(a.address)}</span>
                      {a.profile?.name ? <span className="mono ml-2 text-[12px] text-graphite">{shortAddress(a.address)}</span> : null}
                    </span>
                    <span className="mono text-[13px]">{a.attested} signed{a.upheld > 0 ? ` · ${a.upheld} upheld against` : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1"><Link href="/attestors" className="inline-flex min-h-11 items-center text-[12.5px] underline">See every attestor</Link></p>
        </div>
      </div>
    </section>
  )
}
