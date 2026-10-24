'use client'

import { useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { readEmailSettings, saveEmailSettings, type EmailSettings } from '@/integration/contacts'
import { plainError } from '@/integration/transactions'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { getBrowserNetwork } from '@/integration/network'
import { shortAddress } from '@/view/format'

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] focus:border-held'

type Read = { kind: 'idle' } | { kind: 'working' } | { kind: 'ready'; settings: EmailSettings | null } | { kind: 'error'; message: string }

/**
 * Where Waybill may email this wallet. The address is private, so reading it takes a signature, and it is mailed
 * only after the owner confirms it from a link sent to it.
 */
export default function SettingsPage() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [read, setRead] = useState<Read>({ kind: 'idle' })
  const [email, setEmail] = useState('')
  const [notify, setNotify] = useState(true)
  const [saved, setSaved] = useState<EmailSettings | null>(null)
  const sign = (message: string) => signMessageAsync({ message })
  const [emailOn, setEmailOn] = useState<'checking' | 'on' | 'off' | 'unknown'>('checking')

  // ask the relayer whether email is switched on before anyone is asked to sign
  useEffect(() => {
    let cancelled = false
    try {
      createWaybillApiClient(loadBrowserApiBaseUrl()).getNetwork()
        .then((n) => !cancelled && setEmailOn(n.features?.email ? 'on' : 'off'))
        .catch(() => !cancelled && setEmailOn('unknown'))
    } catch {
      setEmailOn('unknown')
    }
    return () => { cancelled = true }
  }, [])

  // nothing is read until the person asks: reading is a wallet signature
  useEffect(() => setRead({ kind: 'idle' }), [address])

  if (!address) return null
  const load = async () => {
    setRead({ kind: 'working' })
    try {
      const settings = await readEmailSettings({ wallet: address, sign })
      setRead({ kind: 'ready', settings })
      if (settings) {
        setEmail(settings.email)
        setNotify(settings.notificationsEnabled)
      }
    } catch (e) {
      setRead({ kind: 'error', message: plainError(e) })
    }
  }
  const save = async () => {
    setRead({ kind: 'working' })
    try {
      const settings = await saveEmailSettings({ wallet: address, email, notify, sign })
      setSaved(settings)
      setRead({ kind: 'ready', settings })
    } catch (e) {
      setRead({ kind: 'error', message: plainError(e) })
    }
  }

  const current = read.kind === 'ready' ? read.settings : null
  return (
    <main className="mx-auto max-w-xl px-4 pt-6 pb-8 md:px-8 md:pt-10">
      <p className="label">Settings · <span className="mono normal-case">{shortAddress(address)}</span> · {getBrowserNetwork().network}</p>
      <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Email updates</h1>
      <p className="mt-1 text-[13.5px] leading-relaxed text-graphite">
        Get a short email when something needs you on a deal: an invitation, a confirmation to review, a dispute or its decision. Emails name the deal and the part, link back here, and never include commercial detail. Waybill sends nothing until you confirm the address from the link in the first email.
      </p>

      {emailOn === 'off' ? <p role="status" className="mt-6 rounded-md border border-rule bg-sheet px-3.5 py-3 text-[14px]">Email updates are not switched on for this site yet, so there is nothing to set up. You will not be asked to sign anything here.</p> : null}
      {emailOn === 'checking' ? <p role="status" className="mt-6 text-[14px] text-graphite">Checking…</p> : null}
      {read.kind === 'idle' && (emailOn === 'on' || emailOn === 'unknown') ? (
        <button type="button" onClick={() => void load()} className="mt-6 rounded-md border border-rule px-4 py-2.5 text-[14px] font-semibold">Show my email settings</button>
      ) : null}
      {read.kind === 'working' ? <p role="status" className="mt-6 text-[14px] text-graphite">Approve the message in your wallet. This costs nothing.</p> : null}
      {read.kind === 'error' ? (
        <div role="alert" className="mt-6">
          <p className="text-[14px] text-hold">{read.message}</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-[13px] underline">Try again</button>
        </div>
      ) : null}

      {read.kind === 'ready' ? (
        <form className="mt-6" onSubmit={(e) => { e.preventDefault(); void save() }}>
          {current ? (
            <p role="status" className={`mb-4 rounded-md border px-3.5 py-3 text-[13.5px] ${current.verified ? 'border-released/40 bg-released-wash' : 'border-rule bg-sheet'}`}>
              {current.verified ? `${current.email} is confirmed.` : `${current.email} is waiting for confirmation. Open the link we emailed to it${saved && !saved.verified ? ' (it was just sent)' : ''}; nothing is sent until then.`}
            </p>
          ) : null}
          <label className="label block" htmlFor="email">Email address</label>
          <input id="email" type="email" autoComplete="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="mt-4 flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Send me updates for this wallet
          </label>
          <button type="submit" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} className="mt-5 rounded-md bg-held px-4 py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40">
            {current ? 'Save' : 'Save and send a confirmation email'}
          </button>
          <p className="mt-2 text-[12px] text-graphite">This is stored by Waybill, not on the chain, and used only for these updates. Saving needs a free wallet signature.</p>
        </form>
      ) : null}
    </main>
  )
}
