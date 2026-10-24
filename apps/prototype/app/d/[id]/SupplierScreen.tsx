"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DemoMark, Wordmark } from "@/components/Chrome";
import { LiveWaybill } from "@/components/live/Live";
import { Modal } from "@/components/Modal";
import type { Lang } from "@/components/Stub";
import { Timeline } from "@/components/Timeline";
import { TxFlow } from "@/components/TxFlow";
import type { Tranche } from "@/demo/deal";
import { releasedFor, type DealRecord } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { act, newHash, useDemo } from "@/demo/store";

const ESCROW = "WaybillEscrow · demo";

// Supplier copy. Chinese is a draft for native trade-speaker review.
const C = {
  en: {
    wants: (d: DealRecord) => `${d.buyer.name} wants to buy from you`,
    via: (d: DealRecord) => `${d.buyer.org}, ${d.buyer.city} · link shared on WhatsApp`,
    promiseTitle: (d: DealRecord) => `You are paid in ${d.tranches.length} part${d.tranches.length > 1 ? "s" : ""}.`,
    promise: (d: DealRecord) =>
      `The buyer locks the full ${usdc(d.funded)} USDC before you start production. You will see it locked on this page. Each part is paid to you the moment it is confirmed.`,
    fees: (d: DealRecord) => `Fees are paid by the buyer. You receive the full ${usdc(d.total)} USDC.`,
    wrongTitle: "If something goes wrong",
    wrong: [
      "If a confirmation is late, there is a 72-hour grace period before the buyer can ask for that part back.",
      "If the buyer disputes, only that part is frozen. Parts already paid stay paid.",
      "You can answer any dispute with your own evidence. The arbiter can only pay that part to you or back to the buyer.",
    ],
    limits: "What Waybill does not protect against",
    accept: "Accept terms",
    next: "Next: choose where you get paid. About 2 minutes. No crypto knowledge needed.",
    waitingFund: (d: DealRecord) => `You accepted. Waiting for ${d.buyer.name.split(" ")[0]} to lock the money.`,
    waitingFundSub: "We'll message you the moment it's locked. Don't start production before then.",
    locked: (d: DealRecord) => `${usdc(d.funded)} USDC is locked. You can start production.`,
    lockedSub: (d: DealRecord, paid: number) => `Locked ${d.fundedAt?.split(",")[0]} · ${usdc(paid)} paid to you so far`,
    settled: (paid: number) => `Deal complete. ${usdc(paid)} USDC paid to you.`,
    cancelled: "The buyer cancelled this deal before funding. Nothing was locked.",
    payout: "Your payout wallet",
    change: "Change",
    respond: "Respond to dispute",
  },
  zh: {
    wants: (d: DealRecord) => `${d.buyer.name} 想向您采购`,
    via: (d: DealRecord) => `${d.buyer.org}，${d.buyer.city} · 通过 WhatsApp 分享`,
    promiseTitle: (d: DealRecord) => `货款分 ${d.tranches.length} 期支付给您。`,
    promise: (d: DealRecord) => `在您开始生产前，买方会把全部 ${usdc(d.funded)} USDC 锁定在托管中，您可以在本页看到。每一期一经确认，立即付给您。`,
    fees: (d: DealRecord) => `服务费由买方支付，您收到全额 ${usdc(d.total)} USDC。`,
    wrongTitle: "如果出现问题",
    wrong: [
      "如果某期确认延迟，买方要求退回该期款项前有 72 小时宽限期。",
      "如果买方提出争议，只冻结该期款项，已付款项不受影响。",
      "您可以提交自己的证据回应争议。仲裁方只能把该期款项付给您或退回买方。",
    ],
    limits: "Waybill 不保障的情况",
    accept: "接受条款",
    next: "下一步：设置收款方式，约 2 分钟，无需了解加密货币。",
    waitingFund: () => "您已接受，等待买方锁定资金。",
    waitingFundSub: "资金锁定后我们会立即通知您，请在此之前不要开始生产。",
    locked: (d: DealRecord) => `${usdc(d.funded)} USDC 已锁定，您可以开始生产。`,
    lockedSub: (d: DealRecord, paid: number) => `${d.fundedAt?.split(",")[0]} 锁定 · 已付给您 ${usdc(paid)}`,
    settled: (paid: number) => `交易完成，已付给您 ${usdc(paid)} USDC。`,
    cancelled: "买方在付款前取消了此交易，没有锁定任何资金。",
    payout: "您的收款钱包",
    change: "更改",
    respond: "回应争议",
  },
};

