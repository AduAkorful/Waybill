'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount, useReconnect } from 'wagmi'
import { WalletDealsProvider } from '@/data/wallet-deals'
import { ChainGate } from '@/ui/NetworkGuard'
import { useReloadOnAccountChange } from '@/components/use-account-sync'
import { RoleShell } from './RoleShell'

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <p role="status" className="text-[14px] text-graphite">
        {children}
      </p>
    </main>
  )
}

/** Signed-in routes render only with a Privy session and an active wallet address; anything else fails closed. */
export function AppGate({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, connectOrCreateWallet } = usePrivy()
  const { address } = useAccount()
  const router = useRouter()
  useReloadOnAccountChange(address)
  const { reconnect } = useReconnect()

  // arriving from a page with its own wallet setup can leave the signed-in session without an account: ask wagmi to
  // reconnect, and if that does not settle, reload once rather than leave the person on a notice
  useEffect(() => {
    try {
      if (address) sessionStorage.removeItem('wb-gate-reload')
    } catch {}
    if (!ready || !authenticated || address) return
    reconnect()
    const t = setTimeout(() => {
      try {
        if (sessionStorage.getItem('wb-gate-reload') === '1') return
        sessionStorage.setItem('wb-gate-reload', '1')
        window.location.reload()
      } catch {}
    }, 6000)
    return () => clearTimeout(t)
  }, [ready, authenticated, address, reconnect])

  useEffect(() => {
    if (!ready || authenticated) return
    // a session can read as signed out for a moment while the wallet library refreshes it, so wait before leaving
    const t = setTimeout(() => router.replace('/signin'), 2500)
    return () => clearTimeout(t)
  }, [ready, authenticated, router])

  if (!ready) return <Notice>Loading…</Notice>
  if (!authenticated) return <Notice>Checking your sign-in…</Notice>
  if (!address) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
        <p role="status" className="text-[14px] text-graphite">
          Preparing your wallet. If this does not finish, connect or create one.
        </p>
        <button
          type="button"
          onClick={() => connectOrCreateWallet()}
          className="self-start rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-sheet"
        >
          Connect or create wallet
        </button>
      </main>
    )
  }
  return (
    <WalletDealsProvider address={address}>
      <RoleShell address={address}>
        <ChainGate key={address}>{children}</ChainGate>
      </RoleShell>
    </WalletDealsProvider>
  )
}
