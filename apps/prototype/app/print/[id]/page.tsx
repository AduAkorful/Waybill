"use client";

import Link from "next/link";
import { use } from "react";
import { Wordmark } from "@/components/Chrome";
import type { Tranche } from "@/demo/deal";
import { heldFor, refundedFor, releasedFor, splitParts, type DealRecord } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { demoNow, useDemo } from "@/demo/store";

const stateWord: Record<string, string> = {
  waiting: "Waiting",
  in_review: "In buyer's review",
  claimable: "Being paid",
  released: "Released to supplier",
  overdue: "Overdue, in grace period",
  refundable: "Refundable",
  refunded: "Refunded to buyer",
  disputed: "Frozen by dispute",
  resolved: "Split by arbiter",
};

/** Fees paid out of a tranche, by recipient, for the part that went to the supplier. */
function feeSplit(t: Tranche) {
  const share = t.state === "released" ? 1 : t.state === "resolved" ? (t.splitBps ?? 0) / 10_000 : 0;
  return { protocol: Math.round(t.feeProtocol * share), attestors: Math.round(t.feeAttestor * share) };
}

function outcomeOf(t: Tranche) {
  if (t.state === "resolved") {
    const p = splitParts(t);
    return `${usdc(p.toSupplier)} to supplier, ${usdc(p.toBuyer)} to buyer`;
  }
  if (t.state === "released") return `${usdc(t.amount)} to supplier`;
  if (t.state === "refunded") return `${usdc(t.amount + t.fee)} to buyer`;
  return "—";
}

