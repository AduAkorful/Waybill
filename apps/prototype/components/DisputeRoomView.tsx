"use client";

import { useState } from "react";
import type { Tranche } from "@/demo/deal";
import { splitParts, type DealRecord, type DisputeRecord } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { act } from "@/demo/store";
import { TxFlow } from "./TxFlow";

const ESCROW = "WaybillEscrow · demo";
type Viewer = "Buyer" | "Supplier" | "Arbiter";

const kindLabel: Record<string, string> = { filing: "Filing", response: "Response", evidence: "Added evidence" };

/** What the attestor signed for this stub, and the fingerprints of the files behind it. */
function SignedRecord({ t }: { t: Tranche }) {
  if (!t.signedBy) return null;
  return (
    <section className="rounded-md border border-rule bg-sheet p-4">
      <p className="label">What was signed</p>
      <p className="mt-1 text-[14px]">
        <span className="font-semibold">{t.signedBy}</span> confirmed “{t.title.charAt(0).toLowerCase() + t.title.slice(1)}” on {t.signedAt}.
      </p>
      <p className="mt-1 text-[12.5px] text-graphite">Their statement covers only what it names. Units or events outside it aren't covered by the signature.</p>
      {t.evidence?.length ? (
        <ul className="mt-3 divide-y divide-rule rounded-md border border-rule bg-paper text-[13px]">
          {t.evidence.map((f) => (
            <li key={f.name} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span>
                <span className="font-medium">{f.name}</span> <span className="text-graphite">· {f.detail}</span>
              </span>
              <span className="mono shrink-0 text-[11px] text-graphite">{f.hash}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Entries({ rec }: { rec: DisputeRecord }) {
  return (
    <ol className="space-y-3">
      {rec.entries.map((e, i) => (
        <li key={i} className={`rounded-md border bg-sheet p-4 ${e.role === "Buyer" ? "border-hold/35" : "border-rule"}`}>
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[14px] font-semibold">{e.who}</span>
            <span className="mono text-[11px] text-graphite">{e.at}</span>
          </p>
          <p className="label">
            {e.role} · {kindLabel[e.kind]}
          </p>
          <p className="mt-1.5 text-[14px] leading-snug">{e.text}</p>
          {e.files.length ? (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {e.files.map((f) => (
                <span key={f} className="mono rounded border border-rule px-1.5 py-0.5 text-[11px] text-graphite">
                  {f}
                </span>
              ))}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Append-only evidence for either party. Earlier entries are never edited or replaced. */
function AddEvidence({ d, t, viewer, rec }: { d: DealRecord; t: Tranche; viewer: "Buyer" | "Supplier"; rec: DisputeRecord }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const needsResponse = viewer === "Supplier" && !rec.entries.some((e) => e.role === "Supplier");
  const ready = text.trim().length >= 12 && files.length > 0;
  if (rec.decision) return null;
  if (!open)
    return (
      <div className="rounded-md border border-rule bg-sheet p-4">
        <p className="text-[14px] font-semibold">{needsResponse ? "Your response is due" : "Add to the record"}</p>
        <p className="mt-1 text-[13px] text-graphite">
          {needsResponse
            ? `Respond by ${rec.responseDue} GMT with your side and files. After that, the arbiter decides.`
            : "You can add evidence until the arbiter decides. It's added after what's already there, never instead of it."}
        </p>
        <button onClick={() => setOpen(true)} className="mt-3 rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper">
          {needsResponse ? "Respond with evidence" : "Add evidence"}
        </button>
      </div>
    );
  return (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <label className="label block" htmlFor="ev-text">
        {needsResponse ? "Your response" : "What this shows"}
      </label>
      <textarea id="ev-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} className="mt-1 w-full rounded-md border border-rule bg-paper p-2.5 text-[14px] outline-none focus:border-held" />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {files.map((f) => (
          <span key={f} className="mono rounded border border-rule px-1.5 py-0.5 text-[11px] text-graphite">
            {f}
          </span>
        ))}
        <button onClick={() => setFiles((x) => [...x, `file-${x.length + 1}.pdf`])} className="rounded border border-dashed border-graphite/60 px-2 py-0.5 text-[12px]">
          + Add file
        </button>
      </div>
      <div className="mt-3">
        {ready ? (
          <TxFlow
            confirmLabel={needsResponse ? "Send response" : "Add to the record"}
            steps={[
              {
                label: "Submit",
                wallet: { action: `${needsResponse ? "respondToDispute" : "appendDisputeEvidence"}(${d.onchainId}, ${t.index - 1}, evidenceHash)`, to: ESCROW, note: "Adds a fingerprint; never replaces earlier ones" },
              },
            ]}
            onCancel={() => setOpen(false)}
            onDone={() => {
              act.addEvidence(d.id, t.index, viewer, text.trim().slice(0, 140), files, needsResponse ? "response" : "evidence");
              setOpen(false);
              setText("");
              setFiles([]);
            }}
          />
        ) : (
          <p className="rounded-md border border-dashed border-rule p-2.5 text-center text-[12.5px] text-graphite">Write what it shows and add at least one file.</p>
        )}
      </div>
    </div>
  );
}

/** The arbiter's only choices for one frozen stub. Reasoning is required and published. */
function Decide({ d, t, rec }: { d: DealRecord; t: Tranche; rec: DisputeRecord }) {
  const [outcome, setOutcome] = useState<"release" | "refund" | "split" | null>(null);
  const [bps, setBps] = useState(5000);
  const [reason, setReason] = useState("");
  const parts = splitParts({ ...t, splitBps: bps });

  if (rec.decision) return null;
  if (!rec.responseClosed)
    return (
      <div className="rounded-md border border-rule bg-sheet p-4">
        <p className="text-[14px] font-semibold">You can decide after {rec.responseDue} GMT</p>
        <p className="mt-1 text-[13px] text-graphite">The supplier's response window is still open. Deciding before it closes isn't possible.</p>
        <button onClick={() => act.closeResponseWindow(d.id, t.index)} className="mt-3 rounded-md border border-dashed border-graphite/60 px-3 py-1.5 text-[12.5px] text-graphite">
          Demo: fast-forward past the response window
        </button>
      </div>
    );

  const options = [
    { k: "release" as const, title: "Release to supplier", sub: `${usdc(t.amount)} to their payout address`, tone: "border-released/60 text-released" },
    { k: "refund" as const, title: "Refund to buyer", sub: `${usdc(t.amount + t.fee)} incl. fee to their refund address`, tone: "border-refunded/60 text-refunded" },
    { k: "split" as const, title: "Split between them", sub: "By a stated share", tone: "border-ink/50 text-ink" },
  ];
  const ready = outcome && reason.trim().length >= 20;
  return (
    <div data-decision className="rounded-md border border-rule bg-sheet p-4">
      <p className="label">
        Your decision on stub {t.index} · {usdc(t.amount)} USDC
      </p>
      <div className="mt-3 grid gap-2">
        {options.map((o) => (
          <button
            key={o.k}
            onClick={() => setOutcome(o.k)}
            aria-pressed={outcome === o.k}
            className={`rounded-md border px-3 py-2.5 text-left text-[13.5px] font-semibold ${outcome === o.k ? `${o.tone} bg-paper ring-2 ring-current/20` : "border-rule"}`}
          >
            {o.title}
            <span className="block text-[12px] font-normal text-graphite">{o.sub}</span>
          </button>
        ))}
      </div>
      {outcome === "split" ? (
        <div className="mt-3 rounded-md border border-rule bg-paper p-3 text-[13px]">
          <label className="label block" htmlFor="split">
            Supplier's share · {bps / 100}%
          </label>
          <input id="split" type="range" min={0} max={10000} step={500} value={bps} onChange={(e) => setBps(Number(e.target.value))} className="mt-2 w-full accent-[var(--held)]" />
          <p className="mono mt-1 flex justify-between text-[12px]">
            <span className="text-released">supplier {usdc(parts.toSupplier)}</span>
            <span className="text-refunded">buyer {usdc(parts.toBuyer)}</span>
          </p>
        </div>
      ) : null}
      <label className="label mt-4 block" htmlFor="reasoning">
        Reasoning, published on the deal record
      </label>
      <textarea
        id="reasoning"
        rows={4}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What the evidence shows and why this outcome follows."
        className="mt-1 w-full rounded-md border border-rule bg-paper p-2.5 text-[13.5px] leading-snug outline-none focus:border-held"
      />
      <div className="mt-3">
        {ready ? (
          <TxFlow
            tone={outcome === "refund" ? "refunded" : outcome === "release" ? "released" : "held"}
            confirmLabel="Record decision"
            steps={[
              {
                label: "Decide",
                wallet: {
                  action: outcome === "split" ? `resolveSplit(${d.onchainId}, ${t.index - 1}, ${bps})` : `resolve(${d.onchainId}, ${t.index - 1}, ${outcome === "release"})`,
                  to: ESCROW,
                  note: "Final for this stub. Funds go only to the supplier or the buyer.",
                },
              },
            ]}
            onCancel={() => setOutcome(null)}
            onDone={() => act.resolve(d.id, t.index, outcome!, reason.trim().slice(0, 160), bps)}
          />
        ) : (
          <p className="rounded-md border border-dashed border-rule p-2.5 text-center text-[12.5px] text-graphite">
            Choose an outcome and write at least a sentence of reasoning.
          </p>
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-graphite">
        No other recipient or amount is possible. Your {usdc(d.arbiterFee)} fee is credited when you decide before {rec.decideBy}.
      </p>
    </div>
  );
}

function Outcome({ d, t, rec }: { d: DealRecord; t: Tranche; rec: DisputeRecord }) {
  const dec = rec.decision!;
  const parts = splitParts({ ...t, splitBps: dec.supplierBps });
  return (
    <div className={`rounded-md border p-4 ${dec.outcome === "refund" ? "border-refunded/40 bg-refunded-wash" : "border-released/40 bg-released-wash"}`}>
      <p className="label">Decided {dec.at} · final</p>
      <p className="mt-1 text-[15px] font-semibold">
        {dec.outcome === "release"
          ? `Released ${usdc(t.amount)} to ${d.supplier.org.split(" ").slice(0, 2).join(" ")}`
          : dec.outcome === "refund"
            ? `Refunded ${usdc(t.amount + t.fee)} to ${d.buyer.name}`
            : `Split: ${usdc(parts.toSupplier)} to the supplier, ${usdc(parts.toBuyer)} to the buyer`}
      </p>
      <p className="mt-2 text-[13.5px] leading-snug">“{dec.reasoning}”</p>
      <p className="mt-1 text-[12.5px] text-graphite">— {d.arbiter.name}. This decides the frozen stub only; it doesn't settle any wider legal claim.</p>
    </div>
  );
}

export function DisputeRoomView({ d, idx, viewer }: { d: DealRecord; idx: number; viewer: Viewer }) {
  const t = d.tranches.find((x) => x.index === idx);
  const rec = d.disputes?.[idx];
  if (!t || !rec) return <p className="py-10 text-center text-graphite">There is no dispute on stub {idx}.</p>;

  const status = rec.decision ? "Decided" : rec.withdrawn ? "Withdrawn" : rec.responseClosed ? "Waiting for the arbiter" : "Waiting for the supplier's response";
  const others = d.tranches.filter((x) => x.index !== idx);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={`label ${rec.decision ? "" : "text-hold"}`}>
            {d.id} · stub {idx} · {status}
          </p>
          <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-tight md:text-[28px]">
            {t.short} dispute · {usdc(t.amount)} frozen
          </h1>
          <p className="mt-1 text-[13.5px] text-graphite">
            {d.goods} · {d.buyer.org} ↔ {d.supplier.org}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px] md:grid-cols-4">
        {[
          ["Raised", `${rec.raisedAt} by the ${rec.raisedBy.toLowerCase()}`],
          ["Supplier response", rec.responseClosed ? `Closed ${rec.responseDue}` : `Due ${rec.responseDue}`],
          ["Arbiter decides by", rec.decideBy],
          ["If no decision", "Refunded to the buyer"],
        ].map(([k, v]) => (
          <div key={k} className="bg-sheet px-3.5 py-2.5">
            <dt className="label">{k}</dt>
            <dd className="mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[12.5px] text-graphite">
        Not affected:{" "}
        {others.map((o, i) => (
          <span key={o.index}>
            {i ? ", " : ""}stub {o.index} ({o.state === "released" ? "paid" : o.state.replace("_", " ")})
          </span>
        ))}
        .
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <SignedRecord t={t} />
          <div>
            <h2 className="label mb-2">Evidence, in order</h2>
            <Entries rec={rec} />
          </div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {rec.decision ? <Outcome d={d} t={t} rec={rec} /> : null}
          {rec.withdrawn ? (
            <p className="rounded-md border border-rule bg-sheet p-4 text-[13.5px]">The buyer withdrew this dispute. The stub went back to its normal path.</p>
          ) : viewer === "Arbiter" ? (
            <Decide d={d} t={t} rec={rec} />
          ) : (
            <AddEvidence d={d} t={t} viewer={viewer} rec={rec} />
          )}
          {viewer !== "Arbiter" && !rec.decision ? (
            <p className="text-[12.5px] leading-relaxed text-graphite">
              The arbiter, {d.arbiter.name}, can only release this stub to the supplier, refund it to the buyer, or split it between you. They can't touch any other
              stub or send money anywhere else.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
