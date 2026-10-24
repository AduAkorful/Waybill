'use client'

import Link from 'next/link'
import { useState } from 'react'
import { verifyEmailToken } from '@/integration/contacts'

/** The link in the email lands here. Confirming is a button press, so a mail scanner that opens links cannot confirm for you. */
export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<{ kind: 'ready' } | { kind: 'working' } | { kind: 'done' } | { kind: 'error'; message: string }>({ kind: 'ready' })
  if (!token) return <p role="alert" className="text-[14px] text-hold">This link is incomplete. Open it again from the email.</p>
  return (
    <div>
      <h1 className="text-2xl font-semibold">Confirm your email</h1>
      {state.kind === 'done' ? (
        <>
          <p role="status" className="mt-3 text-[14.5px] leading-relaxed">Your email is confirmed. Waybill will send updates for your wallet to this address. You can turn them off in your settings.</p>
          <Link href="/app/settings" className="mt-5 inline-block rounded-md border border-rule px-4 py-2 text-[14px]">Open settings</Link>
        </>
      ) : (
        <>
          <p className="mt-3 text-[14.5px] leading-relaxed text-graphite">Press the button to let Waybill send updates for your wallet to this address.</p>
          {state.kind === 'error' ? <p role="alert" className="mt-3 text-[14px] text-hold">{state.message}</p> : null}
          <button
            type="button"
            disabled={state.kind === 'working'}
            onClick={async () => {
              setState({ kind: 'working' })
              try {
                await verifyEmailToken(token)
                setState({ kind: 'done' })
              } catch (e) {
                setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
              }
            }}
            className="mt-5 rounded-md bg-held px-5 py-2.5 text-[14px] font-semibold text-sheet disabled:opacity-40"
          >
            {state.kind === 'working' ? 'Confirming…' : 'Confirm my email'}
          </button>
        </>
      )}
    </div>
  )
}
