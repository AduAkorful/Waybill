'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useWalletDeals } from '@/data/wallet-deals'
import { shortAddress } from '@/view/format'
import { dealsInShell, heldShells, shellLabel } from '@/view/wallet'
import { ReadStatus } from './ReadStatus'

/** Lands on the one role the wallet holds, or lets it choose between several. Roles come from the escrow's own deal parties. */
export default function AppHome() {
  const read = useWalletDeals()
  const { address } = useAccount()
  const router = useRouter()
  const shells = read.status === 'ready' ? heldShells(read.deals) : []

  useEffect(() => {
    if (shells.length === 1) router.replace(`/app/${shells[0]}`)
  }, [shells, router])

  if (read.status !== 'ready') return <ReadStatus read={read} />
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
        {shells.length === 0 ? 'No deals name this wallet yet' : 'How are you using Waybill today?'}
      </h1>
      <p className="mt-2 text-[14px] text-graphite">
        Signed in as <span className="mono">{address ? shortAddress(address) : ''}</span>.{' '}
        {shells.length === 0
          ? 'Deals appear here once one names this wallet as buyer, supplier, attestor or arbiter.'
          : 'Roles are set per deal, so you may have more than one.'}
      </p>
      {shells.length > 0 ? (
        <ul className="mt-6 space-y-2.5">
          {shells.map((s) => {
            const count = dealsInShell(read.deals, s).length
            return (
              <li key={s}>
                <Link href={`/app/${s}`} className="block w-full rounded-md border border-rule bg-sheet px-4 py-3.5 text-left hover:border-ink">
                  <span className="flex items-baseline justify-between">
                    <span className="text-[15px] font-semibold">{shellLabel[s]}</span>
                    <span className="text-graphite">→</span>
                  </span>
                  <span className="mt-1 block text-[12.5px]">
                    {count} {count === 1 ? 'deal' : 'deals'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-6 text-[13px] text-graphite">
          <Link href="/app/new" className="font-semibold text-ink underline decoration-rule underline-offset-2">Create your first deal</Link>, or look through the{' '}
          <Link href="/attestors" className="font-semibold text-ink underline decoration-rule underline-offset-2">
            attestor directory
          </Link>
          .
        </p>
      )}
    </main>
  )
}
