'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { parseEventLogs, parseAbi, type Hex } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { useArbiterCheck, useArbiterChoices, useAttestorChoices, useBuilderLimits } from '@/data/builder-reads'
import { encodeCurrentEscrowAction, type FeePayer, type ReleaseCondition } from '@/integration/current-actions'
import { readUsdcBalance } from '@/integration/escrow'
import { getBrowserNetwork } from '@/integration/network'
import { Modal } from '@/ui/Modal'
import { LineItems } from '@/ui/Sheet'
import { Combobox } from '@/ui/Combobox'
import { TxFlow } from '@/ui/TxFlow'
import { feeShares, partAmount, buildDeal, buildTerms, arbiterFieldClash, CONDITION_LABEL, emptyDetails, emptyForm, feeFor, TEMPLATES, type BuilderForm, type DetailsForm, type PartForm, type Template } from '@/view/builder'
import { formatAmount, shortAddress } from '@/view/format'
import { draftKey, isBlankDraft, parseDraft, serializeDraft } from '@/view/builder-draft'
import { ShareDeal } from './ShareDeal'

const CREATED = parseAbi(['event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed supplier, address arbiter, uint256 totalAmount, uint16 feeBps)'])
const FEE_PAYERS: { value: FeePayer; label: string }[] = [
  { value: 0, label: 'I pay the Waybill fee' },
  { value: 1, label: 'The supplier pays it from each payment' },
  { value: 2, label: 'Split between us' },
]

const input = 'mt-1.5 w-full rounded-md border border-rule bg-sheet px-3 py-2.5 text-[14px] focus:border-held'

export function Builder() {
  const { address } = useAccount()
  const limits = useBuilderLimits()
  if (!address) return null
  if (limits.status === 'loading') return <Shell><p role="status" className="text-[14px] text-graphite">Reading the escrow&apos;s limits…</p></Shell>
  if (limits.status === 'error')
    return (
      <Shell>
        <p role="alert" className="text-[14px] text-hold">The escrow&apos;s limits could not be read, so a deal can&apos;t be built yet. Check your connection and try again.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-[10px] border border-rule px-4 py-2 text-[14px] text-ink">Try again</button>
        <details className="mt-3 text-[12px] text-graphite"><summary>Details</summary><p className="mt-1 break-all">{limits.message.split('\n')[0]}</p></details>
      </Shell>
    )
  return <Form buyer={address} limits={limits.value} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="max-w-3xl px-4 py-10 md:px-8">{children}</main>
}

