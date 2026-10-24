'use client'

import { Why } from '@/ui/Why'
import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { encodeCapsAction, readPendingCaps, type CapsAction, type PendingCaps } from '@/integration/operator-actions'
import { getReadClient } from '@/integration/read-client'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { parseAmount } from '@/view/builder'
import { capsNote, lowerCapsProblem, raiseCapsProblem } from '@/view/caps'
import { formatAmount, formatDateTime } from '@/view/format'
import type { OperatorSummary } from '@/view/operator'
import { PauserOnly } from './PauserOnly'

const input = 'mt-1.5 w-full rounded-md border border-rule bg-paper px-3 py-2.5 text-[14px] mono focus:border-held'

const TITLES: Record<CapsAction['kind'], string> = {
  lowerCaps: 'Lower the deal limits now',
  scheduleRaiseCaps: 'Schedule higher deal limits',
  executeRaiseCaps: 'Apply the higher deal limits',
}

type Pending = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; pending: PendingCaps | 'unsupported' }

/**
 * The early-access limits, for the pauser. Lowering applies at once and cancels any scheduled raise; a raise is
 * scheduled first and can be applied only after the escrow's 48-hour delay, so it is public before it counts. Limits
 * are checked only when a deal is created or funded: money already held is never touched.
 */
