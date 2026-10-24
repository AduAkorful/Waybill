'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePublicClient } from 'wagmi'
import type { Hex } from 'viem'
import { useWaybillTransaction } from '@/components/use-waybill-transaction'
import type { EncodedWalletAction } from '@/integration/escrow'
import { getBrowserNetwork } from '@/integration/network'
import { waitForActionReceipt } from '@/integration/transactions'
import { shortHash } from '@/view/format'

export interface TxStep {
  /** Plain words for what this signature does */
  label: string
  /** The fixed, already-encoded action the wallet will be asked to sign */
  action: EncodedWalletAction
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
  const explorer = getBrowserNetwork().explorerUrl.replace(/\/+$/, '')
  const [index, setIndex] = useState(0)
  const [hashes, setHashes] = useState<Hex[]>([])
  const [recheck, setRecheck] = useState<'idle' | 'checking' | 'still-unknown'>('idle')
  const [confirmedUnknown, setConfirmedUnknown] = useState(false)
  const done = useRef(false)
  const step = steps[index]!
  const { state } = tx

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
    const timer = setTimeout(() => advance(hash), 900)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  async function lookAgain(hash: Hex) {
    if (!publicClient) return
    setRecheck('checking')
    const result = await waitForActionReceipt(publicClient, hash)
    if (result.status === 'success') {
      setConfirmedUnknown(true)
      setRecheck('idle')
      advance(hash)
    } else setRecheck('still-unknown')
  }

  const link = (hash: Hex) => (
    <a className="underline" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">
      {shortHash(hash)} ↗
    </a>
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
              {k < index ? '✓ ' : ''}
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}

      {state.status === 'idle' || state.status === 'error' ? (
        <>
          {state.status === 'error' ? (
            <p role="alert" className="mb-2 text-[13px] text-hold">
              {state.error.code === 'user_rejected'
                ? 'You declined it in your wallet. Nothing was sent. You can try again.'
                : `${state.error.message}. Nothing was sent.`}
            </p>
          ) : null}
          <button
            onClick={() => void tx.execute(step.action)}
            disabled={!tx.ready}
            className={`w-full rounded-md py-3 text-[14.5px] font-semibold disabled:opacity-60 ${TONE[tone]}`}
          >
            {steps.length > 1 ? step.label : confirmLabel}
          </button>
          <button onClick={onCancel} className="mt-1 w-full py-2 text-[13px] text-graphite hover:text-ink">
            Cancel
          </button>
        </>
      ) : null}

      {state.status === 'signing' ? (
        <p role="status" className="rounded-md border border-rule bg-paper px-3.5 py-3 text-[14px]">
          Check your wallet and approve to continue.
        </p>
      ) : null}

      {state.status === 'confirming' || state.status === 'success' ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-rule bg-paper px-3.5 py-3">
          <span
            aria-hidden
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${state.status === 'success' ? 'bg-released' : 'animate-pulse bg-held ring-4 ring-held/20'}`}
          />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">{state.status === 'success' ? 'Confirmed' : 'Sent · waiting for the network'}</p>
            <p className="text-[12.5px] text-graphite">
              {state.status === 'success' ? 'The network accepted it.' : "Usually a few seconds. Don't send it again."}
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
            It was sent but the network has not confirmed it. Do not send it again. Look at it on the explorer: {link(state.hash)}
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
