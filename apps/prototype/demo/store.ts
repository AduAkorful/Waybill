"use client";

import { useSyncExternalStore } from "react";
import { attestorEarnings, dealOrder, initialDeals, splitParts, type DealRecord, type DisputeEntry } from "./deals";
import type { Confirm } from "./templates";
import type { EvidenceFile, TimelineEvent, Tranche } from "./deal";
import { usdc } from "./format";

/**
 * The prototype's demo state. One store for every role, kept in this browser's localStorage so an action on the
 * buyer's screen shows on the supplier's link in another tab. Never real money: every action is simulated.
 */

interface DemoState {
  deals: Record<string, DealRecord>;
  /** Minutes after 19 Oct 2026, 09:40 GMT; advances with each action */
  clock: number;
  seq: number;
  /** Fees already withdrawn, by recipient */
  withdrawn: Record<string, number>;
  profile: { name: string; city: string; agentId: string };
  /** The buyer's settings (off-chain preferences only) */
  settings: BuyerSettings;
  /** Operator state: new-deal pause. Only the pause is writable; nothing here can touch a deal. */
  ops: { paused: boolean; pausedAt?: string; log: { at: string; text: string }[] };
  /** Ids of deals made in the builder, oldest first */
  created: string[];
}

export interface BuyerSettings {
  name: string;
  org: string;
  city: string;
  email: string;
  notify: { needsYou: boolean; windowEnding: boolean; everyMovement: boolean; weekly: boolean };
  estimate: "GHS" | "none";
  language: "en" | "zh";
  publicNamesByDefault: boolean;
}

const KEY = "wb-demo-v2";
const fresh = (): DemoState => ({
  deals: structuredClone(initialDeals),
  clock: 0,
  seq: 0,
  withdrawn: {},
  profile: { name: "Pearlgate Inspection", city: "Guangzhou", agentId: "" },
  settings: {
    name: "Ama Owusu",
    org: "Owusu Home Electronics",
    city: "Accra",
    email: "ama@owusuhome.example",
    notify: { needsYou: true, windowEnding: true, everyMovement: false, weekly: false },
    estimate: "GHS",
    language: "en",
    publicNamesByDefault: false,
  },
  ops: { paused: false, log: [{ at: "12 Oct 2026, 08:15 GMT", text: "Service started. New deals open." }] },
  created: [],
});

let state: DemoState = fresh();
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
  for (const l of listeners) l();
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...fresh(), ...(JSON.parse(raw) as Partial<DemoState>) };
  } catch {}
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    try {
      state = e.newValue ? { ...fresh(), ...(JSON.parse(e.newValue) as Partial<DemoState>) } : fresh();
    } catch {
      state = fresh();
    }
    for (const l of listeners) l();
  });
}

const serverSnapshot = fresh();

