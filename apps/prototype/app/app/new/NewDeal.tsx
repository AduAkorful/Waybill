"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { attestors } from "@/demo/attestors";
import { usdc } from "@/demo/format";
import { act, useDemo } from "@/demo/store";
import { DemoInvites } from "@/components/builder/DemoInvites";
import { ACCEPTANCE_WARN_BPS, arbiters, confirmLabel, dateAfter, MAX_PARTS, templates, uncheckedBps, type Confirm, type Template, type TemplatePart } from "@/demo/templates";
import { Modal } from "@/components/Modal";
import { LineItems } from "@/components/Sheet";
import { TxFlow } from "@/components/TxFlow";
import { ShareLink } from "@/components/builder/ShareLink";
import { SplitEditor } from "@/components/builder/SplitEditor";

type FeePayer = "Buyer" | "Supplier" | "Split";
const field = "w-full rounded-md border border-rule bg-paper px-3 py-2 text-[14px] outline-none focus:border-ink";
const origins = [
  { code: "CAN", city: "Guangzhou" },
  { code: "SZX", city: "Shenzhen" },
  { code: "YIW", city: "Yiwu" },
  { code: "CAN", city: "Dongguan" },
];
const fee = (cents: number) => Math.round((cents * 75) / 10_000);

const clone = (t: Template): TemplatePart[] => t.parts.map((p) => ({ ...p }));

