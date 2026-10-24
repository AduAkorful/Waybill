'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'

/** For a supplier with no wallet: sign in, get one, copy its address to send to the buyer. */
export function Join() {
  const { ready, authenticated, login, logout } = usePrivy()
  const { address } = useAccount()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch {
      setCopied(false)
    }
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" aria-label="Waybill home"><Wordmark /></Link>
        <ThemeToggle />
      </div>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Get a wallet to be paid</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-graphite">
        Sign in with your email and we create a wallet for you, or connect a wallet you already have. Send its address to your buyer so they can name you in the deal. The address is not secret; it only receives money.
      </p>
      {!authenticated ? (
        <button type="button" disabled={!ready} onClick={() => login({ loginMethods: ['email', 'wallet'] })} className="mt-6 rounded-md bg-ink px-4 py-3 text-[14px] font-semibold text-paper disabled:opacity-60">
          {ready ? 'Sign in or connect a wallet' : 'Loading…'}
        </button>
      ) : address ? (
        <div className="mt-6 rounded-md border border-rule bg-sheet p-4">
          <p className="label">Your wallet address</p>
          <p className="mono mt-1 break-all text-[14px]">{address}</p>
          <div className="mt-3 flex gap-2 text-[13px]">
            <button type="button" onClick={() => void copy()} className="rounded-md bg-ink px-3.5 py-2 font-semibold text-paper">{copied ? 'Copied ✓' : 'Copy address'}</button>
            <button type="button" onClick={() => void logout()} className="px-2 py-2 text-graphite underline">Sign out</button>
          </div>
        </div>
      ) : (
        <p role="status" className="mt-6 text-[13px] text-graphite">Preparing your wallet…</p>
      )}
    </main>
  )
}
