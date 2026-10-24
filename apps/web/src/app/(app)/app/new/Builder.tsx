'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { parseEventLogs, parseAbi, type Hex } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { useArbiterCheck, useAttestorChoices, useBuilderLimits } from '@/data/builder-reads'
import { encodeCurrentEscrowAction, type FeePayer, type ReleaseCondition } from '@/integration/current-actions'
import { getBrowserNetwork } from '@/integration/network'
import { Modal } from '@/ui/Modal'
import { LineItems } from '@/ui/Sheet'
import { TxFlow } from '@/ui/TxFlow'
import { buildDeal, CONDITION_LABEL, emptyForm, feeFor, TEMPLATES, type BuilderForm, type PartForm, type Template } from '@/view/builder'
import { formatAmount, shortAddress } from '@/view/format'
import { ShareDeal } from './ShareDeal'

const CREATED = parseAbi(['event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed supplier, address arbiter, uint256 totalAmount, uint16 feeBps)'])
const FEE_PAYERS: { value: FeePayer; label: string }[] = [
  { value: 0, label: 'I pay the Waybill fee' },
  { value: 1, label: 'The supplier pays it from each payment' },
  { value: 2, label: 'Split between us' },
]

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] outline-none focus:border-held'

export function Builder() {
  const { address } = useAccount()
  const limits = useBuilderLimits()
  if (!address) return null
  if (limits.status === 'loading') return <Shell><p role="status" className="text-[14px] text-graphite">Reading the escrow&apos;s limits…</p></Shell>
  if (limits.status === 'error') return <Shell><p role="alert" className="text-[14px] text-hold">The escrow&apos;s limits could not be read, so no deal can be built: {limits.message}</p></Shell>
  return <Form buyer={address} limits={limits.value} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">{children}</main>
}