export default function PrintRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { deals } = useDemo();
  const d: DealRecord | undefined = deals[id.toUpperCase()];
  if (!d) return <p className="px-4 py-16 text-center">No deal called {id}.</p>;

  const funded = d.state === "funded" || d.state === "settled";
  const fees = d.tranches.map(feeSplit);
  const protocol = fees.reduce((s, f) => s + f.protocol, 0);
  const attestorsPaid = fees.reduce((s, f) => s + f.attestors, 0);
  const arbiterLine = d.arbiterFeePaid ? `${usdc(d.arbiterFee)} paid to the arbiter for a decision made in time` : d.state === "settled" ? `${usdc(d.arbiterFee)} returned to the buyer (no decision was needed)` : `${usdc(d.arbiterFee)} held until a decision is made or the deal settles`;
  const events = d.timeline.filter((e) => !e.upcoming);
  const decisions = Object.values(d.disputes ?? {}).filter((r) => r.decision);

  return (
    <div className="min-h-dvh bg-paper py-6 print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-3 px-4">
        <Link href={`/app/deals/${d.id}`} className="text-[13px] text-graphite">
          ← Back to the deal
        </Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="rounded-md bg-ink px-4 py-2 text-[13.5px] font-semibold text-paper">
            Print or save as PDF
          </button>
        </div>
      </div>

      <article className="doc-light mx-auto max-w-[820px] border border-rule px-8 py-9 shadow-[var(--shadow)] sm:px-12" lang="en">
        <header className="flex items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <Wordmark className="text-[22px]" />
            <p className="label mt-1">Deal record · escrow waybill</p>
          </div>
          <div className="text-right">
            <p className="label">No.</p>
            <p className="mono text-[20px] font-medium">{d.id}</p>
            <p className="mono text-[11px] text-graphite">Generated 19 Oct 2026, {demoNow()} GMT · demo</p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 text-[13px] sm:grid-cols-4">
          {[
            ["Buyer", `${d.buyer.org}`, `${d.buyer.name}, ${d.buyer.city}`],
            ["Supplier", d.supplier.org, `${d.supplier.name}, ${d.supplier.city}`],
            ["Goods", d.goods, `${d.units.toLocaleString("en-US")} units · ${d.cartons} cartons`],
            ["Route", `${d.origin.city} → ${d.destination.city}`, `${d.origin.code} → ${d.destination.code}`],
            ["Template", `${d.template} ${d.templateVersion}`, `terms hash ${d.termsHash}`],
            ["Arbiter", d.arbiter.name, `fee ${usdc(d.arbiterFee)}, prepaid by buyer`],
            ["Funded", d.fundedAt ?? "Not funded", d.fundTx ? `tx ${d.fundTx}` : ""],
            ["Status", d.state === "settled" ? "Settled" : d.state === "cancelled" ? "Cancelled before funding" : funded ? "Funded, in progress" : "Not yet funded", ""],
          ].map(([k, v, sub]) => (
            <div key={k}>
              <p className="label">{k}</p>
              <p className="mt-0.5 font-semibold">{v}</p>
              {sub ? <p className="mono text-[11px] text-graphite">{sub}</p> : null}
            </div>
          ))}
        </section>

        <section className="mt-7">
          <h2 className="label border-b border-rule pb-1">Money</h2>
          <table className="mt-2 w-full text-[13px]">
            <tbody className="mono">
              {[
                ["Deal total", usdc(d.total)],
                [`Waybill fee, ${d.feeBps / 100}%`, usdc(d.feeTotal)],
                ["Arbiter fee (prepaid)", usdc(d.arbiterFee)],
                ["Locked in escrow", funded ? usdc(d.funded) : "—"],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-rule">
                  <td className="py-1.5 font-sans">{k}</td>
                  <td className="py-1.5 text-right">{v} USDC</td>
                </tr>
              ))}
              <tr className="border-b border-rule">
                <td className="py-1.5 font-sans">Released to supplier</td>
                <td className="py-1.5 text-right text-released">{usdc(releasedFor(d))} USDC</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-1.5 font-sans">Refunded to buyer (incl. fees on refunded parts)</td>
                <td className="py-1.5 text-right text-refunded">{usdc(refundedFor(d))} USDC</td>
              </tr>
              <tr>
                <td className="py-1.5 font-sans font-semibold">Still held in escrow</td>
                <td className="py-1.5 text-right font-semibold">{usdc(heldFor(d))} USDC</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-graphite">
            Fees on released parts: {usdc(protocol)} to the protocol and {usdc(attestorsPaid)} to the attestors who signed. Arbiter fee: {arbiterLine}.
          </p>
        </section>

        <section className="mt-7">
          <h2 className="label border-b border-rule pb-1">Parts</h2>
          <table className="mt-2 w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-ink text-[11px]">
                <th className="py-1.5 pr-2 font-semibold">#</th>
                <th className="py-1.5 pr-2 font-semibold">Part and who confirms</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Amount</th>
                <th className="py-1.5 pr-2 font-semibold">State</th>
                <th className="py-1.5 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {d.tranches.map((t) => (
                <tr key={t.index} className="border-b border-rule align-top">
                  <td className="mono py-2 pr-2">{t.index}</td>
                  <td className="py-2 pr-2">
                    <span className="font-semibold">{t.title}</span>
                    <span className="block text-graphite">
                      {t.short === "Acceptance" ? "Supplier acceptance and funding" : t.confirmedBy}
                      {t.signedBy ? ` · signed ${t.signedAt}` : ""}
                    </span>
                    {t.proof ? <span className="mono block text-[10.5px] text-graphite">proof {t.proof}</span> : null}
                  </td>
                  <td className="mono py-2 pr-2 text-right">{usdc(t.amount)}</td>
                  <td className="py-2 pr-2">{stateWord[t.state]}</td>
                  <td className="py-2">
                    {outcomeOf(t)}
                    {t.releasedAt ? <span className="block text-[11px] text-graphite">{t.releasedAt}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {decisions.length ? (
          <section className="mt-7">
            <h2 className="label border-b border-rule pb-1">Arbiter decisions</h2>
            {decisions.map((r) => (
              <div key={r.stub} className="mt-2 text-[13px]">
                <p className="font-semibold">
                  Stub {r.stub} · {r.decision!.at}: {r.decision!.outcome === "split" ? `split, ${(r.decision!.supplierBps ?? 0) / 100}% to the supplier` : r.decision!.outcome === "release" ? "released to the supplier" : "refunded to the buyer"}
                </p>
                <p className="text-graphite">“{r.decision!.reasoning}”</p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="mt-7">
          <h2 className="label border-b border-rule pb-1">What happened</h2>
          <ol className="mt-2 space-y-1 text-[12px]">
            {events.map((e, i) => (
              <li key={i} className="grid grid-cols-[6.5rem_1fr_auto] gap-3 border-b border-rule/60 py-1">
                <span className="mono text-graphite">
                  {e.day} {e.at}
                </span>
                <span>
                  <span className="font-semibold">{e.actor}</span> {e.text}
                </span>
                <span className="mono text-[10.5px] text-graphite">{e.proof ?? ""}</span>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-8 border-t border-rule pt-3 text-[11px] leading-relaxed text-graphite">
          This summary records what happened on the escrow, with transaction references you can check on the Arc explorer. It is not tax, customs or legal advice.
          Commercial terms (goods, prices, delivery) are in the parties' own terms document, whose fingerprint is shown above. Amounts are USDC. Demo data: invented
          parties and figures.
        </footer>
      </article>
    </div>
  );
}
