'use client'

import { useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { DEAL_LABELS, parseDealRanges, setDealLabels, type DealLabel } from '@/integration/labels'
import { plainError } from '@/integration/transactions'
import { shortAddress } from '@/view/format'
import type { OperatorSummary } from '@/view/operator'

const input = 'mt-1.5 w-full rounded-md border border-rule bg-paper px-3 py-2.5 text-[14px] focus:border-held'

type Outcome = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; labelled: number; label: DealLabel } | { kind: 'error'; message: string }

/**
 * Lets the pauser wallet mark deals as team, test, self-dealing or third-party, so the volume figures above can be
 * told apart. One wallet signature covers every deal in the request. A label is a note in the index: it changes no
 * deal, moves no money, and can be changed again.
 */
export function LabelCard({ summary: s, onChanged }: { summary: OperatorSummary; onChanged: () => void }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [text, setText] = useState('')
  const [label, setLabel] = useState<DealLabel>('self-dealing')
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  const isPauser = !!address && address.toLowerCase() === s.chain.pauser.toLowerCase()
  const unlabelled = s.index.volume.find((v) => v.label === null)
  const parsed = parseDealRanges(text, s.chain.totalDeals)

  return (
    <section aria-label="Label deals" className="mt-8 rounded-md border border-rule bg-sheet p-4">
      <p className="label">Label deals</p>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed">
        Mark deals as team, test, self-dealing or third-party so the volume above is not mistaken for outside use. A label is a note kept by Waybill: it changes nothing on the deal and moves no money, and you can set it again.
        {unlabelled ? ` ${unlabelled.created.deals} of the deals the index has seen carry no label yet.` : ''}
      </p>
      {isPauser ? (
        <form
          className="mt-3 max-w-lg"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!parsed.ok || !address) return
            setOutcome({ kind: 'working' })
            try {
              const labelled = await setDealLabels({ signer: address, ranges: parsed.ranges, label, sign: (message) => signMessageAsync({ message }) })
              setOutcome({ kind: 'done', labelled, label })
              onChanged()
            } catch (error) {
              setOutcome({ kind: 'error', message: plainError(error) })
            }
          }}
        >
          <label className="label block" htmlFor="label-deals">Deal numbers</label>
          <input id="label-deals" className={`${input} mono`} value={text} onChange={(e) => { setText(e.target.value); setOutcome({ kind: 'idle' }) }} placeholder={`0-${s.chain.totalDeals > 0n ? s.chain.totalDeals - 1n : 0n}`} spellCheck={false} aria-describedby="label-help" />
          <p id="label-help" className={`mt-1 text-[12px] ${text.trim() !== '' && !parsed.ok ? 'text-hold' : 'text-graphite'}`}>
            {text.trim() === '' ? 'Numbers and ranges, such as 0-278, 281.' : parsed.ok ? `${parsed.count} ${parsed.count === 1n ? 'deal' : 'deals'}.` : parsed.reason}
          </p>
          <fieldset className="mt-3">
            <legend className="label">Label</legend>
            <div className="mt-1.5 grid gap-1.5">
              {DEAL_LABELS.map((l) => (
                <label key={l.value} className="flex items-baseline gap-2 text-[13.5px]">
                  <input type="radio" name="deal-label" value={l.value} checked={label === l.value} onChange={() => setLabel(l.value)} />
                  <span className="font-semibold">{l.value}</span>
                  <span className="text-graphite">{l.help}{l.test ? ' · counted as test volume' : ' · counted as third-party volume'}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={!parsed.ok || outcome.kind === 'working'} className="mt-4 rounded-md bg-ink px-4 py-2.5 text-[14px] font-semibold text-paper disabled:opacity-40">
            {outcome.kind === 'working' ? 'Waiting for your wallet…' : 'Sign and label'}
          </button>
          {outcome.kind === 'done' ? <p role="status" className="mt-2 text-[13px]">Labelled {outcome.labelled} {outcome.labelled === 1 ? 'deal' : 'deals'} as {outcome.label}.</p> : null}
          {outcome.kind === 'error' ? <p role="alert" className="mt-2 text-[13px] text-hold">{outcome.message}</p> : null}
        </form>
      ) : (
        <p className="mt-3 text-[12.5px] text-graphite">Only the pauser wallet <span className="mono">{shortAddress(s.chain.pauser)}</span> can label deals{address ? ` (you are connected as ${shortAddress(address)})` : '; connect it to see the form'}.</p>
      )}
    </section>
  )
}
