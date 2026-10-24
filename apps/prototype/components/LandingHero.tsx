import { deal, tranches } from "@/demo/deal";
import { usdc } from "@/demo/format";
import { Stamp } from "./Stamp";
import { Waybill } from "./Waybill";

const waiting = tranches.map((t) => ({ ...t, state: "waiting" as const, releasedAt: undefined, reviewEnds: undefined, proof: undefined }));

/**
 * The landing hero: the promise on the left, the waybill on the desk on the right.
 * `desk` sets how far the story has got: nothing on the desk, a fresh waybill, or locked with stub 1 paid.
 */
export function LandingHero({ desk = "live" }: { desk?: "empty" | "waiting" | "live" }) {
  return (
    <section className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(var(--rule)_1px,transparent_1px)] [background-size:100%_28px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-20 md:px-8 lg:grid-cols-[1fr_1.05fr] lg:pt-16">
        <div>
          <p data-hero-kicker className="label flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-full border border-rule px-2 py-0.5 normal-case tracking-normal text-ink">Early access</span>
            USDC on Arc · non-custodial escrow
          </p>
          <h1 className="mt-5 text-[38px] leading-[1.04] font-semibold tracking-[-0.02em] sm:text-[48px] lg:text-[52px]">
            <span data-hero-line className="block">
              Pay a deposit.
            </span>
            <span data-hero-line className="block">
              Release the rest when{" "}
              <span data-hero-mark className="marked font-semibold">
                someone you trust
              </span>{" "}
              confirms the goods.
            </span>
          </h1>
          <p data-hero-sub className="mt-6 max-w-[34rem] text-[16.5px] leading-relaxed text-graphite">
            Buyer protection for trades agreed over WhatsApp and WeChat. Waybill holds the payment and releases it to your supplier in parts,
            each one only when the inspector or forwarder you named signs that it happened.
          </p>
          <div data-hero-cta className="mt-8 flex flex-wrap items-center gap-3">
            <a href="/signin?as=buyer" className="rounded-md bg-held px-5 py-3 text-[15px] font-semibold text-sheet">
              Start a deal
            </a>
            <a href="/d/WB-0419" className="rounded-md border border-ink/70 px-5 py-3 text-[15px] font-semibold">
              I received a deal link
            </a>
          </div>
          <dl data-hero-proof className="mt-10 grid max-w-[34rem] grid-cols-1 gap-px overflow-hidden rounded-md border border-rule bg-rule text-[13px] sm:grid-cols-3">
            <div className="bg-sheet px-3 py-2.5">
              <dt className="label">Where's the money</dt>
              <dd className="mt-1 leading-snug">Locked in escrow, visible to both of you</dd>
            </div>
            <div className="bg-sheet px-3 py-2.5">
              <dt className="label">Who releases it</dt>
              <dd className="mt-1 leading-snug">The inspector and forwarder you name</dd>
            </div>
            <div className="bg-sheet px-3 py-2.5">
              <dt className="label">If it goes wrong</dt>
              <dd className="mt-1 leading-snug">That part freezes or comes back to you</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12.5px] text-graphite">Business use only. Early-access caps apply: deals up to 25,000.00 USDC (demo figure).</p>
        </div>

        {/* The concept in one object: the waybill and its carbon copy */}
        <div className={`relative mx-auto w-full max-w-[38rem] lg:mr-0 ${desk === "empty" ? "invisible" : ""}`} aria-hidden={desk === "empty"}>
          <div data-hero-copy aria-hidden className="absolute inset-0 translate-x-4 translate-y-5 rotate-[2.2deg] rounded-md border border-held/30 bg-held-wash" />
          <div data-hero-doc className="relative -rotate-[1.2deg]">
            <Waybill detail="summary" compact showLockStamp={false} ts={desk === "live" ? tranches : waiting} />
          </div>
          {desk === "live" ? (
            <div data-hero-stamp className="absolute -top-5 -left-3 rotate-[-10deg] sm:-left-6">
              <Stamp tone="held" rotate={0} sub={`${usdc(deal.funded)} USDC`}>
                Funds locked
              </Stamp>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
