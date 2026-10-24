// DEMO DATA. Invented attestors. Public counts = history before the demo + live deal outcomes from the store.

import type { DealRecord } from "./deals";

export type AttestorKind = "Inspector" | "Forwarder" | "Clearing agent";

export interface Attestor {
  slug: string;
  org: string;
  name: string;
  initials: string;
  city: string;
  kind: AttestorKind;
  /** Where they work, in plain words */
  corridor: string;
  signs: string[];
  since: string;
  tier: "Registered";
  /** Registry status; a scheduled suspension blocks naming them in new deals */
  status: "Active" | "Suspension scheduled";
  statusNote?: string;
  /** What `confirmedBy` starts with on a deal, for live counts; absent for attestors with no live deals */
  match?: string;
  base: { signed: number; undisputed: number; upheld: number; medianHours: number; repeatClients: number };
  history: { id: string; what: string; when: string; outcome: string; tone: "released" | "hold" | "neutral" }[];
}

export const attestors: Attestor[] = [
  {
    slug: "pearlgate",
    org: "Pearlgate Inspection",
    name: "Lin Mei",
    initials: "LM",
    city: "Guangzhou",
    kind: "Inspector",
    corridor: "Guangzhou, Foshan, Dongguan → Accra, Lagos",
    signs: ["Pre-shipment inspection", "Production proof"],
    since: "Mar 2026",
    tier: "Registered",
    status: "Active",
    match: "Lin Mei",
    base: { signed: 34, undisputed: 33, upheld: 1, medianHours: 6, repeatClients: 5 },
    history: [
      { id: "WB-0402", what: "Pre-shipment inspection", when: "2 Oct", outcome: "Released", tone: "released" },
      { id: "WB-0396", what: "Production proof", when: "27 Sep", outcome: "Released", tone: "released" },
      { id: "WB-0371", what: "Pre-shipment inspection", when: "11 Sep", outcome: "Disputed · upheld against", tone: "hold" },
      { id: "WB-0355", what: "Pre-shipment inspection", when: "30 Aug", outcome: "Released", tone: "released" },
    ],
  },
  {
    slug: "harbourline",
    org: "Harbourline Clearing",
    name: "Kwabena Asante",
    initials: "KA",
    city: "Tema",
    kind: "Clearing agent",
    corridor: "Tema port, Accra deliveries",
    signs: ["Arrival confirmed"],
    since: "Feb 2026",
    tier: "Registered",
    status: "Active",
    match: "Kwabena Asante",
    base: { signed: 52, undisputed: 51, upheld: 0, medianHours: 9, repeatClients: 11 },
    history: [
      { id: "WB-0379", what: "Arrival confirmed", when: "29 Jul", outcome: "Released", tone: "released" },
      { id: "WB-0364", what: "Arrival confirmed", when: "16 Jul", outcome: "Released", tone: "released" },
    ],
  },
  {
    slug: "canton-qc",
    org: "Canton Quality Services",
    name: "Wang Fei",
    initials: "WF",
    city: "Guangzhou",
    kind: "Inspector",
    corridor: "Guangzhou, Shenzhen → Lagos, Accra",
    signs: ["Pre-shipment inspection"],
    since: "May 2026",
    tier: "Registered",
    status: "Active",
    base: { signed: 19, undisputed: 18, upheld: 0, medianHours: 11, repeatClients: 3 },
    history: [
      { id: "WB-0399", what: "Pre-shipment inspection", when: "30 Sep", outcome: "Released", tone: "released" },
      { id: "WB-0384", what: "Pre-shipment inspection", when: "9 Sep", outcome: "Released", tone: "released" },
    ],
  },
  {
    slug: "yiwu-linkage",
    org: "Yiwu Linkage Logistics",
    name: "Chen Yu",
    initials: "CY",
    city: "Yiwu",
    kind: "Forwarder",
    corridor: "Yiwu consolidation → Tema",
    signs: ["Warehouse receipt", "Bill of lading issued"],
    since: "Apr 2026",
    tier: "Registered",
    status: "Active",
    base: { signed: 27, undisputed: 26, upheld: 0, medianHours: 14, repeatClients: 6 },
    history: [
      { id: "WB-0392", what: "Warehouse receipt", when: "21 Sep", outcome: "Released", tone: "released" },
      { id: "WB-0377", what: "Bill of lading issued", when: "4 Sep", outcome: "Released", tone: "released" },
    ],
  },
  {
    slug: "gateway-accra",
    org: "Gateway Clearing Accra",
    name: "Efua Boateng",
    initials: "EB",
    city: "Accra",
    kind: "Clearing agent",
    corridor: "Accra, Kumasi deliveries",
    signs: ["Arrival confirmed"],
    since: "Jun 2026",
    tier: "Registered",
    status: "Active",
    base: { signed: 8, undisputed: 8, upheld: 0, medianHours: 7, repeatClients: 2 },
    history: [{ id: "WB-0393", what: "Arrival confirmed", when: "24 Sep", outcome: "Released", tone: "released" }],
  },
  {
    slug: "sunrise-qc",
    org: "Sunrise Quality Control",
    name: "Zhang Wei",
    initials: "ZW",
    city: "Shenzhen",
    kind: "Inspector",
    corridor: "Shenzhen → Accra",
    signs: ["Pre-shipment inspection"],
    since: "Mar 2026",
    tier: "Registered",
    status: "Suspension scheduled",
    statusNote: "Three disputes were upheld against their statements. A 48-hour review is running before suspension applies. They can't be named in new deals meanwhile.",
    base: { signed: 21, undisputed: 17, upheld: 3, medianHours: 18, repeatClients: 2 },
    history: [
      { id: "WB-0386", what: "Pre-shipment inspection", when: "12 Sep", outcome: "Disputed · upheld against", tone: "hold" },
      { id: "WB-0375", what: "Pre-shipment inspection", when: "28 Aug", outcome: "Disputed · upheld against", tone: "hold" },
      { id: "WB-0361", what: "Pre-shipment inspection", when: "10 Aug", outcome: "Released", tone: "released" },
    ],
  },
];

