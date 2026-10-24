// DEMO DATA. Invented parties and figures for the prototype only. Amounts are USDC cents.

export type MilestoneState =
  | "waiting"
  | "in_review"
  | "claimable"
  | "released"
  | "overdue"
  | "refundable"
  | "refunded"
  | "disputed"
  | "resolved";

export type DealState = "proposed" | "accepted" | "funded" | "settled" | "cancelled";

export interface Party {
  name: string;
  org: string;
  orgZh?: string;
  city: string;
  initials: string;
}

export interface Tranche {
  index: number;
  title: string;
  titleZh: string;
  /** One word for tight places: ledger labels, chips */
  short: string;
  bps: number;
  amount: number;
  fee: number;
  feeProtocol: number;
  feeAttestor: number;
  confirmedBy: string;
  confirmedByZh: string;
  reviewHours: number;
  due: string;
  state: MilestoneState;
  releasedAt?: string;
  reviewEnds?: string;
  proof?: string;
  /** Who signed, when, and the files behind it (attested tranches) */
  signedBy?: string;
  signedAt?: string;
  evidence?: EvidenceFile[];
  /** Set when an arbiter decided this tranche */
  resolvedBy?: "arbiter";
  /** Supplier's share in bps when the arbiter split the tranche */
  splitBps?: number;
}

export interface EvidenceFile {
  name: string;
  detail: string;
  hash: string;
}

export const DEMO_RATE_GHS = 11.2;

export const buyer: Party = {
  name: "Ama Owusu",
  org: "Owusu Home Electronics",
  city: "Accra",
  initials: "AO",
};

export const supplier: Party = {
  name: "Chen Hao",
  org: "Baiyun Brightpower Electronics Co., Ltd.",
  orgZh: "白云明电电子有限公司",
  city: "Guangzhou",
  initials: "BB",
};

export const inspector: Party = {
  name: "Lin Mei",
  org: "Pearlgate Inspection",
  city: "Guangzhou",
  initials: "LM",
};

export const forwarder: Party = {
  name: "Kwabena Asante",
  org: "Harbourline Clearing",
  city: "Tema",
  initials: "KA",
};

export const arbiter: Party = {
  name: "Waybill Arbitration Desk",
  org: "Waybill-operated",
  city: "Remote",
  initials: "WA",
};

export const deal = {
  id: "WB-0427",
  onchainId: 427,
  // Goods travel Guangzhou → Accra (Tema port); money travels the other way.
  origin: { code: "CAN", city: "Guangzhou" },
  destination: { code: "ACC", city: "Accra" },
  goods: "Power banks, 10,000 mAh",
  goodsZh: "移动电源 10,000 mAh",
  units: 4800,
  cartons: 480,
  template: "Standard 20/30/50",
  templateVersion: "v1",
  total: 2_000_000,
  feeBps: 75,
  feeTotal: 15_000,
  feePayer: "Buyer",
  arbiterFee: 10_000,
  funded: 2_025_000,
  termsHash: "0x8f3a91d07be4c21e",
  acceptanceDeadline: "13 Oct 2026",
  fundedAt: "8 Oct 2026, 11:02 GMT",
  fundTx: "0x4a7c22e9f1b091",
  state: "funded" as DealState,
  now: "19 Oct 2026, 09:40 GMT",
};

export const tranches: Tranche[] = [
  {
    index: 1,
    title: "Supplier accepts",
    short: "Acceptance",
    titleZh: "供应商接受条款",
    bps: 2000,
    amount: 400_000,
    fee: 3_000,
    feeProtocol: 3_000,
    feeAttestor: 0,
    confirmedBy: "Paid when you accept and the buyer funds",
    confirmedByZh: "您接受条款且买方付款后支付",
    reviewHours: 0,
    due: "13 Oct 2026",
    state: "released",
    releasedAt: "8 Oct 2026, 11:04 GMT",
    proof: "0x91e0b3d4c7a2f6",
  },
  {
    index: 2,
    title: "Pre-shipment inspection passed",
    short: "Inspection",
    titleZh: "装运前检验通过",
    bps: 3000,
    amount: 600_000,
    fee: 4_500,
    feeProtocol: 2_700,
    feeAttestor: 1_800,
    confirmedBy: "Lin Mei, Pearlgate Inspection",
    confirmedByZh: "林梅，珍门检验",
    reviewHours: 12,
    due: "15 Nov 2026",
    state: "in_review",
    reviewEnds: "19 Oct 2026, 18:40 GMT",
    signedBy: "Lin Mei",
    signedAt: "06:40",
    evidence: [
      { name: "Inspection report", detail: "PDF · 2.4 MB · AQL 2.5, level II", hash: "0x7c1e…a04f" },
      { name: "Sample photos", detail: "12 photos · labels and cartons visible", hash: "0x33b9…e1d2" },
      { name: "Carton count", detail: "480 of 480 counted", hash: "0xd04a…77c5" },
      { name: "Packing list", detail: "PDF · 380 KB · 480 cartons listed", hash: "0x5e02…b7a1" },
    ],
  },
  {
    index: 3,
    title: "Arrival confirmed in Tema",
    short: "Arrival",
    titleZh: "货物抵达特马港",
    bps: 5000,
    amount: 1_000_000,
    fee: 7_500,
    feeProtocol: 4_500,
    feeAttestor: 3_000,
    confirmedBy: "Kwabena Asante, Harbourline Clearing",
    confirmedByZh: "Kwabena Asante，Harbourline 清关",
    reviewHours: 48,
    due: "10 Dec 2026",
    state: "waiting",
  },
];

