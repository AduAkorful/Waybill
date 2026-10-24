'use client'

import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { encodeEscrowAction, encodeUsdcApproval, readUsdcAllowance, readUsdcBalance } from '@/integration/escrow'
import { balanceReadiness } from '@/view/readiness'
import { LineItems } from '@/ui/Sheet'
import { TxFlow, type TxStep } from '@/ui/TxFlow'
import { fundingTotal } from '@/view/derive'
import { formatAmount } from '@/view/format'
import type { DealView } from '@/view/types'

type Allowance = { status: 'checking' } | { status: 'error'; message: string } | { status: 'ready'; enough: boolean; balance: bigint }

/** Funding is up to two real signatures: allow the escrow to take the deposit (only if it cannot already), then fund. */
export function FundDialog({ deal, owner, onCancel, onDone }: { deal: DealView; owner: `0x${string}`; onCancel: () => void; onDone: () => void }) {
  const client = usePublicClient()
  const total = fundingTotal(deal)
  const [allowance, setAllowance] = useState<Allowance>({ status: 'checking' })

  useEffect(() => {
    if (!client) return setAllowance({ status: 'error', message: 'No network connection to Arc' })
    let cancelled = false
    Promise.all([readUsdcAllowance(client, owner), readUsdcBalance(client, owner)])
      .then(([a, balance]) => !cancelled && setAllowance({ status: 'ready', enough: a >= total, balance }))
      .catch((e) => !cancelled && setAllowance({ status: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
    }
  }, [client, owner, total])

  const steps: TxStep[] =
    allowance.status === 'ready'
      ? [
          ...(allowance.enough ? [] : [{ label: `Allow the escrow to take ${formatAmount(total)} USDC`, action: encodeUsdcApproval(total) }]),
          { label: 'Fund the deal', action: encodeEscrowAction({ kind: 'fund', dealId: deal.id }) },
        ]
      : []

  const feeNote =
    deal.feePayer === 'buyer' ? 'Returned with any part that is refunded' : deal.feePayer === 'supplier' ? 'Taken from the supplier at payout' : 'Shared with the supplier'
  return (
    <>
      <p className="label">Deal {String(deal.id)} · lock the money</p>
      <h2 className="mt-1 text-[19px] font-semibold">Fund this deal</h2>
      <div className="mt-4">
        <LineItems
          items={[
            { label: 'Deal total', amount: deal.totalAmount, note: `Paid to the supplier in ${deal.tranches.length} ${deal.tranches.length === 1 ? 'part' : 'parts'}` },
            { label: `Waybill fee, ${deal.feeBps / 100}%`, amount: deal.prepaidFee, note: feeNote },
            { label: 'Arbiter fee', amount: deal.arbiterFee, note: 'Paid only if a dispute is decided in time' },
          ]}
          total={total}
          totalLabel="You lock"
        />
      </div>
      <p className="mt-3 mb-4 text-[12.5px] text-graphite">On Arc. Once sent, Waybill can&apos;t reverse it; only the deal&apos;s rules can move this money.</p>
      {allowance.status === 'checking' ? <p role="status" className="text-[13px] text-graphite">Checking your USDC balance…</p> : null}
      {allowance.status === 'error' ? <p role="alert" className="text-[13px] text-hold">Could not check your USDC balance and allowance, so nothing was offered to sign: {allowance.message}</p> : null}
      {allowance.status === 'ready' && !balanceReadiness(allowance.balance, total, formatAmount).ok ? (
        <>
          <p role="alert" className="text-[13px] text-hold">
            {(balanceReadiness(allowance.balance, total, formatAmount) as { reason: string }).reason} Add USDC to this wallet, then open this again. Nothing was sent.
          </p>
          <button onClick={onCancel} className="mt-1 w-full py-2 text-[13px] text-graphite hover:text-ink">Close</button>
        </>
      ) : null}
      {allowance.status === 'ready' && balanceReadiness(allowance.balance, total, formatAmount).ok ? <TxFlow confirmLabel="Fund" steps={steps} onCancel={onCancel} onDone={() => onDone()} /> : null}
    </>
  )
}
