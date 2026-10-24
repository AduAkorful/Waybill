// DEMO DATA for the clickable prototype. Invented parties and figures; amounts are USDC cents.
// Every fee is 0.75% of its tranche, buyer-prepaid; every deal's funded amount = total + fees + arbiter fee.

import {
  arbiter,
  buyer,
  deal as d427,
  forwarder,
  inspector,
  supplier as s427,
  timeline as t427,
  tranches as tr427,
  type DealState,
  type Party,
  type TimelineEvent,
  type Tranche,
} from "./deal";

export interface Acceptance {
  role: "Supplier" | "Inspector" | "Forwarder" | "Arbiter";
  who: string;
  done: boolean;
}

export interface DisputeEntry {
  who: string;
  role: "Buyer" | "Supplier" | "Arbiter";
  at: string;
  text: string;
  files: string[];
  /** Filing, response, or appended evidence */
  kind: "filing" | "response" | "evidence";
}

export interface DisputeRecord {
  stub: number;
  raisedBy: "Buyer" | "Supplier";
  raisedAt: string;
  /** The other party's response window; the arbiter can't decide while it's open */
  responseDue: string;
  responseClosed: boolean;
  decideBy: string;
  entries: DisputeEntry[];
  decision?: { outcome: "release" | "refund" | "split"; supplierBps?: number; reasoning: string; at: string };
  withdrawn?: boolean;
}

export interface DealRecord {
  id: string;
  onchainId: number;
  origin: { code: string; city: string };
  destination: { code: string; city: string };
  goods: string;
  goodsZh: string;
  units: number;
  cartons: number;
  template: string;
  templateVersion: string;
  total: number;
  feeBps: number;
  feeTotal: number;
  feePayer: string;
  arbiterFee: number;
  funded: number;
  termsHash: string;
  acceptanceDeadline: string;
  fundedAt?: string;
  fundTx?: string;
  state: DealState;
  buyer: Party;
  supplier: Party;
  arbiter: Party;
  acceptances: Acceptance[];
  tranches: Tranche[];
  timeline: TimelineEvent[];
  /** Shown on dashboard rows */
  summary: string;
  /** Labelled test/self-dealing deals are excluded from reputation and volume */
  test?: boolean;
  disputes?: Record<number, DisputeRecord>;
  /** Parties chose to show their names on the public record. Default: hidden. */
  publicNames?: boolean;
  /** The arbiter decided in time, so the prepaid fee went to them */
  arbiterFeePaid?: boolean;
}

const fee = (amount: number) => Math.round((amount * 75) / 10_000);

function t(
  index: number,
  bps: number,
  total: number,
  title: string,
  titleZh: string,
  short: string,
  confirmedBy: string,
  confirmedByZh: string,
  due: string,
  reviewHours: number,
  attested: boolean,
  over: Partial<Tranche> = {},
): Tranche {
  const amount = (total * bps) / 10_000;
  const f = fee(amount);
  const toAttestor = attested ? Math.round(f * 0.4) : 0;
  return {
    index,
    bps,
    amount,
    fee: f,
    feeProtocol: f - toAttestor,
    feeAttestor: toAttestor,
    title,
    titleZh,
    short,
    confirmedBy,
    confirmedByZh,
    due,
    reviewHours,
    state: "waiting",
    ...over,
  };
}

const ev = (day: string, at: string, actor: string, initials: string, text: string, tone: TimelineEvent["tone"] = "neutral", proof?: string): TimelineEvent => ({
  day,
  at,
  actor,
  initials,
  text,
  tone,
  proof,
});

const allAccepted = (sup: string): Acceptance[] => [
  { role: "Supplier", who: sup, done: true },
  { role: "Inspector", who: `${inspector.name}, ${inspector.org}`, done: true },
  { role: "Forwarder", who: `${forwarder.name}, ${forwarder.org}`, done: true },
  { role: "Arbiter", who: arbiter.name, done: true },
];

// ——— WB-0427 · in review (the deal used by every frame) ———
const wb0427: DealRecord = {
  ...d427,
  buyer,
  supplier: s427,
  arbiter,
  acceptances: allAccepted(s427.org),
  tranches: tr427,
  timeline: t427,
  summary: "Power banks · inspection signed, your review closes 18:40",
};

