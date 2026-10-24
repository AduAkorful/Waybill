import { evidence, type Tranche } from "@/demo/deal";
import type { DealRecord } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { statementParts } from "./StatementDoc";
import { Tick } from "./Sheet";

/** Evidence files as a checklist; uploads in progress show a bar, finished ones a drawn tick and fingerprint. */
export function EvidenceList({ done = evidence.length - 1, progress = 64 }: { done?: number; progress?: number }) {
  return (
    <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-sheet">
      {evidence.map((e, i) => {
        const finished = i < done;
        return (
          <li key={e.name} data-file={i} className="flex items-start gap-3 px-3.5 py-3">
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${finished ? "bg-released text-sheet" : "border-2 border-held"}`}
            >
              {finished ? <Tick className="h-3.5 w-3.5" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2 text-[13.5px] font-semibold">
                {e.name}
                {finished ? <span className="mono text-[10.5px] font-normal text-graphite">{e.hash || "0x5e02…b7a1"}</span> : null}
              </p>
              <p className="text-[12.5px] text-graphite">{finished && !e.hash ? "PDF · 380 KB · 480 cartons listed" : e.detail}</p>
              {!finished ? (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-rule/70">
                  <div data-progress className="h-full rounded-full bg-held" style={{ width: `${progress}%` }} />
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The buyer's review panel: what was signed, and the files behind it. */
export function EvidencePanel({ onApprove, onDispute, d, t }: { onApprove?: () => void; onDispute?: () => void; d?: DealRecord; t?: Tranche }) {
  if (d && t) return <SignedEvidence d={d} t={t} onApprove={onApprove} onDispute={onDispute} />;
  return (
    <aside data-panel className="h-full overflow-hidden border-l border-rule bg-sheet p-5">
      <p className="label">Stub 2 · evidence</p>
      <h2 className="mt-1 text-[18px] font-semibold">Pre-shipment inspection passed</h2>
      <p className="mt-2 rounded-md border border-rule bg-paper p-3 text-[13px] leading-relaxed">
        “I confirm that a sample of the goods for deal WB-0427, drawn by AQL 2.5, level II, matched the agreed specification and quantity of 480
        cartons of power banks, 10,000 mAh on 18 Oct 2026.” <span className="text-graphite">— Lin Mei, Pearlgate Inspection</span>
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {["Carton labels", "Sample on bench", "Charge test"].map((p) => (
          <div key={p} data-photo className="grid aspect-[4/3] place-items-end rounded-md border border-rule bg-[linear-gradient(135deg,var(--rule),var(--paper))] p-1.5">
            <span className="text-[10.5px] text-graphite">{p}</span>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <EvidenceList done={4} />
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={onApprove} className="rounded-md bg-held px-4 py-2.5 text-[13.5px] font-semibold text-sheet">
          Approve and release 6,000.00
        </button>
        <button onClick={onDispute} className="rounded-md px-3 py-2.5 text-[13.5px] font-semibold text-hold">
          Dispute
        </button>
      </div>
    </aside>
  );
}

/** The buyer's review of what was actually signed for this stub: the sentence, who signed, the files. */
function SignedEvidence({ d, t, onApprove, onDispute }: { d: DealRecord; t: Tranche; onApprove?: () => void; onDispute?: () => void }) {
  const s = statementParts(d, t);
  return (
    <aside data-panel className="p-5 pt-12">
      <p className="label">
        Stub {t.index} · evidence
      </p>
      <h2 className="mt-1 text-[18px] font-semibold">{t.title}</h2>
      <p className="mt-2 rounded-md border border-rule bg-paper p-3 text-[13.5px] leading-relaxed">
        “{s.parts.join("")}” <span className="text-graphite">— {t.signedBy}, {t.confirmedBy.split(", ")[1] ?? ""} · signed {t.signedAt}</span>
      </p>
      <p className="mt-2 text-[12px] text-graphite">Not covered: {s.notCovered.join("; ").toLowerCase()}.</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(t.evidence ?? []).slice(0, 3).map((f) => (
          <div key={f.name} className="grid aspect-[4/3] place-items-end rounded-md border border-rule bg-[linear-gradient(135deg,var(--rule),var(--paper))] p-1.5">
            <span className="text-[10.5px] text-graphite">{f.name}</span>
          </div>
        ))}
      </div>
      <ul className="mt-4 divide-y divide-rule overflow-hidden rounded-md border border-rule bg-paper">
        {(t.evidence ?? []).map((f) => (
          <li key={f.name} className="flex items-start gap-3 px-3.5 py-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-released text-[11px] text-sheet">✓</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-2 text-[13.5px] font-semibold">
                {f.name}
                <span className="mono text-[10.5px] font-normal text-graphite">{f.hash}</span>
              </p>
              <p className="text-[12.5px] text-graphite">{f.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {t.state === "in_review" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={onApprove} className="rounded-md bg-held px-4 py-2.5 text-[13.5px] font-semibold text-sheet">
            Approve and release {usdc(t.amount)}
          </button>
          <button onClick={onDispute} className="rounded-md px-3 py-2.5 text-[13.5px] font-semibold text-hold">
            Dispute
          </button>
        </div>
      ) : null}
    </aside>
  );
}