export function CapsCard({ summary: s, onChanged }: { summary: OperatorSummary; onChanged: () => void }) {
  const { address } = useAccount()
  const isPauser = !!address && address.toLowerCase() === s.chain.pauser.toLowerCase()
  const current = { maxDealAmount: s.chain.maxDealAmount, maxLocked: s.chain.maxLocked }
  const [pending, setPending] = useState<Pending>({ kind: 'loading' })
  const [reload, setReload] = useState(0)
  const [dealText, setDealText] = useState('')
  const [lockedText, setLockedText] = useState('')
  const [action, setAction] = useState<CapsAction | null>(null)

  useEffect(() => {
    let cancelled = false
    readPendingCaps(getReadClient())
      .then((p) => !cancelled && setPending({ kind: 'ready', pending: p }))
      .catch((e) => !cancelled && setPending({ kind: 'error', message: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
    }
  }, [reload, s])

  const deal = parseAmount(dealText)
  const locked = parseAmount(lockedText)
  const next = deal !== null && locked !== null ? { maxDealAmount: deal, maxLocked: locked } : null
  const lowerProblem = next ? lowerCapsProblem(current, next) : null
  const raiseProblem = next ? raiseCapsProblem(current, next) : null
  const note = next ? capsNote(next) : null
  const scheduled = pending.kind === 'ready' && pending.pending !== 'unsupported' ? pending.pending : null
  // browser time only decides whether the button is offered; the contract checks the real block time
  const raiseReady = scheduled !== null && BigInt(Math.floor(Date.now() / 1000)) >= scheduled.eta

  return (
    <section aria-label="Deal limits" className="mt-8 rounded-md border border-rule bg-sheet p-4">
      <p className="label">Deal limits</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-[14px] sm:grid-cols-[auto_1fr]">
        <dt className="text-graphite">Largest single deal</dt>
        <dd className="mono">{formatAmount(current.maxDealAmount)} USDC</dd>
        <dt className="text-graphite">Most held at once</dt>
        <dd className="mono">{formatAmount(current.maxLocked)} USDC <span className="text-graphite">(held now {formatAmount(s.chain.currentLocked)})</span></dd>
      </dl>
      <Why>
        These limits are checked only when a deal is created or funded; deals already funded are never affected. Lowering applies at once and cancels any scheduled raise. A raise is scheduled first and can be applied only after 48 hours, so anyone can see it coming.
      </Why>

      {pending.kind === 'loading' ? <p role="status" className="mt-2 text-[13px] text-graphite">Reading any scheduled raise…</p> : null}
      {pending.kind === 'error' ? <p role="alert" className="mt-2 text-[13px] text-hold">The scheduled raise could not be read: {pending.message}</p> : null}
      {pending.kind === 'ready' && pending.pending === 'unsupported' ? (
        <p className="mt-2 text-[13px] text-graphite">This escrow was deployed before the limits could change, so they are fixed for its life.</p>
      ) : null}
      {scheduled ? (
        <div className="mt-3 rounded-md border border-rule bg-paper px-3 py-2.5 text-[13px]">
          <p>
            Raise scheduled to <span className="mono">{formatAmount(scheduled.maxDealAmount)}</span> per deal and <span className="mono">{formatAmount(scheduled.maxLocked)}</span> held at once.
          </p>
          <p className="text-graphite">{raiseReady ? `The delay ended ${formatDateTime(scheduled.eta)}; it can be applied now.` : `Can be applied from ${formatDateTime(scheduled.eta)}.`}</p>
          {isPauser ? (
            <button type="button" disabled={!raiseReady} onClick={() => setAction({ kind: 'executeRaiseCaps' })} className="mt-2 rounded-md bg-held px-3 py-1.5 text-[12.5px] font-semibold text-sheet disabled:opacity-40">
              {raiseReady ? 'Apply the raise' : 'Waiting for the delay'}
            </button>
          ) : null}
        </div>
      ) : null}

      {pending.kind === 'ready' && pending.pending !== 'unsupported' ? (
        isPauser ? (
          <form className="mt-4 max-w-lg" onSubmit={(e) => e.preventDefault()}>
            <label className="label block" htmlFor="cap-deal">New largest single deal, USDC</label>
            <input id="cap-deal" className={input} inputMode="decimal" value={dealText} onChange={(e) => setDealText(e.target.value)} placeholder={formatAmount(current.maxDealAmount).replace(/,/g, '')} />
            <label className="label mt-3 block" htmlFor="cap-locked">New most held at once, USDC</label>
            <input id="cap-locked" className={input} inputMode="decimal" value={lockedText} onChange={(e) => setLockedText(e.target.value)} placeholder={formatAmount(current.maxLocked).replace(/,/g, '')} />
            {(dealText || lockedText) && !next ? <p role="alert" className="mt-2 text-[12.5px] text-hold">Enter both limits as USDC amounts, up to 6 decimals.</p> : null}
            {note ? <p className="mt-2 text-[12.5px] text-graphite">{note}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={!next || lowerProblem !== null} onClick={() => next && setAction({ kind: 'lowerCaps', ...next })} className="rounded-md bg-hold px-4 py-2.5 text-[14px] font-semibold text-sheet disabled:opacity-40">
                Lower now
              </button>
              <button type="button" disabled={!next || raiseProblem !== null} onClick={() => next && setAction({ kind: 'scheduleRaiseCaps', ...next })} className="rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-paper disabled:opacity-40">
                Schedule raise (48 h)
              </button>
            </div>
            {next && lowerProblem && raiseProblem ? <p className="mt-2 text-[12.5px] text-graphite">{lowerProblem}</p> : null}
          </form>
        ) : (
          <PauserOnly pauser={s.chain.pauser} address={address} what="change the limits" link={false} />
        )
      ) : null}

      <Modal open={action !== null} onClose={() => setAction(null)} label={action ? TITLES[action.kind] : 'Deal limits'}>
        {action ? (
          <>
            <h2 className="text-[19px] font-semibold">{TITLES[action.kind]}</h2>
            <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
              {action.kind === 'executeRaiseCaps'
                ? 'The scheduled limits take effect now.'
                : `Largest single deal ${formatAmount(action.maxDealAmount)} USDC (now ${formatAmount(current.maxDealAmount)}); most held at once ${formatAmount(action.maxLocked)} USDC (now ${formatAmount(current.maxLocked)}). ${
                    action.kind === 'lowerCaps' ? 'Takes effect at once and cancels any scheduled raise.' : 'Can be applied after 48 hours.'
                  }`}
            </p>
            <TxFlow
              confirmLabel={TITLES[action.kind]}
              tone={action.kind === 'lowerCaps' ? 'hold' : 'held'}
              steps={[{ label: TITLES[action.kind], action: encodeCapsAction(action) }]}
              onCancel={() => setAction(null)}
              onDone={() => {
                setAction(null)
                setDealText('')
                setLockedText('')
                setReload((n) => n + 1)
                onChanged()
              }}
            />
          </>
        ) : null}
      </Modal>
    </section>
  )
}
