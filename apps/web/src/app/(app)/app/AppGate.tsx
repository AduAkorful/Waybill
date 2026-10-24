'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
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

  useEffect(() => {
    if (ready && !authenticated) router.replace('/signin')
  }, [ready, authenticated, router])

  if (!ready) return <Notice>Loading…</Notice>
  if (!authenticated) return <Notice>Taking you to sign in…</Notice>
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
        <ChainGate>{children}</ChainGate>
      </RoleShell>
    </WalletDealsProvider>
  )
}