// ——— WB-0433 · everyone accepted, ready to fund ———
const ningbo: Party = { name: "Zhou Lei", org: "Ningbo Seaview Kitchenware Co.", orgZh: "宁波海景厨具有限公司", city: "Ningbo", initials: "NS" };
const total0433 = 500_000;
const wb0433: DealRecord = {
  id: "WB-0433",
  onchainId: 433,
  origin: { code: "NGB", city: "Ningbo" },
  destination: { code: "ACC", city: "Accra" },
  goods: "Stainless cookware sets",
  goodsZh: "不锈钢厨具套装",
  units: 600,
  cartons: 100,
  template: "30/70 with inspection",
  templateVersion: "v1",
  total: total0433,
  feeBps: 75,
  feeTotal: fee(total0433),
  feePayer: "Buyer",
  arbiterFee: 5_000,
  funded: total0433 + fee(total0433) + 5_000,
  termsHash: "0x2c7b05e1d93fa610",
  acceptanceDeadline: "24 Oct 2026",
  state: "accepted",
  buyer,
  supplier: ningbo,
  arbiter,
  acceptances: [
    { role: "Supplier", who: ningbo.org, done: true },
    { role: "Inspector", who: `${inspector.name}, ${inspector.org}`, done: true },
    { role: "Arbiter", who: arbiter.name, done: true },
  ],
  tranches: [
    t(1, 3000, total0433, "Supplier accepts", "供应商接受条款", "Acceptance", "Paid when they accept and you fund", "您接受条款且买方付款后支付", "24 Oct 2026", 0, false),
    t(2, 7000, total0433, "Pre-shipment inspection passed", "装运前检验通过", "Inspection", "Lin Mei, Pearlgate Inspection", "林梅，珍门检验", "20 Nov 2026", 24, true),
  ],
  timeline: [
    ev("16 Oct", "10:05", "Ama Owusu", "AO", "Created the deal and shared the link", "neutral", "0x51aa09c2e7d4b3"),
    ev("17 Oct", "08:44", "Ningbo Seaview", "NS", "Accepted the terms and set a payout wallet", "neutral", "0x9d02be44c1a7f5"),
    ev("17 Oct", "15:20", "Lin Mei", "LM", "Accepted the inspection statement", "neutral", "0x0f6c71d2b8e3a4"),
    ev("18 Oct", "09:02", "Waybill Arbitration Desk", "WA", "Accepted as arbiter, fee 50.00 USDC", "neutral", "0x7a3e90c5d1f2b8"),
  ],
  summary: "Cookware · everyone accepted, ready for you to fund",
};

// ——— WB-0419 · waiting for the supplier to accept ———
const corelite: Party = { name: "Huang Min", org: "Shenzhen Corelite Lighting Co.", orgZh: "深圳核光照明有限公司", city: "Shenzhen", initials: "SC" };
const total0419 = 840_000;
const wb0419: DealRecord = {
  id: "WB-0419",
  onchainId: 419,
  origin: { code: "SZX", city: "Shenzhen" },
  destination: { code: "ACC", city: "Accra" },
  goods: "LED panel lights, 600 × 600",
  goodsZh: "LED 平板灯 600 × 600",
  units: 1200,
  cartons: 200,
  template: "Standard 20/30/50",
  templateVersion: "v1",
  total: total0419,
  feeBps: 75,
  feeTotal: fee(total0419),
  feePayer: "Buyer",
  arbiterFee: 5_000,
  funded: total0419 + fee(total0419) + 5_000,
  termsHash: "0xe41d77a08c2b9f53",
  acceptanceDeadline: "21 Oct 2026",
  state: "proposed",
  buyer,
  supplier: corelite,
  arbiter,
  acceptances: [
    { role: "Supplier", who: corelite.org, done: false },
    { role: "Inspector", who: `${inspector.name}, ${inspector.org}`, done: true },
    { role: "Forwarder", who: `${forwarder.name}, ${forwarder.org}`, done: true },
    { role: "Arbiter", who: arbiter.name, done: true },
  ],
  tranches: [
    t(1, 2000, total0419, "Supplier accepts", "供应商接受条款", "Acceptance", "Paid when you accept and the buyer funds", "您接受条款且买方付款后支付", "21 Oct 2026", 0, false),
    t(2, 3000, total0419, "Pre-shipment inspection passed", "装运前检验通过", "Inspection", "Lin Mei, Pearlgate Inspection", "林梅，珍门检验", "25 Nov 2026", 12, true),
    t(3, 5000, total0419, "Arrival confirmed in Tema", "货物抵达特马港", "Arrival", "Kwabena Asante, Harbourline Clearing", "Kwabena Asante，Harbourline 清关", "20 Dec 2026", 48, true),
  ],
  timeline: [
    ev("14 Oct", "16:30", "Ama Owusu", "AO", "Created the deal and shared the link on WhatsApp", "neutral", "0x6e2f81a0c4d9b7"),
    ev("15 Oct", "11:10", "Lin Mei", "LM", "Accepted the inspection statement", "neutral", "0x14b9d3e7a0c26f"),
    ev("15 Oct", "13:48", "Kwabena Asante", "KA", "Accepted the arrival statement", "neutral", "0xc0a2f57e19d84b"),
    ev("15 Oct", "14:00", "Waybill Arbitration Desk", "WA", "Accepted as arbiter, fee 50.00 USDC", "neutral", "0x88d1e2b04a6f3c"),
    ev("21 Oct", "23:59", "Acceptance deadline", "◷", "If the supplier hasn't accepted, the deal cancels. Nothing was funded", "neutral"),
  ].map((e, i, a) => (i === a.length - 1 ? { ...e, upcoming: true } : e)),
  summary: "LED panels · waiting for the supplier to accept",
};

