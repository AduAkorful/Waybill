"use client";

import type gsap from "gsap";
import { Acceptances } from "@/components/Acceptances";
import { DeskStage, PhoneSheet, PhoneStage } from "@/components/animatic/Stages";
import { PlainSummary, ShareCard, SplitBar, standardParts, Templates } from "@/components/Builder";
import { DemoMark, Wordmark } from "@/components/Chrome";
import { ArbiterDecision, DisputeRoom, disputeEntries } from "@/components/Dispute";
import { EvidenceList, EvidencePanel } from "@/components/Evidence";
import { LandingHero } from "@/components/LandingHero";
import { Ledger } from "@/components/Ledger";
import { arrive, D, draw, E, resolveText, rise, rollOdo, S, strike, swap, tear, writeIn } from "@/components/motion";
import { LineItems, Sheet, Tick, TxStatus } from "@/components/Sheet";
import { Statement } from "@/components/Statement";
import { DisputedAction, OverdueAction, PayingAction, RefundAction, ReviewAction } from "@/components/StubActions";
import { Waybill } from "@/components/Waybill";
import { deal, inspector, supplier, tranches, type Tranche } from "@/demo/deal";
import { usdc } from "@/demo/format";
import { straightTop, tornTop } from "@/demo/tear";
import { SupplierLink } from "../frames/supplier/SupplierLink";

export interface Scene {
  render: () => React.ReactNode;
  build: (tl: gsap.core.Timeline, q: (sel: string) => Element[], at: string) => void;
}

type Q = (sel: string) => Element[];

// ——— Deal states used across scenes (DEMO DATA) ———

const T = tranches;
const fresh = (t: Tranche): Tranche => ({ ...t, state: "waiting", releasedAt: undefined, reviewEnds: undefined, proof: undefined });
const with_ = (base: Tranche[], over: Record<number, Partial<Tranche>>) => base.map((t) => (over[t.index] ? { ...t, ...over[t.index] } : t));

const proposedTs = T.map(fresh);
const fundedTs = with_(proposedTs, { 1: { state: "claimable" } });
const paying2Ts = with_(T, { 2: { state: "claimable" } });
const released2Ts = with_(T, { 2: { state: "released", releasedAt: "19 Oct 2026, 10:12 GMT", proof: "0xc81f5a2e9d0b47" } });
const disputedTs = with_(released2Ts, { 3: { state: "disputed" } });
const refunded3Ts = with_(released2Ts, { 3: { state: "refunded" } });
const overdueTs = with_(released2Ts, { 3: { state: "overdue" } });
const refundableTs = with_(released2Ts, { 3: { state: "refundable" } });

const tearOf = (i: number) => [straightTop(`${deal.id}-${i}`), tornTop(`${deal.id}-${i}`)] as const;
const first = (q: Q, sel: string) => q(sel)[0];

// ——— Shared scene bodies ———

function BuyerDesk({
  ts,
  actions = {},
  lock = false,
  refunded = 0,
  held,
  head = "Power banks from Baiyun Brightpower",
  top,
}: {
  ts: Tranche[];
  actions?: Record<number, React.ReactNode>;
  lock?: boolean;
  refunded?: number;
  held?: number;
  head?: string;
  top?: React.ReactNode;
}) {
  return (
    <>
      <p className="label">
        {deal.id} · {ts.every((t) => t.state === "waiting") && !lock ? "proposed" : `funded ${deal.fundedAt.split(",")[0]}`}
      </p>
      <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-tight">{head}</h1>
      <div className="mt-4">{top ?? <Ledger ts={ts} refunded={refunded} held={held} />}</div>
      <div className="mt-5 origin-top scale-[0.92]">
        <Waybill detail="summary" compact showLockStamp={lock} ts={ts} actions={actions} proposed={!lock && ts.every((t) => t.state === "waiting")} />
      </div>
    </>
  );
}

const allAccepted = [
  { role: "Supplier", who: supplier.org, done: true },
  { role: "Inspector", who: `${inspector.name}, ${inspector.org}`, done: true },
  { role: "Forwarder", who: "Kwabena Asante, Harbourline", done: true },
  { role: "Arbiter", who: "Waybill Arbitration Desk", done: true },
];

