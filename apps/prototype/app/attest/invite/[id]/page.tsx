"use client";

import Link from "next/link";
import { use, useState } from "react";
import { StatementDoc } from "@/components/StatementDoc";
import { TxFlow } from "@/components/TxFlow";
import { inspector } from "@/demo/deal";
import { usdc } from "@/demo/format";
import { act, useDemo } from "@/demo/store";

export default function Invitation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { deals } = useDemo();
  const d = deals[id.toUpperCase()];
  const [read, setRead] = useState(false);
  const [conflict, setConflict] = useState<"none" | "declare" | null>(null);
  const [declaration, setDeclaration] = useState("");
  const [signing, setSigning] = useState(false);

  if (!d) return <p className="px-4 py-16 text-center">No invitation for {id}.</p>;
  const t = d.tranches.find((x) => x.confirmedBy.startsWith(inspector.name))!;
  const acc = d.acceptances.find((a) => a.role === "Inspector");
  const accepted = acc?.done;
  const ready = read && (conflict === "none" || (conflict === "declare" && declaration.trim().length > 8));

  const decision = accepted ? (
    <div className="rounded-md border border-released/40 bg-released-wash p-4">
      <p className="text-[15px] font-semibold text-released">You accepted this role.</p>
      <p className="mt-1 text-[13px]">
        {d.state === "funded" ? "The deal is funded. Upload evidence and sign when the goods are ready." : "We'll tell you when the buyer funds the deal. Don't inspect before then."}
      </p>
      <Link href="/attest" className="mt-3 inline-block text-[13px] font-semibold underline">
        Back to your work
      </Link>
    </div>
  ) : (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <p className="text-[15px] font-semibold">Accept this role?</p>
      <label className="mt-3 flex items-start gap-2.5 text-[13.5px]">
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-1 accent-[var(--held)]" />
        I've read the exact statement and what it doesn't cover.
      </label>
      <fieldset className="mt-3">
        <legend className="label">Any financial relationship with the buyer or supplier?</legend>
        <label className="mt-1.5 flex items-center gap-2 text-[13.5px]">
          <input type="radio" name="conflict" checked={conflict === "none"} onChange={() => setConflict("none")} className="accent-[var(--held)]" /> None
        </label>
        <label className="mt-1 flex items-center gap-2 text-[13.5px]">
          <input type="radio" name="conflict" checked={conflict === "declare"} onChange={() => setConflict("declare")} className="accent-[var(--held)]" /> Yes, I'll declare it
        </label>
        {conflict === "declare" ? (
          <textarea
            rows={2}
            value={declaration}
            onChange={(e) => setDeclaration(e.target.value)}
            aria-label="Declaration"
            placeholder="Shown to both parties on the deal page."
            className="mt-2 w-full rounded-md border border-rule bg-paper p-2 text-[13px]"
          />
        ) : null}
      </fieldset>
      <div className="mt-4">
        {ready ? (
          <TxFlow
            confirmLabel="Accept role"
            steps={[{ label: "Accept", wallet: { action: `acceptAttestor(${d.onchainId}, ${t.index - 1})`, to: "WaybillEscrow · demo", note: "Records that you accept. Moves no money." } }]}
            onCancel={() => setSigning(false)}
            onDone={() => act.acceptRole(d.id, "Inspector", inspector.name)}
          />
        ) : (
          <p className="rounded-md border border-dashed border-rule p-2.5 text-center text-[12.5px] text-graphite">Confirm you've read the statement and answer the question to continue.</p>
        )}
      </div>
      {!signing ? (
        <button className="mt-2 w-full py-1.5 text-[12.5px] text-graphite underline decoration-rule underline-offset-2" onClick={() => alert("Declining tells the buyer so they can name someone else. (Demo: not recorded.)")}>
          Decline
        </button>
      ) : null}
    </div>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <Link href="/attest" className="text-[12.5px] text-graphite">
        ← Your work
      </Link>
      <p className="label mt-4">Invitation · {d.id}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight md:text-[30px]">
        {d.buyer.name} wants you to confirm the {t.short.toLowerCase()}
      </h1>
      <p className="mt-1 text-[14px] text-graphite">
        {d.goods} · {d.units.toLocaleString("en-US")} units in {d.cartons} cartons · from {d.supplier.org}, {d.supplier.city}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <StatementDoc d={d} t={t} />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px] sm:grid-cols-4">
            {[
              ["This part", `${usdc(t.amount)} USDC`],
              ["You earn", `${usdc(t.feeAttestor)} USDC`],
              ["Due", t.due],
              ["Buyer's review", `${t.reviewHours} h after you sign`],
            ].map(([k, v]) => (
              <div key={k} className="bg-sheet px-3 py-2.5">
                <dt className="label">{k}</dt>
                <dd className="mono mt-0.5 text-[13.5px]">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-md border border-rule p-4 text-[13.5px] leading-relaxed">
            <p className="label">How it works for you</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Accept now. Nothing is funded until everyone accepts.</li>
              <li>When the goods are ready, inspect as usual, upload the files and sign the sentence above. Signing is not a payment.</li>
              <li>Your fee is paid when this part releases. If a dispute is upheld against your statement, it counts on your public record.</li>
            </ol>
          </div>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">{decision}</aside>
      </div>
    </main>
  );
}