// ——— WB-0391 · arrival never confirmed; grace period over, refundable ———
const fairline: Party = { name: "Liang Wei", org: "Dongguan Fairline Textiles Co.", orgZh: "东莞丰线纺织有限公司", city: "Dongguan", initials: "DF" };
const total0391 = 1_200_000;
const wb0391: DealRecord = {
  id: "WB-0391",
  onchainId: 391,
  origin: { code: "CAN", city: "Dongguan" },
  destination: { code: "ACC", city: "Accra" },
  goods: "Cotton bed linen sets",
  goodsZh: "纯棉床上用品套装",
  units: 2000,
  cartons: 250,
  template: "Standard 20/30/50",
  templateVersion: "v1",
  total: total0391,
  feeBps: 75,
  feeTotal: fee(total0391),
  feePayer: "Buyer",
  arbiterFee: 10_000,
  funded: total0391 + fee(total0391) + 10_000,
  termsHash: "0x3f90a1c6e2b7d584",
  acceptanceDeadline: "2 Aug 2026",
  fundedAt: "3 Aug 2026, 09:15 GMT",
  fundTx: "0xa18c3e70d2f945",
  state: "funded",
  buyer,
  supplier: fairline,
  arbiter,
  acceptances: allAccepted(fairline.org),
  tranches: [
    t(1, 2000, total0391, "Supplier accepts", "供应商接受条款", "Acceptance", "Paid when you accept and the buyer funds", "您接受条款且买方付款后支付", "2 Aug 2026", 0, false, {
      state: "released",
      releasedAt: "3 Aug 2026, 09:17 GMT",
      proof: "0x5b7e21c90d4af3",
    }),
    t(2, 3000, total0391, "Pre-shipment inspection passed", "装运前检验通过", "Inspection", "Lin Mei, Pearlgate Inspection", "林梅，珍门检验", "5 Sep 2026", 12, true, {
      state: "released",
      releasedAt: "2 Sep 2026, 21:30 GMT",
      proof: "0xd2c84f1a07e6b9",
    }),
    t(3, 5000, total0391, "Arrival confirmed in Tema", "货物抵达特马港", "Arrival", "Kwabena Asante, Harbourline Clearing", "Kwabena Asante，Harbourline 清关", "12 Oct 2026", 48, true, {
      state: "refundable",
    }),
  ],
  timeline: [
    ev("3 Aug", "09:15", "Ama Owusu", "AO", "Locked 12,190.00 USDC in escrow", "held", "0xa18c3e70d2f945"),
    ev("3 Aug", "09:17", "Waybill relayer", "↻", "Paid 2,400.00 USDC to the supplier (stub 1)", "released", "0x5b7e21c90d4af3"),
    ev("2 Sep", "21:30", "Waybill relayer", "↻", "Paid 3,600.00 USDC to the supplier (stub 2)", "released", "0xd2c84f1a07e6b9"),
    ev("12 Oct", "23:59", "Arrival deadline", "◷", "Arrival wasn't confirmed. 72 h grace began", "hold"),
    ev("15 Oct", "23:59", "Grace period ended", "◷", "No confirmation and no dispute. Stub 3 can be refunded to you", "refunded"),
  ],
  summary: "Bed linen · arrival never confirmed, refund available",
};

