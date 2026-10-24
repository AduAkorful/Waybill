'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { usePrivy } from '@/auth'
import { useAccount, useReconnect } from 'wagmi'
import { WalletDealsProvider } from '@/data/wallet-deals'
import { ChainGate } from '@/ui/NetworkGuard'
import { useReloadOnAccountChange } from '@/components/use-account-sync'
import { SiteHeader } from '@/ui/SiteHeader'
import { RoleShell } from './RoleShell'

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SiteHeader signIn="signed-in" />
      <main className="mx-auto w-full max-w-6xl px-4 pt-10 md:px-8">
        <p role="status" className="text-[14px] text-graphite">
          {children}
        </p>
      </main>
    </div>
  )
}

/** A normal, brief wait reads as plain loading; the "connect or create one" fallback appears only if it drags on. */
function PreparingWallet({ onConnect }: { onConnect: () => void }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 5000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="min-h-dvh">
    <SiteHeader signIn="signed-in" />
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-10 md:px-8">
      <p role="status" className="text-[14px] text-graphite">
        {slow ? 'Preparing your wallet. If this does not finish, connect or create one.' : 'Loading…'}
      </p>
      {slow ? (
        <button type="button" onClick={onConnect} className="self-start rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-sheet">
          Connect or create wallet
        </button>
      ) : null}
    </main>
    </div>
  )
}

/** The sign-in service starting: plain loading at first, then a way out to the sign-in page instead of waiting forever. */
function StartingSignIn() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="min-h-dvh">
      <SiteHeader signIn="signed-in" />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-10 md:px-8">
        <p role="status" className="text-[14px] text-graphite">
          {slow ? 'Sign-in is taking longer than usual. You may need to sign in again.' : 'Loading…'}
        </p>
        {slow ? (
          <div className="flex gap-3">
            <Link href="/signin" className="rounded-md bg-ink px-3 py-2 text-[13px] font-semibold text-sheet">Go to sign in</Link>
            <button type="button" onClick={() => window.location.reload()} className="rounded-md border border-rule px-3 py-2 text-[13px] font-semibold">Try again</button>
          </div>
        ) : null}
      </main>
    </div>
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

  if (!ready) return <StartingSignIn />
  if (!authenticated) return <Notice>Checking your sign-in…</Notice>
  if (!address) return <PreparingWallet onConnect={() => connectOrCreateWallet()} />
  return (
    <WalletDealsProvider address={address}>
      <RoleShell address={address}>
        <ChainGate key={address}>{children}</ChainGate>
      </RoleShell>
    </WalletDealsProvider>
  )
}
