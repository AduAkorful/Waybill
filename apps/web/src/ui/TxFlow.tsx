'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { explorerBase } from '@/integration/network'
import { ExplorerLink } from '@/ui/ExplorerLink'
import { useAccount, usePublicClient } from 'wagmi'
import type { Hex, PublicClient } from 'viem'
import { useWaybillTransaction } from '@/components/use-waybill-transaction'
import type { EncodedWalletAction } from '@/integration/escrow'
import { getBrowserNetwork } from '@/integration/network'
import { waitForActionReceipt } from '@/integration/transactions'
import { shortHash } from '@/view/format'
import { rememberReceipt } from './receipts'

export interface TxStep {
  /** Plain words for what this signature does */
  label: string
  /** The fixed, already-encoded action the wallet will be asked to sign */
  action: EncodedWalletAction
  /** Reads the chain: true when this step's effect has already happened (for example the relayer sent it), so it is not signed */
  alreadyDone?: (client: PublicClient) => Promise<boolean>
  /** Shown instead of a signature when alreadyDone is true */
  doneNote?: string
}

type Tone = 'held' | 'hold' | 'refunded' | 'released'
const TONE: Record<Tone, string> = {
  held: 'bg-held text-sheet',
  hold: 'bg-hold text-sheet',
  refunded: 'bg-refunded text-sheet',
  released: 'bg-released text-sheet',
}

/**
 * One money action as one or more real wallet signatures: ready, waiting for the wallet, sent, confirmed.
 * A hash is never shown as success. A rejection is a normal, retryable outcome. If the network cannot say what
 * happened, the flow says so and offers to look again; it never offers to send the same step a second time.
 */