// ——— WB-0388 · settled sample order ———
const harvest: Party = { name: "Wu Fang", org: "Yiwu Harvest Homewares Co.", orgZh: "义乌丰收家居有限公司", city: "Yiwu", initials: "YH" };
const total0388 = 310_000;
const wb0388: DealRecord = {
  id: "WB-0388",
  onchainId: 388,
  origin: { code: "YIW", city: "Yiwu" },
  destination: { code: "ACC", city: "Accra" },
  goods: "Ceramic mugs, sample order",
  goodsZh: "陶瓷杯样品订单",
  units: 400,
  cartons: 20,
  template: "Sample order",
  templateVersion: "v1",
  total: total0388,
  feeBps: 75,
  feeTotal: fee(total0388),
  feePayer: "Buyer",
  arbiterFee: 5_000,
  funded: total0388 + fee(total0388) + 5_000,
  termsHash: "0x90bd2e47c1a83f06",
  acceptanceDeadline: "18 Jul 2026",
  fundedAt: "15 Jul 2026, 12:40 GMT",
  fundTx: "0x3d6a0e91f7c42b",
  state: "settled",
  buyer,
  supplier: harvest,
  arbiter,
  acceptances: [
    { role: "Supplier", who: harvest.org, done: true },
    { role: "Forwarder", who: `${forwarder.name}, ${forwarder.org}`, done: true },
    { role: "Arbiter", who: arbiter.name, done: true },
  ],
  tranches: [
    t(1, 10_000, total0388, "Arrival confirmed in Tema", "货物抵达特马港", "Arrival", "Kwabena Asante, Harbourline Clearing", "Kwabena Asante，Harbourline 清关", "20 Aug 2026", 24, true, {
      state: "released",
      releasedAt: "14 Aug 2026, 16:05 GMT",
      proof: "0x7f1c94a2e05d38",
    }),
  ],
  timeline: [
    ev("15 Jul", "12:40", "Ama Owusu", "AO", "Locked 3,173.25 USDC in escrow", "held", "0x3d6a0e91f7c42b"),
    ev("13 Aug", "16:05", "Kwabena Asante", "KA", "Signed: arrival confirmed, 20 cartons", "held", "0x2a9e7c03b5d1f4"),
    ev("14 Aug", "16:05", "Waybill relayer", "↻", "Paid 3,100.00 USDC to the supplier", "released", "0x7f1c94a2e05d38"),
    ev("14 Aug", "16:05", "Deal settled", "✓", "All parts paid. Arbiter fee 50.00 returned to Ama", "released"),
  ],
  summary: "Mugs · settled, all parts paid",
};


// ——— WB-0412 · funded; Lin Mei's inspection is due ———
const brightline: Party = { name: "Ou Yang", org: "Foshan Brightline Ceramics Co.", orgZh: "佛山明线陶瓷有限公司", city: "Foshan", initials: "FB" };
const total0412 = 1_500_000;
const wb0412: DealRecord = {
  id: "WB-0412",
  onchainId: 412,
  origin: { code: "CAN", city: "Foshan" },
  destination: { code: "ACC", city: "Accra" },
  goods: "Porcelain floor tiles, 60 × 60",
  goodsZh: "瓷质地砖 60 × 60",
  units: 3200,
  cartons: 800,
  template: "Standard 20/30/50",
  templateVersion: "v1",
  total: total0412,
  feeBps: 75,
  feeTotal: fee(total0412),
  feePayer: "Buyer",
  arbiterFee: 10_000,
  funded: total0412 + fee(total0412) + 10_000,
  termsHash: "0x6d18e3b0a94c27f5",
  acceptanceDeadline: "5 Oct 2026",
  fundedAt: "6 Oct 2026, 14:20 GMT",
  fundTx: "0x2be09d41c7a6f3",
  state: "funded",
  buyer,
  supplier: brightline,
  arbiter,
  acceptances: allAccepted(brightline.org),
  tranches: [
    t(1, 2000, total0412, "Supplier accepts", "供应商接受条款", "Acceptance", "Paid when you accept and the buyer funds", "您接受条款且买方付款后支付", "5 Oct 2026", 0, false, {
      state: "released",
      releasedAt: "6 Oct 2026, 14:22 GMT",
      proof: "0x80f4c2a1d9e357",
    }),
    t(2, 3000, total0412, "Pre-shipment inspection passed", "装运前检验通过", "Inspection", "Lin Mei, Pearlgate Inspection", "林梅，珍门检验", "25 Oct 2026", 12, true),
    t(3, 5000, total0412, "Arrival confirmed in Tema", "货物抵达特马港", "Arrival", "Kwabena Asante, Harbourline Clearing", "Kwabena Asante，Harbourline 清关", "15 Dec 2026", 48, true),
  ],
  timeline: [
    ev("6 Oct", "14:20", "Ama Owusu", "AO", "Locked 15,212.50 USDC in escrow", "held", "0x2be09d41c7a6f3"),
    ev("6 Oct", "14:22", "Waybill relayer", "↻", "Paid 3,000.00 USDC to the supplier (stub 1)", "released", "0x80f4c2a1d9e357"),
    { ...ev("25 Oct", "23:59", "Inspection due", "◷", "Lin Mei confirms the pre-shipment inspection; 72 h grace after"), upcoming: true },
  ],
  summary: "Floor tiles · inspection due 25 Oct",
};