export function NewDeal() {
  const router = useRouter();
  const { ops, settings, deals } = useDemo();
  const [tid, setTid] = useState("standard");
  const [parts, setParts] = useState<TemplatePart[]>(() => clone(templates[1]!));
  const [goods, setGoods] = useState("Power banks, 10,000 mAh");
  const [units, setUnits] = useState("4800");
  const [totalText, setTotalText] = useState("20000");
  const [originIdx, setOriginIdx] = useState(0);
  const [supplierName, setSupplierName] = useState("Chen Hao");
  const [supplierOrg, setSupplierOrg] = useState("Baiyun Brightpower Electronics Co., Ltd.");
  const inspectors = attestors.filter((a) => a.kind === "Inspector");
  const forwarders = attestors.filter((a) => a.kind !== "Inspector");
  const [inspIdx, setInspIdx] = useState(0);
  const [fwdIdx, setFwdIdx] = useState(0);
  const [feePayer, setFeePayer] = useState<FeePayer>("Buyer");
  const [acceptDays, setAcceptDays] = useState(7);
  const [tx, setTx] = useState(false);
  const [madeId, setMadeId] = useState<string | null>(null);

  const template = templates.find((t) => t.id === tid)!;
  const total = Math.round((Number(totalText.replace(/,/g, "")) || 0) * 100);
  const arbiter = arbiters[0]!;
  const sum = parts.reduce((s, p) => s + p.bps, 0);

  const pick = (t: Template) => {
    setTid(t.id);
    setParts(clone(t));
  };
  const setPart = (i: number, over: Partial<TemplatePart>) => setParts((ps) => ps.map((p, k) => (k === i ? { ...p, ...over } : p)));
  const setBps = (bps: number[]) => setParts((ps) => ps.map((p, k) => ({ ...p, bps: bps[k]! })));

  const needInspector = parts.some((p) => p.confirm === "inspector");
  const needForwarder = parts.some((p) => p.confirm === "forwarder");
  const inspector = inspectors[inspIdx]!;
  const forwarder = forwarders[fwdIdx]!;
  const blockedAttestor = (needInspector && inspector.status !== "Active") || (needForwarder && forwarder.status !== "Active");

  // Amounts: the last part takes the rounding remainder so the parts always add to the total exactly.
  const amounts = useMemo(() => {
    let left = total;
    return parts.map((p, i) => {
      const a = i === parts.length - 1 ? left : Math.round((total * p.bps) / 10_000);
      left -= a;
      return a;
    });
  }, [parts, total]);
  const feeTotal = amounts.reduce((s, a) => s + fee(a), 0);
  const feeLock = feePayer === "Buyer" ? feeTotal : feePayer === "Split" ? Math.ceil(feeTotal / 2) : 0;
  const lock = total + feeLock + arbiter.fee;

  const problems: string[] = [];
  if (ops.paused) problems.push("New deals are paused right now. Funded deals are not affected.");
  if (sum !== 10_000) problems.push(`The parts add up to ${sum / 100}%, not 100%.`);
  if (!goods.trim()) problems.push("Describe the goods.");
  if (total <= 0) problems.push("Enter the order total.");
  if (total > 5_000_000) problems.push("Early access caps a single deal at 50,000.00 USDC.");
  if (!supplierName.trim() || !supplierOrg.trim()) problems.push("Name the supplier and their company.");
  if (parts.some((p) => !p.name.trim())) problems.push("Every part needs a name.");
  if (blockedAttestor) problems.push("The attestor you picked is scheduled for suspension and can't be named in new deals.");

  const unchecked = uncheckedBps(parts);
  const risk = unchecked > 0 ? Math.round((total * unchecked) / 10_000) : 0;

  const dueDate = (p: TemplatePart) => dateAfter(acceptDays + p.dueDays);
  const lastWithDate = [...parts].reverse().find((p) => p.confirm !== "acceptance");

  const sentence = (p: TemplatePart, i: number) => {
    const amt = `${usdc(amounts[i]!)} USDC`;
    switch (p.confirm) {
      case "acceptance":
        return `The supplier receives ${amt} as soon as they accept and you fund.`;
      case "inspector":
        return `The supplier receives ${amt} when ${inspector.name} signs “${p.name.toLowerCase()}”. You have ${p.reviewHours} hours to object.`;
      case "forwarder":
        return `The supplier receives ${amt} when ${forwarder.name} confirms “${p.name.toLowerCase()}”. You have ${p.reviewHours} hours to object.`;
      case "buyer":
        return `The supplier receives ${amt} when you approve “${p.name.toLowerCase()}”, or ${p.reviewHours} hours after they ask if you say nothing.`;
      case "timed":
        return `The supplier receives ${amt} on ${dueDate(p)} unless you dispute it first.`;
    }
  };

  const create = () => {
    try {
      const id = act.createDeal({
        goods: goods.trim(),
        units: Number(units) || 0,
        cartons: Math.max(1, Math.round((Number(units) || 0) / 10)),
        origin: origins[originIdx]!,
        destination: { code: "ACC", city: "Accra" },
        template: template.name,
        total,
        parts: parts.map((p) => ({ name: p.name.trim(), nameZh: p.nameZh, short: p.short, bps: p.bps, confirm: p.confirm, reviewHours: p.reviewHours, due: dueDate(p) })),
        supplier: { name: supplierName.trim(), org: supplierOrg.trim() },
        inspector: needInspector ? { name: inspector.name, org: inspector.org } : undefined,
        forwarder: needForwarder ? { name: forwarder.name, org: forwarder.org } : undefined,
        feePayer,
        arbiterFee: arbiter.fee,
        acceptanceDeadline: dateAfter(acceptDays),
      });
      setTx(false);
      setMadeId(id);
      window.scrollTo({ top: 0 });
    } catch {
      setTx(false);
    }
  };

  if (madeId) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 md:py-14">
        <p className="label text-released">Deal created</p>
        <h1 className="mt-1 text-[30px] leading-tight font-semibold tracking-tight">Send the link. Nothing is locked yet.</h1>
        <p className="mt-2 text-[14.5px] text-graphite">
          {madeId} moves forward as everyone accepts. You fund it only after the supplier{needInspector || needForwarder ? " and the attestors" : ""} and the arbiter have all accepted. If they don't by {dateAfter(acceptDays)}, it cancels and you owe nothing.
        </p>
        <div className="mt-6">
          <ShareLink id={madeId} goods={goods.trim()} buyerName={settings.name} dealHref={`/app/deals/${madeId}`} />
        </div>
        <div className="mt-6">{deals[madeId] ? <DemoInvites deal={deals[madeId]!} /> : null}</div>
        <div className="mt-6 flex flex-wrap gap-4 text-[14px]">
          <Link href="/app/new" onClick={() => setMadeId(null)} className="font-semibold text-held underline decoration-held/30 underline-offset-4">
            Build another
          </Link>
          <Link href="/app" className="text-graphite hover:text-ink">
            Back to deals
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-x-10 px-4 pt-6 pb-32 md:px-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-14">
      <div className="min-w-0">
        <p className="label">New deal</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight md:text-[32px]">Set the terms. The supplier sees them in plain words.</h1>

        {ops.paused ? (
          <div role="status" className="mt-5 rounded-md border border-hold/50 bg-hold-wash px-4 py-3 text-[13.5px]">
            <p className="font-semibold text-hold">New deals are paused</p>
            <p className="mt-0.5">The Waybill team paused creating and funding new deals. You can keep building; create it when deals reopen. Deals already funded keep working: payments, refunds and disputes are not affected.</p>
          </div>
        ) : null}

        <Section n={1} title="The order">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Goods" className="sm:col-span-2">
              <input className={field} value={goods} onChange={(e) => setGoods(e.target.value)} />
            </Labelled>
            <Labelled label="Units">
              <input className={`${field} mono`} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ""))} />
            </Labelled>
            <Labelled label="Order total (USDC)">
              <input className={`${field} mono`} inputMode="decimal" value={totalText} onChange={(e) => setTotalText(e.target.value.replace(/[^\d.,]/g, ""))} aria-describedby="total-hint" />
              <span id="total-hint" className="mt-1 block text-[12px] text-graphite">
                {total > 0 ? `${usdc(total)} USDC${settings.estimate === "GHS" ? ` · ≈ GH₵${Math.round((total / 100) * 11.2).toLocaleString("en-US")} est.` : ""}` : "Enter an amount"}
              </span>
            </Labelled>
            <Labelled label="Ships from">
              <select className={field} value={originIdx} onChange={(e) => setOriginIdx(Number(e.target.value))}>
                {origins.map((o, i) => (
                  <option key={i} value={i}>
                    {o.city} ({o.code})
                  </option>
                ))}
              </select>
            </Labelled>
            <Labelled label="Delivered to">
              <input className={field} value="Accra (ACC), via Tema port" readOnly />
            </Labelled>
          </div>
        </Section>

        <Section n={2} title="How the money is paid out">
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Template">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={t.id === tid}
                  data-template={t.id}
                  onClick={() => pick(t)}
                  className={`h-full w-full rounded-md border p-3 text-left ${t.id === tid ? "border-held bg-held-wash" : "border-rule bg-sheet hover:border-ink/40"}`}
                >
                  <span className="block text-[13.5px] font-semibold">{t.name}</span>
                  <span className="block text-[12px] text-graphite">{t.line}</span>
                  <span className="mt-1 block text-[12px] text-graphite">{t.blurb}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6">
            <SplitEditor parts={parts} total={total} onChange={setBps} />
          </div>

          {unchecked > ACCEPTANCE_WARN_BPS ? (
            <div role="note" className="mt-4 rounded-md border border-hold/50 bg-hold-wash px-3.5 py-2.5 text-[13px]">
              <span className="font-semibold text-hold">{unchecked / 100}% moves with no outside check.</span> {usdc(risk)} USDC is paid when the supplier accepts and you fund. Most buyers keep this at {ACCEPTANCE_WARN_BPS / 100}% or less. You can still continue.
            </div>
          ) : null}

          <ol className="mt-5 space-y-3">
            {parts.map((p, i) => (
              <li key={i} data-part={i} className="rounded-md border border-rule bg-sheet p-3.5">
                <div className="flex items-start gap-3">
                  <span className="mono mt-2 w-4 text-[12px] text-graphite">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_96px]">
                    <Labelled label="What happens">
                      <input className={field} value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} aria-label={`Part ${i + 1} name`} />
                    </Labelled>
                    <Labelled label="Share">
                      <div className="relative">
                        <input
                          className={`${field} mono pr-7 text-right`}
                          inputMode="decimal"
                          value={String(p.bps / 100)}
                          aria-label={`Part ${i + 1} percentage`}
                          onChange={(e) => {
                            const v = Number(e.target.value.replace(/[^\d.]/g, ""));
                            setPart(i, { bps: Math.max(0, Math.min(10_000, Math.round(v * 100))) });
                          }}
                        />
                        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[13px] text-graphite">%</span>
                      </div>
                    </Labelled>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <Labelled label="Paid when" className="col-span-2 sm:col-span-1">
                      {template.custom ? (
                        <select className={field} value={p.confirm} onChange={(e) => setPart(i, { confirm: e.target.value as Confirm, reviewHours: e.target.value === "acceptance" ? 0 : p.reviewHours || 24 })}>
                          {(["acceptance", "inspector", "forwarder", "buyer", "timed"] as Confirm[])
                            .filter((c) => c !== "acceptance" || i === 0)
                            .map((c) => (
                              <option key={c} value={c}>
                                {confirmLabel[c]}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <p className="py-2 text-[13.5px]">{confirmLabel[p.confirm]}</p>
                      )}
                    </Labelled>
                      <Labelled label="Due after (days)">
                        <input className={`${field} mono`} inputMode="numeric" disabled={p.confirm === "acceptance"} value={p.confirm === "acceptance" ? "0" : String(p.dueDays)} onChange={(e) => setPart(i, { dueDays: Math.min(365, Number(e.target.value.replace(/\D/g, "")) || 0) })} />
                      </Labelled>
                      <Labelled label="Time to object">
                        <select className={field} disabled={p.confirm === "acceptance"} value={p.reviewHours} onChange={(e) => setPart(i, { reviewHours: Number(e.target.value) })}>
                          {p.confirm === "acceptance" ? <option value={0}>None</option> : [12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} hours</option>)}
                        </select>
                      </Labelled>
                    </div>
                  </div>
                  {template.custom && parts.length > 2 ? (
                    <button type="button" aria-label={`Remove part ${i + 1}`} onClick={() => setParts((ps) => { const rest = ps.filter((_, k) => k !== i); const gone = ps[i]!.bps; rest[rest.length - 1] = { ...rest[rest.length - 1]!, bps: rest[rest.length - 1]!.bps + gone }; return rest; })} className="mt-1 rounded p-1.5 text-[13px] text-graphite hover:text-hold">
                      ✕
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 pl-7 text-[12.5px] text-graphite">
                  <span className="mono text-ink">{usdc(amounts[i]!)}</span> USDC · due {p.confirm === "acceptance" ? "when accepted" : dueDate(p)}
                </p>
              </li>
            ))}
          </ol>
          {template.custom && parts.length < MAX_PARTS ? (
            <button
              type="button"
              onClick={() =>
                setParts((ps) => {
                  const last = ps[ps.length - 1]!;
                  const half = Math.floor(last.bps / 200) * 100;
                  return [...ps.slice(0, -1), { ...last, bps: last.bps - half }, { name: "New part", nameZh: "新阶段", short: "Part", bps: half, confirm: "buyer", reviewHours: 24, dueDays: last.dueDays + 10 }];
                })
              }
              className="mt-3 rounded-md border border-dashed border-ink/40 px-3.5 py-2 text-[13px] font-semibold hover:bg-sheet"
            >
              + Add a part ({parts.length} of {MAX_PARTS})
            </button>
          ) : null}
        </Section>

        <Section n={3} title="Who is involved">
          <div className="grid gap-3 sm:grid-cols-2">
            <Labelled label="Supplier's name">
              <input className={field} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            </Labelled>
            <Labelled label="Supplier's company">
              <input className={field} value={supplierOrg} onChange={(e) => setSupplierOrg(e.target.value)} />
            </Labelled>
            {needInspector ? (
              <Labelled label="Inspector">
                <select className={field} value={inspIdx} onChange={(e) => setInspIdx(Number(e.target.value))}>
                  {inspectors.map((a, i) => (
                    <option key={a.slug} value={i} disabled={a.status !== "Active"}>
                      {a.name}, {a.org} · {a.city}{a.status !== "Active" ? " (suspension scheduled)" : ""}
                    </option>
                  ))}
                </select>
                <Link href={`/attestors/${inspector.slug}`} target="_blank" className="mt-1 block text-[12px] text-held underline decoration-held/30 underline-offset-2">
                  See their record ↗
                </Link>
              </Labelled>
            ) : null}
            {needForwarder ? (
              <Labelled label="Forwarder or clearing agent">
                <select className={field} value={fwdIdx} onChange={(e) => setFwdIdx(Number(e.target.value))}>
                  {forwarders.map((a, i) => (
                    <option key={a.slug} value={i} disabled={a.status !== "Active"}>
                      {a.name}, {a.org} · {a.city}{a.status !== "Active" ? " (suspension scheduled)" : ""}
                    </option>
                  ))}
                </select>
                <Link href={`/attestors/${forwarder.slug}`} target="_blank" className="mt-1 block text-[12px] text-held underline decoration-held/30 underline-offset-2">
                  See their record ↗
                </Link>
              </Labelled>
            ) : null}
            <Labelled label="Arbiter" className="sm:col-span-2">
              <p className="rounded-md border border-rule bg-sheet px-3 py-2 text-[13.5px]">
                <span className="font-semibold">{arbiter.name}</span> · fee <span className="mono">{usdc(arbiter.fee)}</span> USDC, paid up front and returned to you unless they decide a dispute.
                <span className="block text-[12px] text-graphite">{arbiter.note}. The arbiter can only release, refund or split a disputed part.</span>
              </p>
            </Labelled>
          </div>
          {!needInspector && !needForwarder ? <p className="mt-3 text-[13px] text-graphite">This template needs no inspector or forwarder. Only you, the supplier and the arbiter are involved.</p> : null}
        </Section>

        <Section n={4} title="Fee and deadlines">
          <div role="radiogroup" aria-label="Who pays the Waybill fee" className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["Buyer", "You pay it", "Added to what you lock. The supplier receives the full order."],
                ["Supplier", "Supplier pays it", "Taken from each payment to the supplier."],
                ["Split", "Split 50/50", "Half added to what you lock, half taken from payments."],
              ] as [FeePayer, string, string][]
            ).map(([v, t, d]) => (
              <button key={v} type="button" role="radio" aria-checked={feePayer === v} onClick={() => setFeePayer(v)} className={`rounded-md border p-3 text-left ${feePayer === v ? "border-held bg-held-wash" : "border-rule bg-sheet hover:border-ink/40"}`}>
                <span className="block text-[13.5px] font-semibold">{t}</span>
                <span className="block text-[12px] text-graphite">{d}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-graphite">The Waybill fee is 0.75% of each payment: <span className="mono">{usdc(feeTotal)}</span> USDC on this order.</p>
          <div className="mt-4 max-w-xs">
            <Labelled label="Everyone must accept within">
              <select className={field} value={acceptDays} onChange={(e) => setAcceptDays(Number(e.target.value))}>
                {[3, 7, 14, 21].map((d) => (
                  <option key={d} value={d}>
                    {d} days · by {dateAfter(d)}
                  </option>
                ))}
              </select>
            </Labelled>
          </div>
        </Section>
      </div>

      <aside id="summary" className="mt-2 min-w-0 lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-xl border border-rule bg-sheet p-4 md:p-5">
          <p className="label">What you are agreeing to</p>
          <div className="mt-3">
            <LineItems
              items={[
                { label: "Order", amount: total },
                ...(feeLock > 0 ? [{ label: "Waybill fee, 0.75%", amount: feeLock }] : []),
                { label: "Arbiter fee", amount: arbiter.fee, note: "Returned to you unless they decide a dispute" },
              ]}
              total={lock}
              totalLabel="You lock when you fund"
            />
          </div>
          <ol className="mt-4 space-y-2 border-t border-rule pt-4 text-[13.5px] leading-snug">
            {parts.map((p, i) => (
              <li key={i} data-summary className="flex gap-2.5">
                <span className="mono w-4 shrink-0 text-[12px] text-graphite">{i + 1}</span>
                {sentence(p, i)}
              </li>
            ))}
            {lastWithDate ? (
              <li data-summary className="flex gap-2.5">
                <span className="mono w-4 shrink-0 text-[12px] text-graphite">↩</span>
                If “{lastWithDate.name.toLowerCase()}” isn't confirmed by {dueDate(lastWithDate)} plus 72 hours, you can take that part back, with its fee.
              </li>
            ) : null}
            <li data-summary className="flex gap-2.5">
              <span className="mono w-4 shrink-0 text-[12px] text-graphite">!</span>
              If you dispute a part, only that part freezes. The arbiter decides; everything else carries on.
            </li>
          </ol>
          <p className="mt-4 rounded-md bg-paper px-3 py-2.5 text-[13px]">
            {risk > 0 ? (
              <>
                <span className="font-semibold">The most you can lose if nothing ships:</span> <span className="mono">{usdc(risk)}</span> USDC, the part paid on acceptance. Every other part waits for a signature or your approval.
              </>
            ) : (
              <>
                <span className="font-semibold">Nothing is paid without a check.</span> Every part waits for a signature, your approval, or a date.
              </>
            )}
          </p>

          {problems.length > 0 ? (
            <ul className="mt-4 space-y-1 text-[12.5px] text-hold" aria-label="Before you can create this deal">
              {problems.map((p) => (
                <li key={p}>• {p}</li>
              ))}
            </ul>
          ) : null}
          <button
            disabled={problems.length > 0}
            onClick={() => setTx(true)}
            className="mt-4 w-full rounded-md bg-held py-3 text-[14.5px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40"
          >
            Create the deal and get the link
          </button>
          <p className="mt-2 text-[12px] text-graphite">Creating costs only network gas, paid by the relayer. Nothing is locked until you fund, after everyone accepts.</p>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-[49px] z-20 flex items-center justify-between gap-3 border-t border-rule bg-paper/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <p className="min-w-0 text-[12px] leading-tight">
          <span className="text-graphite">You lock when you fund</span>
          <span className="mono block text-[15px] font-medium">{usdc(lock)} USDC</span>
        </p>
        <a href="#summary" className="rounded-md bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper">
          Review and create
        </a>
      </div>

      <Modal open={tx} onClose={() => setTx(false)} label="Create the deal">
        <p className="label">Create the deal</p>
        <h2 className="mt-1 text-[19px] font-semibold tracking-tight">Record the terms. Nothing moves.</h2>
        <p className="mt-2 mb-4 text-[13.5px] text-graphite">This writes the terms so everyone can accept them. No USDC is locked or sent.</p>
        <TxFlow
          steps={[{ label: "Create deal", wallet: { action: "Create a Waybill deal", to: "Waybill escrow (0xcf08…EfA)", note: `${parts.length} parts · ${usdc(total)} USDC order · no funds move` } }]}
          confirmLabel="Create the deal"
          onDone={create}
          onCancel={() => setTx(false)}
        />
      </Modal>
    </main>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9" aria-labelledby={`s${n}`}>
      <h2 id={`s${n}`} className="flex items-baseline gap-2.5 text-[19px] font-semibold tracking-tight">
        <span className="mono text-[13px] font-normal text-graphite">{n}</span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Labelled({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}
