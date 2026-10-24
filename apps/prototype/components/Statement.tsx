import { deal } from "@/demo/deal";
import { Stamp } from "./Stamp";

/** A filled-in blank: the deal-specific words the attestor puts their name to. */
function Blank({ children }: { children: React.ReactNode }) {
  return (
    <span data-blank className="mono inline-block rounded-[2px] border-b-2 border-held/50 bg-held-wash px-1 text-[13px] leading-[1.5] text-ink">
      {children}
    </span>
  );
}

/** The pre-shipment inspection statement, as a typed document. `signed` adds the signature line and stamp. */
export function Statement({ signed = false, signer = "Lin Mei" }: { signed?: boolean; signer?: string }) {
  return (
    <section aria-label="Statement" className="relative rounded-md border border-rule bg-sheet">
      <div className="flex items-baseline justify-between border-b border-rule px-3.5 py-2">
        <span className="label">{signed ? "Signed statement" : "You are confirming"}</span>
        <span className="mono text-[10.5px] text-graphite">pre-shipment v1</span>
      </div>
      <p className="px-3.5 py-3.5 text-[14.5px] leading-[1.8]">
        I confirm that a sample of the goods for deal <Blank>{deal.id}</Blank>, drawn by <Blank>AQL 2.5, level II</Blank>, matched the agreed
        specification and quantity of <Blank>480 cartons</Blank> of <Blank>power banks, 10,000 mAh</Blank> on <Blank>18 Oct 2026</Blank>.
      </p>
      {signed ? (
        <div className="relative border-t border-dashed border-rule px-3.5 pt-2 pb-3">
          <svg viewBox="0 0 200 40" className="h-10 w-48 text-ink" aria-hidden>
            <path
              data-sig
              d="M6 28 C 18 6, 26 34, 38 20 S 58 8, 64 26 S 84 30, 92 14 C 98 4, 104 30, 116 24 S 140 12, 150 22 L 192 20"
              pathLength={1}
              strokeDasharray="1"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <p className="text-[12px] text-graphite">{signer} · 19 Oct 2026, 06:40 GMT · usable once</p>
          <div className="pointer-events-none absolute top-3 right-4">
            <Stamp tone="held" rotate={-8}>
              Signed
            </Stamp>
          </div>
        </div>
      ) : (
        <div className="border-t border-dashed border-rule px-3.5 py-3">
          <p className="label">Not covered by this signature</p>
          <p className="mt-1 text-[13px] text-graphite">Units that were not sampled · damage after the inspection</p>
        </div>
      )}
    </section>
  );
}
