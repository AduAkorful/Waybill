import { buyerFee, heldFor, isClosed, refundedFor, releasedFor, resolvedParts, fundingTotal } from "@/view/derive";
import { formatAmount, toCents } from "@/view/format";
import { trancheName } from "@/view/labels";
import type { DealView } from "@/view/types";
import { Odometer } from "./Odometer";

const seg: Record<string, string> = {
  released: "bg-released",
  refunded: "bg-refunded",
  in_review: "bg-held [background-image:repeating-linear-gradient(-45deg,transparent_0_4px,rgb(255_255_255/0.22)_4px_8px)]",
  claimable: "bg-held",
  disputed: "bg-hold",
  waiting: "bg-transparent border border-held/50",
  overdue: "bg-transparent border border-dashed border-hold/70",
  refundable: "bg-transparent border border-dashed border-refunded/70",
  resolved: "bg-ink",
};

/**
 * Where the deal's money is, as one bar: each stub a segment in proportion to its share.
 * All figures are derived from the escrow's own state; nothing is estimated.
 */
export function Ledger({ deal, voice = "buyer" }: { deal: DealView; voice?: "buyer" | "public" }) {
  const you = voice === "buyer";
  const held = heldFor(deal);
  const released = releasedFor(deal);
  const refunded = refundedFor(deal);
  const size = toCents(fundingTotal(deal));
  const decided = resolvedParts(deal).length;
  const open = deal.tranches.filter((t) => !isClosed(t));
  const feesHeld = open.reduce((s, t) => s + buyerFee(t, deal.feePayer), 0n);
  const arbiterHeld = decided === 0 && deal.state === "funded";

  return (
    <section aria-label="Where the money is" className="@container">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <dt className="label">Released to supplier</dt>
          <dd data-released className="mt-1 text-[26px] leading-none text-released">
            <Odometer to={toCents(released)} size={size} label={`${formatAmount(released)} USDC`} />
          </dd>
        </div>
        <div>
          <dt className="label">Held in escrow</dt>
          <dd data-held className="mt-1 text-[26px] leading-none text-held">
            <Odometer to={toCents(held)} size={size} label={`${formatAmount(held)} USDC`} />
          </dd>
        </div>
        <div>
          <dt className="label">{you ? "Refunded to you" : "Refunded to buyer"}</dt>
          <dd data-refunded className="mt-1 text-[26px] leading-none text-graphite">
            <Odometer to={toCents(refunded)} size={size} label={`${formatAmount(refunded)} USDC`} />
          </dd>
        </div>
      </dl>
        <p className="ml-auto max-w-[17rem] text-[12px] leading-snug text-graphite">
          {held === 0n ? (
            deal.state === "funded" ? "Nothing is held." : deal.state === "settled" ? "Nothing is held. Every part has a final fate." : "Nothing is locked."
          ) : (
            <>
              Held includes {formatAmount(feesHeld)} in fees{arbiterHeld ? ` and the ${formatAmount(deal.arbiterFee)} arbiter fee ${you ? "you" : "the buyer"} prepaid` : ""}.
            </>
          )}
          {decided > 0 ? ` The split on ${decided} arbiter-decided part${decided > 1 ? "s" : ""} is not in these figures.` : ""}
        </p>
      </div>
      {[released, held, refunded].some((v) => v % 10_000n !== 0n) ? (
        <p data-exact className="mono mt-2 text-[11.5px] text-graphite">
          Exact: released {formatAmount(released)} · held {formatAmount(held)} · refunded {formatAmount(refunded)} USDC. The large figures above are rounded to the cent.
        </p>
      ) : null}
      <div className="mt-3 flex h-2.5 gap-[3px]" role="img" aria-label="Deal total split by part">
        {deal.tranches.map((t) => (
          <span key={t.index} data-ledger-seg={t.index} className={`h-full rounded-[2px] ${seg[t.state]}`} style={{ flexGrow: t.bps, flexBasis: 0 }} />
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[12px] text-graphite">
        {deal.tranches.map((t) => (
          <span key={t.index} className="truncate" style={{ flexGrow: t.bps, flexBasis: 0 }}>
            <span className="mono hidden @xl:inline">{formatAmount(t.amount)} · </span>
            {trancheName(t)}
          </span>
        ))}
      </div>
    </section>
  );
}
