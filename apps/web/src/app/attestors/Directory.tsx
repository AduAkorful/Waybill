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
          className="w-full max-w-xs rounded border border-rule bg-paper px-2.5 py-1.5"
        />
      </label>
      <ul className="mt-4 divide-y divide-rule rounded-md border border-rule bg-sheet">
        {rows.map((a) => (
          <li key={a.address}>
            <Link href={`/attestors/${a.address}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 hover:bg-paper">
              <span>
                <span className="text-[15px] font-semibold">{a.name ?? shortAddress(a.address)}</span>
                {a.city ? <span className="ml-2 text-[13px] text-graphite">{a.city}</span> : null}
                {a.name ? <span className="mono ml-2 text-[11.5px] text-graphite">{shortAddress(a.address)}</span> : null}
              </span>
              <span className="mono text-[12px] text-graphite">
                signed {a.attested} · upheld against {a.upheld} · slashed {a.slashed} · {statusWords[a.status].toLowerCase()}
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-4 py-3 text-graphite">No attestor matches that search.</li> : null}
      </ul>
    </>
  )
}
