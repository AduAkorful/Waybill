import { fundingTotal, focusPart } from "@/view/derive";
import { formatAmount, shortAddress } from "@/view/format";
import type { DealView, FeePayer, Tranche } from "@/view/types";
import { Stamp } from "./Stamp";
import { Stub, type Lang, type StubPose } from "./Stub";

const feeWording: Record<FeePayer, string> = {
  buyer: "Paid by the buyer",
  supplier: "Deducted from the supplier's payments",
  split: "Split between buyer and supplier",
};

const feeWordingZh: Record<FeePayer, string> = {
  buyer: "由买方支付",
  supplier: "从供应商的付款中扣除",
  split: "买方与供应商分摊",
};

function Box({ n, label, children, className = "" }: { n: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div data-box className={`border-r border-b border-rule bg-sheet px-3.5 py-2.5 ${className}`}>
      <div className="label flex items-baseline gap-1.5">
        <span className="mono text-[11.5px] font-normal tracking-normal text-graphite">{n}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1 text-[13.5px] leading-snug">{children}</div>
    </div>
  );
}

/** Route line: the money's journey, with each stub pinned where it is confirmed. */
function Route({ ts }: { ts: Tranche[] }) {
  const dot = (t: Tranche) =>
    t.state === "released"
      ? "bg-released border-released"
      : t.state === "in_review" || t.state === "claimable"
        ? "bg-sheet border-held ring-4 ring-held/15"
        : t.state === "disputed"
          ? "bg-hold border-hold"
          : t.state === "refunded"
            ? "bg-refunded border-refunded"
            : "bg-sheet border-rule";
  // Stubs are spread evenly along the line; a single stub sits at the far end.
  const at = (i: number) => (ts.length === 1 ? 94 : 6 + (88 * i) / (ts.length - 1));
  const lastPaid = ts.reduce((p, t, i) => (t.state === "released" ? i : p), -1);
  const active = ts.findIndex((t) => ["in_review", "claimable", "disputed"].includes(t.state));
  const paidTo = lastPaid >= 0 ? at(lastPaid) : 0;
  const activeTo = active > lastPaid ? at(active) : paidTo;
  return (
    <div className="relative mx-2 h-6" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-rule" />
      <div className="absolute top-1/2 left-0 border-t-2 border-released" style={{ width: `${paidTo}%` }} />
      <div className="absolute top-1/2 border-t-2 border-held" style={{ left: `${paidTo}%`, width: `${activeTo - paidTo}%` }} />
      {ts.map((t, i) => (
        <span
          key={t.index}
          data-route-dot={t.index}
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${dot(t)}`}
          style={{ left: `${at(i)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The deal as one document: header, corridor, numbered boxes, and a stub per part. Every value comes from the
 * escrow; goods, names and places appear only when off-chain terms exist and the viewer may see them.
 */
export function Waybill({
  deal,
  lang = "en",
  poses = {},
  showLockStamp = true,
  compact = false,
  detail = "full",
  actions = {},
  redacted = false,
}: {
  deal: DealView;
  lang?: Lang;
  poses?: Record<number, StubPose>;
  showLockStamp?: boolean;
  compact?: boolean;
  /** "summary" keeps the fields a party checks daily and folds the rest into one terms line */
  detail?: "full" | "summary";
  /** Decision controls placed on the stub they act on */
  actions?: Record<number, React.ReactNode>;
  /** Public record: names and commercial detail from off-chain terms are left out, as each party chose */
  redacted?: boolean;
}) {
  const ts = deal.tranches;
  const focus = focusPart(deal)?.index;
  // Parts sit side by side only when every part has its minimum width; below that they stack, instead of being squeezed.
  const side =
    ts.length <= 2
      ? { grid: "@2xl:[grid-template-columns:var(--cols)]", hideH: "@2xl:hidden", showV: "@2xl:block" }
      : ts.length === 3
        ? { grid: "@4xl:[grid-template-columns:var(--cols)]", hideH: "@4xl:hidden", showV: "@4xl:block" }
        : { grid: "@5xl:[grid-template-columns:var(--cols)]", hideH: "@5xl:hidden", showV: "@5xl:block" };
  const cols = ts.map((t) => (t.index === focus ? "minmax(18rem, 1.5fr)" : "minmax(12rem, 1fr)")).join(" 2px ");
  const terms = redacted ? undefined : deal.terms;
  const feeTotal = ts.reduce((s, t) => s + t.fee, 0n);
  const funded = deal.state === "funded" || deal.state === "settled";
  const id = deal.id.toString();

  return (
    <section className="@container" aria-label={`Waybill ${id}`}>
      <div className="relative">
        <div className="relative overflow-hidden rounded-t-md border border-b-0 border-rule bg-sheet shadow-[var(--shadow)]">
          <header className="flex items-start justify-between gap-3 border-b border-rule px-4 pt-3.5 pb-3">
            <div>
              <p className="condensed text-[19px] leading-none font-extrabold tracking-[0.18em]">WAYBILL</p>
              <p className="label mt-1">{lang === "zh" ? "托管运单" : "Escrow waybill"}</p>
            </div>
            <div className="text-right">
              <p className="label">{lang === "zh" ? "编号" : "No."}</p>
              <p className="mono text-[15px] leading-tight font-medium">{id}</p>
            </div>
          </header>

          <div className="border-b border-rule px-4 pt-3 pb-3.5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                {terms?.origin ? (
                  <p className="condensed text-[40px] leading-[0.9] font-extrabold tracking-tight @2xl:text-[52px]">{terms.origin.code}</p>
                ) : (
                  <p className="mono text-[15px] leading-tight font-medium">{shortAddress(deal.supplier)}</p>
                )}
                <p className="mt-1 text-[12px] text-graphite">{terms?.origin ? terms.origin.city : lang === "zh" ? "供应商" : "Supplier"}</p>
              </div>
              <div className="mb-5 min-w-0 flex-1">
                {compact ? (
                  <div className="mx-2 flex items-center gap-2 text-[11.5px] text-graphite">
                    <span className="h-px flex-1 border-t border-dashed border-rule" />
                  </div>
                ) : (
                  <Route ts={ts} />
                )}
              </div>
              <div className="min-w-0 text-right">
                {terms?.destination ? (
                  <p className="condensed text-[40px] leading-[0.9] font-extrabold tracking-tight @2xl:text-[52px]">{terms.destination.code}</p>
                ) : (
                  <p className="mono text-[15px] leading-tight font-medium">{shortAddress(deal.buyer)}</p>
                )}
                <p className="mt-1 text-[12px] text-graphite">{terms?.destination ? terms.destination.city : lang === "zh" ? "买方" : "Buyer"}</p>
              </div>
            </div>
          </div>

          {detail === "summary" ? (
            <>
              <div className="-mr-px -mb-px grid grid-cols-2 @3xl:grid-cols-3">
                <Box n="01" label={lang === "zh" ? "供应商" : "Supplier"}>
                  {terms?.supplierName ? <span className="block font-semibold">{terms.supplierName}</span> : null}
                  <span className="mono text-[12.5px]">{shortAddress(deal.supplier)}</span>
                </Box>
                {terms?.goods ? (
                  <Box n="02" label={lang === "zh" ? "货物" : "Goods"}>
                    {terms.goods}
                    {terms.units !== undefined ? (
                      <span className="block text-graphite">
                        {lang === "zh"
                          ? `${terms.units.toLocaleString("en-US")} 件${terms.cartons !== undefined ? `，共 ${terms.cartons} 箱` : ""}`
                          : `${terms.units.toLocaleString("en-US")} units${terms.cartons !== undefined ? ` in ${terms.cartons} cartons` : ""}`}
                      </span>
                    ) : null}
                  </Box>
                ) : null}
                <Box n="03" label={lang === "zh" ? "交易总额" : "Deal total"}>
                  <span className="mono text-[17px] font-medium">{formatAmount(deal.totalAmount)}</span>{" "}
                  <span className="condensed text-[12px] font-semibold text-graphite">USDC</span>
                </Box>
              </div>
              <p className="border-t border-rule px-3.5 py-2.5 text-[12.5px] text-graphite">
                <span className="label mr-2">{lang === "zh" ? "条款" : "Terms"}</span>
                {terms?.template ? `${terms.template} · ` : ""}
                {lang === "zh" ? "费用" : "fee"} {deal.feeBps / 100}% ({formatAmount(feeTotal)}) · {lang === "zh" ? feeWordingZh[deal.feePayer] : feeWording[deal.feePayer].toLowerCase()} · {lang === "zh" ? (deal.panel ? "三人仲裁组" : "仲裁人") : deal.panel ? "panel of three" : "arbiter"}{" "}
                <span className="mono text-[11.5px]">{deal.panel ? deal.panel.members.map(shortAddress).join(", ") : shortAddress(deal.arbiter)}</span>, {formatAmount(deal.arbiterFee)}
              </p>
            </>
          ) : (
            <div className="-mr-px -mb-px grid grid-cols-2 @3xl:grid-cols-4">
              {(() => {
                // Boxes are numbered in the order shown. The header already carries both addresses, so a party's box
                // appears only when it adds something: a name, or the note that the payout wallet is not set.
                const boxes: { label: string; className?: string; body: React.ReactNode }[] = [];
                if (terms?.buyerName) {
                  boxes.push({ label: "Buyer", className: "col-span-2 @lg:col-span-1", body: (<><span className="block font-semibold">{terms.buyerName}</span><span className="mono text-[12.5px]">{shortAddress(deal.buyer)}</span></>) });
                }
                if (terms?.supplierName || deal.supplierPayout === null) {
                  boxes.push({ label: "Supplier", className: "col-span-2 @lg:col-span-1", body: (<>
                    {terms?.supplierName ? <span className="block font-semibold">{terms.supplierName}</span> : null}
                    <span className="mono text-[12.5px]">{shortAddress(deal.supplier)}</span>
                    {deal.supplierPayout === null ? <span className="block text-graphite">Payout wallet not set yet</span> : null}
                  </>) });
                }
                if (terms?.goods) {
                  boxes.push({ label: "Goods", className: "col-span-2 @lg:col-span-1", body: (<>
                    {terms.goods}
                    {terms.units !== undefined ? (
                      <span className="mono block text-[12px] text-graphite">
                        {terms.units.toLocaleString("en-US")} units{terms.cartons !== undefined ? ` · ${terms.cartons} cartons` : ""}
                      </span>
                    ) : null}
                  </>) });
                }
                boxes.push({ label: "Deal total", body: (<>
                  <span className="mono text-[17px] font-medium">{formatAmount(deal.totalAmount)}</span>{" "}
                  <span className="condensed text-[12px] font-semibold text-graphite">USDC</span>
                </>) });
                boxes.push({ label: "Fee", body: (<>
                  <span className="mono">{deal.feeBps / 100}% · {formatAmount(feeTotal)}</span>
                  <span className="block text-graphite">{feeWording[deal.feePayer]}</span>
                </>) });
                boxes.push({ label: deal.panel ? "Arbiter panel" : "Arbiter", body: (<>
                  <span className="mono text-[12.5px]">{deal.panel ? deal.panel.members.map(shortAddress).join(", ") : shortAddress(deal.arbiter)}</span>
                  <span className="mono block text-[12px] text-graphite">fee {formatAmount(deal.arbiterFee)} · prepaid by buyer</span>
                </>) });
                if (terms?.template) boxes.push({ label: "Terms", body: terms.template });
                boxes.push({ label: "Escrow", body: deal.state === "cancelled" ? (
                  <span>Cancelled before funding</span>
                ) : funded ? (
                  <>
                    <span className="mono font-medium text-held">{formatAmount(fundingTotal(deal))} USDC</span>
                    <span className="block text-graphite">{deal.state === "settled" ? "locked, now settled" : "locked in escrow"}</span>
                  </>
                ) : (
                  <span>Not funded yet</span>
                ) });
                return boxes.map((x, i) => (
                  <Box
                    key={x.label}
                    n={String(i + 1).padStart(2, "0")}
                    label={x.label}
                    // an odd last box fills its row on phones instead of leaving an empty cell
                    className={`${x.className ?? ""} ${i === boxes.length - 1 && boxes.length % 2 === 1 ? "col-span-2 @3xl:col-span-1" : ""}`}
                  >
                    {x.body}
                  </Box>
                ));
              })()}
            </div>
          )}

          {showLockStamp && deal.state === "funded" ? (
            <div data-lock-stamp className="pointer-events-none absolute top-[12px] right-[150px] hidden @2xl:block">
              <Stamp tone="held" rotate={-9} sub={`${formatAmount(fundingTotal(deal))} USDC`}>
                {lang === "zh" ? "资金已锁定" : "Funds locked"}
              </Stamp>
            </div>
          ) : null}
        </div>

        <div className="perf border-x border-rule bg-sheet" aria-hidden>
          <span className="notch -left-[8px]" />
          <span className="notch -right-[8px]" />
        </div>

        {ts.length > 4 ? (
          // Many parts do not fit side by side: they wrap into rows, separated by hairlines instead of perforations.
          <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-px overflow-hidden rounded-b-md border border-t-0 border-rule bg-rule">
            {ts.map((t) => (
              <Stub key={t.index} t={t} seed={`${id}-${t.index}`} lang={lang} pose={poses[t.index]} action={actions[t.index]} className="bg-sheet" />
            ))}
          </div>
        ) : (
          <div className={`grid grid-cols-1 rounded-b-md border border-t-0 border-rule bg-sheet ${side.grid}`} style={{ ["--cols" as string]: cols }}>
            {ts.map((t, i) => (
              <div key={t.index} className="contents">
                {i > 0 ? (
                  <>
                    <div className={`perf ${side.hideH}`} aria-hidden />
                    <div className={`perf-v hidden ${side.showV}`} aria-hidden />
                  </>
                ) : null}
                <Stub
                  t={t}
                  seed={`${id}-${t.index}`}
                  lang={lang}
                  pose={poses[t.index]}
                  action={actions[t.index]}
                  quiet={focus !== undefined && focus !== t.index && t.state === "waiting"}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
