'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useWalletDeals } from '@/data/wallet-deals'
import { dealsInShell, heldShells, shellLabel } from '@/view/wallet'
import { ReadStatus } from './ReadStatus'

/** Lands on the one role the wallet holds, or lets it choose between several. Roles come from the escrow's own deal parties. */
export default function AppHome() {
  const read = useWalletDeals()
  const router = useRouter()
  const shells = read.status === 'ready' ? heldShells(read.deals) : []

  useEffect(() => {
    if (shells.length === 1) router.replace(`/app/${shells[0]}`)
  }, [shells, router])

  if (read.status !== 'ready') return <ReadStatus read={read} />
  if (shells.length === 0) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10 md:px-8">
        <h1 className="text-[22px] font-semibold">No deals name this wallet yet</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-graphite">
          Deals appear here once a buyer creates one that names this wallet as buyer, supplier, attestor or arbiter. You can
          look through the <Link href="/attestors" className="underline">attestor directory</Link> in the meantime.
        </p>
      </main>
    )
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:px-8">
      <h1 className="text-[22px] font-semibold">How are you using Waybill today?</h1>
      <ul className="mt-5 grid gap-3">
        {shells.map((s) => {
          const count = dealsInShell(read.deals, s).length
          return (
            <li key={s}>
              <Link href={`/app/${s}`} className="flex items-center justify-between rounded-md border border-rule bg-paper px-4 py-3.5 hover:border-ink">
                <span className="text-[15px] font-semibold">{shellLabel[s]}</span>
                <span className="text-[13px] text-graphite">
                  {count} {count === 1 ? 'deal' : 'deals'}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
