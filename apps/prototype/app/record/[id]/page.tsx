"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Ledger } from "@/components/Ledger";
import { PublicShell } from "@/components/PublicShell";
import { Timeline } from "@/components/Timeline";
import { Waybill } from "@/components/Waybill";
import type { TimelineEvent } from "@/demo/deal";
import { refundedFor, type DealRecord } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { useDemo } from "@/demo/store";

/** Public view of the timeline: parties by role unless they chose to show names; private evidence text removed. */
function publicEvents(d: DealRecord, names: boolean): TimelineEvent[] {
  const supplierShort = d.supplier.org.split(" ").slice(0, 2).join(" ");
  const swaps: [string, string][] = names
    ? []
    : [
        [d.buyer.name, "Buyer"],
        [d.buyer.name.split(" ")[0]!, "the buyer"],
        [supplierShort, "Supplier"],
        [d.supplier.org, "the supplier"],
      ];
  const clean = (s: string) => swaps.reduce((t, [from, to]) => t.split(from).join(to), s);
  return d.timeline.map((e) => {
    let text = e.text;
    // Reasons and responses are evidence shared with the parties and arbiter, not the public
    text = text.replace(/(Disputed stub \d+): “[^”]*”\./, "$1.").replace(/(Responded on stub \d+): “[^”]*”/, "$1").replace(/(Added evidence on stub \d+): “[^”]*”/, "$1");
    return { ...e, actor: clean(e.actor), text: clean(text), initials: names ? e.initials : e.actor === d.buyer.name || e.actor === supplierShort ? "·" : e.initials };
  });
}

export default function PublicRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { deals } = useDemo();
  const d = deals[id.toUpperCase()];
  const [copied, setCopied] = useState(false);

  if (!d)
    return (
      <PublicShell>
        <main className="mx-auto max-w-2xl px-4 py-24 text-center">
          <h1 className="text-[26px] font-semibold">No deal called {id}</h1>
          <p className="mt-2 text-graphite">Check the link, or ask the buyer or supplier to send it again.</p>
        </main>
      </PublicShell>
    );

  const funded = d.state === "funded" || d.state === "settled";
  const names = !!d.publicNames;
  const paid = d.tranches.filter((t) => ["released", "refunded", "resolved"].includes(t.state)).length;
  const disputes = Object.values(d.disputes ?? {});
  const upheld = d.tranches.filter((t) => t.state === "refunded" && t.resolvedBy === "arbiter").length;
  const late = d.timeline.some((e) => e.text.includes("wasn't confirmed"));
  // The record speaks about the parties, not to them
  const view = d.tranches.map((t) => (t.short === "Acceptance" ? { ...t, confirmedBy: "Paid when the supplier accepts and the buyer funds" } : t));
  const status = d.state === "settled" ? "Settled" : d.state === "cancelled" ? "Cancelled before funding" : funded ? `Funded ${d.fundedAt?.split(",")[0]}` : "Not funded";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/record/${d.id}`);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  if (!funded && d.state !== "cancelled")
    return (
      <PublicShell>
        <main className="mx-auto max-w-2xl px-4 py-24">
          <p className="label">{d.id}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">This deal isn't public yet</h1>
          <p className="mt-2 text-[15px] text-graphite">
            A public record appears once the buyer funds the deal and the money is locked. Until then only the people named in it can see it.
          </p>
        </main>
      </PublicShell>
    );

  return (
    <PublicShell>
      <main className="mx-auto max-w-6xl px-4 pt-4 pb-20 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
          <div>
            <p className="label">
              Public deal record{d.test ? <span className="ml-2 rounded border border-dashed border-graphite/60 px-1 text-[10px] text-graphite">TEST DEAL · NOT COUNTED</span> : null}
            </p>
            <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight md:text-[34px]">
              {d.id} · {names ? `${d.origin.city} → ${d.destination.city}` : `${d.origin.code} → ${d.destination.code}`}
            </h1>
            <p className="mt-1.5 text-[14px] text-graphite">
              {status} · {paid} of {d.tranches.length} parts final · {disputes.length ? `${disputes.length} dispute${disputes.length > 1 ? "s" : ""}${upheld ? `, ${upheld} upheld` : ""}` : "no disputes"}
              {late ? " · one deadline missed" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <a href={`/explorer/${d.fundTx ?? d.timeline.find((e) => e.proof)?.proof ?? "none"}`} target="_blank" rel="noreferrer" className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">
              View on Arc explorer ↗
            </a>
            <Link href={`/print/${d.id}`} className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">
              Download summary
            </Link>
            <button onClick={copy} className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">
              {copied ? "Copied ✓" : "Copy link"}
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {d.state === "cancelled" ? (
              <p className="rounded-md border border-rule bg-sheet p-4 text-[14px]">This deal was cancelled before funding. Nothing was locked.</p>
            ) : (
              <Ledger ts={d.tranches} voice="public" arbiterFee={d.arbiterFee} size={d.funded} refunded={refundedFor(d)} held={d.state === "settled" ? 0 : undefined} />
            )}
            <div className="mt-8">
              <Waybill info={d} ts={view} detail="summary" compact showLockStamp={false} redacted={!names} proposed={!funded} />
            </div>

            {disputes.filter((r) => r.decision).map((r) => (
              <section key={r.stub} className="mt-8 rounded-md border border-rule bg-sheet p-5">
                <p className="label">Arbiter's decision on stub {r.stub} · {r.decision!.at} · final</p>
                <p className="mt-1.5 text-[15px] font-semibold">
                  {r.decision!.outcome === "release" ? "Released to the supplier" : r.decision!.outcome === "refund" ? "Refunded to the buyer" : `Split: ${(r.decision!.supplierBps ?? 0) / 100}% to the supplier`}
                </p>
                <p className="mt-2 text-[14px] leading-snug">“{r.decision!.reasoning}”</p>
                <p className="mt-2 text-[12px] text-graphite">Evidence from the parties stays private. This decision covers one frozen part and doesn't settle any wider legal claim.</p>
              </section>
            ))}
          </div>

          <aside>
            <div className="rounded-md border border-rule bg-sheet p-4 text-[13px] leading-relaxed">
              <p className="label">What this page shows</p>
              <p className="mt-2">
                Amounts, parts, dates and proof links come from the escrow contract; anyone can check them.{" "}
                {names ? "The buyer and supplier chose to show their names." : "The buyer's and supplier's names and the goods are hidden because they chose that."}
              </p>
              <p className="mt-2 text-graphite">Wallet addresses on the explorer are always public. Evidence and chat stay private.</p>
            </div>
            <h2 className="label mt-8 mb-3">Timeline</h2>
            <Timeline events={publicEvents(d, names)} nowLabel={d.timeline.some((e) => e.upcoming) ? "now" : undefined} />
          </aside>
        </div>

        <p className="mt-12 max-w-2xl text-[12.5px] leading-relaxed text-graphite">
          Total funded {funded ? usdc(d.funded) : "—"} USDC, including {usdc(d.feeTotal)} in fees and a {usdc(d.arbiterFee)} arbiter fee. Nobody at Waybill can move this
          money outside the deal's rules.
        </p>
      </main>
    </PublicShell>
  );
}
