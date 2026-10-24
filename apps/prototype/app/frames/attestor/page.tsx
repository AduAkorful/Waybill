import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";
import { PhoneFrame } from "@/components/PhoneFrame";
import { deal, evidence, inspector, tranches } from "@/demo/deal";
import { usdc } from "@/demo/format";

export const metadata = { title: "A3 Attestor signing · Waybill prototype" };

/** A filled-in blank on the statement: the deal-specific words the attestor is putting their name to. */
function Blank({ children }: { children: React.ReactNode }) {
  return <span className="mono rounded-[2px] border-b-2 border-held/50 bg-held-wash px-1 text-[13px] text-ink">{children}</span>;
}

function AttestorSigning() {
  const t = tranches[1];
  const done = evidence.filter((e) => e.state === "done").length;
  const waiting = evidence.length - done;
  return (
    <div className="flex min-h-full flex-col bg-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-paper/95 px-4 py-2.5 backdrop-blur">
        <Wordmark className="text-[14px]" />
        <div className="flex items-center gap-2">
          <DemoMark />
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10.5px] font-semibold text-paper">{inspector.initials}</span>
        </div>
      </header>

      <div className="flex-1 px-4 pt-4 pb-6">
        <a href="#" className="text-[12.5px] text-graphite">
          ← Assigned to you · 1
        </a>
        <p className="label mt-3">
          {deal.id} · stub {t.index} of 3 · due {t.due}
        </p>
        <h1 className="mt-1 text-[20px] leading-tight font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-[13px] text-graphite">
          {deal.cartons} cartons at Baiyun Brightpower, Guangzhou. Inspection visit 18 Oct.
        </p>

        {/* The statement, as a typed document */}
        <section aria-label="Statement you will sign" className="mt-5 rounded-md border border-rule bg-sheet">
          <div className="flex items-baseline justify-between border-b border-rule px-3.5 py-2">
            <span className="label">You are confirming</span>
            <span className="mono text-[10.5px] text-graphite">statement · pre-shipment v1</span>
          </div>
          <p className="px-3.5 py-3.5 text-[14.5px] leading-[1.75]">
            I confirm that a sample of the goods for deal <Blank>{deal.id}</Blank>, drawn by <Blank>AQL 2.5, level II</Blank>, matched the
            agreed specification and quantity of <Blank>480 cartons</Blank> of <Blank>power banks, 10,000 mAh</Blank> on{" "}
            <Blank>18 Oct 2026</Blank>.
          </p>
          <div className="border-t border-dashed border-rule px-3.5 py-3">
            <p className="label">Not covered by your signature</p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-graphite">
              <li>— Units that were not sampled</li>
              <li>— Damage after the inspection</li>
            </ul>
          </div>
        </section>

        {/* Evidence: the folder */}
        <section aria-label="Evidence" className="mt-5">
          <h2 className="label">Evidence · {done} of {evidence.length}</h2>
          <p className="mt-0.5 text-[12px] text-graphite">Files are encrypted. Only their fingerprints go on the record.</p>
          <ul className="mt-2 divide-y divide-rule overflow-hidden rounded-md border border-rule bg-sheet">
            {evidence.map((e) => (
              <li key={e.name} className="flex items-start gap-3 px-3.5 py-3">
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                    e.state === "done" ? "bg-released text-sheet" : "border-2 border-held text-held"
                  }`}
                >
                  {e.state === "done" ? "✓" : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-2 text-[13.5px] font-semibold">
                    {e.name}
                    {e.hash ? <span className="mono text-[10.5px] font-normal text-graphite">{e.hash}</span> : null}
                  </p>
                  <p className="text-[12.5px] text-graphite">{e.detail}</p>
                  {e.state === "uploading" ? (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-rule/70">
                      <div className="h-full rounded-full bg-held" style={{ width: `${e.progress}%` }} />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px]">
          <div className="bg-sheet px-3.5 py-2.5">
            <dt className="label">You earn</dt>
            <dd className="mono mt-0.5 text-[16px] text-released">{usdc(t.feeAttestor)} USDC</dd>
            <dd className="text-[11.5px] text-graphite">paid when stub 2 releases</dd>
          </div>
          <div className="bg-sheet px-3.5 py-2.5">
            <dt className="label">After you sign</dt>
            <dd className="mt-0.5 leading-snug">Ama has 12 h to review. Then {usdc(t.amount)} goes to the supplier.</dd>
          </div>
        </dl>

        <details className="mt-4 text-[12.5px] text-graphite">
          <summary className="cursor-pointer">What your signature is bound to</summary>
          <p className="mono mt-2 leading-relaxed text-[11.5px]">
            deal {deal.onchainId} · stub {t.index} · Arc · escrow 0xDEMO…0427 · statement v1 · expires in 24 h · usable once
          </p>
        </details>
      </div>

      <footer className="sticky bottom-0 border-t border-rule bg-paper/95 px-4 pt-3 pb-4 backdrop-blur">
        <p className="mb-2 flex items-center gap-2 text-[12.5px] text-held" role="status">
          <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-held" />
          Waiting for {waiting} upload to finish before you can sign
        </p>
        <button disabled className="w-full cursor-not-allowed rounded-md bg-ink/25 py-3.5 text-[15.5px] font-semibold text-paper">
          Sign statement
        </button>
        <p className="mt-2 text-center text-[12px] text-graphite">Signing is not a payment. You can sign once.</p>
      </footer>
    </div>
  );
}

export default function AttestorFrame() {
  return (
    <div className="min-h-dvh sm:px-6 sm:py-8">
      <div className="mx-auto mb-6 hidden max-w-5xl items-center justify-between sm:flex">
        <p className="label">A3 · Attestor signing, one upload still running</p>
        <ThemeToggle />
      </div>
      <PhoneFrame label="Lin Mei, Pearlgate Inspection">
        <AttestorSigning />
      </PhoneFrame>
    </div>
  );
}
