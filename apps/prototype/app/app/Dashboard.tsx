"use client";

import Link from "next/link";
import { heldFor, needsBuyer, releasedFor, refundedFor, type DealRecord } from "@/demo/deals";
import { demoNow, orderedIds, useDemo } from "@/demo/store";
import { usdc } from "@/demo/format";

const seg: Record<string, string> = {
  released: "bg-released",
  refunded: "bg-refunded",
  in_review: "bg-held",
  claimable: "bg-held",
  disputed: "bg-hold",
  waiting: "border border-held/50",
  overdue: "border border-dashed border-hold/70",
  refundable: "border border-dashed border-refunded/70",
  resolved: "bg-ink",
};

function MiniLedger({ d }: { d: DealRecord }) {
  const unfunded = d.state === "proposed" || d.state === "accepted" || d.state === "cancelled";
  return (
    <span className="flex h-1.5 w-full gap-[2px]" aria-hidden>
      {d.tranches.map((t) => (
        <span key={t.index} className={`rounded-[1px] ${unfunded ? "border border-dashed border-rule" : seg[t.state]}`} style={{ flexGrow: t.bps, flexBasis: 0 }} />
      ))}
    </span>
  );
}

function statusLine(d: DealRecord): string {
  const need = needsBuyer(d);
  const r = d.tranches.find((t) => t.state === "in_review");
  if (need === "Review" && r) return `${r.short} signed · your review closes ${r.reviewEnds?.split(", ")[1] ?? ""}`;
  if (need === "Fund") return `Everyone accepted · fund ${usdc(d.funded)} to start`;
  if (need === "Refund") return `${d.tranches.find((t) => t.state === "refundable")!.short} never confirmed · refund available`;
  if (d.state === "proposed") return `Waiting for the supplier to accept · deadline ${d.acceptanceDeadline}`;
  if (d.state === "settled") return "Settled · every part paid";
  if (d.state === "cancelled") return "Cancelled before funding";
  if (d.tranches.some((t) => t.state === "claimable")) return "Paying the supplier now";
  if (d.tranches.some((t) => t.state === "disputed")) return "Disputed · one part frozen, waiting on the arbiter";
  const next = d.tranches.find((t) => t.state === "waiting");
  return next ? `Next: ${next.short.toLowerCase()} due ${next.due}` : "In progress";
}

function Row({ d }: { d: DealRecord }) {
  const need = needsBuyer(d);
  return (
    <li>
      <Link href={`/app/deals/${d.id}`} className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 px-4 py-4 hover:bg-sheet md:grid-cols-[7rem_minmax(0,1fr)_10rem_9rem_7rem] md:px-5">
        <span className="mono text-[13px] font-medium">
          {d.id}
          {d.test ? <span className="ml-1.5 rounded border border-dashed border-graphite/60 px-1 text-[10px] text-graphite">TEST</span> : null}
        </span>
        <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
          <span className="block truncate text-[14px] font-semibold">
            {d.goods} <span className="font-normal text-graphite">· {d.supplier.org}</span>
          </span>
          <span className={`block truncate text-[12.5px] ${need ? "text-ink" : "text-graphite"}`}>{statusLine(d)}</span>
        </span>
        <span className="col-span-2 hidden md:col-span-1 md:block">
          <MiniLedger d={d} />
          <span className="mono mt-1 block text-[10.5px] text-graphite">
            {d.origin.code} → {d.destination.code}
          </span>
        </span>
        <span className="mono row-start-1 text-right text-[13.5px] md:row-start-auto">{usdc(d.total)}</span>
        <span className="hidden text-right md:block">
          {need ? (
            <span className="marked text-[12.5px] font-semibold">{need}</span>
          ) : (
            <span className="text-[12.5px] text-graphite group-hover:text-ink">Open →</span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function Dashboard() {
  const { deals } = useDemo();
  const list = orderedIds(deals).map((id) => deals[id]!).filter(Boolean);
  const now = demoNow();
  const needs = list.filter((d) => needsBuyer(d));
  const waiting = list.filter((d) => !needsBuyer(d) && d.state !== "settled" && d.state !== "cancelled");
  const done = list.filter((d) => d.state === "settled" || d.state === "cancelled");
  const held = list.reduce((s, d) => s + heldFor(d), 0);
  const released = list.reduce((s, d) => s + releasedFor(d), 0);
  const refunded = list.reduce((s, d) => s + refundedFor(d), 0);

  const section = (title: string, items: DealRecord[], empty: string) => (
    <section className="mt-8">
      <h2 className="label mb-2 px-1">
        {title} · {items.length}
      </h2>
      {items.length ? (
        <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-paper">{items.map((d) => <Row key={d.id} d={d} />)}</ul>
      ) : (
        <p className="rounded-md border border-dashed border-rule px-4 py-6 text-center text-[13px] text-graphite">{empty}</p>
      )}
    </section>
  );

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Owusu Home Electronics · 19 Oct, {now} GMT</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">
            {needs.length ? (
              <>
                {needs.length} {needs.length === 1 ? "deal needs" : "deals need"} you today
              </>
            ) : (
              "Nothing needs you today"
            )}
          </h1>
        </div>
        <Link href="/app/new" className="rounded-md bg-held px-4 py-2.5 text-[14px] font-semibold text-sheet">
          New deal
        </Link>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-rule bg-rule">
        {[
          ["Held in escrow", held, "text-held"],
          ["Released to suppliers", released, "text-released"],
          ["Refunded to you", refunded, "text-graphite"],
        ].map(([l, v, c]) => (
          <div key={l as string} className="bg-sheet px-3 py-3 md:px-4">
            <dt className="label">{l as string}</dt>
            <dd className={`mono mt-1 text-[17px] md:text-[22px] ${c}`}>{usdc(v as number)}</dd>
          </div>
        ))}
      </dl>

      {section("Needs you", needs, "Nothing to approve, fund or refund.")}
      {section("Waiting on others", waiting, "No deals in progress.")}
      {section("Settled", done, "No settled deals yet.")}

      <p className="mt-10 text-[12px] text-graphite">
        Demo data. Actions are simulated and stored only in this browser. Open a supplier link in another tab to see both sides change.
      </p>
    </main>
  );
}