export function findAttestor(slug: string) {
  return attestors.find((a) => a.slug === slug);
}

const SIGNED = ["in_review", "claimable", "released", "disputed", "resolved"];

/** Live counts: history before this demo plus outcomes of every deal in the store. Derivable from public events. */
export function attestorStats(a: Attestor, deals: Record<string, DealRecord>) {
  let signed = a.base.signed;
  let undisputed = a.base.undisputed;
  let upheld = a.base.upheld;
  const live: Attestor["history"] = [];
  if (a.match) {
    for (const d of Object.values(deals)) {
      for (const t of d.tranches) {
        if (!t.confirmedBy.startsWith(a.match)) continue;
        const counted = SIGNED.includes(t.state) || (t.state === "refunded" && !!t.signedBy);
        if (!counted) continue;
        signed += 1;
        const rec = d.disputes?.[t.index];
        if (t.state === "released" && !rec) undisputed += 1;
        if (t.state === "refunded" && t.resolvedBy === "arbiter") upheld += 1;
        live.push({
          id: d.id,
          what: t.title.replace(" passed", "").replace(" confirmed in Tema", " confirmed"),
          when: t.releasedAt?.split(" 2026")[0] ?? (t.signedAt?.includes(",") ? t.signedAt.split(",")[0]! : "19 Oct"),
          outcome:
            t.state === "released" && !rec ? "Released" : t.state === "in_review" ? "In review" : t.state === "claimable" ? "Paying supplier" : t.state === "disputed" ? "Disputed · awaiting arbiter" : t.resolvedBy === "arbiter" && t.state === "refunded" ? "Disputed · upheld against" : t.state === "resolved" ? "Disputed · split by the arbiter" : "Released",
          tone: t.state === "refunded" || t.state === "disputed" ? "hold" : t.state === "released" ? "released" : "neutral",
        });
      }
    }
  }
  const share = signed ? Math.round((undisputed / signed) * 100) : 0;
  return { signed, undisputed, upheld, share, medianHours: a.base.medianHours, repeatClients: a.base.repeatClients, recent: [...live.reverse(), ...a.history].slice(0, 7) };
}
