import { formatAmount, formatDateTime, formatDay } from "@/view/format";
import { reviewEnds } from "@/view/derive";
import { confirmationText, trancheName } from "@/view/labels";
import { tornTop } from "@/view/tear";
import type { MilestoneState, Tranche } from "@/view/types";
import { Stamp } from "./Stamp";

export type Lang = "en" | "zh";

const stateWord: Record<MilestoneState, { en: string; zh: string }> = {
  waiting: { en: "Waiting", zh: "等待中" },
  in_review: { en: "Buyer review", zh: "买方审核中" },
  claimable: { en: "Paying supplier", zh: "正在付款" },
  released: { en: "Released", zh: "已付款" },
  overdue: { en: "Overdue · grace running", zh: "已逾期" },
  refundable: { en: "Refundable", zh: "可退款" },
  refunded: { en: "Refunded", zh: "已退款" },
  disputed: { en: "Held by dispute", zh: "争议冻结" },
  resolved: { en: "Resolved by arbiter", zh: "已裁决" },
};

const stateTone: Record<MilestoneState, string> = {
  waiting: "text-graphite",
  in_review: "text-held",
  claimable: "text-held",
  released: "text-released",
  overdue: "text-hold",
  refundable: "text-refunded",
  refunded: "text-refunded",
  disputed: "text-hold",
  resolved: "text-ink",
};

export type StubPose = "attached" | "torn" | "tearing";

/** One part of the deal. Torn off (paid or refunded) it leans away from the waybill; everything shown is read from the escrow. */
export function Stub({
  t,
  seed,
  lang = "en",
  pose,
  action,
  quiet = false,
  className = "",
}: {
  t: Tranche;
  /** Torn-edge seed; the same deal and stub always tear the same way */
  seed: string;
  lang?: Lang;
  pose?: StubPose;
  /** Replaces the footer for the stub that needs a decision */
  action?: React.ReactNode;
  /** Pushed back when another stub is the one that needs attention */
  quiet?: boolean;
  className?: string;
}) {
  const p: StubPose = pose ?? (t.state === "released" || t.state === "refunded" ? "torn" : "attached");
  const torn = p !== "attached";
  const zh = lang === "zh";
  const word = stateWord[t.state];
  const wash =
    t.state === "released"
      ? "bg-released-wash"
      : t.state === "refunded"
        ? "bg-refunded-wash"
        : t.state === "disputed"
          ? "bg-hold-wash"
          : t.state === "in_review" || t.state === "claimable"
            ? "bg-held-wash"
            : "bg-sheet";
  const transform =
    p === "tearing"
      ? "translate(10px, 26px) rotate(4.5deg)"
      : p === "torn"
        ? t.state === "refunded"
          ? "translate(-3px, 9px) rotate(1.4deg)"
          : "translate(3px, 9px) rotate(-1.2deg)"
        : undefined;
  const active = t.state === "in_review" || t.state === "claimable" || t.state === "disputed";
  const ends = reviewEnds(t);

  return (
    <div className={`relative min-w-0 ${className}`}>
      {torn ? <div aria-hidden className="absolute inset-0 rounded-b-md border border-dashed border-rule" /> : null}
      <article
        data-stub-card={t.index}
        aria-label={`Stub ${t.index}, ${word.en}`}
        className={`relative flex h-full flex-col rounded-b-md px-4 pb-4 ${wash} ${torn ? "pt-6 shadow-[var(--shadow)]" : "pt-4"} ${
          active ? "z-[1] shadow-[0_0_0_1.5px_var(--held),var(--shadow)]" : ""
        } ${t.state === "disputed" ? "shadow-[0_0_0_1.5px_var(--hold),var(--shadow)]" : ""} ${
          t.state === "overdue" || t.state === "refundable" ? "outline-1 -outline-offset-4 outline-hold/60 outline-dashed" : ""
        } ${quiet ? "opacity-80" : ""}`}
        style={{ clipPath: torn ? tornTop(seed) : undefined, transform }}
      >
        <header className="flex items-baseline justify-between gap-2">
          <span className="label">
            {zh ? `第 ${t.index} 期` : `Stub ${t.index}`} · {t.bps / 100}%
          </span>
          <span className={`label ${stateTone[t.state]}`}>{zh ? word.zh : word.en}</span>
        </header>

        <h3 className="mt-2 text-[15px] leading-snug font-semibold">{trancheName(t)}</h3>

        <p className="mt-2 flex items-baseline gap-1.5">
          <span className={`mono leading-none font-medium tracking-tight ${active ? "text-[26px]" : "text-[21px]"}`}>{formatAmount(t.amount)}</span>
          <span className="condensed text-[11px] font-semibold text-graphite">USDC</span>
        </p>

        <p className="mt-3 text-[12.5px] leading-snug text-graphite">{confirmationText(t)}</p>

        <footer className="mt-auto pt-4">
          {action ??
            (t.state === "released" ? (
              <p className="text-[12px] text-graphite">Paid to the supplier</p>
            ) : t.state === "refunded" ? (
              <p className="text-[12px] text-graphite">Returned to the buyer</p>
            ) : t.state === "resolved" ? (
              <p className="text-[12px] text-graphite">Decided by the arbiter</p>
            ) : t.state === "disputed" ? (
              <p className="text-[12px] text-hold">Frozen until the arbiter decides. Other stubs are not affected.</p>
            ) : ends !== null ? (
              <p className="text-[12px] text-graphite">
                Buyer can object until <span className="text-ink">{formatDateTime(ends)}</span>
              </p>
            ) : t.deadline > 0n ? (
              <p className="text-[12px] text-graphite">
                {zh ? "截止" : "Due"} <span className="text-ink">{formatDay(t.deadline)}</span>
              </p>
            ) : null)}
        </footer>

        {t.state === "released" || t.state === "refunded" || t.state === "disputed" ? (
          <div className="pointer-events-none absolute right-3 bottom-3">
            <Stamp tone={t.state === "released" ? "released" : t.state === "refunded" ? "refunded" : "hold"} rotate={-7}>
              {t.state === "released" ? (zh ? "已付款" : "Released") : t.state === "refunded" ? (zh ? "已退款" : "Refunded") : zh ? "冻结" : "Held"}
            </Stamp>
          </div>
        ) : null}
      </article>
    </div>
  );
}