/** Held in escrow = unreleased principal + their prepaid fees + prepaid arbiter fee. */
export function heldInEscrow(ts: Tranche[] = tranches, arbiterFee: number = deal.arbiterFee): number {
  const open = ts.filter((t) => !["released", "refunded", "resolved"].includes(t.state));
  return open.reduce((s, t) => s + t.amount + t.fee, 0) + arbiterFee;
}

/** Paid to the supplier, including their share of any tranche the arbiter split. */
export function releasedTotal(ts: Tranche[] = tranches): number {
  return ts.reduce((s, t) => s + (t.state === "released" ? t.amount : t.state === "resolved" ? Math.round((t.amount * (t.splitBps ?? 0)) / 10_000) : 0), 0);
}

export interface TimelineEvent {
  at: string;
  day: string;
  actor: string;
  initials: string;
  text: string;
  proof?: string;
  tone?: "held" | "released" | "refunded" | "hold" | "neutral";
  upcoming?: boolean;
}

export const timeline: TimelineEvent[] = [
  { day: "6 Oct", at: "14:20", actor: "Ama Owusu", initials: "AO", text: "Created the deal and shared the link", proof: "0x2d10c8a4e6f3b7", tone: "neutral" },
  { day: "7 Oct", at: "09:12", actor: "Baiyun Brightpower", initials: "BB", text: "Accepted the terms and set a payout wallet", proof: "0x6b3f0e9a12d4c8", tone: "neutral" },
  { day: "7 Oct", at: "16:45", actor: "Lin Mei", initials: "LM", text: "Accepted the inspection statement", proof: "0x0c7e44b1a9f2d3", tone: "neutral" },
  { day: "8 Oct", at: "08:30", actor: "Kwabena Asante", initials: "KA", text: "Accepted the arrival statement", proof: "0xa4d29c7f0e18b5", tone: "neutral" },
  { day: "8 Oct", at: "08:31", actor: "Waybill Arbitration Desk", initials: "WA", text: "Accepted as arbiter, fee 100.00 USDC", proof: "0x3e8b1f6c2a90d7", tone: "neutral" },
  { day: "8 Oct", at: "11:02", actor: "Ama Owusu", initials: "AO", text: "Locked 20,250.00 USDC in escrow", proof: "0x4a7c22e9f1b091", tone: "held" },
  { day: "8 Oct", at: "11:04", actor: "Waybill relayer", initials: "↻", text: "Paid 4,000.00 USDC to the supplier (stub 1)", proof: "0x91e0b3d4c7a2f6", tone: "released" },
  { day: "19 Oct", at: "06:40", actor: "Lin Mei", initials: "LM", text: "Signed: pre-shipment inspection passed. 4 files attached", proof: "0xe57a0c93b2d148", tone: "held" },
  { day: "19 Oct", at: "18:40", actor: "Review window ends", initials: "◷", text: "6,000.00 USDC releases to the supplier unless Ama acts", tone: "neutral", upcoming: true },
  { day: "10 Dec", at: "23:59", actor: "Arrival due", initials: "◷", text: "Kwabena confirms arrival in Tema; 72 h grace after", tone: "neutral", upcoming: true },
];

export const otherDeals = [
  { id: "WB-0419", route: "ACC ⟶ SZX", counterparty: "Shenzhen Corelite Lighting", amount: 840_000, state: "Waiting for supplier", tone: "neutral" as const },
  { id: "WB-0388", route: "ACC ⟶ YIW", counterparty: "Yiwu Harvest Homewares", amount: 310_000, state: "Settled", tone: "released" as const },
];

export const evidence = [
  { name: "Inspection report", detail: "PDF · 2.4 MB · AQL 2.5, level II", hash: "0x7c1e…a04f", state: "done" as const },
  { name: "Sample photos", detail: "12 photos · labels and cartons visible", hash: "0x33b9…e1d2", state: "done" as const },
  { name: "Carton count", detail: "480 of 480 counted", hash: "0xd04a…77c5", state: "done" as const },
  { name: "Packing list", detail: "Uploading · 64% · resumes if the connection drops", hash: "", state: "uploading" as const, progress: 64 },
];
