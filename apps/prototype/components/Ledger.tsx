import type { Tranche } from "@/demo/deal";
import { deal, heldInEscrow, releasedTotal } from "@/demo/deal";
import { usdc } from "@/demo/format";
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
 * Replaces separate "held / released / refunded" boxes so the three figures can't be read as unrelated numbers.
 */
export function Ledger({
  ts,
  refunded = 0,
  voice = "buyer",
  held: heldOverride,
  arbiterFee = deal.arbiterFee,
  size = deal.funded,
}: {
  arbiterFee?: number;
  /** Largest figure the ledger may roll through; sizes the counters */
  size?: number;
  ts: Tranche[];
  refunded?: number;
  voice?: "buyer" | "public";
  /** When a decision has already paid the arbiter fee out of the held amount */
  held?: number;
}) {
  const you = voice === "buyer";
  const held = heldOverride ?? heldInEscrow(ts, arbiterFee);
  const released = releasedTotal(ts);
  return (
    <section aria-label="Where the money is" className="@container">
      <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <dt className="label">Released to supplier</dt>
          <dd data-released className="mt-1 text-[26px] leading-none text-released">
            <Odometer to={released} size={size} />
          </dd>
        </div>
        <div>
          <dt className="label">Held in escrow</dt>
          <dd data-held className="mt-1 text-[26px] leading-none text-held">
            <Odometer to={held} size={size} />
          </dd>
        </div>
        <div>
          <dt className="label">{you ? "Refunded to you" : "Refunded to buyer"}</dt>
          <dd data-refunded className="mt-1 text-[26px] leading-none text-graphite">
            <Odometer to={refunded} size={size} />
          </dd>
        </div>
        <p className="ml-auto max-w-[17rem] text-[12px] leading-snug text-graphite">
          {held === 0 ? (
            "Nothing is held. Every part has a final fate."
          ) : (
            <>
              Held includes {usdc(ts.filter((t) => !["released", "refunded"].includes(t.state)).reduce((s, t) => s + t.fee, 0))} in fees and the{" "}
              {usdc(arbiterFee)} arbiter fee {you ? "you" : "the buyer"} prepaid.
            </>
          )}
        </p>
      </dl>
      <div className="mt-3 flex h-2.5 gap-[3px]" role="img" aria-label="Deal total split by stub">
        {ts.map((t) => (
          <span key={t.index} data-ledger-seg={t.index} className={`h-full rounded-[2px] ${seg[t.state]}`} style={{ flexGrow: t.bps, flexBasis: 0 }} />
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[11px] text-graphite">
        {ts.map((t) => (
          <span key={t.index} className="truncate" style={{ flexGrow: t.bps, flexBasis: 0 }}>
            <span className="mono hidden @xl:inline">{usdc(t.amount)} · </span>
            {t.short}
          </span>
        ))}
      </div>
    </section>
  );
}
