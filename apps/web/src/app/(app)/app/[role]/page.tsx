'use client'

import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { useWalletDeals } from '@/data/wallet-deals'
import { dealsInShell, isShell, rolesIn, shellLabel } from '@/view/wallet'
import { ReadStatus } from '../ReadStatus'

/** Every deal the wallet holds in one role, newest first, as the relayer indexed them. */
export default function RoleHome() {
  const { role } = useParams<{ role: string }>()
  const read = useWalletDeals()
  if (!isShell(role)) notFound()
  if (read.status !== 'ready') return <ReadStatus read={read} />

  const deals = dealsInShell(read.deals, role)
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <h1 className="text-[22px] font-semibold">{shellLabel[role]}</h1>
      {deals.length === 0 ? (
        <p className="mt-3 text-[14px] text-graphite">This wallet holds no {shellLabel[role].toLowerCase()} role in any deal.</p>
      ) : (
        <ul className="mt-5 divide-y divide-rule rounded-md border border-rule bg-paper">
          {deals.map((d) => (
            <li key={String(d.dealId)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-[14.5px] font-semibold">Deal {String(d.dealId)}</p>
                <p className="text-[12.5px] text-graphite">
                  {d.state ? d.state.toLowerCase() : 'state not indexed yet'}
                  {rolesIn(d, role).map((r) => (r.part !== null ? ` · confirms part ${r.part + 1}` : r.role === 'panel' ? ' · panel member' : '')).join('')}
                </p>
              </div>
              <Link href={`/record/${d.dealId}`} className="text-[13px] underline hover:text-ink">
                Public record
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
