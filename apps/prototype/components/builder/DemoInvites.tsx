"use client";

import Link from "next/link";
import type { DealRecord } from "@/demo/deals";
import { act } from "@/demo/store";

/**
 * Demo only. In the product each person follows their own email or chat link. In the prototype only the supplier
 * and Lin Mei have screens of their own for a new deal, so everyone else can accept from here to move the deal on.
 */
export function DemoInvites({ deal }: { deal: DealRecord }) {
  const pending = deal.acceptances.filter((a) => !a.done);
  if (pending.length === 0) return null;
  return (
    <div className="rounded-md border border-dashed border-graphite/50 p-3.5">
      <p className="label">Demo only · invitations</p>
      <p className="mt-0.5 text-[12.5px] text-graphite">Each person would accept from their own link. Here you can open it, or accept on their behalf to move the deal along.</p>
      <ul className="mt-2 divide-y divide-rule text-[13.5px]">
        {pending.map((a) => (
          <li key={a.role} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-semibold">{a.role}</span> · {a.who}
            </span>
            <span className="flex gap-2">
              {a.role === "Supplier" ? (
                <Link href={`/d/${deal.id}`} target="_blank" className="rounded border border-rule px-2.5 py-1 text-[12.5px] font-semibold hover:bg-sheet">
                  Open their link ↗
                </Link>
              ) : (
                <>
                  {a.role === "Inspector" && a.who.startsWith("Lin Mei") ? (
                    <Link href={`/attest/invite/${deal.id}`} target="_blank" className="rounded border border-rule px-2.5 py-1 text-[12.5px] font-semibold hover:bg-sheet">
                      Open invitation ↗
                    </Link>
                  ) : null}
                  <button onClick={() => act.acceptRole(deal.id, a.role as "Inspector" | "Forwarder" | "Arbiter", a.who.split(",")[0]!)} className="rounded bg-ink px-2.5 py-1 text-[12.5px] font-semibold text-paper">
                    Accept as them
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
