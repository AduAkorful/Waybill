import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBrowserNetwork } from '@/integration/network'
import { getAttestor } from '@/server/attestors'
import { PublicShell } from '@/ui/PublicShell'
import { attestorName, describeAttestorEvent, statusWords } from '@/view/attestor'
import { formatDateTime, shortAddress, shortHash } from '@/view/format'

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
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-20 md:px-8">
        <Link href="/attestors" className="text-[13px] text-graphite hover:text-ink">← All attestors</Link>
        {read.status === 'unconfigured' ? <p className="mt-6 text-graphite">This site has no attestor source configured.</p> : null}
        {read.status === 'error' ? <p role="alert" className="mt-6 text-hold">This profile is unavailable right now: {read.message}</p> : null}
        {read.status === 'ready' ? (
          <>
            <h1 className="mt-3 text-[30px] font-semibold tracking-tight">{attestorName(read.value) ?? shortAddress(read.value.address)}</h1>
            <p className="mono mt-1 text-[12.5px] text-graphite">
              {read.value.profile?.city ? `${read.value.profile.city} · ` : ''}
              <a className="underline" href={`${explorer}/address/${read.value.address}`} target="_blank" rel="noreferrer">
                {read.value.address} ↗
              </a>
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-4">
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
            {read.value.pending ? (
              <p role="status" className="mt-4 rounded-md border border-hold/50 bg-paper px-3.5 py-3 text-[13.5px]">
                A change to “{statusWords[read.value.pending.status].toLowerCase()}” is scheduled for {formatDateTime(read.value.pending.eta)}
                {read.value.pending.automatic ? ', triggered by repeated upheld disputes' : ''}.
              </p>
            ) : null}
            <h2 className="mt-8 text-[17px] font-semibold tracking-tight">Registry history</h2>
            <ol className="mt-3 divide-y divide-rule rounded-md border border-rule bg-sheet text-[13.5px]">
              {(read.value.events ?? []).map((e) => (
                <li key={`${e.blockNumber}-${e.logIndex}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3.5 py-2.5">
                  <span>{describeAttestorEvent(e)}</span>
                  <span className="mono text-[12px] text-graphite">
                    {e.time === null ? 'time unknown' : formatDateTime(e.time)} ·{' '}
                    <a className="underline" href={`${explorer}/tx/${e.txHash}`} target="_blank" rel="noreferrer">
                      {shortHash(e.txHash)} ↗
                    </a>
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </main>
    </PublicShell>
  )
}
