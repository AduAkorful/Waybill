'use client'

import { useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
import { PublicShell } from '@/ui/PublicShell'

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
    <PublicShell>
    <main className="mx-auto grid max-w-4xl gap-x-12 gap-y-8 px-4 py-10 md:grid-cols-[1fr_1fr] md:px-8 md:py-16">
      <div>
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
      </div>
      <ol className="space-y-4 text-[14px] leading-relaxed md:pt-12">
        {[
          ['Get a wallet', 'Sign in with your email. Waybill creates a wallet for you, or you connect one you already have.'],
          ['Send the address to your buyer', 'They name that wallet as the supplier when they create the deal. The address is not secret.'],
          ['Open the deal link', 'You see the terms, accept them, and are paid part by part as each one is confirmed. Nothing moves until you accept.'],
        ].map(([t, b], i) => (
          <li key={t} className="flex gap-3">
            <span className="mono mt-0.5 text-[13px] text-graphite">{i + 1}</span>
            <span><span className="block font-semibold">{t}</span><span className="text-graphite">{b}</span></span>
          </li>
        ))}
      </ol>
    </main>
    </PublicShell>
  )
}