// ——— WB-0440 · proposed; Lin Mei has been invited as inspector ———
const harbor: Party = { name: "Lin Jie", org: "Xiamen Harbor Solar Co.", orgZh: "厦门港湾太阳能有限公司", city: "Xiamen", initials: "XH" };
const total0440 = 900_000;
const wb0440: DealRecord = {
  id: "WB-0440",
  onchainId: 440,
  origin: { code: "XMN", city: "Xiamen" },
  destination: { code: "ACC", city: "Accra" },
  goods: "Solar lanterns with USB output",
  goodsZh: "带 USB 输出的太阳能灯",
  units: 1500,
  cartons: 150,
  template: "30/70 with inspection",
  templateVersion: "v1",
  total: total0440,
  feeBps: 75,
  feeTotal: fee(total0440),
  feePayer: "Buyer",
  arbiterFee: 5_000,
  funded: total0440 + fee(total0440) + 5_000,
  termsHash: "0xb37a0c5e92d1f846",
  acceptanceDeadline: "26 Oct 2026",
  state: "proposed",
  buyer,
  supplier: harbor,
  arbiter,
  acceptances: [
    { role: "Supplier", who: harbor.org, done: true },
    { role: "Inspector", who: `${inspector.name}, ${inspector.org}`, done: false },
    { role: "Arbiter", who: arbiter.name, done: true },
  ],
  tranches: [
    t(1, 3000, total0440, "Supplier accepts", "供应商接受条款", "Acceptance", "Paid when you accept and the buyer funds", "您接受条款且买方付款后支付", "26 Oct 2026", 0, false),
    t(2, 7000, total0440, "Pre-shipment inspection passed", "装运前检验通过", "Inspection", "Lin Mei, Pearlgate Inspection", "林梅，珍门检验", "28 Nov 2026", 24, true),
  ],
  timeline: [
    ev("18 Oct", "11:30", "Ama Owusu", "AO", "Created the deal and invited Lin Mei as inspector", "neutral", "0x4c91e07ab2d5f3"),
    ev("18 Oct", "17:05", "Xiamen Harbor", "XH", "Accepted the terms and set a payout wallet", "neutral", "0x0e7d3b9a51c2f8"),
    ev("19 Oct", "08:00", "Waybill Arbitration Desk", "WA", "Accepted as arbiter, fee 50.00 USDC", "neutral", "0x93a2c1f0e6b47d"),
    { ...ev("26 Oct", "23:59", "Acceptance deadline", "◷", "If the inspector hasn't accepted, the deal cancels. Nothing was funded"), upcoming: true },
  ],
  summary: "Solar lanterns · waiting for the inspector to accept",
};

