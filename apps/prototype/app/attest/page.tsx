"use client";

import Link from "next/link";
import { inspector } from "@/demo/deal";
import { attestorEarnings, dealOrder, type DealRecord } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { useDemo } from "@/demo/store";
import type { Tranche } from "@/demo/deal";

interface Item {
  d: DealRecord;
  t: Tranche;
  href: string;
  status: string;
  cta?: string;
}

export default function AttestorWork() {
  const { deals, withdrawn } = useDemo();
  const mine: { d: DealRecord; t: Tranche }[] = [];
  for (const id of [...dealOrder, ...Object.keys(deals).filter((k) => !dealOrder.includes(k))]) {
    const d = deals[id];
    if (!d) continue;
    for (const t of d.tranches) if (t.confirmedBy.startsWith(inspector.name)) mine.push({ d, t });
  }
  const invited = (d: DealRecord) => d.acceptances.find((a) => a.role === "Inspector" && !a.done);
  const groups: [string, Item[], string][] = [
    [
      "Invitations",
      mine.filter(({ d }) => invited(d) && d.state === "proposed").map(({ d, t }) => ({ d, t, href: `/attest/invite/${d.id}`, status: `Accept by ${d.acceptanceDeadline}`, cta: "Review invitation" })),
      "No new invitations.",
    ],
    [
      "Ready to sign",
      mine
        .filter(({ d, t }) => d.state === "funded" && (t.state === "waiting" || t.state === "overdue"))
        .map(({ d, t }) => ({ d, t, href: `/attest/${d.id}/${t.index}`, status: `Due ${t.due}`, cta: "Upload and sign" })),
      "Nothing to sign right now.",
    ],
    [
      "Waiting on the buyer",
      mine
        .filter(({ t }) => t.state === "in_review" || t.state === "claimable" || t.state === "disputed")
        .map(({ d, t }) => ({
          d,
          t,
          href: `/attest/${d.id}/${t.index}`,
          status: t.state === "disputed" ? "Disputed · the arbiter will see your statement" : t.state === "claimable" ? "Approved · paying the supplier" : `Signed · review ends ${t.reviewEnds?.split(", ")[1]}`,
        })),
      "Nothing waiting.",
    ],
    [
      "Upcoming",
      mine.filter(({ d }) => !invited(d) && (d.state === "proposed" || d.state === "accepted")).map(({ d, t }) => ({ d, t, href: `/attest/${d.id}/${t.index}`, status: "Accepted · the buyer hasn't funded yet" })),
      "Nothing upcoming.",
    ],
    [
      "Done",
      mine
        .filter(({ t }) => ["released", "refunded", "resolved"].includes(t.state))
        .map(({ d, t }) => ({ d, t, href: `/attest/${d.id}/${t.index}`, status: t.state === "released" ? `Released ${t.releasedAt?.split(",")[0]}` : t.state === "refunded" ? "Refunded to the buyer" : "Split by the arbiter" })),
      "Nothing finished yet.",
    ],
  ];
  const earned = attestorEarnings(deals, inspector.name).reduce((s, r) => s + r.amount, 0);
  const available = earned - (withdrawn[inspector.name] ?? 0);
  const todo = groups[0]![1].length + groups[1]![1].length;

  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            {inspector.org} · {inspector.city}
          </p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">
            {todo ? `${todo} ${todo === 1 ? "thing needs" : "things need"} you` : "You're up to date"}
          </h1>
        </div>
        <Link href="/attest/fees" className="rounded-md border border-rule bg-sheet px-4 py-2.5 text-[13.5px] hover:bg-paper">
          <span className="label block">Fees to withdraw</span>
          <span className="mono text-[17px] text-released">{usdc(available)} USDC</span>
        </Link>
      </div>

      {groups.map(([title, items, empty], gi) => (
        <section key={title} className="mt-8">
          <h2 className="label mb-2 px-1">
            {title} · {items.length}
          </h2>
          {items.length ? (
            <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule">
              {items.map(({ d, t, href, status, cta }) => (
                <li key={`${d.id}-${t.index}`}>
                  <Link href={href} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 px-4 py-4 hover:bg-sheet md:grid-cols-[7rem_minmax(0,1fr)_9rem_10rem]">
                    <span className="mono text-[13px] font-medium">{d.id}</span>
                    <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
                      <span className="block truncate text-[14px] font-semibold">
                        {t.title} <span className="font-normal text-graphite">· {d.goods}</span>
                      </span>
                      <span className={`block text-[12.5px] ${gi < 2 ? "text-ink" : "text-graphite"}`}>
                        {status} · {d.supplier.org.split(" ").slice(0, 2).join(" ")}, {d.supplier.city}
                      </span>
                    </span>
                    <span className="row-start-1 text-right md:row-start-auto">
                      <span className="mono block text-[13px]">{usdc(t.amount)}</span>
                      <span className="block text-[11.5px] text-graphite">you earn {usdc(t.feeAttestor)}</span>
                    </span>
                    <span className="hidden text-right md:block">
                      {cta ? <span className="marked text-[12.5px] font-semibold">{cta}</span> : <span className="text-[12.5px] text-graphite">Open →</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-rule px-4 py-5 text-center text-[13px] text-graphite">{empty}</p>
          )}
        </section>
      ))}

      <p className="mt-10 text-[12px] text-graphite">
        Demo data · you are viewing as {inspector.name}. Your fee is 40% of the 0.75% fee on each part you confirm, paid only when that part is released.
      </p>
    </main>
  );
}
