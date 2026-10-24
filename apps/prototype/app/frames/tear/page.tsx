import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";
import { Odometer } from "@/components/Odometer";
import { Waybill } from "@/components/Waybill";
import { heldInEscrow, releasedTotal, tranches } from "@/demo/deal";

export const metadata = { title: "Stub tear · Waybill prototype" };

// The moment after Ama approves stub 2 and the sponsored claim confirms.
const after = tranches.map((t) =>
  t.index === 2 ? { ...t, state: "released" as const, releasedAt: "19 Oct 2026, 10:12 GMT", proof: "0xc81f5a2e9d0b47" } : t,
);
const PEAK = 0.62;

export default function TearFrame() {
  return (
    <div className="min-h-dvh px-4 py-6 md:px-10">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Wordmark />
        <div className="flex gap-2">
          <DemoMark />
          <ThemeToggle />
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-5xl">
        <p className="label">Signature moment · frozen at its peak</p>
        <h1 className="mt-1 max-w-2xl text-[24px] leading-tight font-semibold tracking-tight md:text-[28px]">
          Stub 2 tears off and goes to the supplier.
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-graphite">
          Ama approved the inspection early. The claim confirmed, so the stub tears along its perforation, the green stamp lands, and the two
          figures roll to their new values. About 900 ms, the only overshoot in the product.
        </p>

        <dl className="mt-6 grid max-w-xl grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
          <div className="bg-sheet px-4 py-3">
            <dt className="label">Held in escrow</dt>
            <dd className="mt-1 text-[26px] text-held">
              <Odometer from={heldInEscrow()} to={heldInEscrow(after)} progress={PEAK} />
            </dd>
          </div>
          <div className="bg-sheet px-4 py-3">
            <dt className="label">Released to supplier</dt>
            <dd className="mt-1 text-[26px] text-released">
              <Odometer from={releasedTotal()} to={releasedTotal(after)} progress={PEAK} />
            </dd>
          </div>
        </dl>

        <div className="mt-8 pb-16">
          <Waybill ts={after} poses={{ 2: "tearing" }} />
        </div>
      </div>
    </div>
  );
}
