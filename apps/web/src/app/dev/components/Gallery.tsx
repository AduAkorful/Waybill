'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPublicClient, http, type PublicClient } from 'viem'
import { readNextDealId } from '@/integration/escrow'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { Acceptances } from '@/ui/Acceptances'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'
import { LiveLedger, LiveWaybill } from '@/ui/Live'
import { Stamp } from '@/ui/Stamp'
import { useDeal } from '@/data/use-deal'
import { formatAmount, formatDateTime, shortHash } from '@/view/format'
import { loadDealView } from '@/view/from-chain'
import { MILESTONE_STATES, type DealView } from '@/view/types'

const RECENT = 12

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; nextId: bigint; deals: DealView[] }

/**
 * Component gallery for development. There is no sample data here: every deal is read from the escrow on the
 * configured network, so a component state appears only if a real deal is in that state.
 */
export function Gallery() {
  const network = useMemo(() => getBrowserNetwork(), [])
  const client = useMemo(() => createPublicClient({ chain: getBrowserChain(), transport: http(network.rpcUrl), batch: { multicall: true } }) as PublicClient, [network])
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [selected, setSelected] = useState<bigint | null>(null)
  const [reread, setReread] = useState<DealView | null>(null)
  const [idText, setIdText] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const nextId = await readNextDealId(client, network)
        const ids = Array.from({ length: Math.min(RECENT, Number(nextId)) }, (_, i) => nextId - 1n - BigInt(i))
        const deals = await Promise.all(ids.map((id) => loadDealView(client, network, id)))
        if (cancelled) return
        setLoad({ status: 'ready', nextId, deals })
        setSelected(deals[0]?.id ?? null)
      } catch (e) {
        if (!cancelled) setLoad({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, network])

  const loaded = load.status === 'ready' ? load.deals : []
  const deal = reread ?? loaded.find((d) => d.id === selected) ?? null

  const open = useCallback(
    async (id: bigint) => {
      setReread(null)
      setSelected(id)
      if (!loaded.some((d) => d.id === id)) setReread(await loadDealView(client, network, id))
    },
    [client, network, loaded],
  )

  const seen = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of loaded) for (const t of d.tranches) counts.set(t.state, (counts.get(t.state) ?? 0) + 1)
    return counts
  }, [loaded])

  return (
    <main className="mx-auto max-w-5xl px-4 pt-5 pb-20">
      <header className="flex items-center justify-between gap-3 border-b border-rule pb-3">
        <div className="flex items-baseline gap-3">
          <Wordmark />
          <span className="label">Components · {network.network}</span>
        </div>
        <ThemeToggle />
      </header>

      {load.status === 'loading' ? <p className="mt-6 text-graphite">Reading the escrow…</p> : null}
      {load.status === 'error' ? (
        <p role="alert" className="mt-6 text-hold">
          Could not read the escrow: {load.message}
        </p>
      ) : null}

      {load.status === 'ready' ? (
        <>
          <section className="mt-5">
            <p className="label">Deals on this network · {load.nextId.toString()} in total · latest {loaded.length}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {loaded.map((d) => (
                <li key={d.id.toString()}>
                  <button
                    onClick={() => open(d.id)}
                    aria-pressed={deal?.id === d.id}
                    className={`mono rounded border px-2 py-1 text-[12px] ${deal?.id === d.id ? 'border-held bg-held-wash' : 'border-rule hover:bg-sheet'}`}
                  >
                    {d.id.toString()} · {d.state}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-3 flex items-center gap-2 text-[13px]"
              onSubmit={(e) => {
                e.preventDefault()
                if (/^\d+$/.test(idText) && BigInt(idText) < load.nextId) open(BigInt(idText))
              }}
            >
              <label className="label" htmlFor="deal-id">
                Deal id
              </label>
              <input id="deal-id" value={idText} onChange={(e) => setIdText(e.target.value.replace(/\D/g, ''))} className="mono w-24 rounded border border-rule bg-paper px-2 py-1" inputMode="numeric" />
              <button className="rounded border border-rule px-2.5 py-1 font-semibold hover:bg-sheet">Open</button>
            </form>
          </section>

          {deal ? (
            <>
              <Group title={`Waybill · deal ${deal.id}`} note="Full detail. Goods, names and places appear only when off-chain terms exist; none are served yet.">
                <LiveWaybill deal={deal} />
              </Group>
              <Group title="Summary and compact">
                <LiveWaybill deal={deal} detail="summary" compact />
              </Group>
              <Group title="Ledger" note="Derived from the escrow's own state. Arbiter-split parts count once their event is read from the relayer; until then the figures leave them out.">
                <LiveLedger deal={deal} />
                <p className="mono mt-3 text-[12px] text-graphite">
                  total {formatAmount(deal.totalAmount)} · prepaid fee {formatAmount(deal.prepaidFee)} · arbiter fee {formatAmount(deal.arbiterFee)}
                </p>
              </Group>
              <Group title="History" note="Indexed events from the relayer API. Shown only when the API is configured and answers.">
                <History id={deal.id} />
              </Group>
              <Group title="Acceptances">
                <Acceptances deal={deal} />
              </Group>
              <Group title="Stamps" note="Shown for the states present on the loaded deals.">
                <div className="flex flex-wrap gap-4">
                  {seen.has('released') ? <Stamp tone="released">Released</Stamp> : null}
                  {seen.has('refunded') ? <Stamp tone="refunded">Refunded</Stamp> : null}
                  {seen.has('disputed') ? <Stamp tone="hold">Held</Stamp> : null}
                  {deal.state === 'funded' ? <Stamp tone="held">Funds locked</Stamp> : null}
                </div>
              </Group>
            </>
          ) : null}

          <Group title="Part states on this network" note={`Across the latest ${loaded.length} deals. A state with no deal cannot be shown without inventing one.`}>
            <ul className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-3">
              {MILESTONE_STATES.map((s) => (
                <li key={s} className="flex items-baseline justify-between bg-sheet px-3 py-2 text-[13px]">
                  <span>{s.replace('_', ' ')}</span>
                  <span className={`mono ${seen.has(s) ? '' : 'text-graphite'}`}>{seen.get(s) ?? 'none yet'}</span>
                </li>
              ))}
            </ul>
          </Group>
        </>
      ) : null}
    </main>
  )
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      {note ? <p className="mt-0.5 mb-3 text-[12.5px] text-graphite">{note}</p> : <div className="mb-3" />}
      {children}
    </section>
  )
}

function History({ id }: { id: bigint }) {
  const read = useDeal(id)
  const explorer = getBrowserNetwork().explorerUrl.replace(/\/+$/, '')
  if (read.status === 'loading') return <p className="text-graphite">Reading…</p>
  if (read.status === 'error') return <p role="alert" className="text-hold">Could not read the deal: {read.message}</p>
  if (read.history.status === 'unconfigured') return <p className="text-graphite">No relayer API is configured, so there is no history to show.</p>
  if (read.history.status === 'error') return <p role="alert" className="text-hold">History unavailable: {read.history.message}</p>
  const events = read.deal.events ?? []
  if (events.length === 0) return <p className="text-graphite">The relayer has indexed no events for this deal.</p>
  const unknown = read.deal.tranches.filter((t) => t.state === 'resolved' && !read.deal.splits?.some((x) => x.position === t.position))
  return (
    <>
      {unknown.length > 0 ? <p role="alert" className="mb-2 text-hold">Split decision not found in the indexed events for part {unknown.map((t) => t.index).join(', ')}.</p> : null}
      <ol className="divide-y divide-rule rounded-md border border-rule bg-sheet text-[13px]">
        {events.map((e) => (
          <li key={`${e.blockNumber}-${e.logIndex}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
            <span>
              {e.name}
              {e.position === null ? '' : ` · part ${e.position + 1}`}
            </span>
            <span className="mono text-graphite">
              {e.time === null ? 'time unknown' : formatDateTime(e.time)} ·{' '}
              <a className="underline" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                {shortHash(e.txHash)}
              </a>
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}
