'use client'

import { useEffect, useRef } from 'react'
import { useAccount, useReconnect } from 'wagmi'
import { useSetActiveWallet, useWallets } from '@/auth'
import { DEV_WALLET_AUTH } from '@/integration/dev-wallet-flag'

type Injected = {
  on?: (event: 'accountsChanged', handler: (accounts: string[]) => void) => void
  removeListener?: (event: 'accountsChanged', handler: (accounts: string[]) => void) => void
}

/**
 * Follows an account switch made inside the wallet app (Rabby, MetaMask) without a sign-out.
 * - Wallet sign-in (dev/fork): the session is the connected wallet, so wagmi's own accountsChanged handling is enough;
 *   we only nudge a reconnect if wagmi has not caught up. Screens keyed on the address (ChainGate) start fresh.
 * - Privy: if the new account is already a wallet on this sign-in, make it the active one; otherwise reload, so the
 *   page asks the person to sign in with it instead of acting for an account the session does not cover.
 */
export function useReloadOnAccountChange(current: string | undefined): void {
  const { address } = useAccount()
  const { reconnect } = useReconnect()
  const { wallets } = useWallets()
  const { setActiveWallet } = useSetActiveWallet()
  const latest = useRef({ address, wallets, setActiveWallet, reconnect })
  latest.current = { address, wallets, setActiveWallet, reconnect }

  useEffect(() => {
    if (!current) return
    const ethereum = (window as unknown as { ethereum?: Injected }).ethereum
    if (!ethereum?.on) return
    const handler = (accounts: string[]) => {
      const next = accounts[0]
      if (!next || next.toLowerCase() === current.toLowerCase()) return
      const l = latest.current
      if (DEV_WALLET_AUTH) {
        // give wagmi a moment to apply the change itself, then make sure it has
        setTimeout(() => {
          if (latest.current.address?.toLowerCase() !== next.toLowerCase()) latest.current.reconnect()
        }, 400)
        return
      }
      const linked = (l.wallets as { address: string }[]).find((w) => w.address.toLowerCase() === next.toLowerCase())
      if (linked) void (l.setActiveWallet as (w: unknown) => Promise<void>)(linked)
      else window.location.reload()
    }
    ethereum.on('accountsChanged', handler)
    return () => ethereum.removeListener?.('accountsChanged', handler)
  }, [current])
}
