import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBrowserNetwork } from '@/integration/network'
import { getAttestor } from '@/server/attestors'
import { PublicShell } from '@/ui/PublicShell'
import { attestorName, groupHistory, statusWords } from '@/view/attestor'
import { HistoryRows } from '@/ui/HistoryRows'
import { formatDateTime, formatDay, shortAddress } from '@/view/format'

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
      <main className="mx-auto max-w-5xl px-4 pt-2 pb-12 md:px-8 md:pt-6">
        <Link href="/attestors" className="inline-flex min-h-11 items-center text-[13px] text-graphite hover:text-ink">← All attestors</Link>
        {read.status === 'unconfigured' ? <p className="mt-6 text-graphite">This site has no attestor source configured.</p> : null}
        {read.status === 'error' ? <p role="alert" className="mt-6 text-hold">This profile is unavailable right now: {read.message}</p> : null}
        {read.status === 'ready' ? (
          <div className="mt-3">
            <h1 className="text-[30px] font-semibold tracking-tight">{attestorName(read.value) ?? shortAddress(read.value.address)}</h1>
            <p className="mono mt-1 text-[12.5px] break-words text-graphite">
              {read.value.profile?.city ? `${read.value.profile.city} · ` : ''}
              <a className="inline-flex min-h-11 items-center underline sm:inline sm:min-h-0" href={`${explorer}/address/${read.value.address}`} target="_blank" rel="noreferrer">
                <span className="sm:hidden">{shortAddress(read.value.address)}</span>
                <span className="hidden break-all sm:inline">{read.value.address}</span> ↗
              </a>
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-4">
              {[
                ['Signed', read.value.attested, true],
                ['Upheld against', read.value.upheld, true],
                ['Slashed', read.value.slashed, true],
                ['Status', statusWords[read.value.status], false],
              ].map(([k, v, num]) => (
                <div key={String(k)} className="bg-sheet px-3.5 py-3">
                  <dt className="label">{k}</dt>
                  <dd className={`${num ? 'mono' : ''} mt-1 text-[18px]`}>{v}</dd>
                </div>
              ))}
            </dl>
            {(() => {
              const times = (read.value.events ?? []).map((e) => e.time).filter((t): t is bigint => t !== null)
              return times.length ? (
                <dl className="mt-3 grid gap-x-8 gap-y-1 rounded-md border border-rule bg-sheet px-3.5 py-3 text-[13px] sm:grid-cols-3">
                  <div className="flex justify-between gap-3 sm:block"><dt className="text-graphite">First activity</dt><dd className="mono">{formatDay(times[0]!)}</dd></div>
                  <div className="flex justify-between gap-3 sm:block"><dt className="text-graphite">Latest activity</dt><dd className="mono">{formatDay(times[times.length - 1]!)}</dd></div>
                  <div className="flex justify-between gap-3 sm:block"><dt className="text-graphite">Registry records</dt><dd className="mono">{(read.value.events ?? []).length}</dd></div>
                </dl>
              ) : null
            })()}
            {read.value.pending ? (
              <p role="status" className="mt-4 rounded-md border border-hold/50 bg-paper px-3.5 py-3 text-[13.5px]">
                A change to “{statusWords[read.value.pending.status].toLowerCase()}” is scheduled for {formatDateTime(read.value.pending.eta)}
                {read.value.pending.automatic ? ', triggered by repeated upheld disputes' : ''}.
              </p>
            ) : null}
            <h2 className="mt-8 text-[17px] font-semibold tracking-tight">Registry history</h2>
            <div className="mt-3">
              <HistoryRows groups={groupHistory(read.value.events ?? []).reverse()} explorer={explorer} />
            </div>
            <p className="mt-2 text-[12px] text-graphite">Repeated records are shown as one row with a count. The registry records outcomes, not deal numbers, so a row cannot be tied to one deal.</p>
            <p className="mt-8 max-w-2xl text-[13px] leading-relaxed text-graphite">An attestor is a person or company a deal names to confirm one thing, such as that goods were inspected or shipped, by signing a fixed statement. Signing never moves money by itself, and the counts above come from the registry contract, not from Waybill.</p>
          </div>
        ) : null}
      </main>
    </PublicShell>
  )
}
