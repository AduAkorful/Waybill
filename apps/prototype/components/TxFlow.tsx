"use client";

import { useEffect, useState } from "react";
import { newHash } from "@/demo/store";
import { usdc } from "@/demo/format";

export interface TxStep {
  /** Plain words: "Allow Waybill to take 5,087.50 USDC" */
  label: string;
  /** What the wallet will show: contract, action, amount, recipient */
  wallet: { action: string; to: string; amount?: number; note?: string };
}

type Phase = "ready" | "awaiting" | "rejected" | "submitted" | "confirmed";

/**
 * One money action, step by step: ready → wallet prompt → sent (hash, pending) → confirmed.
 * A hash is never called success; rejection is a normal, retryable outcome. The wallet is simulated.
 */
export function TxFlow({
  steps,
  confirmLabel,
  tone = "held",
  onDone,
  onCancel,
}: {
  steps: TxStep[];
  confirmLabel: string;
  tone?: "held" | "hold" | "refunded" | "released";
  onDone: (hash: string) => void;
  onCancel: () => void;
}) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [hashes, setHashes] = useState<string[]>([]);
  const step = steps[i]!;

  useEffect(() => {
    if (phase === "submitted") {
      const h = setTimeout(() => setPhase("confirmed"), 1600);
      return () => clearTimeout(h);
    }
    if (phase === "confirmed") {
      const h = setTimeout(() => {
        if (i < steps.length - 1) {
          setI(i + 1);
          setPhase("ready");
        } else onDone(hashes[hashes.length - 1] ?? "");
      }, 900);
      return () => clearTimeout(h);
    }
  }, [phase, i, steps.length, hashes, onDone]);

  const btn: Record<string, string> = {
    held: "bg-held text-sheet",
    hold: "bg-hold text-sheet",
    refunded: "bg-refunded text-sheet",
    released: "bg-released text-sheet",
  };

  return (
    <div>
      {steps.length > 1 ? (
        <ol className="mb-4 flex gap-2 text-[12px]">
          {steps.map((s, k) => (
            <li
              key={s.label}
              className={`flex-1 rounded-md border px-2.5 py-1.5 ${k < i ? "border-released/40 text-released" : k === i ? "border-ink/60" : "border-rule text-graphite"}`}
            >
              <span className="mono mr-1">{k + 1}</span>
              {k < i ? "✓ " : ""}
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}

      {phase === "ready" ? (
        <>
          <button onClick={() => setPhase("awaiting")} className={`w-full rounded-md py-3 text-[14.5px] font-semibold ${btn[tone]}`}>
            {steps.length > 1 ? step.label : confirmLabel}
          </button>
          <button onClick={onCancel} className="mt-1 w-full py-2 text-[13px] text-graphite hover:text-ink">
            Cancel
          </button>
        </>
      ) : null}

      {phase === "awaiting" || phase === "rejected" ? (
        <DemoWallet
          step={step}
          rejected={phase === "rejected"}
          onSign={() => {
            setHashes((h) => [...h, newHash()]);
            setPhase("submitted");
          }}
          onReject={() => setPhase("rejected")}
          onRetry={() => setPhase("awaiting")}
          onCancel={onCancel}
        />
      ) : null}

      {phase === "submitted" || phase === "confirmed" ? (
        <div role="status" className="flex items-start gap-3 rounded-md border border-rule bg-paper px-3.5 py-3">
          <span
            aria-hidden
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${phase === "confirmed" ? "bg-released" : "animate-pulse bg-held ring-4 ring-held/20"}`}
          />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">{phase === "confirmed" ? "Confirmed" : "Sent · waiting for the network"}</p>
            <p className="text-[12.5px] text-graphite">
              {phase === "confirmed" ? "The network accepted it." : "Usually a few seconds. Don't send it again."}
            </p>
            <p className="mono mt-1 truncate text-[12px] text-graphite">{hashes[hashes.length - 1]} ↗</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A stand-in for the user's wallet prompt, clearly marked as simulated. */
function DemoWallet({
  step,
  rejected,
  onSign,
  onReject,
  onRetry,
  onCancel,
}: {
  step: TxStep;
  rejected: boolean;
  onSign: () => void;
  onReject: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) {
  if (rejected) {
    return (
      <div role="alert" className="rounded-md border border-hold/40 bg-hold-wash p-3.5">
        <p className="text-[14px] font-semibold text-hold">You declined in your wallet</p>
        <p className="mt-0.5 text-[12.5px]">Nothing was sent and nothing changed. You can try again.</p>
        <div className="mt-3 flex gap-2">
          <button onClick={onRetry} className="rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper">
            Try again
          </button>
          <button onClick={onCancel} className="rounded-md px-3 py-2 text-[13px] text-graphite">
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border-2 border-dashed border-graphite/40">
      <p className="mono flex items-center justify-between bg-ink px-3 py-1.5 text-[10.5px] tracking-wide text-paper uppercase">
        <span>Demo wallet · simulated</span>
        <span>Arc</span>
      </p>
      <div className="bg-sheet p-3.5 text-[13px]">
        <p className="label">Request</p>
        <p className="font-semibold">{step.wallet.action}</p>
        <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-y-1 text-[12.5px]">
          <dt className="text-graphite">Contract</dt>
          <dd className="mono text-[12px]">{step.wallet.to}</dd>
          {step.wallet.amount !== undefined ? (
            <>
              <dt className="text-graphite">Amount</dt>
              <dd className="mono">{usdc(step.wallet.amount)} USDC</dd>
            </>
          ) : null}
          {step.wallet.note ? (
            <>
              <dt className="text-graphite">Note</dt>
              <dd>{step.wallet.note}</dd>
            </>
          ) : null}
        </dl>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={onReject} className="rounded-md border border-rule py-2 text-[13px] font-semibold">
            Reject
          </button>
          <button onClick={onSign} className="rounded-md bg-ink py-2 text-[13px] font-semibold text-paper">
            Sign
          </button>
        </div>
      </div>
    </div>
  );
}
