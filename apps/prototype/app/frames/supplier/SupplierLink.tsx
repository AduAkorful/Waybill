"use client";

import { useState } from "react";
import { DemoMark, Wordmark } from "@/components/Chrome";
import { Stamp } from "@/components/Stamp";
import type { Lang } from "@/components/Stub";
import { Waybill } from "@/components/Waybill";
import { buyer, deal, tranches } from "@/demo/deal";
import { usdc } from "@/demo/format";

const proposed = tranches.map((t) => ({ ...t, state: "waiting" as const, releasedAt: undefined, reviewEnds: undefined, proof: undefined }));
const funded = proposed.map((t) => (t.index === 1 ? { ...tranches[0]! } : t));
const paid2 = funded.map((t) => (t.index === 2 ? { ...tranches[1]!, state: "released" as const, releasedAt: "19 Oct 2026, 10:12 GMT", proof: "0xc81f5a2e9d0b47" } : t));

/** Where the supplier is in the deal; drives the banner, the stubs and whether Accept is offered. */
export type SupplierStage = "proposed" | "accepted" | "funded" | "paid2";

const copy = {
  en: {
    wants: `${buyer.name} wants to buy from you`,
    via: `${buyer.org}, ${buyer.city} · link shared on WhatsApp`,
    promiseTitle: "You are paid in three parts.",
    promise: `The buyer locks the full ${usdc(deal.funded)} USDC before you start production. You will see it locked on this page. Each part is paid to you the moment it is confirmed.`,
    fees: "Fees are paid by the buyer. You receive the full 20,000.00 USDC.",
    wrongTitle: "If something goes wrong",
    wrong: [
      "If a confirmation is late, there is a 72-hour grace period before the buyer can ask for that part back.",
      "If the buyer disputes, only that part is frozen. Parts already paid stay paid.",
      "You can answer any dispute with your own evidence. The arbiter can only pay that part to you or back to the buyer.",
    ],
    limits: "What Waybill does not protect against",
    accept: "Accept terms",
    next: "Next: choose where you get paid. About 2 minutes. No crypto knowledge needed.",
    decline: "Decline or ask for changes",
    banner: { accepted: "You accepted. Waiting for Ama to lock the money.", funded: "20,250.00 USDC is locked. You can start production.", paid2: "6,000.00 USDC paid for the inspection." },
    bannerSub: { accepted: "We'll message you the moment it's locked. Don't start production before then.", funded: "Locked 8 Oct · 4,000.00 already paid to you · proof ↗", paid2: "Paid 19 Oct, 10:12 GMT · 10,000.00 paid so far · proof ↗" },
  },
  zh: {
    wants: `${buyer.name} 想向您采购`,
    via: `${buyer.org}，阿克拉 · 通过 WhatsApp 分享`,
    promiseTitle: "货款分三期支付给您。",
    promise: `在您开始生产前，买方会把全部 ${usdc(deal.funded)} USDC 锁定在托管中，您可以在本页看到。每一期一经确认，立即付给您。`,
    fees: "服务费由买方支付，您收到全额 20,000.00 USDC。",
    wrongTitle: "如果出现问题",
    wrong: [
      "如果某期确认延迟，买方要求退回该期款项前有 72 小时宽限期。",
      "如果买方提出争议，只冻结该期款项，已付款项不受影响。",
      "您可以提交自己的证据回应争议。仲裁方只能把该期款项付给您或退回买方。",
    ],
    limits: "Waybill 不保障的情况",
    accept: "接受条款",
    next: "下一步：设置收款方式，约 2 分钟，无需了解加密货币。",
    decline: "拒绝或要求修改",
    banner: { accepted: "您已接受，等待买方锁定资金。", funded: "20,250.00 USDC 已锁定，您可以开始生产。", paid2: "检验款 6,000.00 USDC 已付给您。" },
    bannerSub: { accepted: "资金锁定后我们会立即通知您，请在此之前不要开始生产。", funded: "10月8日锁定 · 已付 4,000.00 · 凭证 ↗", paid2: "10月19日 10:12 支付 · 累计已付 10,000.00 · 凭证 ↗" },
  },
} as const;

