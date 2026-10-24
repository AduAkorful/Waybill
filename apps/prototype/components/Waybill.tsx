import { buyer, deal, supplier, tranches as demoTranches, type Party, type Tranche, arbiter } from "@/demo/deal";

/** The header fields a waybill needs. A DealRecord satisfies it. */
export type WaybillInfo = Omit<typeof deal, "state" | "now" | "fundedAt" | "fundTx"> & {
  fundedAt?: string;
  fundTx?: string;
  buyer: Party;
  supplier: Party;
  arbiter: Party;
};
const defaultInfo: WaybillInfo = { ...deal, buyer, supplier, arbiter };
import { ghsEstimate, shortHash, usdc } from "@/demo/format";
import { Stamp } from "./Stamp";
import { Stub, type Lang, type StubPose } from "./Stub";

function Box({
  n,
  label,
  zh,
  bilingual,
  children,
  className = "",
}: {
  n: string;
  label: string;
  zh: string;
  bilingual: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-box className={`bg-sheet px-3.5 py-2.5 ${className}`}>
      <div className="label flex items-baseline gap-1.5">
        <span className="mono font-normal tracking-normal text-[10px] opacity-70">{n}</span>
        <span>{label}</span>
        {bilingual ? <span lang="zh" className="normal-case tracking-normal">{zh}</span> : null}
      </div>
      <div className="mt-1 text-[13.5px] leading-snug">{children}</div>
    </div>
  );
}

/** Redaction bars: the document-world way to show something exists but isn't yours to read. */
function Redact({ lines, note }: { lines: string[]; note: string }) {
  return (
    <span className="block" aria-label={note}>
      {lines.map((w, i) => (
        <span key={i} aria-hidden className={`mt-1 block h-[13px] rounded-[1px] bg-ink/85 first:mt-0.5 ${w}`} />
      ))}
      <span className="mt-1.5 block text-[11.5px] text-graphite">{note}</span>
    </span>
  );
}

/** Route line: the goods' journey, with each stub pinned where it is confirmed. */
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
  const at = [6, 38, 94];
  // Solid green up to the last paid stub; blue on to the stub now being confirmed.
  const lastPaid = ts.reduce((p, t, i) => (t.state === "released" ? i : p), -1);
  const active = ts.findIndex((t) => ["in_review", "claimable", "disputed"].includes(t.state));
  const paidTo = lastPaid >= 0 ? at[lastPaid] : 0;
  const activeTo = active > lastPaid ? at[active] : paidTo;
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
          style={{ left: `${at[i] ?? 50}%` }}
        />
      ))}
    </div>
  );
}

