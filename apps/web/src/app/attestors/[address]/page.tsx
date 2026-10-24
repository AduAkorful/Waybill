import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBrowserNetwork } from '@/integration/network'
import { getAttestor } from '@/server/attestors'
import { PublicShell } from '@/ui/PublicShell'
import { attestorName, groupHistory, statusWords } from '@/view/attestor'
import { formatDateTime, formatDay, shortAddress, shortHash } from '@/view/format'

export const revalidate = 60

const valid = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a)

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params
  if (!valid(address)) return { title: 'Attestor not found' }
  const read = await getAttestor(address)
  if (read.status !== 'ready') return { title: shortAddress(address) }
  const a = read.value
  return {
    title: attestorName(a) ?? shortAddress(a.address),
    description: `Signed ${a.attested} · upheld against ${a.upheld} · slashed ${a.slashed} · ${statusWords[a.status].toLowerCase()}`,
  }
}

export default async function AttestorProfile({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  if (!valid(address)) notFound()
  const read = await getAttestor(address)
  if (read.status === 'missing') notFound()
  const explorer = getBrowserNetwork().explorerUrl.replace(/\/+$/, '')

  return (
    <PublicShell>
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-20 md:px-8">
        <Link href="/attestors" className="text-[13px] text-graphite hover:text-ink">← All attestors</Link>
        {read.status === 'unconfigured' ? <p className="mt-6 text-graphite">This site has no attestor source configured.</p> : null}
        {read.status === 'error' ? <p role="alert" className="mt-6 text-hold">This profile is unavailable right now: {read.message}</p> : null}
        {read.status === 'ready' ? (
          <div className="mt-3 grid gap-x-10 gap-y-6 lg:grid-cols-[19rem_1fr]">
          <div>
            <h1 className="text-[30px] font-semibold tracking-tight">{attestorName(read.value) ?? shortAddress(read.value.address)}</h1>
            <p className="mono mt-1 break-all text-[12.5px] text-graphite">
              {read.value.profile?.city ? `${read.value.profile.city} · ` : ''}
              <a className="underline" href={`${explorer}/address/${read.value.address}`} target="_blank" rel="noreferrer">
                {read.value.address} ↗
              </a>
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
              {[
                ['Signed', read.value.attested],
                ['Upheld against', read.value.upheld],
                ['Slashed', read.value.slashed],
                ['Status', statusWords[read.value.status]],
              ].map(([k, v]) => (
                <div key={String(k)} className="bg-sheet px-3.5 py-3">
                  <dt className="label">{k}</dt>
                  <dd className="mono mt-1 text-[18px]">{v}</dd>
                </div>
              ))}
            </dl>
            {(() => {
              const times = (read.value.events ?? []).map((e) => e.time).filter((t): t is bigint => t !== null)
              return times.length ? (
                <dl className="mt-3 rounded-md border border-rule bg-sheet px-3.5 py-3 text-[13px]">
                  <div className="flex justify-between gap-3"><dt className="text-graphite">First activity</dt><dd className="mono">{formatDay(times[0]!)}</dd></div>
                  <div className="mt-1 flex justify-between gap-3"><dt className="text-graphite">Latest activity</dt><dd className="mono">{formatDay(times[times.length - 1]!)}</dd></div>
                  <div className="mt-1 flex justify-between gap-3"><dt className="text-graphite">Registry records</dt><dd className="mono">{(read.value.events ?? []).length}</dd></div>
                </dl>
              ) : null
            })()}
            {read.value.pending ? (
              <p role="status" className="mt-4 rounded-md border border-hold/50 bg-paper px-3.5 py-3 text-[13.5px]">
                A change to “{statusWords[read.value.pending.status].toLowerCase()}” is scheduled for {formatDateTime(read.value.pending.eta)}
                {read.value.pending.automatic ? ', triggered by repeated upheld disputes' : ''}.
              </p>
            ) : null}
          </div>
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight lg:mt-2">Registry history</h2>
            <ol className="mt-3 divide-y divide-rule rounded-md border border-rule bg-sheet text-[13.5px]">
              {groupHistory(read.value.events ?? []).reverse().slice(0, 50).map((g) => (
                <li key={`${g.lastTx}-${g.count}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3.5 py-2.5">
                  <span>
                    {g.text}
                    {g.count > 1 ? <span className="mono ml-2 rounded border border-rule px-1.5 text-[11.5px] text-graphite">× {g.count}</span> : null}
                  </span>
                  <span className="mono text-[12px] text-graphite">
                    {g.last === null ? 'time unknown' : g.count > 1 && g.first !== null ? `${formatDay(g.first)} to ${formatDay(g.last)}` : formatDateTime(g.last)} ·{' '}
                    <a className="underline" href={`${explorer}/tx/${g.lastTx}`} target="_blank" rel="noreferrer">
                      {shortHash(g.lastTx)} ↗
                    </a>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[12px] text-graphite">Repeated records are shown as one row with a count. The registry records outcomes, not deal numbers, so a row cannot be tied to one deal.</p>
          </div>
          </div>
        ) : null}
      </main>
    </PublicShell>
  )
}