export function SupplierLink({ initial, stage = "proposed", bare = false }: { initial: Lang; stage?: SupplierStage; bare?: boolean }) {
  const [lang, setLang] = useState<Lang>(initial);
  const c = copy[lang];
  const zh = lang === "zh" ? "zh" : undefined;
  const cta = (
    <>
      <button className="w-full rounded-md bg-ink py-3.5 text-[15.5px] font-semibold text-paper hover:opacity-90">{c.accept}</button>
      <p className="mt-2 text-center text-[12px] text-graphite">{c.next}</p>
      <button className="mt-1 w-full py-1.5 text-[12.5px] text-graphite underline decoration-rule underline-offset-2">{c.decline}</button>
    </>
  );
  return (
    // translate="no": the Chinese view is the product; a browser's auto-translate would show something we never wrote.
    <div className="@container flex min-h-full flex-col bg-paper" lang={zh ? "zh-CN" : "en"} translate="no">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 @4xl:px-8">
          <Wordmark className="text-[14px]" />
          <div className="flex items-center gap-2">
            <DemoMark />
            <div role="group" aria-label="Language" className="flex rounded-full border border-rule p-0.5 text-[12px]">
              {(["en", "zh"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`rounded-full px-2.5 py-0.5 ${lang === l ? "bg-ink text-paper" : "text-graphite"}`}
                >
                  {l === "en" ? "EN" : "中文"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-6 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_22rem] @4xl:gap-10 @4xl:px-8 @4xl:pt-10">
        <div className="min-w-0">
          <p data-wants className="text-[21px] leading-tight font-semibold tracking-tight @4xl:text-[32px]">{c.wants}</p>
          <p className="mt-1 text-[13px] text-graphite @4xl:text-[14px]">{c.via}</p>

          {stage === "proposed" ? (
            <div data-promise className="mt-4 rounded-md border border-held/30 bg-held-wash p-3.5 @4xl:hidden">
              <p className="text-[14.5px] font-semibold text-held">{c.promiseTitle}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed">{c.promise}</p>
            </div>
          ) : (
            <div data-banner className={`mt-4 rounded-md border p-3.5 ${stage === "accepted" ? "border-rule bg-sheet" : "border-held/30 bg-held-wash"}`}>
              <p className={`text-[14.5px] font-semibold ${stage === "accepted" ? "" : "text-held"}`}>{c.banner[stage]}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-graphite">{c.bannerSub[stage]}</p>
            </div>
          )}

          <div className="relative mt-5 @4xl:mt-8">
            <Waybill lang={lang} bilingual ts={stage === "funded" ? funded : stage === "paid2" ? paid2 : proposed} proposed={stage === "proposed" || stage === "accepted"} compact showLockStamp={false} />
            {stage === "accepted" ? (
              <div data-accept-stamp className="pointer-events-none absolute top-[250px] right-6">
                <Stamp tone="held" rotate={-8} sub="7 OCT 2026">
                  {zh ? "已接受" : "Accepted"}
                </Stamp>
              </div>
            ) : null}
          </div>

          <div className="@4xl:hidden">
            <p className="mt-6 text-[13px]">{c.fees}</p>
            <Wrong c={c} />
          </div>
          {zh ? <p className="mono mt-4 text-[10.5px] text-graphite">中文文案为草稿，需母语贸易人士审校 · draft, needs native review</p> : null}
        </div>

        {/* Web: the decision lives in a column beside the document */}
        <aside className="hidden @4xl:block">
          <div className="sticky top-20">
            <div className="rounded-md border border-held/30 bg-held-wash p-4">
              <p className="text-[15px] font-semibold text-held">{c.promiseTitle}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed">{c.promise}</p>
              <p className="mt-3 border-t border-held/20 pt-3 text-[13px]">{c.fees}</p>
            </div>
            <div className="mt-5">{cta}</div>
            <Wrong c={c} />
          </div>
        </aside>
      </div>

      {bare || stage !== "proposed" ? null : (
      <footer className="sticky bottom-0 border-t border-rule bg-paper/95 px-4 pt-3 pb-4 backdrop-blur @4xl:hidden">{cta}</footer>
      )}
    </div>
  );
}

function Wrong({ c }: { c: (typeof copy)[Lang] }) {
  return (
    <>
      <h2 className="label mt-6">{c.wrongTitle}</h2>
      <ul className="mt-2 space-y-2 text-[13.5px] leading-relaxed">
        {c.wrong.map((w) => (
          <li key={w} className="flex gap-2">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-graphite" />
            {w}
          </li>
        ))}
      </ul>
      <a href="/#rules" className="mt-3 inline-block text-[13px] underline decoration-rule underline-offset-2">
        {c.limits}
      </a>
    </>
  );
}