export function TxFlow({
  steps,
  confirmLabel,
  tone = 'held',
  onDone,
  onCancel,
}: {
  steps: TxStep[]
  confirmLabel: string
  tone?: Tone
  /** Called once, after the last step is confirmed, with every hash in order */
  onDone: (hashes: Hex[]) => void
  onCancel: () => void
}) {
  const tx = useWaybillTransaction()
  const publicClient = usePublicClient()
  const explorer = explorerBase()
  const [index, setIndex] = useState(0)
  const [hashes, setHashes] = useState<Hex[]>([])
  const [recheck, setRecheck] = useState<'idle' | 'checking' | 'still-unknown'>('idle')
  const [confirmedUnknown, setConfirmedUnknown] = useState(false)
  const [slowWallet, setSlowWallet] = useState(false)
  const { address } = useAccount()
  const [copied, setCopied] = useState(false)
  // between the click and the wallet opening, the network is checked first; say so instead of a faded button
  const [pressed, setPressed] = useState(false)
  // a button that has just appeared ignores clicks for a moment, so a double click on the one before cannot reach the wallet
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    setArmed(false)
    const timer = setTimeout(() => setArmed(true), 600)
    return () => clearTimeout(timer)
  }, [index])
  const done = useRef(false)
  const step = steps[index]!
  // the chain is read again before a step is offered: if someone else already did it, there is nothing to sign
  const [skipped, setSkipped] = useState(false)
  // once this person's own wallet is open (or their transaction is out), the "already done" check stands down: if it
  // flipped now the dialog would close and their transaction's outcome would never be shown
  const walletBusy = useRef(false)
  walletBusy.current = !['idle', 'error'].includes(tx.state.status)
  const checkDone = useCallback(async (): Promise<boolean> => {
    if (!step.alreadyDone || !publicClient) return false
    try {
      return await step.alreadyDone(publicClient as PublicClient)
    } catch {
      return false
    }
  }, [step, publicClient])
  useEffect(() => {
    setSkipped(false)
    if (!step.alreadyDone) return
    let live = true
    let tries = 0
    const look = async () => {
      if (!live || walletBusy.current) return
      if (await checkDone()) {
        if (live && !walletBusy.current) setSkipped(true)
        return
      }
      if (++tries < 6 && live) timer = setTimeout(look, 1500)
    }
    let timer = setTimeout(look, 0)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, publicClient])
  useEffect(() => {
    if (!skipped || done.current) return
    const timer = setTimeout(() => {
      if (done.current || walletBusy.current) return
      done.current = true
      onDone(hashes)
    }, 2500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipped])
  // a dialog drawn again while its transaction is still confirming carries on from the hash, not from the idle button
  useEffect(() => {
    tx.resume(step.action)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tx.resume])
  const { state } = tx
  // once the wallet answers (sent, rejected, failed), the "waiting for your wallet" note must not linger
  useEffect(() => {
    if (state.status !== 'idle') setPressed(false)
  }, [state.status])

  const advance = useCallback(
    (hash: Hex) => {
      const all = [...hashes, hash]
      setHashes(all)
      if (index < steps.length - 1) {
        setIndex(index + 1)
        setConfirmedUnknown(false)
        setRecheck('idle')
        tx.reset()
      } else if (!done.current) {
        done.current = true
        onDone(all)
      }
    },
    [hashes, index, steps.length, onDone, tx],
  )

  // A confirmed step moves on after a moment so the confirmation can be read.
  useEffect(() => {
    if (state.status !== 'success') return
    const hash = state.hash
    rememberReceipt(step.label, hash)
    const timer = setTimeout(() => advance(hash), 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  // A wallet window that was closed without an answer never reports back; say so after a minute.
  useEffect(() => {
    setSlowWallet(false)
    if (state.status !== 'signing') return
    const timer = setTimeout(() => setSlowWallet(true), 60_000)
    return () => clearTimeout(timer)
  }, [state.status])

  async function lookAgain(hash: Hex) {
    if (!publicClient) return
    setRecheck('checking')
    const result = await waitForActionReceipt(publicClient, hash)
    if (result.status === 'success') {
      rememberReceipt(step.label, hash)
      setConfirmedUnknown(true)
      setRecheck('idle')
      advance(hash)
    } else setRecheck('still-unknown')
  }

  const link = (hash: Hex) => (
    <ExplorerLink className="underline" href={`${explorer}/tx/${hash}`}>
      {shortHash(hash)} ↗
    </ExplorerLink>
  )

  return (
    <div>
      {steps.length > 1 ? (
        <ol className="mb-4 flex gap-2 text-[12px]">
          {steps.map((s, k) => (
            <li
              key={s.label}
              className={`flex-1 rounded-md border px-2.5 py-1.5 ${k < index ? 'border-released/40 text-released' : k === index ? 'border-ink/60' : 'border-rule text-graphite'}`}
            >
              <span className="mono mr-1">{k + 1}</span>
              {k < index || (k === index && skipped) ? '✓ ' : ''}
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}

      {skipped ? (
        <div role="status" data-step-already-done className="flex items-start gap-3 rounded-md border border-rule bg-paper px-3.5 py-3">
          <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-released" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">Already done</p>
            <p className="text-[12.5px] text-graphite">{step.doneNote ?? 'The chain already shows this step. Nothing to sign.'}</p>
          </div>
        </div>
      ) : null}

      {!skipped && (state.status === 'idle' || state.status === 'error') ? (
        <>
          {state.status === 'error' ? (
            <p role="alert" className="mb-2 text-[13px] text-hold">
              {state.error.code === 'user_rejected'
                ? 'You declined it in your wallet. Nothing was sent. You can try again.'
                : `${state.error.message.replace(/\.+$/, '')}. Nothing was sent${state.error.code === 'rpc_error' ? '; try again in a moment.' : '.'}`}
            </p>
          ) : null}
          {state.status === 'error' && state.error.code === 'no_gas' && address ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(address).then(() => setCopied(true)).catch(() => {})
              }}
              className="mb-2 w-full rounded-md border border-rule py-2.5 text-[13.5px] font-semibold hover:bg-sheet"
            >
              {copied ? 'Address copied' : 'Copy my wallet address'}
            </button>
          ) : null}
          <button
            onClick={() => {
              setPressed(true)
              void checkDone()
                .then((already) => (already ? setSkipped(true) : tx.execute(step.action)))
                .finally(() => setPressed(false))
            }}
            disabled={!tx.ready || !armed || pressed}
            aria-busy={pressed}
            className={`w-full rounded-md py-3 text-[14.5px] font-semibold disabled:opacity-60 ${TONE[tone]}`}
          >
            {pressed ? 'Waiting for your wallet…' : steps.length > 1 ? step.label : confirmLabel}
          </button>
          {pressed ? (
            <p role="status" className="mt-1.5 text-[12.5px] text-graphite">
              Waiting for your wallet… Checking the action with Arc first, then your wallet asks you to approve.
            </p>
          ) : null}
          <button type="button" onClick={onCancel} className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-rule text-[13.5px] font-semibold text-ink hover:bg-paper">
            Cancel
          </button>
        </>
      ) : null}

      {state.status === 'signing' ? (
        <div role="status" className="rounded-md border border-rule bg-paper px-3.5 py-3 text-[14px]">
          <p>{slowWallet ? 'Still waiting for your wallet. If you closed its window, stop waiting and try again.' : 'Waiting for your wallet… Approve it there to continue.'}</p>
          <p className="mt-1 text-[12.5px] text-graphite">
            Nothing happens until you approve. If the wallet window closed or never appeared, you can stop waiting and try again.
          </p>
          <button onClick={tx.reset} className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-semibold hover:bg-sheet">
            Stop waiting
          </button>
        </div>
      ) : null}

      {state.status === 'confirming' || state.status === 'success' ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-rule bg-paper px-3.5 py-3">
          <span
            aria-hidden
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${state.status === 'success' ? 'bg-released' : 'animate-pulse bg-held ring-4 ring-held/20'}`}
          />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">{state.status === 'success' ? 'Confirmed' : 'Confirming on Arc…'}</p>
            <p className="text-[12.5px] text-graphite">
              {state.status === 'success' ? 'The network accepted it.' : "Sent. Usually a few seconds. Don't send it again."}
            </p>
            <p className="mono mt-1 truncate text-[12px] text-graphite">{link(state.hash)}</p>
          </div>
        </div>
      ) : null}

      {state.status === 'reverted' ? (
        <div role="alert" className="rounded-md border border-hold/50 bg-paper px-3.5 py-3">
          <p className="text-[14px] font-semibold">The network rejected it</p>
          <p className="text-[12.5px] text-graphite">It was included but did not take effect, so nothing moved. {link(state.hash)}</p>
          <button onClick={tx.reset} className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-semibold hover:bg-sheet">
            Back
          </button>
        </div>
      ) : null}

      {state.status === 'unknown' && !confirmedUnknown ? (
        <div role="alert" className="rounded-md border border-hold/50 bg-paper px-3.5 py-3">
          <p className="text-[14px] font-semibold">We can't tell yet whether it went through</p>
          <p className="text-[12.5px] text-graphite">
            It was sent but the network has not confirmed it. Do not send it again. {explorer ? 'Look at it on the explorer:' : 'Its transaction hash is'} {link(state.hash)}
          </p>
          {recheck === 'still-unknown' ? <p className="mt-1 text-[12.5px] text-hold">Still not confirmed.</p> : null}
          <button
            onClick={() => void lookAgain(state.hash)}
            disabled={recheck === 'checking'}
            className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-semibold hover:bg-sheet disabled:opacity-60"
          >
            {recheck === 'checking' ? 'Checking…' : 'Check again'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
