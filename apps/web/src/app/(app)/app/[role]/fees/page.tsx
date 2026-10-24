'use client'

import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createPublicClient, http, type PublicClient } from 'viem'
import { useAccount } from 'wagmi'
import { encodeCurrentEscrowAction } from '@/integration/current-actions'
import { readFeeBalance } from '@/integration/escrow'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { formatAmount } from '@/view/format'

/** Fees an attestor has earned from released parts, read from the escrow, and the withdrawal to their own wallet. */
export default function FeesPage() {
  const { role } = useParams<{ role: string }>()
  if (role !== 'attestor') notFound()
  return <Fees />
}

function Fees() {
  const { address } = useAccount()
  const network = useMemo(() => getBrowserNetwork(), [])
  const client = useMemo(() => createPublicClient({ chain: getBrowserChain(), transport: http(network.rpcUrl) }) as PublicClient, [network])
  const [refresh, setRefresh] = useState(0)
  const [read, setRead] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; balance: bigint }>({ kind: 'loading' })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!address) return
    let cancelled = false
    readFeeBalance(client, address, network)
      .then((balance) => !cancelled && setRead({ kind: 'ready', balance }))
      .catch((e) => !cancelled && setRead({ kind: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
    }
  }, [client, network, address, refresh])

  return (
    <main className="mx-auto max-w-2xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <p className="label">Attestor</p>
      <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Fees</h1>
      <p className="mt-1 text-[13.5px] text-graphite">Your fee on a part is added here when that part is paid to the supplier. It is yours to withdraw at any time; nobody else can move it.</p>
      <div className="mt-6 rounded-md border border-rule bg-sheet p-4">
        <p className="label">Ready to withdraw</p>
        {read.kind === 'loading' ? <p role="status" className="mt-1 text-[14px] text-graphite">Reading your balance…</p> : null}
        {read.kind === 'error' ? <p role="alert" className="mt-1 text-[14px] text-hold">Your balance could not be read: {read.message}</p> : null}
        {read.kind === 'ready' ? (
          <>
            <p className="mono mt-1 text-[28px]">{formatAmount(read.balance)} <span className="text-[14px] text-graphite">USDC</span></p>
            <button type="button" disabled={read.balance === 0n} onClick={() => setOpen(true)} className="mt-3 rounded-md bg-held px-4 py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40">
              Withdraw to my wallet
            </button>
            {read.balance === 0n ? <p className="mt-2 text-[12.5px] text-graphite">Nothing has been earned yet.</p> : null}
          </>
        ) : null}
      </div>
      <Link href="/app/attestor" className="mt-6 inline-block text-[13.5px] underline">Back to your work</Link>
      <Modal open={open} onClose={() => setOpen(false)} label="Withdraw fees">
        {open && read.kind === 'ready' ? (
          <>
            <h2 className="text-[19px] font-semibold">Withdraw {formatAmount(read.balance)} USDC</h2>
            <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">Everything you have earned is sent to your wallet.</p>
            <TxFlow confirmLabel="Withdraw" steps={[{ label: 'Withdraw your fees', action: encodeCurrentEscrowAction({ kind: 'withdrawFees' }) }]} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); setRefresh((n) => n + 1) }} />
          </>
        ) : null}
      </Modal>
    </main>
  )
}
