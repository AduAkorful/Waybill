"use client";

import Link from "next/link";
import { arbiter } from "@/demo/deal";
import type { DealRecord, DisputeRecord } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { useDemo } from "@/demo/store";

export default function ArbiterQueue() {
  const { deals } = useDemo();
  const all: { d: DealRecord; r: DisputeRecord }[] = [];
  for (const d of Object.values(deals)) for (const r of Object.values(d.disputes ?? {})) all.push({ d, r });
  const open = all.filter(({ r }) => !r.decision && !r.withdrawn);
  const ready = open.filter(({ r }) => r.responseClosed);
  const waiting = open.filter(({ r }) => !r.responseClosed);
  const closed = all.filter(({ r }) => r.decision || r.withdrawn);

  const list = (title: string, items: typeof all, empty: string) => (
    <section className="mt-8">
      <h2 className="label mb-2 px-1">
        {title} · {items.length}
      </h2>
      {items.length ? (
        <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule">
          {items.map(({ d, r }) => {
            const t = d.tranches.find((x) => x.index === r.stub)!;
            return (
              <li key={`${d.id}-${r.stub}`}>
                <Link href={`/arbiter/${d.id}/${r.stub}`} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 px-4 py-4 hover:bg-sheet md:grid-cols-[7rem_minmax(0,1fr)_8rem_11rem]">
                  <span className="mono text-[13px] font-medium">{d.id}</span>
                  <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
                    <span className="block truncate text-[14px] font-semibold">
                      Stub {r.stub} · {t.short.toLowerCase()} <span className="font-normal text-graphite">· {d.goods}</span>
                    </span>
                    <span className="block truncate text-[12.5px] text-graphite">
                      {d.buyer.org} ↔ {d.supplier.org} · {r.entries.length} entries
                    </span>
                  </span>
                  <span className="mono row-start-1 text-right text-[13px] md:row-start-auto">{usdc(t.amount)}</span>
                  <span className="hidden text-right text-[12.5px] md:block">
                    {r.decision ? (
                      <span className="text-graphite">Decided {r.decision.at}</span>
                    ) : r.withdrawn ? (
                      <span className="text-graphite">Withdrawn by the buyer</span>
                    ) : r.responseClosed ? (
                      <span className="marked font-semibold">Decide by {r.decideBy}</span>
                    ) : (
                      <span className="text-graphite">Response due {r.responseDue}</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-rule px-4 py-5 text-center text-[13px] text-graphite">{empty}</p>
      )}
    </section>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <p className="label">{arbiter.name}</p>
      <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">
        {ready.length ? `${ready.length} ${ready.length === 1 ? "dispute is" : "disputes are"} ready for a decision` : "No disputes waiting for you"}
      </h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-graphite">
        Each dispute is one frozen part of one deal. You can release it to the supplier, refund it to the buyer, or split it. Nothing else, and never to
        yourself. If you miss the deadline, the default applies and your fee goes back to the buyer.
      </p>
      {list("Ready for a decision", ready, "Nothing ready.")}
      {list("Waiting for the supplier's response", waiting, "None.")}
      {list("Closed", closed, "No closed disputes yet.")}
    </main>
  );
}
