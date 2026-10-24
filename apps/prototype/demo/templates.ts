// DEMO DATA. Template definitions for the deal builder. Parts are in bps and always total 10,000.

/** What confirms a part. Drives the plain-language sentence and who must accept the deal. */
export type Confirm = "acceptance" | "inspector" | "forwarder" | "buyer" | "timed";

export interface TemplatePart {
  name: string;
  nameZh: string;
  short: string;
  bps: number;
  confirm: Confirm;
  reviewHours: number;
  /** Days after the acceptance deadline the part is due */
  dueDays: number;
}

export interface Template {
  id: string;
  name: string;
  line: string;
  blurb: string;
  parts: TemplatePart[];
  /** Custom lets the buyer add and remove parts */
  custom?: boolean;
}

const p = (name: string, nameZh: string, short: string, bps: number, confirm: Confirm, reviewHours: number, dueDays: number): TemplatePart => ({
  name,
  nameZh,
  short,
  bps,
  confirm,
  reviewHours,
  dueDays,
});

export const templates: Template[] = [
  {
    id: "sample",
    name: "Sample order",
    line: "100% on arrival",
    blurb: "One payment, released when arrival is confirmed. For a first small order.",
    parts: [p("Arrival confirmed", "货物抵达", "Arrival", 10_000, "forwarder", 48, 45)],
  },
  {
    id: "standard",
    name: "Standard 20/30/50",
    line: "Accept · Inspect · Arrive",
    blurb: "A small share when the supplier commits, most after an inspector and a forwarder confirm.",
    parts: [
      p("Supplier accepts", "供应商接受条款", "Acceptance", 2000, "acceptance", 0, 0),
      p("Pre-shipment inspection passed", "装运前检验通过", "Inspection", 3000, "inspector", 12, 35),
      p("Arrival confirmed", "货物抵达", "Arrival", 5000, "forwarder", 48, 60),
    ],
  },
  {
    id: "inspection",
    name: "30/70 with inspection",
    line: "Accept · Inspect",
    blurb: "Most of the money moves on the inspector's word. No arrival step.",
    parts: [
      p("Supplier accepts", "供应商接受条款", "Acceptance", 3000, "acceptance", 0, 0),
      p("Pre-shipment inspection passed", "装运前检验通过", "Inspection", 7000, "inspector", 24, 35),
    ],
  },
  {
    id: "warehouse",
    name: "Forwarder warehouse release",
    line: "Accept · Goods received · Released",
    blurb: "A forwarder confirms the goods are in their warehouse, then again when they are released to you.",
    parts: [
      p("Supplier accepts", "供应商接受条款", "Acceptance", 1000, "acceptance", 0, 0),
      p("Goods received at the warehouse", "货物入库确认", "Received", 4000, "forwarder", 24, 30),
      p("Goods released from the warehouse", "货物出库放行", "Released", 5000, "forwarder", 48, 50),
    ],
  },
  {
    id: "four",
    name: "Four-stage production",
    line: "10 · 20 · 30 · 40",
    blurb: "For made-to-order goods: start, mid-production, inspection, arrival.",
    parts: [
      p("Supplier accepts", "供应商接受条款", "Acceptance", 1000, "acceptance", 0, 0),
      p("Production started", "开始生产", "Production", 2000, "buyer", 24, 20),
      p("Pre-shipment inspection passed", "装运前检验通过", "Inspection", 3000, "inspector", 12, 45),
      p("Arrival confirmed", "货物抵达", "Arrival", 4000, "forwarder", 48, 70),
    ],
  },
  {
    id: "custom",
    name: "Custom",
    line: "Your own parts",
    blurb: "Start from two parts and add up to eight. Pick what confirms each one.",
    custom: true,
    parts: [
      p("Supplier accepts", "供应商接受条款", "Acceptance", 3000, "acceptance", 0, 0),
      p("Goods ready", "货物备妥", "Ready", 7000, "buyer", 24, 30),
    ],
  },
];

export const MAX_PARTS = 8;
/** An acceptance-only part above this share pays out with no outside check; warn the buyer. */
export const ACCEPTANCE_WARN_BPS = 3000;

export const confirmLabel: Record<Confirm, string> = {
  acceptance: "Supplier accepts and you fund",
  inspector: "An inspector signs",
  forwarder: "A forwarder confirms",
  buyer: "You approve",
  timed: "A date passes",
};

export const arbiters = [{ name: "Waybill Arbitration Desk", org: "Waybill-operated", fee: 10_000, note: "Decides within 7 days of the supplier's response window" }];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** “23 Dec 2026”: the demo date (19 Oct 2026) plus whole days. */
export function dateAfter(days: number): string {
  const d = new Date(Date.UTC(2026, 9, 19 + days));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The share of the money that moves on the supplier's say-so alone, with no outside check. */
export function uncheckedBps(parts: { bps: number; confirm: Confirm }[]): number {
  return parts.filter((p) => p.confirm === "acceptance").reduce((s, p) => s + p.bps, 0);
}