export function useDemo(): DemoState {
  return useSyncExternalStore(
    (l) => {
      hydrate();
      listeners.add(l);
      // localStorage may hold a newer state than the server render; tell React once after subscribing.
      queueMicrotask(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => serverSnapshot,
  );
}

export function useDeal(id: string): DealRecord | undefined {
  return useDemo().deals[id];
}

// ——— Clock, hashes, events ———

function now(advance = 2) {
  state = { ...state, clock: state.clock + advance };
  const total = 9 * 60 + 40 + state.clock;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const at = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return { day: "19 Oct", at, stamp: `19 Oct 2026, ${at} GMT` };
}

/** “22 Oct, 09:42”: the demo clock plus whole days, for response and decision deadlines. */
function later(days: number) {
  const { at } = now(0);
  return `${19 + days} Oct, ${at}`;
}

export function demoNow(): string {
  const total = 9 * 60 + 40 + state.clock;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function hash(): string {
  state = { ...state, seq: state.seq + 1 };
  let x = (state.seq * 2654435761) >>> 0;
  let out = "0x";
  for (let i = 0; i < 14; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += "0123456789abcdef"[(x >>> 16) & 15];
  }
  return out;
}

function update(id: string, fn: (d: DealRecord) => DealRecord) {
  const d = state.deals[id];
  if (!d) return;
  let next = fn(structuredClone(d));
  // Settled when every tranche has a final fate
  if (next.state === "funded" && next.tranches.every((t) => ["released", "refunded", "resolved"].includes(t.state))) {
    const when = now(0);
    next = {
      ...next,
      state: "settled",
      timeline: [...next.timeline.filter((e) => !e.upcoming), { day: when.day, at: when.at, actor: "Deal settled", initials: "✓", text: `Every part has reached its final fate. Arbiter fee ${usdc(next.arbiterFee)} returned to ${next.buyer.name.split(" ")[0]}`, tone: "released" }],
    };
  }
  state = { ...state, deals: { ...state.deals, [id]: next } };
  emit();
}

function push(d: DealRecord, e: Omit<TimelineEvent, "day" | "at">, advance = 2): DealRecord {
  const when = now(advance);
  const past = d.timeline.filter((x) => !x.upcoming);
  const upcoming = d.timeline.filter((x) => x.upcoming);
  return { ...d, timeline: [...past, { ...e, day: when.day, at: when.at }, ...upcoming] };
}

const setT = (d: DealRecord, idx: number, over: Partial<Tranche>): DealRecord => ({
  ...d,
  tranches: d.tranches.map((t) => (t.index === idx ? { ...t, ...over } : t)),
});

const dropUpcoming = (d: DealRecord, match: string): DealRecord => ({ ...d, timeline: d.timeline.filter((e) => !(e.upcoming && e.actor.includes(match))) });

// ——— Actions. Each mirrors one fixed contract operation from docs/frontend-behavior.md ———

export const act = {
  reset() {
    state = fresh();
    emit();
  },


  /** Buyer `createDeal(...)`: a new proposed deal, nothing locked. Refused while new deals are paused. */
  createDeal(input: NewDealInput): string {
    if (state.ops.paused) throw new Error("New deals are paused");
    const id = `WB-${String(441 + state.created.length).padStart(4, "0")}`;
    const feeOf = (amount: number) => Math.round((amount * 75) / 10_000);
    let left = input.total;
    const tranches: Tranche[] = input.parts.map((p, i) => {
      const last = i === input.parts.length - 1;
      const amount = last ? left : Math.round((input.total * p.bps) / 10_000);
      left -= amount;
      const f = feeOf(amount);
      const attested = p.confirm === "inspector" || p.confirm === "forwarder";
      const toAttestor = attested ? Math.round(f * 0.4) : 0;
      const who =
        p.confirm === "inspector" && input.inspector
          ? `${input.inspector.name}, ${input.inspector.org}`
          : p.confirm === "forwarder" && input.forwarder
            ? `${input.forwarder.name}, ${input.forwarder.org}`
            : p.confirm === "buyer"
              ? `${state.settings.name} approves`
              : p.confirm === "timed"
                ? "Paid on the due date; nobody needs to sign"
                : "Paid when the supplier accepts and the buyer funds";
      return {
        index: i + 1,
        bps: p.bps,
        amount,
        fee: f,
        feeProtocol: f - toAttestor,
        feeAttestor: toAttestor,
        title: p.name,
        titleZh: p.nameZh,
        short: p.short,
        confirmedBy: who,
        confirmedByZh: who,
        reviewHours: p.reviewHours,
        due: p.due,
        state: "waiting",
      };
    });
    const feeTotal = tranches.reduce((s, x) => s + x.fee, 0);
    const feeShare = input.feePayer === "Buyer" ? feeTotal : input.feePayer === "Split" ? Math.ceil(feeTotal / 2) : 0;
    const when = now(3);
    const acceptances = [
      { role: "Supplier" as const, who: input.supplier.org, done: false },
      ...(input.inspector ? [{ role: "Inspector" as const, who: `${input.inspector.name}, ${input.inspector.org}`, done: false }] : []),
      ...(input.forwarder ? [{ role: "Forwarder" as const, who: `${input.forwarder.name}, ${input.forwarder.org}`, done: false }] : []),
      { role: "Arbiter" as const, who: "Waybill Arbitration Desk", done: false },
    ];
    const record: DealRecord = {
      id,
      onchainId: 441 + state.created.length,
      origin: input.origin,
      destination: input.destination,
      goods: input.goods,
      goodsZh: input.goods,
      units: input.units,
      cartons: input.cartons,
      template: input.template,
      templateVersion: "v1",
      total: input.total,
      feeBps: 75,
      feeTotal,
      feePayer: input.feePayer,
      arbiterFee: input.arbiterFee,
      funded: input.total + feeShare + input.arbiterFee,
      termsHash: hash(),
      acceptanceDeadline: input.acceptanceDeadline,
      state: "proposed",
      buyer: { name: state.settings.name, org: state.settings.org, city: state.settings.city, initials: state.settings.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() },
      supplier: { name: input.supplier.name, org: input.supplier.org, city: input.origin.city, initials: input.supplier.org.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() },
      arbiter: { name: "Waybill Arbitration Desk", org: "Waybill-operated", city: "Remote", initials: "WA" },
      acceptances,
      tranches,
      timeline: [
        { day: when.day, at: when.at, actor: state.settings.name, initials: "AO", text: "Created the deal. Nothing is locked yet", tone: "neutral", proof: hash() },
        { day: input.acceptanceDeadline.split(" ").slice(0, 2).join(" "), at: "23:59", actor: "Acceptance deadline", initials: "◷", text: "If everyone hasn't accepted, the deal cancels. Nothing was funded", tone: "neutral", upcoming: true },
      ],
      summary: `${input.goods} · waiting for acceptances`,
    };
    state = { ...state, deals: { ...state.deals, [id]: record }, created: [...state.created, id] };
    emit();
    return id;
  },

  setSettings(patch: Partial<BuyerSettings>) {
    state = { ...state, settings: { ...state.settings, ...patch, notify: { ...state.settings.notify, ...(patch.notify ?? {}) } } };
    emit();
  },

  /** Operator `pause()` / `unpause()`: new deals only. Funded deals, claims, refunds and disputes are never affected. */
  setPaused(paused: boolean) {
    const when = now(1);
    state = {
      ...state,
      ops: {
        paused,
        pausedAt: paused ? when.stamp : undefined,
        log: [{ at: when.stamp, text: paused ? "New deals paused. Funded deals, claims, refunds and disputes unaffected." : "New deals reopened." }, ...state.ops.log],
      },
    };
    emit();
  },

  /** Supplier `acceptSupplier(dealId, payout)` */
  supplierAccept(id: string, payout: string) {
    update(id, (d) => {
      let n = { ...d, acceptances: d.acceptances.map((a) => (a.role === "Supplier" ? { ...a, done: true } : a)) };
      n = push(n, { actor: d.supplier.org.split(" ").slice(0, 2).join(" "), initials: d.supplier.initials, text: `Accepted the terms. Payout wallet ${payout}`, tone: "neutral", proof: hash() });
      n = dropUpcoming(n, "Acceptance deadline");
      if (n.acceptances.every((a) => a.done)) n.state = "accepted";
      return n;
    });
  },

  /** Buyer `approve(USDC)` then `fund(dealId)` */
  fund(id: string, tx: string) {
    update(id, (d) => {
      const when = now(1);
      let n: DealRecord = { ...d, state: "funded", fundedAt: when.stamp, fundTx: tx };
      n = push(n, { actor: d.buyer.name, initials: d.buyer.initials, text: `Locked ${usdc(d.funded)} USDC in escrow`, tone: "held", proof: tx }, 0);
      // An acceptance tranche becomes claimable the moment the deal is funded
      const first = n.tranches.find((t) => t.short === "Acceptance");
      if (first) n = setT(n, first.index, { state: "claimable" });
      return n;
    });
  },

  /** Buyer `approveMilestone(dealId, i)`: ends the review window; payment is a separate claim */
  approve(id: string, idx: number) {
    update(id, (d) => {
      const n = setT(d, idx, { state: "claimable" });
      return dropUpcoming(push(n, { actor: d.buyer.name, initials: d.buyer.initials, text: `Approved stub ${idx} early`, tone: "held", proof: hash() }), "Review window");
    });
  },

  /** Anyone (here, the relayer) `claim(dealId, i)` */
  claim(id: string, idx: number) {
    update(id, (d) => {
      const t = d.tranches.find((x) => x.index === idx)!;
      const when = now(1);
      const proof = hash();
      const n = setT(d, idx, { state: "released", releasedAt: when.stamp, proof });
      return push(n, { actor: "Waybill relayer", initials: "↻", text: `Paid ${usdc(t.amount)} USDC to the supplier (stub ${idx})`, tone: "released", proof }, 0);
    });
  },

  /** Buyer `dispute(dealId, i, evidenceHash)` inside the review window */
  dispute(id: string, idx: number, reason: string, files: string[] = []) {
    update(id, (d) => {
      const n = setT(d, idx, { state: "disputed" });
      const ev = push(n, { actor: d.buyer.name, initials: d.buyer.initials, text: `Disputed stub ${idx}: “${reason}”. Only this part is frozen`, tone: "hold", proof: hash() });
      const at = `19 Oct, ${ev.timeline.filter((e) => !e.upcoming).at(-1)!.at}`;
      return dropUpcoming(
        {
          ...ev,
          disputes: {
            ...(ev.disputes ?? {}),
            [idx]: {
              stub: idx,
              raisedBy: "Buyer",
              raisedAt: at,
              responseDue: later(3),
              responseClosed: false,
              decideBy: later(10),
              entries: [{ who: d.buyer.name, role: "Buyer", at, kind: "filing", text: reason, files }],
            },
          },
        },
        "Review window",
      );
    });
  },

  /** Buyer `withdrawDispute(dealId, i)`: back to review */
  withdrawDispute(id: string, idx: number) {
    update(id, (d) => {
      const n = push(setT(d, idx, { state: "in_review" }), { actor: d.buyer.name, initials: d.buyer.initials, text: `Withdrew the dispute on stub ${idx}`, tone: "neutral", proof: hash() });
      const rec = n.disputes?.[idx];
      return rec ? { ...n, disputes: { ...n.disputes, [idx]: { ...rec, withdrawn: true } } } : n;
    });
  },

  /** Supplier `respondToDispute(dealId, i, evidenceHash)` */
  respond(id: string, idx: number, text: string, files: string[] = []) {
    act.addEvidence(id, idx, "Supplier", text, files, "response");
  },

  /** Either party `appendDisputeEvidence` / `respondToDispute`: append-only, never replaces earlier evidence */
  addEvidence(id: string, idx: number, role: "Buyer" | "Supplier", text: string, files: string[], kind: DisputeEntry["kind"] = "evidence") {
    update(id, (d) => {
      const who = role === "Buyer" ? d.buyer.name : d.supplier.org.split(" ").slice(0, 2).join(" ");
      const initials = role === "Buyer" ? d.buyer.initials : d.supplier.initials;
      const verb = kind === "response" ? "Responded" : "Added evidence";
      const n = push(d, { actor: who, initials, text: `${verb} on stub ${idx}: “${text}”`, tone: "neutral", proof: hash() });
      const rec = n.disputes?.[idx];
      if (!rec) return n;
      const at = `19 Oct, ${n.timeline.filter((e) => !e.upcoming).at(-1)!.at}`;
      return { ...n, disputes: { ...n.disputes, [idx]: { ...rec, entries: [...rec.entries, { who, role, at, kind, text, files }] } } };
    });
  },

  /** Demo only: jump past the supplier's response window so the arbiter's decision can be tried */
  closeResponseWindow(id: string, idx: number) {
    update(id, (d) => {
      const rec = d.disputes?.[idx];
      if (!rec) return d;
      const n = push(d, { actor: "Response window closed", initials: "◷", text: "Demo fast-forward: the arbiter can now decide", tone: "neutral" }, 0);
      return { ...n, disputes: { ...n.disputes, [idx]: { ...rec, responseClosed: true } } };
    });
  },

  /** Arbiter `resolve(dealId, i, toSupplier)` or `resolveSplit(dealId, i, supplierBps)`: one frozen stub, two parties only */
  resolve(id: string, idx: number, outcome: "release" | "refund" | "split", reasoning: string, supplierBps = 0) {
    update(id, (d) => {
      const t = d.tranches.find((x) => x.index === idx)!;
      const proof = hash();
      const when = now(1);
      const state: Tranche["state"] = outcome === "release" ? "released" : outcome === "refund" ? "refunded" : "resolved";
      let n = setT(d, idx, { state, resolvedBy: "arbiter", splitBps: outcome === "split" ? supplierBps : undefined, releasedAt: when.stamp, proof });
      const parts = splitParts({ ...t, splitBps: supplierBps });
      const what =
        outcome === "release"
          ? `released ${usdc(t.amount)} to the supplier`
          : outcome === "refund"
            ? `refunded ${usdc(t.amount + t.fee)} to the buyer`
            : `split stub ${idx}: ${usdc(parts.toSupplier)} to the supplier, ${usdc(parts.toBuyer)} to the buyer`;
      n = push(n, { actor: d.arbiter.name, initials: d.arbiter.initials, text: `Decided stub ${idx}: ${what}. “${reasoning}”`, tone: outcome === "refund" ? "refunded" : "released", proof }, 0);
      n = dropUpcoming(n, "Arbiter deadline");
      const rec = n.disputes?.[idx];
      return {
        ...n,
        arbiterFeePaid: true,
        disputes: rec ? { ...n.disputes, [idx]: { ...rec, decision: { outcome, supplierBps, reasoning, at: `19 Oct, ${when.at}` } } } : n.disputes,
      };
    });
  },

  /** Named attestor `acceptAttestor(dealId, i)` */
  acceptRole(id: string, role: "Inspector" | "Forwarder" | "Arbiter", who: string) {
    update(id, (d) => {
      let n = { ...d, acceptances: d.acceptances.map((a) => (a.role === role ? { ...a, done: true } : a)) };
      n = push(n, { actor: who, initials: who.split(" ").map((w) => w[0]).join(""), text: role === "Arbiter" ? `Accepted as arbiter, fee ${usdc(d.arbiterFee)}` : `Accepted the ${role === "Inspector" ? "inspection" : "arrival"} statement`, tone: "neutral", proof: hash() });
      if (n.acceptances.every((a) => a.done)) {
        n = dropUpcoming({ ...n, state: "accepted" }, "Acceptance deadline");
      }
      return n;
    });
  },

  /** Attestor signs the EIP-712 statement, then `attest(dealId, i, evidenceHash, …)` is submitted */
  attest(id: string, idx: number, signer: string, files: EvidenceFile[]) {
    update(id, (d) => {
      const t = d.tranches.find((x) => x.index === idx)!;
      const when = now(2);
      const endMin = 9 * 60 + 40 + state.clock + t.reviewHours * 60;
      const endDay = 19 + Math.floor(endMin / (24 * 60));
      const endAt = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      const reviewEnds = `${endDay} Oct 2026, ${endAt} GMT`;
      let n = setT(d, idx, { state: t.reviewHours ? "in_review" : "claimable", signedBy: signer, signedAt: when.at, evidence: files, reviewEnds });
      n = { ...n, timeline: n.timeline.filter((e) => !(e.upcoming && e.actor.toLowerCase().startsWith(t.short.toLowerCase()))) };
      n = push(n, { actor: signer, initials: signer.split(" ").map((w) => w[0]).join(""), text: `Signed: ${t.title.toLowerCase()}. ${files.length} files attached`, tone: "held", proof: hash() }, 0);
      if (t.reviewHours)
        n = {
          ...n,
          timeline: [
            ...n.timeline,
            { day: `${endDay} Oct`, at: endAt, actor: "Review window ends", initials: "◷", text: `${usdc(t.amount)} USDC releases to the supplier unless ${d.buyer.name.split(" ")[0]} acts`, tone: "neutral", upcoming: true },
          ],
        };
      return n;
    });
  },

  /** Fee recipient `withdrawFees()` / arbiter `withdrawArbiterFee(dealId)`: pull to their own account only */
  withdraw(recipient: string, amount: number) {
    state = { ...state, withdrawn: { ...state.withdrawn, [recipient]: (state.withdrawn[recipient] ?? 0) + amount } };
    emit();
  },

  /** `AttestorRegistry.setProfile(name, city, agentId)` */
  setProfile(p: { name: string; city: string; agentId: string }) {
    state = { ...state, profile: p };
    emit();
  },

  /** Buyer `refund(dealId, i)` after deadline + grace */
  refund(id: string, idx: number) {
    update(id, (d) => {
      const t = d.tranches.find((x) => x.index === idx)!;
      const proof = hash();
      const n = setT(d, idx, { state: "refunded", releasedAt: now(1).stamp, proof });
      return push(n, { actor: d.buyer.name, initials: d.buyer.initials, text: `Took back ${usdc(t.amount + t.fee)} USDC (stub ${idx} and its fee)`, tone: "refunded", proof }, 0);
    });
  },

  /** Supplier `proposePayout(dealId, addr)`: takes effect only after the delay */
  proposePayout(id: string, addr: string) {
    update(id, (d) =>
      push(d, { actor: d.supplier.org.split(" ").slice(0, 2).join(" "), initials: d.supplier.initials, text: `Proposed a new payout wallet ${addr}. It applies after 48 h unless rejected`, tone: "hold", proof: hash() }),
    );
  },

  /** Off-chain preference: show buyer and supplier names on the public deal page. Addresses stay public regardless. */
  setPublicNames(id: string, on: boolean) {
    update(id, (d) => ({ ...d, publicNames: on }));
  },

  /** Buyer `cancelUnaccepted(dealId)` before funding */
  cancel(id: string) {
    update(id, (d) => push({ ...d, state: "cancelled" }, { actor: d.buyer.name, initials: d.buyer.initials, text: "Cancelled the deal before funding. Nothing was locked", tone: "neutral", proof: hash() }));
  },
};

export interface NewDealInput {
  goods: string;
  units: number;
  cartons: number;
  origin: { code: string; city: string };
  destination: { code: string; city: string };
  template: string;
  total: number;
  parts: { name: string; nameZh: string; short: string; bps: number; confirm: Confirm; reviewHours: number; due: string }[];
  supplier: { name: string; org: string };
  inspector?: { name: string; org: string };
  forwarder?: { name: string; org: string };
  feePayer: "Buyer" | "Supplier" | "Split";
  arbiterFee: number;
  acceptanceDeadline: string;
}

/** Deal ids newest-created first, then the seeded order. */
export function orderedIds(deals: Record<string, DealRecord>): string[] {
  return [...Object.keys(deals).filter((k) => !dealOrder.includes(k)).reverse(), ...dealOrder].filter((k) => deals[k]);
}

export function earnedBy(name: string) {
  return attestorEarnings(state.deals, name);
}

export function newHash(): string {
  return hash();
}
