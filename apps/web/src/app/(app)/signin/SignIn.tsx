'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { Wordmark, ThemeToggle } from '@/ui/Chrome'

/** Privy runs the email code and wallet connection; this page only opens it and moves on once signed in. */
export function SignIn() {
  const { ready, authenticated, login } = usePrivy()
  const router = useRouter()

  useEffect(() => {
    if (ready && authenticated) router.replace('/app')
  }, [ready, authenticated, router])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" aria-label="Waybill home">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </div>
      <h1 className="text-[26px] leading-tight font-semibold">Sign in to Waybill</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-graphite">
        Use your email and we send a six-digit code, or connect a wallet you already have. Signing in never moves money:
        every payment or release asks you to approve it in your wallet.
      </p>
      <button
        type="button"
        onClick={() => login({ loginMethods: ['email', 'wallet'] })}
        disabled={!ready || authenticated}
        className="mt-6 rounded-md bg-ink px-4 py-3 text-[14px] font-semibold text-sheet disabled:opacity-60"
      >
        {!ready ? 'Loading…' : authenticated ? 'Signed in, opening your deals…' : 'Continue with email or wallet'}
      </button>
      <p className="mt-6 text-[12.5px] text-graphite">
        Business use only · Early access. Just looking at a deal? Public records need no sign-in.
      </p>
    </main>
  )
}
