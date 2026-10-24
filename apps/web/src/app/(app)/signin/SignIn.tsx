'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useLogin, useLoginWithEmail, usePrivy } from '@privy-io/react-auth'
import { useAccount, useSwitchChain } from 'wagmi'
import { getBrowserNetwork } from '@/integration/network'
import { ThemeToggle, Wordmark } from '@/ui/Chrome'

const CODE_LENGTH = 6
const RESEND_SECONDS = 30
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Privy runs the email code and the wallet connection; this page is only the face of it.
 * Nothing here moves money: signing in asks for no signature on a deal.
 */
export function SignIn() {
  const router = useRouter()
  const { ready, authenticated } = usePrivy()
  const { address, chainId } = useAccount()
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain()
  const expected = getBrowserNetwork()
  const { login } = useLogin()
  const { sendCode, loginWithCode, state } = useLoginWithEmail()

  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState('')
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [wait, setWait] = useState(0)
  const [editing, setEditing] = useState(false)
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  const awaitingCode = !editing && (state.status === 'awaiting-code-input' || state.status === 'submitting-code' || (state.status === 'error' && wait > 0))
  const wrongNetwork = ready && authenticated && !!address && chainId !== expected.chainId

  useEffect(() => {
    if (ready && authenticated && address && !wrongNetwork) router.replace('/app')
  }, [ready, authenticated, address, wrongNetwork, router])

  useEffect(() => {
    if (wait <= 0) return
    const h = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(h)
  }, [wait])

  const send = async () => {
    if (!EMAIL_PATTERN.test(email.trim())) return setEmailErr("That doesn't look like an email address.")
    setEmailErr('')
    setDigits(Array(CODE_LENGTH).fill(''))
    try {
      await sendCode({ email: email.trim() })
      setEditing(false)
      setWait(RESEND_SECONDS)
      setTimeout(() => boxes.current[0]?.focus(), 50)
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : 'The code could not be sent.')
    }
  }

  const verify = async (code = digits.join('')) => {
    if (code.length < CODE_LENGTH) return
    try {
      await loginWithCode({ code })
    } catch {
      // the hook reports the failure through state.error, shown below
    }
  }

  const setDigit = (i: number, v: string) => {
    const only = v.replace(/\D/g, '')
    if (only.length > 1) {
      const next = only.slice(0, CODE_LENGTH).split('')
      const filled = [...next, ...Array(CODE_LENGTH - next.length).fill('')]
      setDigits(filled)
      boxes.current[Math.min(next.length, CODE_LENGTH - 1)]?.focus()
      if (next.length === CODE_LENGTH) void verify(next.join(''))
      return
    }
    const next = [...digits]
    next[i] = only
    setDigits(next)
    if (only && i < CODE_LENGTH - 1) boxes.current[i + 1]?.focus()
    if (only && next.every(Boolean)) void verify(next.join(''))
  }

  const codeErr =
    state.status === 'error' ? "That code didn't work. Check the latest email, or send a new one." : ''

  const heading = wrongNetwork ? 'Switch to Arc' : awaitingCode ? 'Enter the code we sent' : 'Sign in to Waybill'

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-rule bg-sheet lg:block">
        <div className="flex h-full flex-col justify-between p-10">
          <Link href="/">
            <Wordmark />
          </Link>
          <div>
            <p className="max-w-md text-[34px] leading-[1.08] font-semibold tracking-tight">
              Pay a deposit. Release the rest when <span className="marked">someone you trust</span> confirms the goods.
            </p>
            <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-graphite">
              One sign-in for every role. Your role is set per deal, so you can be a buyer on one and an inspector on another.
            </p>
          </div>
          <ol className="max-w-sm space-y-2 text-[13.5px] text-graphite">
            <li><span className="mono mr-2">1</span>The supplier accepts the deal and the buyer locks the money.</li>
            <li><span className="mono mr-2">2</span>A named person confirms each part with a signed statement.</li>
            <li><span className="mono mr-2">3</span>Each part is paid when it is confirmed, or refunded if it is not.</li>
          </ol>
          <p className="text-[12px] text-graphite">Waybill never asks for your seed phrase or private key.</p>
        </div>
      </aside>

      <main className="flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 md:px-8">
          <Link href="/" className="inline-flex min-h-11 items-center lg:invisible">
            <Wordmark />
          </Link>
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 pb-16 md:max-w-md">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{heading}</h1>
          {!wrongNetwork && !awaitingCode ? <p className="mt-1 text-[13.5px] text-graphite lg:hidden">Pay a deposit. Release the rest when someone you trust confirms the goods.</p> : null}

          {wrongNetwork ? (
            <>
              <p className="mt-2 text-[14px] text-graphite">
                Your wallet is on another network. Deals run on Arc ({expected.network}), so we ask it to switch. Nothing is sent and nothing is spent.
              </p>
              <button
                type="button"
                onClick={() => switchChain({ chainId: expected.chainId })}
                disabled={switching}
                className="mt-6 w-full rounded-md bg-held py-3 text-[15px] font-semibold text-sheet disabled:opacity-60"
              >
                {switching ? 'Waiting for your wallet…' : 'Switch to Arc'}
              </button>
              {switchError ? <p role="alert" className="mt-2 text-[12.5px] text-hold">The wallet did not switch: {switchError.message}</p> : null}
            </>
          ) : awaitingCode ? (
            <>
              <p className="mt-2 text-[14px] text-graphite">
                Sent to <span className="font-semibold text-ink">{email.trim()}</span>.{' '}
                <button type="button" onClick={() => setEditing(true)} className="underline decoration-rule underline-offset-2">
                  Change
                </button>
              </p>
              <div className="mt-6 flex gap-2" role="group" aria-label="Six-digit code">
                {digits.map((v, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      boxes.current[i] = el
                    }}
                    value={v}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label={`Digit ${i + 1}`}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !digits[i] && i > 0) boxes.current[i - 1]?.focus()
                      if (e.key === 'Enter') void verify()
                    }}
                    className={`mono h-14 w-full min-w-0 rounded-md border bg-sheet text-center text-[22px] focus:border-held ${codeErr ? 'border-hold' : 'border-rule'}`}
                  />
                ))}
              </div>
              {codeErr ? (
                <p role="alert" className="mt-2 text-[12.5px] text-hold">
                  {codeErr}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void verify()}
                disabled={state.status === 'submitting-code'}
                className="mt-4 w-full rounded-md bg-ink py-3 text-[15px] font-semibold text-paper disabled:opacity-60"
              >
                {state.status === 'submitting-code' ? 'Checking…' : 'Continue'}
              </button>
              <div className="mt-4 text-[12.5px] text-graphite">
                {wait > 0 ? (
                  <span>Send a new code in {wait} s</span>
                ) : (
                  <button type="button" onClick={() => void send()} className="font-semibold text-ink underline decoration-rule underline-offset-2">
                    Send a new code
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-[14px] text-graphite">Use your work email. We&apos;ll send a six-digit code; there&apos;s no password.</p>
              <label className="label mt-8 block" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setEmailErr('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
                aria-invalid={!!emailErr}
                aria-describedby={emailErr ? 'email-err' : undefined}
                className={`mt-1.5 w-full rounded-md border bg-sheet px-3.5 py-3 text-[15px] focus:border-held ${emailErr ? 'border-hold' : 'border-rule'}`}
              />
              {emailErr ? (
                <p id="email-err" role="alert" className="mt-1.5 text-[12.5px] text-hold">
                  {emailErr}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void send()}
                disabled={!ready || state.status === 'sending-code'}
                className="mt-4 w-full rounded-md bg-ink py-3 text-[15px] font-semibold text-paper disabled:opacity-60"
              >
                {!ready ? 'Loading…' : state.status === 'sending-code' ? 'Sending…' : 'Send code'}
              </button>
              <div className="my-6 flex items-center gap-3 text-[12px] text-graphite">
                <span className="h-px flex-1 bg-rule" /> or <span className="h-px flex-1 bg-rule" />
              </div>
              <button
                type="button"
                onClick={() => login({ loginMethods: ['wallet'] })}
                disabled={!ready}
                className="w-full rounded-md border border-rule py-3 text-[14.5px] font-semibold hover:bg-sheet disabled:opacity-60"
              >
                Connect your own wallet
              </button>
              <p className="mt-6 text-[12.5px] leading-relaxed text-graphite">
                Signing in with email creates a wallet for you. Your signature is only used when you choose to sign.
              </p>
              <p className="mt-4 text-[12.5px] text-graphite">Suppliers don&apos;t need an account. Open the link your buyer sent you.</p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
