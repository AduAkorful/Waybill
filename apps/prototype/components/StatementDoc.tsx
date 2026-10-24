import type { Tranche } from "@/demo/deal";
import type { DealRecord } from "@/demo/deals";

/** The statement library (spec §3): each milestone type's exact sentence and what it leaves out. */
export function statementParts(d: DealRecord, t: Tranche) {
  if (t.short === "Arrival")
    return {
      version: "arrival v1",
      parts: ["I confirm that the shipment for deal ", d.id, " arrived at ", "Tema port", " with ", `${d.cartons} cartons`, " matching the packing list, on ", "the date signed", "."],
      blanks: [1, 3, 5, 7],
      notCovered: ["Quality of the goods inside the cartons", "Customs clearance outcome"],
      checklist: ["Delivery receipt", "Arrival photos with labels", "Carton count"],
    };
  return {
    version: "pre-shipment v1",
    parts: ["I confirm that a sample of the goods for deal ", d.id, ", drawn by ", "AQL 2.5, level II", ", matched the agreed specification and quantity of ", `${d.cartons} cartons`, " of ", d.goods.charAt(0).toLowerCase() + d.goods.slice(1), "."],
    blanks: [1, 3, 5, 7],
    notCovered: ["Units that were not sampled", "Damage after the inspection"],
    checklist: ["Inspection report", "Sample photos", "Carton count", "Packing list"],
  };
}

/** The sentence an attestor puts their name to, typed out with the deal-specific words filled in. */
export function StatementDoc({ d, t, signed, signer }: { d: DealRecord; t: Tranche; signed?: { at: string }; signer?: string }) {
  const s = statementParts(d, t);
  return (
    <section aria-label="Statement" className="rounded-md border border-rule bg-sheet">
      <div className="flex items-baseline justify-between border-b border-rule px-4 py-2">
        <span className="label">{signed ? "Signed statement" : "You are confirming"}</span>
        <span className="mono text-[10.5px] text-graphite">statement · {s.version}</span>
      </div>
      <p className="px-4 py-4 text-[15px] leading-[1.85]">
        {s.parts.map((p, i) =>
          s.blanks.includes(i) ? (
            <span key={i} data-blank className="mono rounded-[2px] border-b-2 border-held/50 bg-held-wash px-1 text-[13.5px] text-ink">
              {p}
            </span>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </p>
      {signed ? (
        <div className="border-t border-dashed border-rule px-4 pt-2 pb-3">
          <svg viewBox="0 0 200 40" className="h-9 w-44 text-ink" aria-hidden>
            <path d="M6 28 C 18 6, 26 34, 38 20 S 58 8, 64 26 S 84 30, 92 14 C 98 4, 104 30, 116 24 S 140 12, 150 22 L 192 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="text-[12px] text-graphite">
            {signer} · {signed.at} · bound to {d.id}, stub {t.index}, on Arc · usable once
          </p>
        </div>
      ) : (
        <div className="border-t border-dashed border-rule px-4 py-3">
          <p className="label">Not covered by this signature</p>
          <ul className="mt-1 space-y-0.5 text-[13px] text-graphite">
            {s.notCovered.map((n) => (
              <li key={n}>— {n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
