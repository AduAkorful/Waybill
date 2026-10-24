'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { shortAddress } from '@/view/format'
import { statusWords, type AttestorStatus } from '@/view/attestor'

export interface DirectoryRow {
  address: string
  name: string | null
  city: string | null
  status: AttestorStatus
  attested: number
  upheld: number
  slashed: number
}

export function Directory({ attestors }: { attestors: DirectoryRow[] }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle === ''
      ? attestors
      : attestors.filter((a) => [a.name, a.city, a.address].some((v) => v?.toLowerCase().includes(needle)))
  }, [attestors, q])

  return (
    <>
      <label className="mt-6 flex items-center gap-2 text-[13px]">
        <span className="label">Search</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, city or address"
          className="min-h-11 w-full max-w-xs rounded border border-rule bg-paper px-2.5 text-base"
        />
      </label>
      <div className="mt-4 overflow-hidden rounded-md border border-rule bg-sheet">
        <div className="label hidden grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_8rem] gap-x-4 border-b border-rule px-4 py-2 md:grid" aria-hidden>
          <span>Attestor</span>
          <span className="text-right">Signed</span>
          <span className="text-right">Upheld against</span>
          <span className="text-right">Slashed</span>
          <span>Status</span>
        </div>
        <ul className="divide-y divide-rule">
          {rows.map((a) => (
            <li key={a.address}>
              <Link href={`/attestors/${a.address}`} className="grid min-h-11 gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper md:grid-cols-[minmax(0,1fr)_5rem_7rem_5rem_8rem] md:items-baseline">
                <span className="min-w-0">
                  <span className="text-[15px] font-semibold">{a.name ?? shortAddress(a.address)}</span>
                  {a.city ? <span className="ml-2 text-[13px] text-graphite">{a.city}</span> : null}
                  <span className="mono ml-2 text-[12px] text-graphite">{a.name ? shortAddress(a.address) : ''}</span>
                </span>
                <span className="mono text-[12px] text-graphite md:hidden">
                  signed {a.attested} · upheld against {a.upheld} · slashed {a.slashed} · {statusWords[a.status].toLowerCase()}
                </span>
                <span className="mono hidden text-right text-[13px] md:block">{a.attested}</span>
                <span className="mono hidden text-right text-[13px] md:block">{a.upheld}</span>
                <span className="mono hidden text-right text-[13px] md:block">{a.slashed}</span>
                <span className="hidden text-[13px] text-graphite md:block">{statusWords[a.status]}</span>
              </Link>
            </li>
          ))}
          {rows.length === 0 ? <li className="px-4 py-3 text-graphite">No attestor matches that search.</li> : null}
        </ul>
      </div>
      <section className="mt-8 max-w-2xl text-[13.5px] leading-relaxed text-graphite">
        <h2 className="text-[15px] font-semibold text-ink">Who attests</h2>
        <p className="mt-1">A buyer names the people who confirm each part of a deal, such as an inspector or a forwarder. Anyone with a wallet can be named. This list shows the ones the registry contract has a record for; a profile name is whatever that wallet chose to publish, not a check by Waybill.</p>
      </section>
    </>
  )
}