// ——— WB-0398 · stub 3 disputed; response window closed; waiting on the arbiter ———
const apex: Party = { name: "Deng Rui", org: "Guangzhou Apex Mobile Accessories Co.", orgZh: "广州顶点手机配件有限公司", city: "Guangzhou", initials: "GA" };
const total0398 = 600_000;
const wb0398: DealRecord = {
  id: "WB-0398",
  onchainId: 398,
  origin: { code: "CAN", city: "Guangzhou" },
  destination: { code: "ACC", city: "Accra" },
  goods: "Silicone phone cases, mixed models",
  goodsZh: "硅胶手机壳（多型号）",
  units: 5000,
  cartons: 50,
  template: "Standard 20/30/50",
  templateVersion: "v1",
  total: total0398,
  feeBps: 75,
  feeTotal: fee(total0398),
  feePayer: "Buyer",
  arbiterFee: 5_000,
  funded: total0398 + fee(total0398) + 5_000,
  termsHash: "0x1fa62d9c0e74b358",
  acceptanceDeadline: "22 Aug 2026",
  fundedAt: "23 Aug 2026, 10:00 GMT",
  fundTx: "0x6c3b28e0f19da4",
  state: "funded",
  buyer,
  supplier: apex,
  arbiter,
  acceptances: allAccepted(apex.org),
  tranches: [
    t(1, 2000, total0398, "Supplier accepts", "供应商接受条款", "Acceptance", "Paid when you accept and the buyer funds", "您接受条款且买方付款后支付", "22 Aug 2026", 0, false, {
      state: "released",
      releasedAt: "23 Aug 2026, 10:02 GMT",
      proof: "0x4f0d81b2c6a9e7",
    }),
    t(2, 3000, total0398, "Pre-shipment inspection passed", "装运前检验通过", "Inspection", "Lin Mei, Pearlgate Inspection", "林梅，珍门检验", "25 Sep 2026", 12, true, {
      state: "released",
      releasedAt: "21 Sep 2026, 08:40 GMT",
      proof: "0xa7e3c09f2b4d16",
      signedBy: "Lin Mei",
      signedAt: "20 Sep, 20:40",
      evidence: [
        { name: "Inspection report", detail: "PDF · 1.8 MB · AQL 2.5, level II, 8 models", hash: "0x2d7a…91be" },
        { name: "Sample photos", detail: "24 photos · one per model, front and back", hash: "0xe0c4…5f13" },
      ],
    }),
    t(3, 5000, total0398, "Arrival confirmed in Tema", "货物抵达特马港", "Arrival", "Kwabena Asante, Harbourline Clearing", "Kwabena Asante，Harbourline 清关", "15 Oct 2026", 48, true, {
      state: "disputed",
      signedBy: "Kwabena Asante",
      signedAt: "14 Oct, 11:20",
      evidence: [
        { name: "Delivery receipt", detail: "PDF · 50 of 50 cartons received at Tema", hash: "0x8b13…c07a" },
        { name: "Arrival photos", detail: "9 photos · carton labels and seals", hash: "0x51fe…3d28" },
      ],
    }),
  ],
  timeline: [
    ev("23 Aug", "10:00", "Ama Owusu", "AO", "Locked 6,095.00 USDC in escrow", "held", "0x6c3b28e0f19da4"),
    ev("23 Aug", "10:02", "Waybill relayer", "↻", "Paid 1,200.00 USDC to the supplier (stub 1)", "released", "0x4f0d81b2c6a9e7"),
    ev("21 Sep", "08:40", "Waybill relayer", "↻", "Paid 1,800.00 USDC to the supplier (stub 2)", "released", "0xa7e3c09f2b4d16"),
    ev("14 Oct", "11:20", "Kwabena Asante", "KA", "Signed: arrival confirmed, 50 of 50 cartons", "held", "0x3c9a07e1d5f28b"),
    ev("16 Oct", "09:15", "Ama Owusu", "AO", "Disputed stub 3: “1,850 of 5,000 cases are the wrong model”. Only this part is frozen", "hold", "0xd06e2b8f4a1c93"),
    ev("17 Oct", "18:02", "Guangzhou Apex", "GA", "Responded on stub 3: “Models match the approved sample list; buyer changed the mix by chat”", "neutral", "0x7f25c0a9e3d14b"),
    { ...ev("26 Oct", "09:15", "Arbiter deadline", "◷", "If no decision by then, the default applies: stub 3 refunded to the buyer"), upcoming: true },
  ],
  disputes: {
    3: {
      stub: 3,
      raisedBy: "Buyer",
      raisedAt: "16 Oct, 09:15",
      responseDue: "19 Oct, 09:15",
      responseClosed: true,
      decideBy: "26 Oct, 09:15",
      entries: [
        {
          who: "Ama Owusu",
          role: "Buyer",
          at: "16 Oct, 09:15",
          kind: "filing",
          text: "1,850 of 5,000 cases are for iPhone 12 instead of the iPhone 15 we ordered. Count sheet and photos attached.",
          files: ["count-sheet.pdf", "wrong-model-photos ×14"],
        },
        {
          who: "Guangzhou Apex",
          role: "Supplier",
          at: "17 Oct, 18:02",
          kind: "response",
          text: "The model mix matches the sample list Lin Mei inspected on 20 Sep. The buyer asked to change the mix on WeChat after inspection; we did not agree to it.",
          files: ["approved-sample-list.pdf", "wechat-export.pdf"],
        },
        {
          who: "Ama Owusu",
          role: "Buyer",
          at: "18 Oct, 10:30",
          kind: "evidence",
          text: "Our purchase order v2, sent before inspection, lists iPhone 15 for those cases.",
          files: ["po-v2.pdf"],
        },
      ],
    },
  },
  summary: "Phone cases · stub 3 disputed, arbiter deciding by 26 Oct",
};

