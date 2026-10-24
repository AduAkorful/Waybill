import { formatAmount } from "@/view/format";

/** A modal sheet for one money action. Rises from the bottom on phones, centred on desktop. */
export function Sheet({ title, kicker, children, className = "" }: { title: string; kicker?: string; children: React.ReactNode; className?: string }) {
  return (
    <section data-sheet role="dialog" aria-label={title} className={`rounded-xl border border-rule bg-sheet p-5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] ${className}`}>
      {kicker ? <p className="label">{kicker}</p> : null}
      <h2 className="mt-1 text-[19px] leading-tight font-semibold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** The total built line by line, so nothing is hidden inside it. Amounts in cents. */
export function LineItems({ items, total, totalLabel = "Total" }: { items: { label: string; amount: bigint; note?: string }[]; total: bigint; totalLabel?: string }) {
  return (
    <dl className="text-[14px]">
      {items.map((it) => (
        <div key={it.label} data-line className="flex items-baseline justify-between gap-3 py-1.5">
          <dt>
            {it.label}
            {it.note ? <span className="block text-[12px] text-graphite">{it.note}</span> : null}
          </dt>
          <dd className="mono">{formatAmount(it.amount)}</dd>
        </div>
      ))}
      <div data-total-rule className="my-1.5 h-px origin-left bg-ink/80" />
      <div data-total className="flex items-baseline justify-between gap-3 pt-1">
        <dt className="font-semibold">{totalLabel}</dt>
        <dd className="mono text-[20px] font-medium">
          {formatAmount(total)} <span className="condensed text-[11px] font-semibold text-graphite">USDC</span>
        </dd>
      </div>
    </dl>
  );
}

export type TxView = "ready" | "awaiting" | "submitted" | "confirmed";

/** Wallet → network status, worded so a hash is never mistaken for success. */
export function TxStatus({ view, hash }: { view: TxView; hash?: string }) {
  const text: Record<TxView, [string, string]> = {
    ready: ["Ready", "Nothing has been sent yet."],
    awaiting: ["Confirm in your wallet", "Nothing has been sent yet."],
    submitted: ["Sent · waiting for the network", "Usually a few seconds. Don't send it again."],
    confirmed: ["Confirmed", "The network accepted it."],
  };
  const [head, sub] = text[view];
  return (
    <div data-tx className="flex items-start gap-3 rounded-md border border-rule bg-paper px-3.5 py-3">
      <span
        aria-hidden
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
          view === "confirmed" ? "bg-released" : view === "submitted" ? "bg-held ring-4 ring-held/20" : view === "awaiting" ? "animate-pulse bg-held" : "bg-graphite/50"
        }`}
      />
      <div className="min-w-0">
        <p data-tx-head className="text-[14px] font-semibold">
          {head}
        </p>
        <p className="text-[12.5px] text-graphite">{sub}</p>
        {hash && view !== "awaiting" && view !== "ready" ? (
          <p data-hash className="mono mt-1 text-[12px] text-graphite">
            {hash}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A tick that can draw itself on (motion.ts `draw`). */
export function Tick({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className}`} aria-hidden>
      <path data-tick d="M3.5 8.5 L6.7 11.5 L12.5 4.8" pathLength={1} strokeDasharray="1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