function FundBar() {
  return (
    <div className="space-y-3">
      <Acceptances rows={allAccepted} />
      <button data-fund className="rounded-md bg-held px-5 py-2.5 text-[14px] font-semibold text-sheet">
        Fund {usdc(deal.funded)} USDC
      </button>
    </div>
  );
}

function FundSheet({ view }: { view?: "awaiting" | "submitted" }) {
  return (
    <Sheet kicker={`${deal.id} · lock the money`} title="Fund this deal">
      <LineItems
        items={[
          { label: "Deal total", amount: deal.total, note: "Paid to the supplier in 3 parts" },
          { label: "Waybill fee, 0.75%", amount: deal.feeTotal, note: "Returned with any part that's refunded" },
          { label: "Arbiter fee", amount: deal.arbiterFee, note: "Returned if no decision is ever needed in time" },
        ]}
        total={deal.funded}
        totalLabel="You lock"
      />
      <p className="mt-3 text-[12.5px] text-graphite">On Arc. Once sent, Waybill can't reverse it; only the deal's rules can move this money.</p>
      <div className="mt-4">
        {view ? (
          <TxStatus view={view} hash="0x4a7c22e9…f1b091" />
        ) : (
          <button className="w-full rounded-md bg-held py-3 text-[14.5px] font-semibold text-sheet">Approve and fund {usdc(deal.funded)}</button>
        )}
      </div>
    </Sheet>
  );
}