export function Waybill({
  lang = "en",
  bilingual = false,
  ts = demoTranches,
  poses = {},
  showLockStamp = true,
  proposed = false,
  compact = false,
  detail = "full",
  actions = {},
  redacted = false,
  info,
}: {
  lang?: Lang;
  bilingual?: boolean;
  ts?: Tranche[];
  poses?: Record<number, StubPose>;
  showLockStamp?: boolean;
  proposed?: boolean;
  compact?: boolean;
  /** "summary" keeps the four fields a party checks daily and folds fee, arbiter and hash into one terms line */
  detail?: "full" | "summary";
  /** Decision controls placed on the stub they act on */
  actions?: Record<number, React.ReactNode>;
  /** Public record: commercial details blacked out, as each party chose */
  redacted?: boolean;
  /** The deal to draw; defaults to the WB-0427 demo deal used by the frames */
  info?: WaybillInfo;
}) {
  const d = info ?? defaultInfo;
  const bi = bilingual || lang === "zh";
  const focus = ts.find((t) => ["in_review", "claimable", "disputed"].includes(t.state))?.index;
  // The ledger already shows proportions; here the stub that needs a decision gets the room for it.
  const cols = ts.map((t) => (t.index === focus ? "minmax(18rem, 1.5fr)" : "minmax(12rem, 1fr)")).join(" 2px ");

  return (
    <section className="@container" aria-label={`Waybill ${d.id}`}>
      <div className="relative">
        {/* Document */}
        <div className="relative overflow-hidden rounded-t-md border border-b-0 border-rule bg-sheet shadow-[var(--shadow)]">
          <header className="flex items-start justify-between gap-3 border-b border-rule px-4 pt-3.5 pb-3">
            <div>
              <p className="condensed text-[19px] leading-none font-extrabold tracking-[0.18em]">WAYBILL</p>
              <p className="label mt-1">
                Escrow waybill{bi ? <span lang="zh" className="normal-case tracking-normal"> · 托管运单</span> : null}
              </p>
            </div>
            <div className="text-right">
              <p className="label">No.</p>
              <p className="mono text-[15px] leading-tight font-medium">{d.id}</p>
            </div>
          </header>

          {/* Corridor */}
          <div className="border-b border-rule px-4 pt-3 pb-3.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="condensed text-[40px] leading-[0.9] font-extrabold tracking-tight @2xl:text-[52px]">{d.origin.code}</p>
                <p className="mt-1 text-[12px] text-graphite">
                  {redacted ? "Origin" : d.origin.city}
                  {bi && !redacted ? <span lang="zh"> · 广州</span> : null}
                </p>
              </div>
              <div className="mb-5 min-w-0 flex-1">
                {compact ? (
                  <div className="mx-2 flex items-center gap-2 text-[11.5px] text-graphite">
                    <span className="h-px flex-1 border-t border-dashed border-rule" />
                    <span className="hidden whitespace-nowrap @lg:inline" lang={lang === "zh" ? "zh-CN" : undefined}>
                      {lang === "zh" ? "海运 · 预计到港" : "Sea freight · arrival due"} {ts[ts.length - 1]?.due}
                    </span>
                    <span className="h-px flex-1 border-t border-dashed border-rule" />
                  </div>
                ) : (
                  <Route ts={ts} />
                )}
              </div>
              <div className="text-right">
                <p className="condensed text-[40px] leading-[0.9] font-extrabold tracking-tight @2xl:text-[52px]">{d.destination.code}</p>
                <p className="mt-1 text-[12px] text-graphite">
                  {redacted ? "Destination" : `${d.destination.city}, Tema port`}
                  {bi && !redacted ? <span lang="zh"> · 阿克拉</span> : null}
                </p>
              </div>
            </div>
          </div>

          {/* Numbered boxes */}
          {detail === "summary" ? (
            <>
              <div className="grid grid-cols-2 gap-px bg-rule @3xl:grid-cols-[1.3fr_1.2fr_1fr]">
                <Box className="col-span-2 @3xl:col-span-1" n="02" label="Supplier" zh="供应商" bilingual={bi}>
                  {redacted ? (
                    <Redact lines={["w-11/12", "w-1/2"]} note="Hidden by the supplier" />
                  ) : (
                    <>
                      <span className="font-semibold">{d.supplier.org}</span>
                      <span className="block text-graphite">
                        {d.supplier.name}, {d.supplier.city}
                      </span>
                    </>
                  )}
                </Box>
                <Box n="03" label="Goods" zh="货物" bilingual={bi}>
                  {redacted ? (
                    <Redact lines={["w-3/4", "w-2/3"]} note="Commercial detail, hidden" />
                  ) : (
                    <>
                      {d.goods}
                      <span className="block text-graphite">
                        {d.units.toLocaleString("en-US")} units in {d.cartons} cartons
                      </span>
                    </>
                  )}
                </Box>
                <Box n="04" label="Deal total" zh="合同总额" bilingual={bi}>
                  <span className="mono text-[17px] font-medium">{usdc(d.total)}</span>{" "}
                  <span className="condensed text-[11px] font-semibold text-graphite">USDC</span>
                  <span className="block text-[12px] text-graphite">{ghsEstimate(d.total)}</span>
                </Box>
              </div>
              <p className="border-t border-rule px-3.5 py-2.5 text-[12.5px] text-graphite">
                <span className="label mr-2">{d.fundedAt ? `Terms frozen ${d.fundedAt.split(",")[0]}` : "Terms · freeze when funded"}</span>
                {d.template} · fee 0.75% ({usdc(d.feeTotal)}) paid by buyer · arbiter {d.arbiter.name}, {usdc(d.arbiterFee)} · terms hash{" "}
                <span className="mono text-[11.5px]">{shortHash(d.termsHash)}</span> ·{" "}
                {redacted ? null : (
                  <a href={`/print/${d.id}`} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-2 hover:text-ink">
                    full terms ↗
                  </a>
                )}
              </p>
            </>
          ) : (
          <div className="grid grid-cols-2 gap-px bg-rule @3xl:grid-cols-4">
            <Box className="col-span-2 @lg:col-span-1" n="01" label="Buyer" zh="买方" bilingual={bi}>
              <span className="font-semibold">{d.buyer.org}</span>
              <span className="block text-graphite">
                {d.buyer.name}, {d.buyer.city}
              </span>
            </Box>
            <Box className="col-span-2 @lg:col-span-1" n="02" label="Supplier" zh="供应商" bilingual={bi}>
              {bi ? (
                <span lang="zh" className="block font-semibold">
                  {d.supplier.orgZh}
                </span>
              ) : null}
              <span className={bi ? "block text-graphite" : "font-semibold"}>{d.supplier.org}</span>
            </Box>
            <Box className="col-span-2 @lg:col-span-1" n="03" label="Goods" zh="货物" bilingual={bi}>
              <span lang={lang === "zh" ? "zh" : undefined}>{lang === "zh" ? d.goodsZh : d.goods}</span>
              <span className="mono block text-[12px] text-graphite">
                {d.units.toLocaleString("en-US")} units · {d.cartons} cartons
              </span>
            </Box>
            <Box n="04" label="Deal total" zh="合同总额" bilingual={bi}>
              <span className="mono text-[17px] font-medium">{usdc(d.total)}</span>{" "}
              <span className="condensed text-[11px] font-semibold text-graphite">USDC</span>
              {lang === "en" ? <span className="mono block text-[11.5px] text-graphite">{ghsEstimate(d.total)}</span> : null}
            </Box>
            <Box n="05" label="Fee" zh="服务费" bilingual={bi}>
              <span className="mono">0.75% · {usdc(d.feeTotal)}</span>
              <span className="block text-graphite" lang={lang === "zh" ? "zh" : undefined}>
                {lang === "zh" ? "由买方支付，您收到全额" : "Paid by buyer"}
              </span>
            </Box>
            <Box n="06" label="Arbiter" zh="仲裁方" bilingual={bi}>
              {d.arbiter.name}
              <span className="mono block text-[12px] text-graphite">
                {lang === "zh" ? "费用" : "fee"} {usdc(d.arbiterFee)} · {lang === "zh" ? "买方预付" : "prepaid by buyer"}
              </span>
            </Box>
            <Box n="07" label="Terms" zh="条款" bilingual={bi}>
              {d.template} <span className="mono text-[12px] text-graphite">{d.templateVersion}</span>
              <span className="mono block text-[12px] text-graphite">hash {shortHash(d.termsHash)}</span>
            </Box>
            <Box n="08" label="Escrow" zh="托管" bilingual={bi}>
              {proposed ? (
                <span lang={lang === "zh" ? "zh" : undefined}>
                  {lang === "zh" ? "尚未付款，您接受后买方付款" : "Not funded yet"}
                </span>
              ) : (
                <>
                  <span className="mono text-held font-medium">{usdc(d.funded)} USDC</span>
                  <span className="block text-graphite">
                    locked {d.fundedAt?.split(",")[0]} ·{" "}
                    <a href={`/explorer/${d.fundTx}`} target="_blank" rel="noreferrer" className="mono text-[12px] underline decoration-rule underline-offset-2">
                      {shortHash(d.fundTx ?? "")} ↗
                    </a>
                  </span>
                </>
              )}
            </Box>
          </div>
          )}

          {showLockStamp && !proposed ? (
            <div data-lock-stamp className="pointer-events-none absolute top-[12px] right-[150px] hidden @2xl:block">
              <Stamp tone="held" rotate={-9} sub={`${usdc(d.funded)} USDC`}>
                {lang === "zh" ? "资金已锁定" : "Funds locked"}
              </Stamp>
            </div>
          ) : null}
        </div>

        {/* Perforated edge */}
        <div className="perf border-x border-rule bg-sheet" aria-hidden>
          <span className="notch -left-[8px]" />
          <span className="notch -right-[8px]" />
        </div>

        {/* Stubs */}
        <div
          className="grid grid-cols-1 rounded-b-md border border-t-0 border-rule bg-sheet @2xl:[grid-template-columns:var(--cols)]"
          style={{ ["--cols" as string]: cols }}
        >
          {ts.map((t, i) => (
            <div key={t.index} className="contents">
              {i > 0 ? (
                <>
                  <div className="perf @2xl:hidden" aria-hidden />
                  <div className="perf-v hidden @2xl:block" aria-hidden />
                </>
              ) : null}
              <Stub
                t={t}
                seed={`${d.id}-${t.index}`}
                lang={lang}
                pose={poses[t.index]}
                action={actions[t.index]}
                quiet={focus !== undefined && focus !== t.index && t.state === "waiting"}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
