'use client'

import { useEffect, useState } from 'react'
import { isAddress } from 'viem'
import { useAccount } from 'wagmi'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { getBrowserNetwork } from '@/integration/network'
import { encodeArbiterListAction, type ArbiterListAction } from '@/integration/operator-actions'
import { Modal } from '@/ui/Modal'
import { TxFlow } from '@/ui/TxFlow'
import { parseArbiters, type Arbiter } from '@/view/arbiter'
import { formatAmount, formatDateTime, shortAddress } from '@/view/format'
import { parseAmount } from '@/view/builder'
import type { OperatorSummary } from '@/view/operator'

const input = 'mt-1.5 w-full rounded-md border border-rule bg-paper px-3 py-2.5 text-[14px] outline-none focus:border-held'

const TITLES: Record<ArbiterListAction['kind'], string> = {
  scheduleAddArbiter: 'Schedule adding this arbiter',
  executeAddArbiter: 'Add this arbiter now',
  scheduleRemoveArbiter: 'Schedule removing this arbiter',
  executeRemoveArbiter: 'Remove this arbiter now',
}

/**
 * The approved arbiter list, for the pauser. The list only decides who can be named on a NEW deal; it holds no money
 * and a deal that already exists keeps its arbiter. Every addition or removal is scheduled first and takes effect
 * only after the contract's 48-hour delay.
 */
export function ArbiterListCard({ summary: s, onChanged }: { summary: OperatorSummary; onChanged: () => void }) {
  const { address } = useAccount()
  const isPauser = !!address && address.toLowerCase() === s.chain.pauser.toLowerCase()
  const [list, setList] = useState<Arbiter[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [wallet, setWallet] = useState('')
  const [fee, setFee] = useState('0')
  const [action, setAction] = useState<ArbiterListAction | null>(null)

  useEffect(() => {
    let cancelled = false
    createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, getBrowserNetwork())
      .getArbiters()
      .then((raw) => !cancelled && (setList(parseArbiters(raw)), setError('')))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [reload])

  const feeUnits = parseAmount(fee)
  const target = wallet.trim()
  const canSchedule = isAddress(target, { strict: false }) && feeUnits !== null
  // browser time only decides whether the button is offered; the contract checks the real block time
  const now = BigInt(Math.floor(Date.now() / 1000))

  return (
    <section aria-label="Approved arbiters" className="mt-8 rounded-md border border-rule bg-sheet p-4">
      <p className="label">Approved arbiters</p>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed">
        Only arbiters on this list can be named on a new deal. The list holds no money and changes nothing on deals that already exist. Each addition or removal is scheduled first and can be carried out only after a 48-hour delay.
      </p>
      {error ? <p role="alert" className="mt-2 text-[13px] text-hold">The list could not be read: {error}</p> : null}
      {list === null && !error ? <p role="status" className="mt-2 text-[13px] text-graphite">Reading the list…</p> : null}
      {list ? (
        <ul className="mt-3 grid gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px]">
          {list.length === 0 ? <li className="bg-sheet px-3 py-2.5 text-graphite">No arbiter has ever been on the list.</li> : null}
          {list.map((a) => {
            const addReady = a.pendingAdd !== null && now >= a.pendingAdd.eta
            const removeReady = a.pendingRemove !== null && now >= a.pendingRemove.eta
            return (
              <li key={a.address} className="flex flex-wrap items-center justify-between gap-2 bg-sheet px-3 py-2.5">
                <span>
                  <span className="mono text-[12.5px]">{shortAddress(a.address)}</span>{' '}
                  <span className={a.allowed ? 'font-semibold text-released' : 'text-graphite'}>{a.allowed ? `On the list · fee ${formatAmount(a.fee)} USDC` : 'Not on the list'}</span>
                  {a.pendingAdd ? <span className="block text-[12px] text-graphite">Addition scheduled for {formatDateTime(a.pendingAdd.eta)} UTC · fee {formatAmount(a.pendingAdd.fee)} USDC</span> : null}
                  {a.pendingRemove ? <span className="block text-[12px] text-graphite">Removal scheduled for {formatDateTime(a.pendingRemove.eta)} UTC</span> : null}
                </span>
                {isPauser ? (
                  <span className="flex gap-2">
                    {a.pendingAdd ? (
                      <button type="button" disabled={!addReady} onClick={() => setAction({ kind: 'executeAddArbiter', arbiter: a.address })} className="rounded-md bg-held px-3 py-1.5 text-[12.5px] font-semibold text-sheet disabled:opacity-40">
                        {addReady ? 'Add now' : 'Waiting for the delay'}
                      </button>
                    ) : null}
                    {a.allowed && !a.pendingRemove ? (
                      <button type="button" onClick={() => setAction({ kind: 'scheduleRemoveArbiter', arbiter: a.address })} className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-semibold">Schedule removal</button>
                    ) : null}
                    {a.pendingRemove ? (
                      <button type="button" disabled={!removeReady} onClick={() => setAction({ kind: 'executeRemoveArbiter', arbiter: a.address })} className="rounded-md bg-hold px-3 py-1.5 text-[12.5px] font-semibold text-sheet disabled:opacity-40">
                        {removeReady ? 'Remove now' : 'Waiting for the delay'}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {isPauser ? (
        <form
          className="mt-4 max-w-lg"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSchedule && feeUnits !== null) setAction({ kind: 'scheduleAddArbiter', arbiter: target as `0x${string}`, fee: feeUnits })
          }}
        >
          <label className="label block" htmlFor="new-arbiter">Add an arbiter</label>
          <input id="new-arbiter" className={`${input} mono`} value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x… wallet" spellCheck={false} />
          <label className="label mt-3 block" htmlFor="new-arbiter-fee">Fee they charge per deal, USDC</label>
          <input id="new-arbiter-fee" className={`${input} mono w-40`} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          <button type="submit" disabled={!canSchedule} className="mt-3 rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-paper disabled:opacity-40">Schedule addition</button>
        </form>
      ) : (
        <p className="mt-3 text-[12.5px] text-graphite">Only the pauser wallet <span className="mono">{shortAddress(s.chain.pauser)}</span> can change the list.</p>
      )}

      <Modal open={action !== null} onClose={() => setAction(null)} label={action ? TITLES[action.kind] : 'Arbiter list'}>
        {action ? (
          <>
            <h2 className="text-[19px] font-semibold">{TITLES[action.kind]}</h2>
            <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
              <span className="mono">{shortAddress(action.arbiter)}</span>
              {action.kind === 'scheduleAddArbiter' ? ` will be addable after 48 hours, with a fee of ${formatAmount(action.fee)} USDC per deal.` : action.kind === 'scheduleRemoveArbiter' ? ' will be removable after 48 hours. Deals that already exist keep this arbiter.' : '. The delay has passed.'}
            </p>
            <TxFlow
              confirmLabel="Sign"
              steps={[{ label: TITLES[action.kind], action: encodeArbiterListAction(action) }]}
              onCancel={() => setAction(null)}
              onDone={() => {
                setAction(null)
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
