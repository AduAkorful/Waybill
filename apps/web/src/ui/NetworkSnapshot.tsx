'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { readNextDealId } from '@/integration/escrow'
import { getBrowserNetwork } from '@/integration/network'
import { getReadClient } from '@/integration/read-client'
import { useBuilderLimits } from '@/data/builder-reads'
import { parseAttestors, type Attestor } from '@/view/attestor'
import { formatAmount, shortAddress } from '@/view/format'
import { loadDealView } from '@/view/from-chain'
import type { DealView } from '@/view/types'

const SCAN = 8
const SHOW = 4

type Recent = { status: 'loading' } | { status: 'error' } | { status: 'ready'; total: bigint; deals: DealView[] }
type People = { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; top: Attestor[] }

const word: Record<string, string> = { funded: 'Funded', settled: 'Settled' }

/**
 * Live figures for the network, read from the escrow and the registry when the page opens: how many deals exist, how
 * much is held now, the newest funded or settled deals (each opens its public record), and the attestors who have
 * signed the most. Every figure is a real read; when one cannot be read the block says so instead of guessing.
 */
export function NetworkSnapshot({ heading = 'On this network right now' }: { heading?: string }) {
  const network = useMemo(() => getBrowserNetwork(), [])
  const limits = useBuilderLimits()
  const [recent, setRecent] = useState<Recent>({ status: 'loading' })
  const [people, setPeople] = useState<People>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const client = getReadClient()
    void (async () => {
      try {
        const total = await readNextDealId(client, network)
        const ids: bigint[] = []
        for (let i = total - 1n; i >= 0n && ids.length < SCAN; i--) ids.push(i)
        const reads = await Promise.allSettled(ids.map((id) => loadDealView(client, network, id)))
        const deals = reads
          .flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
          .filter((d) => d.state === 'funded' || d.state === 'settled')
          .slice(0, SHOW)
        if (!cancelled) setRecent({ status: 'ready', total, deals })
      } catch {
        if (!cancelled) setRecent({ status: 'error' })
      }
    })()
    void (async () => {
      try {
        const api = createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, network)
        const all = parseAttestors(await api.getAttestors())
        if (!cancelled) setPeople({ status: 'ready', top: [...all].sort((a, b) => b.attested - a.attested).slice(0, 3) })
      } catch {
        if (!cancelled) setPeople({ status: 'unavailable' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [network])

  const tile = (label: string, value: string | null, note?: string) => (
    <div className="bg-sheet px-4 py-3.5">
      <dt className="label">{label}</dt>
      <dd className="mt-1">
        <span className="mono block text-[22px]">{value ?? '…'}</span>
        {note ? <span className="mt-0.5 block text-[12px] text-graphite">{note}</span> : null}
      </dd>
    </div>
  )

  return (
    <section aria-labelledby="snapshot-h" className="mt-12 border-t border-rule pt-8">
      <h2 id="snapshot-h" className="text-[20px] font-semibold tracking-tight">{heading}</h2>
      <p className="mt-1 text-[13px] text-graphite">Read from the {network.network === 'testnet' ? 'Arc test network' : 'Arc'} when this page opened. {network.network === 'testnet' ? 'Test money only.' : ''}</p>

      <dl className="mt-5 grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-3">
        {tile('Deals created', recent.status === 'ready' ? recent.total.toString() : null)}
        {tile('Held in escrow now', limits.status === 'ready' ? `${formatAmount(limits.value.currentLocked)} USDC` : null, limits.status === 'ready' ? `of a ${formatAmount(limits.value.maxLocked)} USDC early-access cap` : undefined)}
        {tile('Largest deal allowed', limits.status === 'ready' ? `${formatAmount(limits.value.maxDealAmount)} USDC` : null, 'early-access limit per deal')}
      </dl>
      {limits.status === 'error' ? <p role="alert" className="mt-2 text-[12.5px] text-hold">The escrow's figures could not be read just now.</p> : null}

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="label">Newest funded or settled deals</h3>
          {recent.status === 'loading' ? <p role="status" className="mt-3 text-[13px] text-graphite">Reading the escrow…</p> : null}
          {recent.status === 'error' ? <p role="alert" className="mt-3 text-[13px] text-hold">Recent deals could not be read just now.</p> : null}
          {recent.status === 'ready' && recent.deals.length === 0 ? <p className="mt-3 text-[13px] text-graphite">No deal among the newest {SCAN} has been funded yet.</p> : null}
          {recent.status === 'ready' && recent.deals.length > 0 ? (
            <ul className="mt-2 divide-y divide-rule rounded-md border border-rule bg-sheet">
              {recent.deals.map((d) => (
                <li key={String(d.id)}>
                  <Link href={`/record/${d.id}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] hover:bg-paper">
                    <span>
                      <span className="font-semibold">Deal {String(d.id)}</span>
                      <span className="ml-2 text-graphite">{d.tranches.length} {d.tranches.length === 1 ? 'part' : 'parts'}</span>
                    </span>
                    <span className="mono text-[13px]">{formatAmount(d.totalAmount)} USDC <span className="ml-1 text-graphite">· {word[d.state] ?? d.state}</span></span>
                  </Link>
                </li>
              ))}
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
                  <Link href={`/attestors/${a.address}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[13.5px] hover:bg-paper">
                    <span className="min-w-0">
                      <span className="font-semibold">{a.profile?.name ?? shortAddress(a.address)}</span>
                      {a.profile?.city ? <span className="ml-2 text-graphite">{a.profile.city}</span> : null}
                    </span>
                    <span className="mono text-[13px]">{a.attested} signed{a.upheld > 0 ? ` · ${a.upheld} upheld against` : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-[12.5px]"><Link href="/attestors" className="underline">See every attestor</Link></p>
        </div>
      </div>
    </section>
  )
}