function Form({ buyer, limits }: { buyer: `0x${string}`; limits: Extract<ReturnType<typeof useBuilderLimits>, { status: 'ready' }>['value'] }) {
  const client = usePublicClient()
  const directory = useAttestorChoices()
  const [template, setTemplate] = useState<Template>(TEMPLATES[1]!)
  const [form, setForm] = useState<BuilderForm>(() => emptyForm(buyer, limits.minFeeBps, TEMPLATES[1]!))
  const arbiter = useArbiterCheck(form.arbiter)
  const [signing, setSigning] = useState(false)
  const [created, setCreated] = useState<bigint | null>(null)
  const [lookup, setLookup] = useState('')
  const [now] = useState(() => Math.floor(Date.now() / 1000))

  const checked = arbiter?.status === 'ready' ? arbiter.value : null
  const built = useMemo(() => buildDeal(form, buyer, limits, checked, Math.floor(Date.now() / 1000)), [form, buyer, limits, checked])
  const set = (patch: Partial<BuilderForm>) => setForm((f) => ({ ...f, ...patch }))
  const setPart = (i: number, patch: Partial<PartForm>) => setForm((f) => ({ ...f, parts: f.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  const pick = (t: Template) => {
    setTemplate(t)
    setForm((f) => ({ ...f, parts: t.parts() }))
  }

  if (created !== null) return <ShareDeal dealId={created} supplier={form.supplier} />

  const total = built.ok ? built.deal.totalAmount : null
  const arbiterFee = checked?.allowed ? checked.fee : 0n
  const showErrors = form.total !== '' || form.supplier !== '' || form.arbiter !== ''

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 pt-6 pb-20 md:px-8 md:pt-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <p className="label">New deal</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Set the terms</h1>
        <p className="mt-1 max-w-xl text-[13.5px] text-graphite">Nothing is sent until you create the deal and sign it in your wallet. After that, the supplier and everyone you name must accept before you can fund it.</p>

        <section className="mt-8" aria-label="Template">
          <h2 className="label mb-2">Start from</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => pick(t)} aria-pressed={template.id === t.id} className={`rounded-md border px-3.5 py-3 text-left ${template.id === t.id ? 'border-ink bg-sheet' : 'border-rule hover:border-ink'}`}>
                <span className="block text-[14px] font-semibold">{t.name}</span>
                <span className="mt-0.5 block text-[12.5px] text-graphite">{t.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="People">
          <div className="sm:col-span-2">
            <label className="label block" htmlFor="supplier">Supplier&apos;s wallet</label>
            <input id="supplier" className={`${input} mono`} value={form.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="0x…" spellCheck={false} />
            <p className="mt-1 text-[12px] text-graphite">
              No wallet yet? Ask them to open <Link href="/join" className="underline" target="_blank">the sign-up page</Link> and send you the address it shows.
            </p>
          </div>
          <div>
            <label className="label block" htmlFor="total">Total, USDC</label>
            <input id="total" className={`${input} mono`} inputMode="decimal" value={form.total} onChange={(e) => set({ total: e.target.value })} />
          </div>
          <div>
            <label className="label block" htmlFor="refund">Refunds go to</label>
            <input id="refund" className={`${input} mono`} value={form.refund} onChange={(e) => set({ refund: e.target.value })} spellCheck={false} />
          </div>
          <div className="sm:col-span-2">
            <label className="label block" htmlFor="arbiter">Arbiter&apos;s wallet</label>
            <input id="arbiter" className={`${input} mono`} value={form.arbiter} onChange={(e) => set({ arbiter: e.target.value })} placeholder="0x… from the approved list" spellCheck={false} />
            <p className="mt-1 text-[12px]" role="status">
              {arbiter === null ? <span className="text-graphite">Decides disputes. Must be on the approved list.</span> : null}
              {arbiter?.status === 'loading' ? <span className="text-graphite">Checking the approved list…</span> : null}
              {arbiter?.status === 'error' ? <span className="text-hold">Could not check the list: {arbiter.message}</span> : null}
              {arbiter?.status === 'ready' && arbiter.value.allowed ? <span className="text-released">On the approved list · fee {formatAmount(arbiter.value.fee)} USDC, paid only if they decide in time</span> : null}
              {arbiter?.status === 'ready' && !arbiter.value.allowed ? <span className="text-hold">Not on the approved list.</span> : null}
            </p>
          </div>
        </section>

        <section className="mt-8" aria-label="Parts">
          <h2 className="label mb-2">Payments</h2>
          <datalist id="attestors">
            {directory.attestors.map((a) => (
              <option key={a.address} value={a.address}>{a.profile?.name ?? shortAddress(a.address)}</option>
            ))}
          </datalist>
          <ol className="space-y-3">
            {form.parts.map((p, i) => (
              <li key={i} className="rounded-md border border-rule bg-paper p-3.5">
                <div className="flex flex-wrap items-end gap-3">
                  <span className="mono pb-2 text-[13px] text-graphite">{i + 1}</span>
                  <div className="w-24">
                    <label className="label block" htmlFor={`pct-${i}`}>Share, %</label>
                    <input id={`pct-${i}`} className={`${input} mono`} inputMode="decimal" value={p.percent} onChange={(e) => setPart(i, { percent: e.target.value })} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="label block" htmlFor={`cond-${i}`}>Paid when</label>
                    <select
                      id={`cond-${i}`}
                      className={input}
                      value={p.condition}
                      onChange={(e) => {
                        const condition = Number(e.target.value) as ReleaseCondition
                        setPart(i, { condition, attestors: condition === 1 ? (p.attestors.length ? p.attestors : ['']) : [] })
                      }}
                    >
                      {([0, 1, 2, 3] as ReleaseCondition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                    </select>
                  </div>
                  {form.parts.length > 1 ? (
                    <button type="button" onClick={() => set({ parts: form.parts.filter((_, j) => j !== i) })} className="pb-2 text-[12.5px] text-graphite hover:text-hold">Remove</button>
                  ) : null}
                </div>
                {p.condition === 1 ? (
                  <div className="mt-3">
                    <p className="label">Attestors (all must confirm)</p>
                    {p.attestors.map((a, k) => (
                      <div key={k} className="mt-1.5 flex gap-2">
                        <input aria-label={`Attestor ${k + 1} for part ${i + 1}`} list="attestors" className={`${input} mono mt-0`} value={a} onChange={(e) => setPart(i, { attestors: p.attestors.map((x, j) => (j === k ? e.target.value : x)) })} placeholder="0x…" spellCheck={false} />
                        {p.attestors.length > 1 ? <button type="button" onClick={() => setPart(i, { attestors: p.attestors.filter((_, j) => j !== k) })} className="text-[12.5px] text-graphite hover:text-hold">Remove</button> : null}
                      </div>
                    ))}
                    {p.attestors.length < 5 ? <button type="button" onClick={() => setPart(i, { attestors: [...p.attestors, ''] })} className="mt-1.5 text-[12.5px] underline">Add another attestor</button> : null}
                    {directory.note ? <p className="mt-1 text-[12px] text-graphite">{directory.note}</p> : null}
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Small label="Due in, days" value={p.dueDays} onChange={(v) => setPart(i, { dueDays: v })} />
                  <Small label="Grace, days" value={p.graceDays} onChange={(v) => setPart(i, { graceDays: v })} />
                  {p.condition === 1 || p.condition === 2 ? <Small label="Your review, hours" value={p.reviewHours} onChange={(v) => setPart(i, { reviewHours: v })} /> : <span />}
                </div>
              </li>
            ))}
          </ol>
          {form.parts.length < 8 ? (
            <button type="button" onClick={() => set({ parts: [...form.parts, { percent: '', condition: 1, attestors: [''], dueDays: String(60), graceDays: '7', reviewHours: '24' }] })} className="mt-3 text-[13px] font-semibold underline">Add a part</button>
          ) : null}
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Fees and timing">
          <div>
            <label className="label block" htmlFor="payer">Who pays the Waybill fee</label>
            <select id="payer" className={input} value={form.feePayer} onChange={(e) => set({ feePayer: Number(e.target.value) as FeePayer })}>
              {FEE_PAYERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label block" htmlFor="bps">Fee, basis points ({limits.minFeeBps} to {limits.maxFeeBps})</label>
            <input id="bps" className={`${input} mono`} inputMode="numeric" value={form.feeBps} onChange={(e) => set({ feeBps: e.target.value })} />
          </div>
          <Small label="Days to accept" value={form.acceptDays} onChange={(v) => set({ acceptDays: v })} />
          <Small label="Hours the arbiter has to decide" value={form.decisionHours} onChange={(v) => set({ decisionHours: v })} />
        </section>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Summary">
        <div className="rounded-md border border-rule bg-sheet p-4">
          <p className="label">Summary</p>
          {total !== null ? (
            <div className="mt-3">
              <LineItems
                items={[
                  { label: 'Deal total', amount: total, note: `${form.parts.length} ${form.parts.length === 1 ? 'payment' : 'payments'} to the supplier` },
                  { label: `Waybill fee, ${Number(form.feeBps) / 100}%`, amount: feeFor(total, Number(form.feeBps)), note: form.feePayer === 0 ? 'You prepay it; returned with any refunded part' : form.feePayer === 1 ? 'Taken from the supplier at payout' : 'Shared with the supplier' },
                  { label: 'Arbiter fee', amount: arbiterFee, note: 'Paid only if a dispute is decided in time' },
                ]}
                total={total + (form.feePayer === 0 ? feeFor(total, Number(form.feeBps)) : 0n) + arbiterFee}
                totalLabel="At most you lock"
              />
              <p className="mt-2 text-[12px] text-graphite">The exact figure is fixed when you fund. Nothing is locked until then.</p>
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-graphite">Fill in the total, supplier and arbiter to see what you would lock.</p>
          )}
          {!built.ok && showErrors ? (
            <ul role="alert" className="mt-4 list-disc space-y-1 pl-4 text-[12.5px] text-hold">
              {built.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : null}
          <button type="button" disabled={!built.ok} onClick={() => setSigning(true)} className="mt-4 w-full rounded-md bg-held py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40">
            Create deal
          </button>
          <p className="mt-3 text-[12px] text-graphite">Terms freeze when you fund. Nobody, including Waybill, can move the money except by these rules.</p>
          <p className="mt-2 text-[11.5px] text-graphite">Read from the escrow at {new Date(now * 1000).toISOString().slice(11, 16)} UTC. Held in escrow now: {formatAmount(limits.currentLocked)} of {formatAmount(limits.maxLocked)} USDC early-access cap.</p>
        </div>
      </aside>

      <Modal open={signing && built.ok} onClose={() => setSigning(false)} label="Create this deal">
        {signing && built.ok ? (
          <>
            <h2 className="text-[19px] font-semibold">Create this deal</h2>
            <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">This records the terms on Arc. No money moves yet. You fund it once everyone has accepted.</p>
            <TxFlow
              confirmLabel="Create deal"
              steps={[{ label: 'Create the deal', action: encodeCurrentEscrowAction({ kind: 'createDeal', ...built.deal }, getBrowserNetwork()) }]}
              onCancel={() => setSigning(false)}
              onDone={async (hashes: Hex[]) => {
                const hash = hashes[hashes.length - 1]!
                try {
                  const receipt = await client!.getTransactionReceipt({ hash })
                  const log = parseEventLogs({ abi: CREATED, logs: receipt.logs, eventName: 'DealCreated' }).find((l) => l.address.toLowerCase() === getBrowserNetwork().contracts.escrow.toLowerCase())
                  if (!log) throw new Error('The transaction confirmed but its deal number could not be read.')
                  setSigning(false)
                  setCreated(log.args.dealId)
                } catch (e) {
                  setSigning(false)
                  setLookup(e instanceof Error ? e.message : String(e))
                }
              }}
            />
          </>
        ) : null}
      </Modal>
      {lookup ? <p role="alert" className="text-[13px] text-hold lg:col-span-2">{lookup} Check your deals list for the new deal.</p> : null}
    </main>
  )
}

function Small({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label block">{label}
        <input className={`${input} mono`} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  )
}
