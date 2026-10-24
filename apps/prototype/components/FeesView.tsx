"use client";

import Link from "next/link";
import { useState } from "react";
import { usdc } from "@/demo/format";
import { act, useDemo } from "@/demo/store";
import { Modal } from "./Modal";
import { TxFlow } from "./TxFlow";

export interface FeeRow {
  id: string;
  what: string;
  amount: number;
  at: string;
  href: string;
}

/** Fees a recipient has earned and can pull to their own wallet. Never deal principal, never anyone else's fees. */
export function FeesView({ recipient, title, rows, action, explain }: { recipient: string; title: string; rows: FeeRow[]; action: string; explain: string }) {
  const { withdrawn } = useDemo();
  const [open, setOpen] = useState(false);
  const earned = rows.reduce((s, r) => s + r.amount, 0);
  const out = withdrawn[recipient] ?? 0;
  const available = earned - out;

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <p className="label">{recipient}</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 max-w-2xl text-[13.5px] text-graphite">{explain}</p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-3">
        {[
          ["Earned", earned, "text-ink"],
          ["Withdrawn", out, "text-graphite"],
          ["Available", available, "text-released"],
        ].map(([k, v, c]) => (
          <div key={k as string} className="bg-sheet px-4 py-3">
            <p className="label">{k as string}</p>
            <p className={`mono mt-1 text-[22px] ${c}`}>{usdc(v as number)}</p>
          </div>
        ))}
      </div>
      <button
        disabled={!available}
        onClick={() => setOpen(true)}
        className="mt-4 rounded-md bg-released px-5 py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:bg-ink/20"
      >
        {available ? `Withdraw ${usdc(available)} USDC` : "Nothing to withdraw"}
      </button>

      <h2 className="label mt-10 mb-2">Earned, by part</h2>
      {rows.length ? (
        <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule">
          {rows.map((r) => (
            <li key={`${r.id}-${r.what}`}>
              <Link href={r.href} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3 text-[14px] hover:bg-sheet">
                <span>
                  <span className="mono mr-3 text-[13px]">{r.id}</span>
                  {r.what}
                </span>
                <span className="text-[12.5px] text-graphite">{r.at}</span>
                <span className="mono text-released">+{usdc(r.amount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-rule px-4 py-6 text-center text-[13px] text-graphite">No fees yet. They're credited when a part you confirmed is released.</p>
      )}

      <Modal open={open} onClose={() => setOpen(false)} label="Withdraw fees">
        <h2 className="text-[19px] font-semibold">Withdraw {usdc(available)} USDC</h2>
        <p className="mt-2 mb-4 text-[13.5px]">To your own wallet 0x5E…60e. This takes only your fees; it can't touch any deal's escrowed money.</p>
        <TxFlow
          tone="released"
          confirmLabel="Withdraw"
          steps={[{ label: "Withdraw", wallet: { action, to: "WaybillEscrow · demo", amount: available, note: "To the signing wallet" } }]}
          onCancel={() => setOpen(false)}
          onDone={() => {
            act.withdraw(recipient, available);
            setOpen(false);
          }}
        />
      </Modal>
    </main>
  );
}