function Form({ buyer, limits }: { buyer: `0x${string}`; limits: Extract<ReturnType<typeof useBuilderLimits>, { status: 'ready' }>['value'] }) {
  const client = usePublicClient()
  const directory = useAttestorChoices()
  const arbiters = useArbiterChoices()
  const [template, setTemplate] = useState<Template>(TEMPLATES[1]!)
  const [form, setForm] = useState<BuilderForm>(() => emptyForm(buyer, limits.minFeeBps, TEMPLATES[1]!))
  const arbiter = useArbiterCheck(form.arbiter)
  const panelRead = [useArbiterCheck(form.panel[0] ?? ''), useArbiterCheck(form.panel[1] ?? ''), useArbiterCheck(form.panel[2] ?? '')]
  const panelChecks = panelRead.map((r) => (r?.status === 'ready' ? r.value : null))
  // The deal as it was when Create was pressed. The form behind the dialog keeps re-reading the chain, and a failed
  // re-read must not close or change a dialog the wallet is waiting on.
  const [balance, setBalance] = useState<bigint | null>(null)
  useEffect(() => {
    if (!client) return
    let cancelled = false
    readUsdcBalance(client, buyer as `0x${string}`).then((b) => !cancelled && setBalance(b)).catch(() => !cancelled && setBalance(null))
    return () => { cancelled = true }
  }, [client, buyer])
  const [frozen, setFrozen] = useState<Extract<typeof built, { ok: true }> | null>(null)
  const [created, setCreated] = useState<bigint | null>(null)
  const [createdTx, setCreatedTx] = useState<Hex | null>(null)
  // a click on Create while something is still wrong must answer, not do nothing
  const [attempted, setAttempted] = useState(false)
  const [flash, setFlash] = useState(false)
  // the terms page says creating a deal confirms business use; this is where that is confirmed
  const [agreed, setAgreed] = useState(false)
  const [details, setDetails] = useState<DetailsForm>(emptyDetails)
  // the half-built deal survives a reload: one draft per network and wallet, restored once, cleared on create or Start over
  const storageKey = useMemo(() => draftKey(getBrowserNetwork().chainId, buyer), [buyer])
  const [draftReady, setDraftReady] = useState(false)
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    setDraftReady(false)
    let draft = null
    try { draft = parseDraft(window.localStorage.getItem(storageKey)) } catch { /* storage blocked: start blank */ }
    if (draft) {
      setTemplate(draft.template)
      setForm(draft.form)
      setDetails(draft.details)
      setRestored(true)
    }
    setDraftReady(true)
  }, [storageKey])
  useEffect(() => {
    if (!draftReady || created !== null) return
    const timer = setTimeout(() => {
      try {
        if (isBlankDraft(form, details, emptyForm(buyer, limits.minFeeBps, TEMPLATES[1]!), template)) window.localStorage.removeItem(storageKey)
        else window.localStorage.setItem(storageKey, serializeDraft(template, form, details))
      } catch { /* storage full or blocked: the form still works, it just won't survive a reload */ }
    }, 300)
    return () => clearTimeout(timer)
  }, [draftReady, created, form, details, template, storageKey, buyer, limits.minFeeBps])
  const clearDraft = () => { try { window.localStorage.removeItem(storageKey) } catch { /* nothing kept */ } }
  const startOver = () => {
    clearDraft()
    setTemplate(TEMPLATES[1]!)
    setForm(emptyForm(buyer, limits.minFeeBps, TEMPLATES[1]!))
    setDetails(emptyDetails())
    setAttempted(false)
    setRestored(false)
  }
  const tryCreate = () => {
    if (built.ok) {
      setAgreed(false)
      return setFrozen(built)
    }
    setAttempted(true)
    requestAnimationFrame(() => {
      const list = document.getElementById('build-problems')
      list?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      list?.focus({ preventScroll: true })
    })
    setFlash(true)
    setTimeout(() => setFlash(false), 1400)
  }
  const [lookup, setLookup] = useState('')
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  // Deadlines are checked against the chain's clock, not this device's: if the chain runs ahead (a skewed device
  // clock, or a test fork that was moved forward), build from the chain's time so the deadline is still in the future.
  const [chainAhead, setChainAhead] = useState(0)
  useEffect(() => {
    let live = true
    client?.getBlock({ blockTag: 'latest' }).then((b) => {
      if (live) setChainAhead(Math.max(0, Number(b.timestamp) - Math.floor(Date.now() / 1000)))
    }).catch(() => {})
    return () => { live = false }
  }, [client])

  const checked = arbiter?.status === 'ready' ? arbiter.value : null
  // the checks are new objects on every render, so key the memo on what they say
  const checksKey = JSON.stringify(panelChecks.map((c) => (c ? [c.allowed, String(c.fee)] : null)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => buildDeal(form, buyer, limits, checked, Math.floor(Date.now() / 1000) + chainAhead, panelChecks), [form, buyer, limits, checked, checksKey, chainAhead])
  const set = (patch: Partial<BuilderForm>) => setForm((f) => ({ ...f, ...patch }))
  const setPart = (i: number, patch: Partial<PartForm>) => setForm((f) => ({ ...f, parts: f.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  const pick = (t: Template) => {
    setTemplate(t)
    setForm((f) => ({ ...f, parts: t.parts() }))
  }

  const terms = buildTerms(details, form.parts, template.id === 'custom' ? undefined : template.name)
  if (created !== null) return <ShareDeal dealId={created} txHash={createdTx} supplier={form.supplier} buyer={buyer} terms={terms.ok ? terms.terms : null} isPublic={details.isPublic} />

  const total = built.ok ? built.deal.totalAmount : null
  const isPanel = form.panel.length > 0
  const leader = isPanel ? panelChecks[0] : checked
  const arbiterFee = leader?.allowed ? leader.fee : 0n
  const bad = (prefix: string) => (showErrors && !built.ok && built.errors.some((e) => e.startsWith(prefix))) || undefined
  const showErrors = attempted || form.total !== '' || form.supplier !== '' || form.arbiter !== '' || form.panel.some((m) => m !== '')

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 pt-6 pb-40 md:px-8 md:pt-10 lg:pb-20 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <p className="label">New deal</p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Set the terms</h1>
          <button type="button" onClick={startOver} className="text-[13px] text-graphite underline hover:text-ink">Start over</button>
        </div>
        {restored ? <p role="status" className="mt-2 text-[13px] text-graphite">Your unfinished deal was restored from this browser.</p> : null}
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
            <input id="supplier" name="supplier" aria-invalid={bad('The supplier')} className={`${input} mono`} value={form.supplier} onChange={(e) => set({ supplier: e.target.value })} placeholder="0x…" spellCheck={false} />
            {form.supplier.trim().length > 12 ? <p className="mono mt-1 text-[12px] text-graphite" aria-hidden>{shortAddress(form.supplier.trim())}</p> : null}
            <p className="mt-1 text-[12px] text-graphite">
              No wallet yet? Ask them to open <Link href="/join" className="underline" target="_blank">the sign-up page</Link> and send you the address it shows.
            </p>
          </div>
          <div>
            <label className="label block" htmlFor="total">Total, USDC</label>
            <input id="total" name="total" aria-invalid={bad('Enter the total')} className={`${input} mono`} inputMode="decimal" value={form.total} onChange={(e) => set({ total: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label block" htmlFor="refund">Refunds go to</label>
            <input id="refund" name="refund" aria-invalid={bad('The refund')} className={`${input} mono`} value={form.refund} onChange={(e) => set({ refund: e.target.value })} spellCheck={false} />
            {form.refund.trim().length > 12 ? <p className="mono mt-1 text-[12px] text-graphite" aria-hidden>{shortAddress(form.refund.trim())}</p> : null}
          </div>
          <div className="sm:col-span-2">
            <fieldset>
              <legend className="label">Who decides disputes</legend>
              <div className="mt-1.5 flex flex-wrap gap-4 text-[13.5px]">
                <label className="flex items-center gap-2"><input type="radio" name="arbiter-mode" checked={!isPanel} onChange={() => set({ panel: [] })} /> One arbiter</label>
                <label className={`flex items-center gap-2 ${arbiters.arbiters.length < 3 ? 'opacity-60' : ''}`}><input type="radio" name="arbiter-mode" disabled={arbiters.arbiters.length < 3 && !isPanel} checked={isPanel} onChange={() => set({ panel: ['', '', ''] })} /> A panel of three (any two who agree decide)</label>
                {arbiters.arbiters.length < 3 ? <p className="text-[12px] text-graphite">A panel needs three arbiters on the approved list; {arbiters.arbiters.length} {arbiters.arbiters.length === 1 ? 'is' : 'are'} on it now.</p> : null}
              </div>
            </fieldset>
            {!isPanel ? (
              <div className="mt-3">
                <ArbiterField id="arbiter" label="Arbiter's wallet" value={form.arbiter} onChange={(v) => set({ arbiter: v })} check={arbiter} choices={arbiters} clash={!!arbiterFieldClash(form, buyer, null)} />
                {arbiterFieldClash(form, buyer, null) ? <p role="alert" data-inline-clash className="mt-1 text-[12.5px] text-hold">{arbiterFieldClash(form, buyer, null)}</p> : null}
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                  <ArbiterField
                    id={`panel-${i}`}
                    label={i === 0 ? 'Panel arbiter 1 (receives the arbiter fee)' : `Panel arbiter ${i + 1}`}
                    value={form.panel[i] ?? ''}
                    onChange={(v) => set({ panel: form.panel.map((m, j) => (j === i ? v : m)) })}
                    check={panelRead[i] ?? null}
                    choices={arbiters}
                    clash={!!arbiterFieldClash(form, buyer, i)}
                  />
                  {arbiterFieldClash(form, buyer, i) ? <p role="alert" data-inline-clash className="mt-1 text-[12.5px] text-hold">{arbiterFieldClash(form, buyer, i)}</p> : null}
                  </div>
                ))}
                <p className="text-[12px] text-graphite">All three must be on the approved list and must accept before you can fund. They vote on a disputed part; when two vote the same way it is decided at once.</p>
              </div>
            )}
          </div>
        </section>

        <section className="mt-8" aria-label="Parts">
          <h2 className="label mb-2">Payments</h2>
          <ol className="space-y-3">
            {form.parts.map((p, i) => (
              <li key={i} className="rounded-md border border-rule bg-paper p-3.5">
                <div className="flex flex-wrap items-end gap-3">
                  <span className="mono pb-2 text-[13px] text-graphite">{i + 1}</span>
                  <div className="w-24">
                    <label className="label block" htmlFor={`pct-${i}`}>Share, %</label>
                    <input id={`pct-${i}`} name={`pct-${i}`} className={`${input} mono`} inputMode="decimal" value={p.percent} onChange={(e) => setPart(i, { percent: e.target.value })} />
                    <p className="mono mt-1 text-[12px] text-graphite" aria-live="off">{partAmount(form.total, p.percent) === null ? '' : `${formatAmount(partAmount(form.total, p.percent)!)} USDC`}</p>
                  </div>
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
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
                    <button type="button" onClick={() => set({ parts: form.parts.filter((_, j) => j !== i) })} aria-label={`Remove part ${i + 1}`} className="ml-auto inline-flex min-h-11 items-center px-2 text-[12.5px] text-graphite hover:text-hold sm:ml-0 sm:pb-0">Remove</button>
                  ) : null}
                </div>
                {p.condition === 1 ? (
                  <div className="mt-3">
                    <p className="label">Attestors (all must confirm)</p>
                    {p.attestors.map((a, k) => (
                      <div key={k} className="mt-1.5 flex gap-2">
                        <Combobox label={`Attestor ${k + 1} for part ${i + 1}`} className={`${input} mono mt-0`} value={a} onChange={(v) => setPart(i, { attestors: p.attestors.map((x, j) => (j === k ? v : x)) })} placeholder="0x… or a name" options={directory.attestors.map((d) => ({ value: d.address, label: d.profile?.name ?? shortAddress(d.address) }))} />
                        {p.attestors.length > 1 ? <button type="button" onClick={() => setPart(i, { attestors: p.attestors.filter((_, j) => j !== k) })} aria-label={`Remove attestor ${k + 1} from part ${i + 1}`} className="text-[12.5px] text-graphite hover:text-hold">Remove</button> : null}
                      </div>
                    ))}
                    {p.attestors.length < 5 ? <button type="button" onClick={() => setPart(i, { attestors: [...p.attestors, ''] })} className="mt-1.5 text-[12.5px] underline">Add another attestor</button> : null}
                    {directory.note ? <p className="mt-1 text-[12px] text-graphite">{directory.note}</p> : null}
                  </div>
                ) : null}
                <div className="mt-3">
                  <label className="label block" htmlFor={`title-${i}`}>What this part is for (optional)</label>
                  <input id={`title-${i}`} name={`title-${i}`} className={input} value={p.title} maxLength={80} onChange={(e) => setPart(i, { title: e.target.value })} placeholder="Deposit, production, delivery…" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Small label="Due in, days" value={p.dueDays} onChange={(v) => setPart(i, { dueDays: v })} />
                  <Small label="Grace, days" value={p.graceDays} onChange={(v) => setPart(i, { graceDays: v })} />
                  {p.condition === 1 || p.condition === 2 ? <Small label="Your review, hours" value={p.reviewHours} onChange={(v) => setPart(i, { reviewHours: v })} /> : <span />}
                </div>
              </li>
            ))}
          </ol>
          {form.parts.length < 8 ? (
            <button type="button" onClick={() => set({ parts: [...form.parts, { title: '', percent: '', condition: 1, attestors: [''], dueDays: String(60), graceDays: '7', reviewHours: '24' }] })} className="mt-3 text-[13px] font-semibold underline">Add a part</button>
          ) : null}
        </section>

        <section className="mt-8" aria-label="Details">
          <h2 className="label mb-1">Details for the supplier (optional)</h2>
          <p className="mb-3 max-w-xl text-[12.5px] leading-relaxed text-graphite">What is being bought and who is who. The contract stores none of this: Waybill keeps it off-chain, visible to the people named in the deal unless you choose to make it public. It is saved after the deal is created and cannot be changed once the deal is funded.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label block" htmlFor="goods">Goods</label>
              <input id="goods" name="goods" className={input} value={details.goods} maxLength={300} onChange={(e) => setDetails({ ...details, goods: e.target.value })} placeholder="e.g. Cotton t-shirts, 5,000 units" />
            </div>
            <Small label="Units" value={details.units} onChange={(v) => setDetails({ ...details, units: v })} />
            <Small label="Cartons" value={details.cartons} onChange={(v) => setDetails({ ...details, cartons: v })} />
            <div>
              <label className="label block" htmlFor="origin-code">Ships from (country code, city)</label>
              <div className="flex gap-2"><input id="origin-code" name="origin-code" className={`${input} mono w-20`} maxLength={3} value={details.originCode} onChange={(e) => setDetails({ ...details, originCode: e.target.value })} placeholder="CN" /><input aria-label="Origin city" className={input} value={details.originCity} onChange={(e) => setDetails({ ...details, originCity: e.target.value })} placeholder="Shenzhen" /></div>
            </div>
            <div>
              <label className="label block" htmlFor="destination-code">Ships to (country code, city)</label>
              <div className="flex gap-2"><input id="destination-code" name="destination-code" className={`${input} mono w-20`} maxLength={3} value={details.destinationCode} onChange={(e) => setDetails({ ...details, destinationCode: e.target.value })} placeholder="GH" /><input aria-label="Destination city" className={input} value={details.destinationCity} onChange={(e) => setDetails({ ...details, destinationCity: e.target.value })} placeholder="Accra" /></div>
            </div>
            <div>
              <label className="label block" htmlFor="buyer-name">Your name or company</label>
              <input id="buyer-name" name="buyer-name" className={input} value={details.buyerName} maxLength={120} onChange={(e) => setDetails({ ...details, buyerName: e.target.value })} />
            </div>
            <div>
              <label className="label block" htmlFor="supplier-name">Supplier’s name or company</label>
              <input id="supplier-name" name="supplier-name" className={input} value={details.supplierName} maxLength={120} onChange={(e) => setDetails({ ...details, supplierName: e.target.value })} />
            </div>
            <label className="flex items-start gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={details.isPublic} onChange={(e) => setDetails({ ...details, isPublic: e.target.checked })} />
              <span>Show these details on the deal&apos;s public record. Anyone with the link could read them. Leave this off to keep them to the people named in the deal.</span>
            </label>
          </div>
          {!terms.ok ? <ul role="alert" className="mt-2 space-y-0.5 text-[12.5px] text-hold">{terms.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </section>

        <section className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="Fees and timing">
          <div>
            <label className="label block" htmlFor="payer">Who pays the Waybill fee</label>
            <select id="payer" name="payer" className={input} value={form.feePayer} onChange={(e) => set({ feePayer: Number(e.target.value) as FeePayer })}>
              {FEE_PAYERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label block" htmlFor="bps">Fee, basis points ({limits.minFeeBps} to {limits.maxFeeBps})</label>
            <input id="bps" name="bps" className={`${input} mono`} inputMode="numeric" value={form.feeBps} onChange={(e) => set({ feeBps: e.target.value })} />
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
                  { label: `Waybill fee, ${Number(form.feeBps) / 100}%`, amount: feeFor(total, Number(form.feeBps)), note: feeNote(feeFor(total, Number(form.feeBps)), form.feePayer) },
                  { label: 'Arbiter fee', amount: arbiterFee, note: 'Paid only if a dispute is decided in time' },
                ]}
                total={total + feeShares(feeFor(total, Number(form.feeBps)), form.feePayer).buyer + arbiterFee}
                totalLabel="At most you lock"
              />
              <p className="mt-2 text-[12px] text-graphite">The exact figure is fixed when you fund. Nothing is locked until then.</p>
              {(() => {
                const lock = total + feeShares(feeFor(total, Number(form.feeBps)), form.feePayer).buyer + arbiterFee
                return balance !== null && balance < lock ? (
                  <p role="status" className="mt-2 rounded-md border border-hold/50 bg-hold-wash px-3 py-2 text-[12.5px]">
                    Your wallet holds {formatAmount(balance)} USDC and funding will lock up to {formatAmount(lock)}. You can still create the deal, but you will need to add USDC before you can fund it.
                  </p>
                ) : null
              })()}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-graphite">{arbiter?.status === 'loading' || panelRead.some((r) => r?.status === 'loading') ? 'Checking the arbiter on the approved list…' : 'Fill in the total, supplier and arbiter to see what you would lock.'}</p>
          )}
          {!built.ok && showErrors ? (
            <ul id="build-problems" tabIndex={-1} aria-label="Problems to fix before creating" className={`mt-4 list-disc space-y-1 rounded-md pl-4 text-[12.5px] text-hold outline-none transition-colors ${flash ? 'bg-hold-wash ring-2 ring-hold/60' : ''}`}>
              {built.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : null}
          <button type="button" aria-disabled={!built.ok} aria-describedby={!built.ok && showErrors ? "build-problems" : undefined} onClick={tryCreate} className={`mt-4 w-full rounded-md bg-held py-2.5 text-[14px] font-semibold text-sheet ${built.ok ? '' : 'opacity-60'}`}>
            Create deal
          </button>
          <p className="mt-3 text-[12px] text-graphite">Terms freeze when you fund. Nobody, including Waybill, can move the money except by these rules.</p>
          <p className="mt-2 text-[12px] text-graphite">Read from the escrow at {new Date(now * 1000).toISOString().slice(11, 16)} UTC. Held in escrow now: {formatAmount(limits.currentLocked)} of {formatAmount(limits.maxLocked)} USDC early-access cap.</p>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-[calc(2.85rem+env(safe-area-inset-bottom))] z-30 border-t border-rule bg-paper px-4 py-2.5 md:bottom-0 lg:hidden">
        <button type="button" aria-disabled={!built.ok} aria-label="Create deal" onClick={tryCreate} className={`w-full rounded-md bg-held py-2.5 text-[14px] font-semibold text-sheet ${built.ok ? '' : 'opacity-60'}`}>
          {built.ok ? 'Create deal' : 'Create deal · fix the problems above'}
        </button>
      </div>
      <Modal open={frozen !== null} onClose={() => setFrozen(null)} label="Create this deal">
        {frozen ? (
          <>
            <h2 className="text-[19px] font-semibold">Create this deal</h2>
            <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">This records the terms on Arc. No money moves yet. You fund it once everyone has accepted.</p>
            <label className="mb-4 flex items-start gap-2.5 text-[13.5px]">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} aria-describedby={agreed ? undefined : "agree-help"} />
              <span>
                I am using Waybill for business, and I have read the{' '}
                <Link href="/legal" target="_blank" className="underline">terms, privacy and security</Link> page, including how disputes are decided.
              </span>
            </label>
            {!agreed ? (
              <>
                <p id="agree-help" className="text-[12.5px] text-graphite">Tick the box to continue.</p>
                <button type="button" onClick={() => setFrozen(null)} className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-rule text-[13.5px] font-semibold text-ink hover:bg-paper">Cancel</button>
              </>
            ) : (
            <TxFlow
              confirmLabel="Create deal"
              steps={[{ label: 'Create the deal', action: encodeCurrentEscrowAction(frozen.deal.panel ? { kind: 'createDealWithPanel', ...frozen.deal, panel: frozen.deal.panel } : { kind: 'createDeal', ...frozen.deal }, getBrowserNetwork()) }]}
              onCancel={() => setFrozen(null)}
              onDone={async (hashes: Hex[]) => {
                const hash = hashes[hashes.length - 1]!
                try {
                  const receipt = await client!.getTransactionReceipt({ hash })
                  const log = parseEventLogs({ abi: CREATED, logs: receipt.logs, eventName: 'DealCreated' }).find((l) => l.address.toLowerCase() === getBrowserNetwork().contracts.escrow.toLowerCase())
                  if (!log) throw new Error('The transaction confirmed but its deal number could not be read.')
                  setFrozen(null)
                  setCreatedTx(hash)
                  clearDraft()
                  setCreated(log.args.dealId)
                } catch (e) {
                  setFrozen(null)
                  setLookup(e instanceof Error ? e.message : String(e))
                }
              }}
            />
            )}
          </>
        ) : null}
      </Modal>
      {lookup ? <p role="alert" className="text-[13px] text-hold lg:col-span-2">{lookup} Check your deals list for the new deal.</p> : null}
    </main>
  )
}