function AttestorPhone({ done, progress, ready, statement }: { done: number; progress?: number; ready: boolean; statement?: "open" | "signed" }) {
  return (
    <div className="bg-paper">
      <header className="flex items-center justify-between border-b border-rule px-4 py-2.5">
        <Wordmark className="text-[14px]" />
        <DemoMark />
      </header>
      <div className="px-4 pt-4 pb-40">
        <p className="label">{deal.id} · stub 2 of 3</p>
        <h1 className="mt-1 text-[19px] leading-tight font-semibold">Pre-shipment inspection passed</h1>
        {statement ? (
          <div className="mt-4">
            <Statement signed={statement === "signed"} />
            {statement === "signed" ? (
              <p data-next className="mt-3 rounded-md border border-rule bg-sheet p-3 text-[13px]">
                Ama has 12 h to review. Then 6,000.00 goes to the supplier and you earn 18.00.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4">
            <p className="label mb-2">
              Evidence · {done} of 4
            </p>
            <EvidenceList done={done} progress={progress} />
          </div>
        )}
      </div>
    </div>
  );
}

function AttestorFooter({ ready }: { ready: boolean }) {
  return (
    <div className="border-t border-rule bg-paper/95 px-4 pt-3 pb-5">
      <p data-status className={`mb-2 text-[12.5px] ${ready ? "text-released" : "text-held"}`}>
        {ready ? "All 4 files uploaded. Ready to sign." : "Waiting for 1 upload to finish before you can sign"}
      </p>
      <button data-sign className={`w-full rounded-md py-3.5 text-[15px] font-semibold text-paper ${ready ? "bg-ink" : "bg-ink/25"}`}>
        Sign statement
      </button>
    </div>
  );
}

function AcceptCta({ zh = true }: { zh?: boolean }) {
  return (
    <div className="border-t border-rule bg-paper/95 px-4 pt-3 pb-5">
      <button className="w-full rounded-md bg-ink py-3.5 text-[15px] font-semibold text-paper">{zh ? "接受条款" : "Accept terms"}</button>
      <p className="mt-2 text-center text-[11.5px] text-graphite">{zh ? "下一步：设置收款方式，约 2 分钟" : "Next: choose where you get paid. About 2 minutes."}</p>
    </div>
  );
}

function PayoutSheet({ created }: { created: boolean }) {
  return (
    <PhoneSheet>
      <p className="label">第 2 步 · Step 2</p>
      <h2 className="mt-1 text-[18px] font-semibold" lang="zh-CN">
        我们应把款项付到哪里？
      </h2>
      <p className="text-[12.5px] text-graphite">Where should we pay you?</p>
      {created ? (
        <div className="mt-4 rounded-md border border-rule bg-paper p-3">
          <p className="flex items-center justify-between">
            <span className="label">新收款钱包 · New payout wallet</span>
            <span className="text-released">
              <Tick />
            </span>
          </p>
          <p data-addr className="mono mt-1.5 text-[14px]">
            0x7d3a…e5b0…91c2
          </p>
          <p className="mt-1 text-[11.5px] text-graphite">您可随时导出密钥 · Export the key any time</p>
          <button className="mt-3 w-full rounded-md bg-ink py-3 text-[14.5px] font-semibold text-paper">确认 · Confirm</button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <button className="w-full rounded-md bg-ink py-3 text-[14px] font-semibold text-paper">为我创建钱包（推荐）· Create a wallet</button>
          <button className="w-full rounded-md border border-rule py-3 text-[14px] font-semibold">粘贴已有地址 · Paste an address</button>
        </div>
      )}
    </PhoneSheet>
  );
}

// ——— Scenes, one per storyboard beat ———

export const scenes: Record<string, Scene[]> = {
  landing: [
    {
      render: () => (
        <div className="h-full overflow-hidden bg-paper">
          <LandingHero desk="empty" />
        </div>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-hero-line]"), { opacity: 0, y: 12, filter: "blur(10px)", duration: D.move, ease: E("arrive"), stagger: S.row }, at);
        writeIn(tl, q("[data-hero-mark]"), `${at}+=0.55`);
        arrive(tl, q("[data-hero-sub], [data-hero-cta], [data-hero-proof]"), `${at}+=0.3`);
      },
    },
    {
      render: () => (
        <div className="h-full overflow-hidden bg-paper">
          <LandingHero desk="waiting" />
        </div>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-hero-copy]"), { opacity: 0, duration: D.base, ease: E("settle") }, at);
        tl.from(q("[data-hero-doc]"), { opacity: 0, y: 40, duration: D.deliberate, ease: E("arrive") }, `${at}+=0.1`);
        arrive(tl, q("[data-hero-doc] [data-box]"), `${at}+=0.45`, { stagger: S.field, y: 6 });
      },
    },
    {
      render: () => (
        <div className="h-full overflow-hidden bg-paper">
          <LandingHero desk="live" />
        </div>
      ),
      build: (tl, q, at) => {
        strike(tl, q("[data-hero-stamp] [data-stamp]"), at);
        const [s, t] = tearOf(1);
        tear(tl, first(q, '[data-hero-doc] [data-stub-card="1"]'), `${at}+=0.3`, s, t);
        strike(tl, q('[data-hero-doc] [data-stub-card="1"] [data-stamp]'), `${at}+=1.1`);
        tl.from(q('[data-hero-doc] [data-stub-card="2"]'), { boxShadow: "0 0 0 0px var(--held)", duration: D.base, ease: E("settle") }, `${at}+=1.2`);
      },
    },
  ],

  "supplier-accept": [
    {
      render: () => (
        <PhoneStage overlay={<AcceptCta zh={false} />}>
          <SupplierLink initial="en" bare />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        arrive(tl, q("[data-wants], [data-promise]"), at);
        arrive(tl, q("[data-box]"), `${at}+=0.25`, { y: 8 });
        arrive(tl, q("[data-stub-card]"), `${at}+=0.9`);
      },
    },
    {
      render: () => (
        <PhoneStage overlay={<AcceptCta />}>
          <SupplierLink initial="zh" bare />
        </PhoneStage>
      ),
      build: (tl, q, at) => swap(tl, q("[data-wants], [data-promise], [data-box], [data-stub-card] h3"), at),
    },
    {
      render: () => (
        <PhoneStage offset={880} overlay={<AcceptCta />}>
          <SupplierLink initial="zh" bare />
        </PhoneStage>
      ),
      build: () => {},
    },
    {
      render: () => (
        <PhoneStage offset={880} overlay={<PayoutSheet created={false} />}>
          <SupplierLink initial="zh" bare />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-scrim]"), { opacity: 0, duration: D.base, ease: E("settle") }, at);
        rise(tl, q("[data-sheet]"), at);
      },
    },
    {
      render: () => (
        <PhoneStage offset={880} overlay={<PayoutSheet created />}>
          <SupplierLink initial="zh" bare />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        resolveText(tl, first(q, "[data-addr]"), at, 0.6);
        draw(tl, q("[data-sheet] [data-tick]"), `${at}+=0.55`, D.tick * 2);
      },
    },
    {
      render: () => (
        <PhoneStage>
          <SupplierLink initial="zh" bare stage="accepted" />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        strike(tl, q("[data-accept-stamp] [data-stamp]"), `${at}+=0.1`);
        arrive(tl, q("[data-banner]"), `${at}+=0.3`);
      },
    },
  ],

  fund: [
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={proposedTs} top={<FundBar />} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        draw(tl, q('[data-accept="Arbiter"] [data-tick]'), at, D.tick * 2);
        swap(tl, q("[data-accept-note]"), `${at}+=0.2`);
        tl.from(q("[data-fund]"), { opacity: 0.35, duration: D.quick, ease: E("settle") }, `${at}+=0.24`);
      },
    },
    {
      render: () => (
        <DeskStage modal={<FundSheet />}>
          <BuyerDesk ts={proposedTs} top={<FundBar />} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-scrim]"), { opacity: 0, duration: D.base }, at);
        tl.from(q("[data-modal]"), { opacity: 0, y: 30, duration: D.base, ease: E("arrive") }, at);
        arrive(tl, q("[data-line]"), `${at}+=0.2`, { y: 6 });
        tl.from(q("[data-total-rule]"), { scaleX: 0, duration: D.base, ease: E("settle") }, `${at}+=0.5`);
        arrive(tl, q("[data-total]"), `${at}+=0.65`, { y: 4 });
      },
    },
    {
      render: () => (
        <DeskStage modal={<FundSheet view="awaiting" />}>
          <BuyerDesk ts={proposedTs} top={<FundBar />} />
        </DeskStage>
      ),
      build: () => {},
    },
    {
      render: () => (
        <DeskStage modal={<FundSheet view="submitted" />}>
          <BuyerDesk ts={proposedTs} top={<FundBar />} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        swap(tl, q("[data-tx-head]"), at);
        resolveText(tl, first(q, "[data-hash]"), `${at}+=0.1`, 0.6);
      },
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={fundedTs} lock actions={{ 1: <PayingAction hash="0x91e0…a2f6" /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        strike(tl, q("[data-lock-stamp] [data-stamp]"), at);
        rollOdo(tl, first(q, "[data-held] [data-odo]"), 0, `${at}+=0.15`);
        tl.from(q("[data-ledger-seg]"), { scaleX: 0, transformOrigin: "left center", duration: D.base, ease: E("settle"), stagger: S.row }, `${at}+=0.15`);
        arrive(tl, q('[data-stub-card="1"] [data-action]'), `${at}+=0.5`, { y: 6 });
      },
    },
    {
      render: () => (
        <PhoneStage>
          <SupplierLink initial="zh" bare stage="funded" />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        arrive(tl, q("[data-banner]"), at);
        const [s, t] = tearOf(1);
        tear(tl, first(q, '[data-stub-card="1"]'), `${at}+=0.45`, s, t);
        strike(tl, q('[data-stub-card="1"] [data-stamp]'), `${at}+=1.25`);
      },
    },
  ],

  attest: [
    {
      render: () => (
        <PhoneStage overlay={<AttestorFooter ready={false} />}>
          <AttestorPhone done={3} progress={64} ready={false} />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        draw(tl, q('[data-file="2"] [data-tick]'), at, D.tick * 2);
        tl.from(q("[data-progress]"), { width: "18%", duration: D.base, ease: "none" }, at);
      },
    },
    {
      render: () => (
        <PhoneStage overlay={<AttestorFooter ready />}>
          <AttestorPhone done={4} ready />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        draw(tl, q('[data-file="3"] [data-tick]'), at, D.tick * 2);
        swap(tl, q("[data-status]"), `${at}+=0.15`);
        tl.from(q("[data-sign]"), { opacity: 0.35, duration: D.quick, ease: E("settle") }, `${at}+=0.2`);
      },
    },
    {
      render: () => (
        <PhoneStage overlay={<AttestorFooter ready />}>
          <AttestorPhone done={4} ready statement="open" />
        </PhoneStage>
      ),
      build: (tl, q, at) => writeIn(tl, q("[data-blank]"), at, S.field),
    },
    {
      render: () => (
        <PhoneStage
          overlay={
            <PhoneSheet>
              <TxStatus view="awaiting" />
              <p className="mt-3 text-[12.5px] leading-relaxed text-graphite">
                Signing is not a payment. This signature is bound to {deal.id}, stub 2, on Arc, and can be used once.
              </p>
            </PhoneSheet>
          }
        >
          <AttestorPhone done={4} ready statement="open" />
        </PhoneStage>
      ),
      build: () => {},
    },
    {
      render: () => (
        <PhoneStage>
          <AttestorPhone done={4} ready statement="signed" />
        </PhoneStage>
      ),
      build: (tl, q, at) => {
        draw(tl, q("[data-sig]"), at, D.deliberate);
        strike(tl, q("[data-stamp]"), `${at}+=0.6`);
        arrive(tl, q("[data-next]"), `${at}+=0.8`);
      },
    },
  ],

  release: [
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={T} actions={{ 2: <ReviewAction /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q('[data-stub-card="2"]'), { boxShadow: "0 0 0 0px var(--held)", duration: D.base, ease: E("settle") }, at);
        arrive(tl, q('[data-stub-card="2"] [data-action]'), `${at}+=0.1`, { y: 8 });
        writeIn(tl, q("[data-mark]"), `${at}+=0.4`);
      },
    },
    {
      render: () => (
        <DeskStage panel={<EvidencePanel />}>
          <BuyerDesk ts={T} actions={{ 2: <ReviewAction /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-panel-wrap]"), { xPercent: 100, duration: D.base, ease: E("arrive") }, at);
        arrive(tl, q("[data-photo], [data-file]"), `${at}+=0.2`, { y: 6 });
      },
    },
    {
      render: () => (
        <DeskStage
          modal={
            <Sheet kicker="Stub 2 · inspection" title={`Release ${usdc(6_000_00)} USDC to Baiyun Brightpower now?`}>
              <p className="text-[13.5px] leading-relaxed">
                This ends your review early. The money goes to their payout address and can't be returned by Waybill. Stub 3 stays locked.
              </p>
              <button className="mt-4 w-full rounded-md bg-held py-3 text-[14.5px] font-semibold text-sheet">Approve and release</button>
              <button className="mt-1 w-full py-2 text-[13px] text-graphite">Keep reviewing</button>
            </Sheet>
          }
        >
          <BuyerDesk ts={T} actions={{ 2: <ReviewAction /> }} />
        </DeskStage>
      ),
      build: () => {},
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={paying2Ts} actions={{ 2: <PayingAction /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        swap(tl, q('[data-stub-card="2"] [data-action]'), at);
      },
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={released2Ts} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        const [s, t] = tearOf(2);
        tear(tl, first(q, '[data-stub-card="2"]'), at, s, t);
        strike(tl, q('[data-stub-card="2"] [data-stamp]'), `${at}+=0.8`);
        rollOdo(tl, first(q, "[data-released] [data-odo]"), 4_000_00, `${at}+=0.75`);
        rollOdo(tl, first(q, "[data-held] [data-odo]"), 16_220_00, `${at}+=0.75`);
        tl.from(q('[data-ledger-seg="2"]'), { opacity: 0.35, duration: D.base, ease: E("settle") }, `${at}+=0.8`);
      },
    },
    {
      render: () => (
        <PhoneStage>
          <SupplierLink initial="zh" bare stage="paid2" />
        </PhoneStage>
      ),
      build: (tl, q, at) => arrive(tl, q("[data-banner]"), at),
    },
  ],

  dispute: [
    {
      render: () => (
        <DeskStage
          modal={
            <Sheet kicker="Stub 3 · arrival" title="Dispute arrival">
              <label className="label block">What's wrong</label>
              <p className="mt-1 rounded-md border border-rule bg-paper p-2.5 text-[13px]">{disputeEntries[0]!.text}</p>
              <p className="mt-2 flex gap-1.5">
                <span className="mono rounded border border-rule px-1.5 py-0.5 text-[11px] text-graphite">failed-units.jpg ×18</span>
                <span className="mono rounded border border-rule px-1.5 py-0.5 text-[11px] text-graphite">charge-test.mp4</span>
              </p>
              <p data-freeze className="mt-3 rounded-md bg-hold-wash p-2.5 text-[13px] text-hold">
                Only stub 3 ({usdc(10_000_00)}) freezes. Stubs 1 and 2 stay paid. The supplier has 72 h to respond.
              </p>
              <button className="mt-4 w-full rounded-md bg-hold py-3 text-[14.5px] font-semibold text-sheet">Raise dispute</button>
            </Sheet>
          }
        >
          <BuyerDesk ts={with_(released2Ts, { 3: { state: "in_review" } })} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-scrim]"), { opacity: 0, duration: D.base }, at);
        tl.from(q("[data-modal]"), { opacity: 0, y: 30, duration: D.base, ease: E("arrive") }, at);
        arrive(tl, q("[data-freeze]"), `${at}+=0.35`);
      },
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={disputedTs} actions={{ 3: <DisputedAction /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q('[data-stub-card="3"]'), { boxShadow: "0 0 0 0px var(--hold)", duration: D.base, ease: E("settle") }, at);
        strike(tl, q('[data-stub-card="3"] [data-stamp]'), `${at}+=0.25`);
        arrive(tl, q('[data-stub-card="3"] [data-action]'), `${at}+=0.35`, { y: 6 });
      },
    },
    {
      render: () => (
        <PhoneStage>
          <div className="bg-paper">
            <header className="flex items-center justify-between border-b border-rule px-4 py-2.5">
              <Wordmark className="text-[14px]" />
              <DemoMark />
            </header>
            <div className="px-4 pt-4">
              <p className="label text-hold">{deal.id} · stub 3 disputed</p>
              <h1 className="mt-1 text-[19px] font-semibold">Dispute room</h1>
              <p className="mt-1 text-[12.5px] text-graphite">Arbiter decides by 22 Dec. Only {usdc(10_000_00)} is frozen.</p>
              <div className="mt-4">
                <DisputeRoom />
              </div>
            </div>
          </div>
        </PhoneStage>
      ),
      build: (tl, q, at) => arrive(tl, q("[data-entry]").slice(-1), at),
    },
    {
      render: () => (
        <DeskStage who="Waybill Arbitration Desk" initials="WA">
          <p className="label text-hold">{deal.id} · stub 3 · decide by 22 Dec</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Arrival dispute</h1>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_420px] gap-6">
            <div>
              <p className="label mb-2">Evidence, in order</p>
              <DisputeRoom />
              <p className="mt-3 rounded-md border border-rule bg-sheet p-3 text-[12.5px] text-graphite">
                Inspector's statement (18 Oct): sample matched specification. Covers sampled units only.
              </p>
            </div>
            <ArbiterDecision amount={10_000_00} fee={75_00} />
          </div>
        </DeskStage>
      ),
      build: () => {},
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={refunded3Ts} refunded={10_075_00} held={0} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        const [s, t] = tearOf(3);
        tear(tl, first(q, '[data-stub-card="3"]'), at, s, t, -1);
        strike(tl, q('[data-stub-card="3"] [data-stamp]'), `${at}+=0.8`);
        rollOdo(tl, first(q, "[data-refunded] [data-odo]"), 0, `${at}+=0.75`);
        rollOdo(tl, first(q, "[data-held] [data-odo]"), 10_175_00, `${at}+=0.75`);
      },
    },
  ],

  refund: [
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={overdueTs} actions={{ 3: <OverdueAction /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q('[data-stub-card="3"]'), { outlineColor: "transparent", duration: D.base, ease: E("settle") }, at);
        swap(tl, q('[data-stub-card="3"] header'), at);
        arrive(tl, q('[data-stub-card="3"] [data-action]'), `${at}+=0.1`, { y: 6 });
      },
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={overdueTs} actions={{ 3: <OverdueAction left="51 h 12 m" /> }} />
        </DeskStage>
      ),
      build: () => {},
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={refundableTs} actions={{ 3: <RefundAction amount={10_000_00} fee={75_00} /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        swap(tl, q('[data-stub-card="3"] header'), at);
        arrive(tl, q('[data-stub-card="3"] [data-action]'), `${at}+=0.1`, { y: 6 });
      },
    },
    {
      render: () => (
        <DeskStage
          modal={
            <Sheet kicker="Stub 3 · arrival not confirmed" title="Take this part back">
              <LineItems
                items={[
                  { label: "Stub 3", amount: 10_000_00 },
                  { label: "Its 0.75% fee", amount: 75_00 },
                ]}
                total={10_075_00}
                totalLabel="Back to you"
              />
              <p className="mt-3 text-[12.5px] text-graphite">To your refund address 0x46…D0F1. Stubs 1 and 2 stay paid.</p>
              <button className="mt-4 w-full rounded-md bg-refunded py-3 text-[14.5px] font-semibold text-sheet">Refund to me</button>
            </Sheet>
          }
        >
          <BuyerDesk ts={refundableTs} actions={{ 3: <RefundAction amount={10_000_00} fee={75_00} /> }} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-scrim]"), { opacity: 0, duration: D.base }, at);
        tl.from(q("[data-modal]"), { opacity: 0, y: 30, duration: D.base, ease: E("arrive") }, at);
        arrive(tl, q("[data-line]"), `${at}+=0.2`, { y: 6 });
      },
    },
    {
      render: () => (
        <DeskStage>
          <BuyerDesk ts={refunded3Ts} refunded={10_075_00} />
        </DeskStage>
      ),
      build: (tl, q, at) => {
        const [s, t] = tearOf(3);
        tear(tl, first(q, '[data-stub-card="3"]'), at, s, t, -1);
        strike(tl, q('[data-stub-card="3"] [data-stamp]'), `${at}+=0.8`);
        rollOdo(tl, first(q, "[data-refunded] [data-odo]"), 0, `${at}+=0.75`);
        rollOdo(tl, first(q, "[data-held] [data-odo]"), 10_175_00, `${at}+=0.75`);
      },
    },
  ],

  build: [
    {
      render: () => (
        <DeskStage>
          <p className="label">New deal · step 2 of 4</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">How should the money be released?</h1>
          <div className="mt-5">
            <Templates chosen={1} />
          </div>
          <div className="mt-8 max-w-3xl">
            <SplitBar parts={standardParts} total={deal.total} />
          </div>
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q("[data-seg]"), { scaleX: 0, transformOrigin: "left center", duration: D.arrive, ease: E("arrive"), stagger: S.row }, at);
      },
    },
    {
      render: () => (
        <DeskStage>
          <p className="label">New deal · step 2 of 4</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">How should the money be released?</h1>
          <div className="mt-5">
            <Templates chosen={1} />
          </div>
          <div className="mt-8 max-w-3xl">
            <SplitBar parts={standardParts.map((p) => (p.name === "Inspection" ? { ...p, bps: 3500 } : p))} total={deal.total} />
          </div>
          <button className="mt-6 cursor-not-allowed rounded-md bg-ink/25 px-5 py-2.5 text-[14px] font-semibold text-paper">Continue</button>
        </DeskStage>
      ),
      build: (tl, q, at) => {
        tl.from(q('[data-seg="1"]'), { flexGrow: 3000, duration: D.quick, ease: E("settle") }, at);
      },
    },
    {
      render: () => (
        <DeskStage>
          <p className="label">New deal · step 4 of 4</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Read it back before you share</h1>
          <div className="mt-6 max-w-3xl rounded-md border border-rule bg-sheet p-6">
            <PlainSummary total={deal.total} fee={deal.feeTotal} arbiterFee={deal.arbiterFee} />
          </div>
        </DeskStage>
      ),
      build: (tl, q, at) => arrive(tl, q("[data-summary]"), at, { y: 6 }),
    },
    {
      render: () => (
        <DeskStage>
          <p className="label">New deal · created</p>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Send it to your supplier</h1>
          <div className="mt-6 max-w-xl">
            <ShareCard url="waybill.demo/d/WB-0427" />
          </div>
        </DeskStage>
      ),
      build: (tl, q, at) => arrive(tl, q("[data-share]"), at),
    },
  ],
};