function supplierAction(t: Tranche, lang: Lang, onRespond: () => void): React.ReactNode {
  const zh = lang === "zh";
  if (t.state === "in_review")
    return (
      <p data-action className="text-[13px] leading-snug">
        <span className="font-semibold">{zh ? "已确认，买方审核中。" : "Confirmed. The buyer is reviewing."}</span>{" "}
        <span className="text-graphite">
          {zh ? `如买方不操作，${t.reviewEnds?.split(", ")[1]} 自动付款给您。` : `Paid to you automatically at ${t.reviewEnds?.split(", ")[1]} unless they dispute.`}
        </span>
      </p>
    );
  if (t.state === "claimable")
    return (
      <p data-action className="flex items-center gap-2 text-[13px] font-semibold text-held">
        <span className="h-2 w-2 animate-pulse rounded-full bg-held" />
        {zh ? "正在付款给您…" : "Paying you now…"}
      </p>
    );
  if (t.state === "disputed")
    return (
      <div data-action className="text-[13px]">
        <p className="font-semibold text-hold">{zh ? "买方对此期提出争议，仅此期被冻结。" : "The buyer disputed this part. Only this part is frozen."}</p>
        <button onClick={onRespond} className="mt-2 rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper">
          {zh ? "回应争议" : "Respond with evidence"}
        </button>
        <p className="mt-1 text-[12px] text-graphite">{zh ? "72 小时内回应" : "Due within 72 h"}</p>
      </div>
    );
  if (t.state === "refundable")
    return <p data-action className="text-[13px] text-graphite">{zh ? "宽限期已过，买方可取回此期款项。" : "Grace period over. The buyer can take this part back."}</p>;
  return undefined;
}

type Dialog = "accept" | "payout" | null;

