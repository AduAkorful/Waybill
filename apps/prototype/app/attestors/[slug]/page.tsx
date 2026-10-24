"use client";

import Link from "next/link";
import { use } from "react";
import { PublicShell } from "@/components/PublicShell";
import { attestorStats, findAttestor } from "@/demo/attestors";
import { useDemo } from "@/demo/store";

// The standard statement for each milestone type, with what it leaves out (spec §3). Blanks are filled per deal.
const statements: Record<string, { says: string; notCovered: string }> = {
  "Pre-shipment inspection": {
    says: "A sample of the goods, drawn by the stated method, matched the agreed specification and quantity.",
    notCovered: "Units that weren't sampled; damage after the inspection.",
  },
  "Production proof": {
    says: "A named production run exists and matches the order description at the stated stage.",
    notCovered: "Quality of every unit; goods leaving the factory.",
  },
  "Arrival confirmed": {
    says: "The shipment arrived at the destination with the stated carton count.",
    notCovered: "Quality of what's inside; the customs clearance outcome.",
  },
  "Warehouse receipt": {
    says: "The stated cartons matching the packing list arrived at the named warehouse in the stated condition.",
    notCovered: "The contents of cartons beyond the stated check.",
  },
  "Bill of lading issued": {
    says: "A shipment under the stated bill of lading left on the stated date.",
    notCovered: "Condition of the goods; final delivery.",
  },
};

export default function AttestorProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { deals } = useDemo();
  const a = findAttestor(slug);

  if (!a)
    return (
      <PublicShell>
        <main className="mx-auto max-w-2xl px-4 py-24 text-center">
          <h1 className="text-[26px] font-semibold">No attestor called “{slug}”</h1>
          <Link href="/attestors" className="mt-4 inline-block text-held underline">
            See all attestors
          </Link>
        </main>
      </PublicShell>
    );

  const s = attestorStats(a, deals);
  const blocked = a.status !== "Active";
  const stats = [
    { label: "Statements signed", value: String(s.signed), note: `since ${a.since}` },
    { label: "Released without dispute", value: String(s.undisputed), note: `of ${s.signed} · ${s.share}%` },
    { label: "Disputes upheld against", value: String(s.upheld), note: s.upheld ? "the arbiter found the statement inaccurate" : "none so far", bad: s.upheld > 0 },
    { label: "Median time to sign", value: `${s.medianHours} h`, note: "after the goods were ready" },
  ];

  return (
    <PublicShell active="/attestors">
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-20 md:px-8 md:pt-10">
        <Link href="/attestors" className="text-[12.5px] text-graphite">
          ← All attestors
        </Link>

        <div className="mt-5 flex flex-wrap items-start justify-between gap-6 border-b border-rule pb-8">
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-ink text-[17px] font-semibold text-paper">{a.initials}</span>
            <div>
              <h1 className="text-[28px] leading-tight font-semibold tracking-tight md:text-[32px]">{a.org}</h1>
              <p className="text-[14px] text-graphite">
                {a.name} · {a.city} · {a.kind}
              </p>
              <p className="text-[13px] text-graphite">{a.corridor}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="label">Tier</p>
            <p className="mt-1 text-[15px] font-semibold">{a.tier}</p>
            <p className="max-w-[16rem] text-[12px] text-graphite">Business details on file · not yet verified by a partner</p>
          </div>
        </div>

        {blocked ? (
          <div role="status" className="mt-6 rounded-md border border-hold/40 bg-hold-wash p-4">
            <p className="text-[14.5px] font-semibold text-hold">{a.status}</p>
            <p className="mt-1 text-[13.5px]">{a.statusNote}</p>
          </div>
        ) : null}

        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-4">
          {stats.map((x) => (
            <div key={x.label} className="bg-sheet p-4">
              <dt className="label">{x.label}</dt>
              <dd className={`mono mt-2 text-[28px] leading-none ${x.bad ? "text-hold" : ""}`}>{x.value}</dd>
              <dd className="mt-1.5 text-[12px] text-graphite">{x.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-graphite">
          Counts, not a score. Built only from deal outcomes on the escrow contract, so every figure can be re-derived from public events. Nothing is
          self-reported, and test or self-dealing deals are excluded. {s.repeatClients} buyers and suppliers have used them more than once.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section>
            <h2 className="label mb-3">Recent statements</h2>
            <ul className="divide-y divide-rule border-y border-rule">
              {s.recent.map((r) => (
                <li key={`${r.id}-${r.what}`} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-3 text-[14px]">
                  <Link href={`/record/${r.id}`} className="mono w-20 text-[13px] underline decoration-rule underline-offset-2 hover:text-held">
                    {r.id}
                  </Link>
                  <span className="min-w-0 flex-1">{r.what}</span>
                  <span className="text-graphite">{r.when}</span>
                  <span className={`w-52 text-right text-[13px] font-medium ${r.tone === "released" ? "text-released" : r.tone === "hold" ? "text-hold" : "text-held"}`}>
                    {r.outcome}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <aside className="space-y-4">
            <section className="rounded-md border border-rule bg-sheet p-4">
              <h2 className="label">What they sign</h2>
              <ul className="mt-2 space-y-3 text-[13.5px] leading-snug">
                {a.signs.map((k) => (
                  <li key={k}>
                    <p className="font-semibold">{k}</p>
                    <p className="text-graphite">{statements[k]?.says}</p>
                    <p className="mt-0.5 text-[12.5px] text-graphite">Not covered: {statements[k]?.notCovered}</p>
                  </li>
                ))}
              </ul>
            </section>
            <div className="rounded-md border border-rule p-4">
              {blocked ? (
                <p className="text-[13.5px] text-graphite">They can't be named in new deals until the review ends.</p>
              ) : (
                <>
                  <p className="text-[13.5px] leading-relaxed">Choosing {a.org}? Name them when you create a deal. They accept their role and the exact statement before you fund.</p>
                  <Link href="/signin?as=buyer" className="mt-3 block rounded-md bg-held px-4 py-2.5 text-center text-[14px] font-semibold text-sheet">
                    Name them in a new deal
                  </Link>
                </>
              )}
            </div>
          </aside>
        </div>
      </main>
    </PublicShell>
  );
}