export const initialDeals: Record<string, DealRecord> = {
  "WB-0412": wb0412,
  "WB-0440": wb0440,
  "WB-0398": wb0398,
  "WB-0427": wb0427,
  "WB-0433": wb0433,
  "WB-0419": wb0419,
  "WB-0391": wb0391,
  "WB-0388": wb0388,
};

export const dealOrder = ["WB-0427", "WB-0433", "WB-0391", "WB-0398", "WB-0412", "WB-0440", "WB-0419", "WB-0388"];

/** What the buyer needs to do on a deal right now, if anything. */
export function needsBuyer(d: DealRecord): string | null {
  if (d.state === "accepted") return "Fund";
  if (d.tranches.some((x) => x.state === "in_review")) return "Review";
  if (d.tranches.some((x) => x.state === "refundable")) return "Refund";
  return null;
}

/** Fees an attestor has earned: their share of each released tranche they signed. */
export function attestorEarnings(deals: Record<string, DealRecord>, name: string) {
  const rows: { id: string; stub: number; what: string; amount: number; at: string }[] = [];
  for (const d of Object.values(deals))
    for (const t of d.tranches)
      if (t.confirmedBy.startsWith(name) && (t.state === "released" || (t.state === "resolved" && (t.splitBps ?? 0) > 0)))
        rows.push({ id: d.id, stub: t.index, what: t.short, amount: t.state === "released" ? t.feeAttestor : Math.round((t.feeAttestor * (t.splitBps ?? 0)) / 10_000), at: t.releasedAt?.split(",")[0] ?? "" });
  return rows;
}

export function heldFor(d: DealRecord): number {
  if (d.state === "proposed" || d.state === "accepted" || d.state === "cancelled") return 0;
  if (d.state === "settled") return 0;
  const open = d.tranches.filter((x) => !["released", "refunded", "resolved"].includes(x.state));
  return open.reduce((s, x) => s + x.amount + x.fee, 0) + (d.arbiterFeePaid ? 0 : d.arbiterFee);
}

/** Supplier's part of a split tranche, and the buyer's part including the fee on what came back. */
export function splitParts(t: Tranche) {
  const s = t.splitBps ?? 0;
  const toSupplier = Math.round((t.amount * s) / 10_000);
  const toBuyer = t.amount - toSupplier + Math.round((t.fee * (10_000 - s)) / 10_000);
  return { toSupplier, toBuyer };
}

export function releasedFor(d: DealRecord): number {
  return d.tranches.reduce((s, x) => s + (x.state === "released" ? x.amount : x.state === "resolved" ? splitParts(x).toSupplier : 0), 0);
}

/** Refunded principal and fees; on settlement without an arbiter decision, the prepaid arbiter fee comes back too. */
export function refundedFor(d: DealRecord): number {
  const parts = d.tranches.reduce((s, x) => s + (x.state === "refunded" ? x.amount + x.fee : x.state === "resolved" ? splitParts(x).toBuyer : 0), 0);
  const arbiterBack = d.state === "settled" && !d.arbiterFeePaid ? d.arbiterFee : 0;
  return parts + arbiterBack;
}