export function SupplierScreen({ id }: { id: string }) {
  const { deals } = useDemo();
  const d = deals[id];
  const [lang, setLang] = useState<Lang>("zh");
  const [dialog, setDialog] = useState<Dialog>(null);
  const router = useRouter();
  const c = C[lang];
  const zh = lang === "zh";

  if (!d) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-[22px] font-semibold">This deal link isn't valid</h1>
        <p className="mt-2 text-graphite">Ask the buyer to send it again.</p>
      </main>
    );
  }

  const accepted = d.acceptances.find((a) => a.role === "Supplier")?.done ?? false;
  const funded = d.state === "funded" || d.state === "settled";
  const paid = releasedFor(d);
  const canAccept = d.state === "proposed" && !accepted;
  const actions = Object.fromEntries(
    d.tranches.map((t) => [
      t.index,
      supplierAction(t, lang, () => router.push(`/d/${d.id}/room/${t.index}`)),
    ]),
  );

  const banner = !canAccept ? (
    <div
      data-banner
      className={`mt-4 rounded-md border p-3.5 ${d.state === "cancelled" ? "border-rule bg-sheet" : funded ? (d.state === "settled" ? "border-released/40 bg-released-wash" : "border-held/30 bg-held-wash") : "border-rule bg-sheet"}`}
    >
      <p className={`text-[14.5px] font-semibold ${funded ? (d.state === "settled" ? "text-released" : "text-held") : ""}`}>
        {d.state === "cancelled" ? c.cancelled : d.state === "settled" ? c.settled(paid) : funded ? c.locked(d) : c.waitingFund(d)}
      </p>
      {d.state !== "cancelled" ? (
        <p className="mt-1 text-[13px] text-graphite">{funded ? c.lockedSub(d, paid) : c.waitingFundSub}</p>
      ) : null}
    </div>
  ) : null;

  const cta = (
    <>
      <button onClick={() => setDialog("accept")} className="w-full rounded-md bg-ink py-3.5 text-[15.5px] font-semibold text-paper hover:opacity-90">
        {c.accept}
      </button>
      <p className="mt-2 text-center text-[12px] text-graphite">{c.next}</p>
    </>
  );

  const wrong = (
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

  const wallet = accepted ? (
    <div className="mt-6 flex items-center justify-between gap-3 rounded-md border border-rule bg-sheet px-3.5 py-3 text-[13px]">
      <span>
        <span className="label block">{c.payout}</span>
        <span className="mono">0x7d3a…91c2</span>
      </span>
      <button onClick={() => setDialog("payout")} className="text-[12.5px] font-semibold underline decoration-rule underline-offset-2">
        {c.change}
      </button>
    </div>
  ) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-paper" lang={zh ? "zh-CN" : "en"} translate="no">
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 md:px-8">
          <Wordmark className="text-[14px]" />
          <div className="flex items-center gap-2">
            <DemoMark />
            <div role="group" aria-label="Language" className="flex rounded-full border border-rule p-0.5 text-[12px]">
              {(["en", "zh"] as const).map((l) => (
                <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={`rounded-full px-2.5 py-0.5 ${lang === l ? "bg-ink text-paper" : "text-graphite"}`}>
                  {l === "en" ? "EN" : "中文"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-8 md:px-8 md:pt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
        <div className="min-w-0">
          <p className="text-[21px] leading-tight font-semibold tracking-tight md:text-[32px]">{c.wants(d)}</p>
          <p className="mt-1 text-[13px] text-graphite md:text-[14px]">{c.via(d)}</p>

          {canAccept ? (
            <div className="mt-4 rounded-md border border-held/30 bg-held-wash p-3.5 lg:hidden">
              <p className="text-[14.5px] font-semibold text-held">{c.promiseTitle(d)}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed">{c.promise(d)}</p>
            </div>
          ) : (
            <div className="lg:hidden">{banner}</div>
          )}

          <div className="mt-5 md:mt-8">
            <LiveWaybill info={d} ts={d.tranches} lang={lang} bilingual compact showLockStamp={false} proposed={!funded} actions={actions} />
          </div>

          <div className="lg:hidden">
            {canAccept ? <p className="mt-6 text-[13px]">{c.fees(d)}</p> : null}
            {wallet}
            {wrong}
          </div>

          <section className="mt-10">
            <h2 className="label mb-3">{zh ? "记录 · Timeline" : "Timeline"}</h2>
            <Timeline events={d.timeline} />
          </section>
          {zh ? <p className="mono mt-6 text-[10.5px] text-graphite">中文文案为草稿，需母语贸易人士审校 · draft, needs native review</p> : null}
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20">
            {canAccept ? (
              <>
                <div className="rounded-md border border-held/30 bg-held-wash p-4">
                  <p className="text-[15px] font-semibold text-held">{c.promiseTitle(d)}</p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed">{c.promise(d)}</p>
                  <p className="mt-3 border-t border-held/20 pt-3 text-[13px]">{c.fees(d)}</p>
                </div>
                <div className="mt-5">{cta}</div>
              </>
            ) : (
              banner
            )}
            {wallet}
            {wrong}
          </div>
        </aside>
      </div>

      {canAccept ? <footer className="sticky bottom-0 border-t border-rule bg-paper/95 px-4 pt-3 pb-4 backdrop-blur lg:hidden">{cta}</footer> : null}

      {dialog === "accept" ? <AcceptDialog d={d} lang={lang} onClose={() => setDialog(null)} /> : null}

      {dialog === "payout" ? (
        <Modal open onClose={() => setDialog(null)} label="Change payout wallet">
          <p className="label">{c.payout}</p>
          <h2 className="mt-1 text-[19px] font-semibold">{zh ? "更改收款钱包" : "Change where you get paid"}</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed">
            {zh
              ? "为了安全，新地址在 48 小时后才生效，买方会看到这次更改。在此之前，付款仍会发到当前钱包。"
              : "For safety, a new address only takes effect after 48 hours, and the buyer sees the change. Until then, payments still go to your current wallet."}
          </p>
          <input defaultValue="0x2b91…7e04" className="mono mt-3 mb-4 w-full rounded-md border border-rule bg-paper px-3 py-2.5 text-[14px]" aria-label="New payout address" />
          <TxFlow
            confirmLabel={zh ? "提交更改" : "Propose new wallet"}
            steps={[{ label: "Propose", wallet: { action: `proposePayout(${d.onchainId}, newAddress)`, to: ESCROW, note: "Applies after 48 h unless rejected" } }]}
            onCancel={() => setDialog(null)}
            onDone={() => {
              act.proposePayout(d.id, "0x2b91…7e04");
              setDialog(null);
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function AcceptDialog({ d, lang, onClose }: { d: DealRecord; lang: Lang; onClose: () => void }) {
  const zh = lang === "zh";
  const [mode, setMode] = useState<"choose" | "create" | "paste">("choose");
  const [addr] = useState(() => {
    const h = newHash();
    return `${h.slice(0, 6)}…${h.slice(-4)}`;
  });
  const [pasted, setPasted] = useState("");
  const chosen = mode === "create" ? addr : pasted.trim();
  const valid = mode === "create" || /^0x[0-9a-fA-F]{40}$/.test(pasted.trim());

  return (
    <Modal open onClose={onClose} label="Accept terms">
      <p className="label">{zh ? "第 2 步 · Step 2" : "Step 2 of 2"}</p>
      <h2 className="mt-1 text-[19px] font-semibold">{zh ? "我们应把款项付到哪里？" : "Where should we pay you?"}</h2>
      {mode === "choose" ? (
        <div className="mt-4 space-y-2">
          <button onClick={() => setMode("create")} className="w-full rounded-md bg-ink px-4 py-3 text-left text-[14px] font-semibold text-paper">
            {zh ? "为我创建钱包（推荐）" : "Create a wallet for me (recommended)"}
            <span className="block text-[12px] font-normal opacity-80">{zh ? "用邮箱登录，可随时导出密钥" : "Sign in with email. Export the key any time."}</span>
          </button>
          <button onClick={() => setMode("paste")} className="w-full rounded-md border border-rule px-4 py-3 text-left text-[14px] font-semibold">
            {zh ? "我已有地址" : "I already have an address"}
            <span className="block text-[12px] font-normal text-graphite">{zh ? "必须能接收 Arc 网络上的 USDC" : "It must receive USDC on Arc"}</span>
          </button>
        </div>
      ) : (
        <div className="mt-4">
          {mode === "create" ? (
            <div className="rounded-md border border-rule bg-paper p-3">
              <p className="label">{zh ? "新收款钱包" : "New payout wallet"}</p>
              <p className="mono mt-1 text-[15px]">{addr}</p>
              <p className="mt-1 text-[12px] text-graphite">{zh ? "已为 chen.hao@demo 创建 · 可随时导出密钥" : "Created for chen.hao@demo · export the key any time"}</p>
            </div>
          ) : (
            <>
              <label className="label block" htmlFor="addr">
                {zh ? "收款地址" : "Payout address"}
              </label>
              <input
                id="addr"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="0x…"
                className="mono mt-1 w-full rounded-md border border-rule bg-paper px-3 py-2.5 text-[13px] outline-none focus:border-held"
              />
              {pasted && !valid ? <p className="mt-1 text-[12px] text-hold">{zh ? "地址格式不正确" : "That isn't a valid address (0x followed by 40 characters)."}</p> : null}
            </>
          )}
          <p className="mt-3 mb-4 text-[12.5px] text-graphite">
            {zh ? `接受即同意 ${d.tranches.length} 期付款条款、确认方和仲裁方。` : `Accepting agrees to the ${d.tranches.length} parts, who confirms each, and the arbiter.`}
          </p>
          {valid ? (
            <TxFlow
              confirmLabel={zh ? "接受条款" : "Accept terms"}
              steps={[{ label: "Accept", wallet: { action: `acceptSupplier(${d.onchainId}, payout)`, to: ESCROW, note: `Payout to ${mode === "create" ? addr : chosen.slice(0, 6) + "…" + chosen.slice(-4)}` } }]}
              onCancel={onClose}
              onDone={() => {
                act.supplierAccept(d.id, mode === "create" ? addr : `${chosen.slice(0, 6)}…${chosen.slice(-4)}`);
                onClose();
              }}
            />
          ) : (
            <button onClick={() => setMode("choose")} className="text-[13px] text-graphite underline">
              {zh ? "返回" : "Back"}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
