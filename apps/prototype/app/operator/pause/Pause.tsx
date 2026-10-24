"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { TxFlow } from "@/components/TxFlow";
import { act, useDemo } from "@/demo/store";

export function Pause() {
  const { ops } = useDemo();
  const [open, setOpen] = useState(false);
  const pausing = !ops.paused;

  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16 md:px-8">
      <p className="label">
        <Link href="/operator" className="hover:text-ink">Monitor</Link> · New-deal pause
      </p>
      <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">
        New deals are{" "}
        <span className={ops.paused ? "text-hold" : "text-released"}>{ops.paused ? "paused" : "open"}</span>
      </h1>
      {ops.paused ? <p className="mt-1 text-[13px] text-graphite">Since {ops.pausedAt}</p> : null}

      <p className="mt-3 text-[14.5px]">
        The pause is the emergency brake for something wrong with <em>new</em> deals, such as a bug found in the funding path. It is the only control the team has, and it is built so it can never trap anyone's money.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-hold/40 bg-hold-wash p-4">
          <h2 className="text-[15px] font-semibold text-hold">While paused, these stop</h2>
          <ul className="mt-2 space-y-1.5 text-[14px]">
            <li>• Creating a new deal</li>
            <li>• Funding a deal that has not been funded yet</li>
          </ul>
        </section>
        <section className="rounded-xl border border-released/40 bg-released-wash p-4">
          <h2 className="text-[15px] font-semibold text-released">These never stop</h2>
          <ul className="mt-2 space-y-1.5 text-[14px]">
            <li>• Payments to suppliers (claims)</li>
            <li>• Refunds, including after a missed deadline</li>
            <li>• Disputes, evidence and arbiter decisions</li>
            <li>• Failed-payment retries and fee withdrawals</li>
            <li>• Everything on deals already funded</li>
          </ul>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-rule bg-sheet p-4 md:p-5">
        <h2 className="text-[16px] font-semibold tracking-tight">{pausing ? "Pause new deals" : "Reopen new deals"}</h2>
        <p className="mt-1 text-[13.5px] text-graphite">
          This is signed with the team's pauser wallet, a multi-party wallet. It takes effect when the network confirms. {pausing ? "Everyone with a deal in progress sees a notice, not an error." : "Buyers can create and fund deals again straight away."}
        </p>
        <button
          onClick={() => setOpen(true)}
          className={`mt-4 rounded-md px-4 py-2.5 text-[14px] font-semibold text-sheet ${pausing ? "bg-hold" : "bg-ink text-paper"}`}
        >
          {pausing ? "Pause new deals…" : "Reopen new deals…"}
        </button>
      </section>

      <p className="mt-4 text-[12.5px] text-graphite">Nothing on this page, or anywhere in the operator console, can move, freeze or redirect funds that are already in escrow.</p>

      <Modal open={open} onClose={() => setOpen(false)} label={pausing ? "Pause new deals" : "Reopen new deals"}>
        <p className="label">{pausing ? "Pause" : "Reopen"}</p>
        <h2 className="mt-1 text-[19px] font-semibold tracking-tight">{pausing ? "Stop new deals?" : "Open new deals again?"}</h2>
        <p className="mt-2 mb-4 text-[13.5px]">
          {pausing
            ? "Creating and funding new deals stops. Claims, refunds, disputes, decisions, retries and withdrawals keep working."
            : "Buyers can create and fund new deals again."}
        </p>
        <TxFlow
          tone={pausing ? "hold" : "held"}
          steps={[{ label: pausing ? "Pause" : "Reopen", wallet: { action: pausing ? "Pause new deals" : "Unpause new deals", to: "Waybill escrow (0xcf08…EfA)", note: "Pauser wallet · no funds move" } }]}
          confirmLabel={pausing ? "Pause new deals" : "Reopen new deals"}
          onDone={() => {
            act.setPaused(pausing);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </Modal>
    </main>
  );
}
