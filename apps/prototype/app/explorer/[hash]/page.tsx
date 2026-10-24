"use client";

import Link from "next/link";
import { use } from "react";
import { PublicShell } from "@/components/PublicShell";
import { useDemo } from "@/demo/store";

/** A stand-in for the Arc explorer. In the product, every "proof" link opens the real transaction page. */
export default function DemoExplorer({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  const { deals } = useDemo();
  let found: { deal: string; text: string; when: string; actor: string } | null = null;
  for (const d of Object.values(deals)) {
    const e = d.timeline.find((x) => x.proof === hash);
    if (e) found = { deal: d.id, text: e.text, when: `${e.day} 2026, ${e.at} GMT`, actor: e.actor };
    const t = d.tranches.find((x) => x.proof === hash);
    if (!found && t) found = { deal: d.id, text: `Stub ${t.index} ${t.state === "refunded" ? "refunded" : "released"}`, when: t.releasedAt ?? "", actor: "Waybill relayer" };
    if (!found && d.fundTx === hash) found = { deal: d.id, text: "Locked the deal total in escrow", when: d.fundedAt ?? "", actor: d.buyer.name };
    if (found) break;
  }
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-20 md:px-8 md:pt-14">
        <p className="label">Arc explorer · demo page</p>
        <h1 className="mt-2 text-[24px] leading-tight font-semibold tracking-tight">Transaction</h1>
        <p className="mono mt-1 break-all text-[13px] text-graphite">{hash}</p>
        {found ? (
          <dl className="mt-6 divide-y divide-rule rounded-md border border-rule bg-sheet text-[14px]">
            {[
              ["Status", "Success · 1 confirmation"],
              ["Time", found.when],
              ["From", found.actor],
              ["To", "WaybillEscrow · demo contract"],
              ["What it did", found.text],
              ["Deal", found.deal],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[8rem_1fr] gap-3 px-4 py-3">
                <dt className="label pt-0.5">{k}</dt>
                <dd>{k === "Deal" ? <Link href={`/record/${v}`} className="mono underline decoration-rule underline-offset-2">{v}</Link> : v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-6 rounded-md border border-dashed border-rule p-6 text-center text-[14px] text-graphite">No transaction with that reference in the demo data.</p>
        )}
        <p className="mt-6 text-[12.5px] leading-relaxed text-graphite">
          In the product this opens the transaction on the real Arc explorer, where anyone can check the amount, the sender and the contract. This page only mimics it.
        </p>
      </main>
    </PublicShell>
  );
}
