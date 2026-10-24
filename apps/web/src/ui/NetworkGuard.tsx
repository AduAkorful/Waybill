'use client'

import type { ReactNode } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { getBrowserNetwork } from '@/integration/network'

/**
 * Renders its children only when a wallet is connected on the configured Arc network. Anything else fails
 * closed: no signing surface is shown on the wrong chain, and the way back is one labelled button.
 */
export function NetworkGuard({ children, signedOut }: { children: ReactNode; signedOut: ReactNode }) {
  const expected = getBrowserNetwork()
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()

  if (!isConnected) return <>{signedOut}</>
  if (chainId !== expected.chainId) {
    return (
      <div role="alert" className="rounded-md border border-hold/50 bg-paper px-3.5 py-3">
        <p className="text-[14px] font-semibold">Your wallet is on a different network</p>
        <p className="mt-0.5 text-[12.5px] text-graphite">
          Waybill runs on Arc ({expected.network}, chain {expected.chainId}). Nothing can be signed until the wallet is on it.
        </p>
        <button
          onClick={() => switchChain({ chainId: expected.chainId })}
          disabled={isPending}
          className="mt-2 rounded-md bg-ink px-3 py-1.5 text-[13px] font-semibold text-sheet disabled:opacity-60"
        >
          {isPending ? 'Waiting for your wallet…' : 'Switch to Arc'}
        </button>
        {error ? <p className="mt-1.5 text-[12.5px] text-hold">The wallet did not switch: {error.message}</p> : null}
      </div>
    )
  }
  return <>{children}</>
}