function feeNote(fee: bigint, payer: FeePayer): string {
  const { buyer, supplier } = feeShares(fee, payer)
  if (payer === 0) return `You prepay all of it (${formatAmount(buyer)} USDC); returned with any refunded part`
  if (payer === 1) return `Taken from the supplier at payout (${formatAmount(supplier)} USDC); you prepay none`
  return `Split: you prepay ${formatAmount(buyer)} USDC, the supplier pays ${formatAmount(supplier)} USDC at payout`
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

type ArbiterChoices = ReturnType<typeof useArbiterChoices>

/** One arbiter wallet: a pick from the approved list or a pasted address, checked against the list contract. */
/** With a clash (the buyer's own wallet, or a repeat on the panel) only the clash error shows, not the list check as well. */
function ArbiterField({ id, label, value, onChange, check, choices, clash = false }: { id: string; label: string; value: string; onChange: (v: string) => void; check: ReturnType<typeof useArbiterCheck>; choices: ArbiterChoices; clash?: boolean }) {
  return (
    <div>
      <label className="label block" htmlFor={id}>{label}</label>
      {choices.arbiters.length > 0 ? (
        <select aria-label={`Choose an approved arbiter for ${label}`} className={`${input} mb-2`} value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
          <option value="">Choose from the approved list…</option>
          {choices.arbiters.map((a) => (
            <option key={a.address} value={a.address}>{shortAddress(a.address)} · fee {formatAmount(a.fee)} USDC</option>
          ))}
        </select>
      ) : null}
      {choices.note ? <p className="mb-1 text-[12px] text-graphite">{choices.note}</p> : null}
      <input id={id} className={`${input} mono`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="0x… from the approved list" spellCheck={false} />
      {clash ? null : <p className="mt-1 text-[12px]" role="status">
        {check === null ? <span className="text-graphite">Decides disputes. Must be on the approved list.</span> : null}
        {check?.status === 'loading' ? <span className="text-graphite">Checking the approved list…</span> : null}
        {check?.status === 'error' ? <span className="text-hold">Could not check the list: {check.message}</span> : null}
        {check?.status === 'ready' && check.value.allowed ? <span className="text-released">On the approved list · fee {formatAmount(check.value.fee)} USDC, paid only if they decide in time</span> : null}
        {check?.status === 'ready' && !check.value.allowed ? <span className="text-hold">Not on the approved list.</span> : null}
      </p>}
    </div>
  )
}
