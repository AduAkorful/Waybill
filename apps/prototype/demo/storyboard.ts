import type { Shape, Tone } from "@/components/Sketch";

/**
 * The storyboard: every priority flow as beats. One file drives both the storyboard page and the animatic,
 * so timings and intent can't drift between them. Sketches are on a 160×100 canvas; dashed arrows mean movement.
 */

export interface Beat {
  title: string;
  /** Screen id from plans/45-prototype-brief.md */
  screen: string;
  /** Motion length in ms; 0 = held, waits for the person */
  ms: number;
  onScreen: string;
  motion: string;
  why: string;
  shapes: Shape[];
}

export interface Flow {
  id: string;
  name: string;
  intent: string;
  beats: Beat[];
}

// ——— Sketch helpers ———

type StubLook = "w" | "r" | "pay" | "rel" | "ref" | "h" | "tear" | "od";
const look: Record<StubLook, { tone: Tone; torn?: boolean; rot?: number; dy?: number; dx?: number; fill?: boolean }> = {
  w: { tone: "ghost" },
  r: { tone: "held" },
  pay: { tone: "held" },
  rel: { tone: "released", torn: true, rot: -3, dy: 2 },
  ref: { tone: "refunded", torn: true, rot: 3, dy: 2 },
  h: { tone: "hold" },
  tear: { tone: "released", torn: true, rot: 9, dy: 7, dx: 3 },
  od: { tone: "hold", fill: false },
};

/** A waybill: header block, perforation, three stubs at 20/30/50. */
function wb(x: number, y: number, w: number, stubs: StubLook[], h = 24, sh = 18): Shape[] {
  const out: Shape[] = [
    { t: "doc", x, y, w, h },
    { t: "text", x: x + 3, y: y + 6, s: "WAYBILL", size: 3.6 },
    { t: "text", x: x + 3, y: y + 15, s: "CAN", size: 7 },
    { t: "text", x: x + w - 3, y: y + 15, s: "ACC", size: 7, anchor: "end" },
    { t: "rows", x: x + 3, y: y + 19, w: w - 6, n: 2, gap: 2.4 },
    { t: "perf", x, y: y + h + 1, w },
  ];
  const widths = [0.2, 0.3, 0.5];
  let cx = x;
  stubs.forEach((s, i) => {
    const sw = w * widths[i]!;
    const l = look[s];
    out.push({ t: "stub", x: cx + (l.dx ?? 0), y: y + h + 2 + (l.dy ?? 0), w: sw - 1, h: sh, tone: l.tone, torn: l.torn, rot: l.rot, fill: l.fill });
    cx += sw;
  });
  return out;
}

function phone(x: number): Shape[] {
  return [{ t: "phone", x, y: 8, w: 46, h: 86 }];
}

/** Phone with a compact waybill inside. */
function phoneWb(x: number, stubs: StubLook[]): Shape[] {
  return [...phone(x), ...wb(x + 3, 24, 40, stubs, 18, 14)];
}

const ledger = (x: number, y: number, w: number, parts: Tone[]): Shape[] => {
  const ws = [0.2, 0.3, 0.5];
  let cx = x;
  return parts.map((tone, i) => {
    const s: Shape = { t: "bar", x: cx, y, w: w * ws[i]! - 0.8, h: 2.4, tone, outline: tone === "ghost" };
    cx += w * ws[i]!;
    return s;
  });
};

// ——— Flows ———

export const flows: Flow[] = [
  {
    id: "landing",
    name: "Landing hero",
    intent: "Stage. In a few seconds a stranger should understand: money locked, released in parts, each part confirmed by someone you chose.",
    beats: [
      {
        title: "Headline resolves",
        screen: "P1",
        ms: 700,
        onScreen: "Headline, subline and two calls to action; the waybill not yet on the desk",
        motion: "Headline lines rise 12 px and sharpen from blur, 90 ms apart; highlighter sweeps left to right under “someone you trust” (420 ms) after the last line lands",
        why: "The promise is read before anything decorative moves; the highlighter draws the eye to the one idea that's new",
        shapes: [
          { t: "rows", x: 10, y: 30, w: 60, n: 3, gap: 9, tone: "ink" },
          { t: "bar", x: 18, y: 38.5, w: 40, h: 3, tone: "ghost" },
          { t: "arrow", x1: 14, y1: 42, x2: 58, y2: 42, tone: "ghost" },
          { t: "btn", x: 10, y: 66, w: 22, s: "Start a deal", filled: true, tone: "held" },
          { t: "btn", x: 35, y: 66, w: 30, s: "I got a link" },
        ],
      },
      {
        title: "The waybill lands on the desk",
        screen: "P1",
        ms: 700,
        onScreen: "The waybill, slightly turned, with its blue carbon copy behind",
        motion: "Carbon copy fades in first, then the waybill slides 40 px up and settles into its −1.2° turn (arrive ease); boxes then write in, 60 ms apart",
        why: "A document arriving on a desk is the product's metaphor in one gesture; the copy behind says two parties hold the same record",
        shapes: [
          { t: "doc", x: 92, y: 18, w: 58, h: 70, tone: "held", fill: false },
          ...wb(88, 14, 58, ["w", "w", "w"], 40, 26),
          { t: "arrow", x1: 117, y1: 96, x2: 117, y2: 84 },
        ],
      },
      {
        title: "Funds locked, first stub tears",
        screen: "P1",
        ms: 1600,
        onScreen: "FUNDS LOCKED stamp on the corner; stub 1 torn and green; stub 2 in review",
        motion: "Stamp strikes (strike ease, 260 ms); 300 ms later stub 1 tears and lands (900 ms, the one overshoot); stub 2 border tints blue. Plays once, never loops",
        why: "Shows the whole idea before the visitor scrolls: locked → confirmed → paid. Playing once respects people reading the headline",
        shapes: [
          ...wb(88, 14, 58, ["tear", "r", "w"], 40, 26),
          { t: "stamp", x: 100, y: 14, word: "LOCKED", tone: "held", rot: -10 },
          { t: "arrow", x1: 96, y1: 64, x2: 100, y2: 78, tone: "released" },
        ],
      },
    ],
  },
  {
    id: "supplier-accept",
    name: "Supplier accepts",
    intent: "The make-or-break moment: a supplier with no wallet opens a WhatsApp/WeChat link and accepts in about two minutes.",
    beats: [
      {
        title: "Link opens",
        screen: "S1",
        ms: 420,
        onScreen: "Buyer's name, the three-parts promise, the waybill with all stubs waiting",
        motion: "Promise card arrives, then the waybill's boxes, 90 ms apart, top to bottom; stubs arrive last",
        why: "Read like a document, top down; the stubs (the money) arrive last so that's where the eye settles",
        shapes: [...phoneWb(57, ["w", "w", "w"]), { t: "bar", x: 60, y: 14, w: 40, h: 6, tone: "held", outline: true }, { t: "arrow", x1: 80, y1: 70, x2: 80, y2: 58, tone: "ghost" }],
      },
      {
        title: "Switch to 中文",
        screen: "S1",
        ms: 180,
        onScreen: "Same page in Chinese; box labels bilingual",
        motion: "Text blurs out and back in place (180 ms); no layout moves",
        why: "Language changes the words, not the deal. Nothing shifting tells the supplier these are the same terms",
        shapes: [...phoneWb(57, ["w", "w", "w"]), { t: "text", x: 95, y: 16, s: "中文", size: 4, tone: "held" }, { t: "text", x: 61, y: 18, s: "想向您采购", size: 4 }],
      },
      {
        title: "Reads what unlocks each payment",
        screen: "S1",
        ms: 0,
        onScreen: "Stubs with amount and who confirms each; “If something goes wrong”; Accept pinned at the bottom",
        motion: "Held. Nothing moves while the supplier decides",
        why: "A decision about money needs stillness",
        shapes: [...phoneWb(57, ["w", "w", "w"]), { t: "btn", x: 60, y: 82, w: 40, s: "接受条款", filled: true }],
      },
      {
        title: "Payout sheet rises",
        screen: "S2",
        ms: 300,
        onScreen: "Sheet: “Where should we pay you?” Create a wallet (recommended) or paste an address",
        motion: "Sheet rises from the bottom (300 ms, arrive); waybill dims to 40% behind it",
        why: "One question at a time, with the deal still visible behind so the supplier knows what they're accepting",
        shapes: [...phoneWb(57, ["w", "w", "w"]), { t: "doc", x: 57, y: 52, w: 46, h: 42 }, { t: "btn", x: 61, y: 62, w: 38, s: "Create wallet", filled: true }, { t: "btn", x: 61, y: 72, w: 38, s: "Paste address" }, { t: "arrow", x1: 80, y1: 100, x2: 80, y2: 88 }],
      },
      {
        title: "Wallet created",
        screen: "S2",
        ms: 600,
        onScreen: "Payout address shown short, “Export key any time”, Confirm",
        motion: "Address resolves left to right from scrambled characters (600 ms); a tick draws (240 ms)",
        why: "The address is generated, not typed; watching it resolve shows it's unique and real",
        shapes: [...phone(57), { t: "doc", x: 57, y: 52, w: 46, h: 42 }, { t: "text", x: 61, y: 64, s: "0x7d3a…91c2", size: 4.4, mono: true }, { t: "tick", x: 97, y: 63 }, { t: "btn", x: 61, y: 80, w: 38, s: "Confirm", filled: true }],
      },
      {
        title: "Accepted",
        screen: "S1",
        ms: 700,
        onScreen: "ACCEPTED stamp on the supplier box; banner: “Waiting for the buyer to lock the money”",
        motion: "Sheet departs (200 ms); ACCEPTED strikes on box 02 (260 ms); banner arrives (420 ms)",
        why: "A stamp is how a waybill records consent; the banner says what happens next so the supplier isn't left wondering",
        shapes: [...phoneWb(57, ["w", "w", "w"]), { t: "stamp", x: 80, y: 34, word: "ACCEPTED", tone: "held" }, { t: "bar", x: 60, y: 14, w: 40, h: 6, tone: "ghost", outline: true }],
      },
    ],
  },
  {
    id: "fund",
    name: "Buyer funds",
    intent: "The money becomes real. Every part of the total is visible before it's signed; nothing is called success until the chain says so.",
    beats: [
      {
        title: "Last acceptance arrives",
        screen: "B3",
        ms: 420,
        onScreen: "Acceptance chips: supplier ✓, inspector ✓, forwarder ✓, arbiter ✓; Fund button enabled",
        motion: "Final chip's tick draws (240 ms); Fund button fades from disabled (180 ms)",
        why: "Funding is gated by everyone accepting; seeing the last tick explains why the button just woke up",
        shapes: [...wb(30, 12, 100, ["w", "w", "w"]), { t: "tick", x: 40, y: 64 }, { t: "tick", x: 60, y: 64 }, { t: "tick", x: 80, y: 64 }, { t: "tick", x: 100, y: 64 }, { t: "btn", x: 62, y: 76, w: 36, s: "Fund 20,250.00", filled: true, tone: "held" }],
      },
      {
        title: "Fund sheet: the total, built line by line",
        screen: "B4",
        ms: 420,
        onScreen: "Deal 20,000.00 + fee 150.00 + arbiter fee 100.00 = 20,250.00 USDC; network Arc; “Waybill cannot reverse this”",
        motion: "Sheet rises (300 ms); the three lines write in 90 ms apart; the total rule draws, then the total",
        why: "Nothing is hidden inside the total; watching it add up is the trust",
        shapes: [{ t: "doc", x: 40, y: 14, w: 80, h: 76 }, { t: "rows", x: 46, y: 28, w: 68, n: 3, gap: 8, tone: "ink" }, { t: "line", x1: 46, y1: 52, x2: 114, y2: 52 }, { t: "text", x: 114, y: 60, s: "20,250.00", size: 6, mono: true, anchor: "end" }, { t: "btn", x: 56, y: 74, w: 48, s: "Approve and fund", filled: true, tone: "held" }],
      },
      {
        title: "Waiting for the wallet",
        screen: "B4",
        ms: 0,
        onScreen: "“Confirm in your wallet. Nothing has been sent yet.”",
        motion: "Held. A slow 1.6 s breathing dot only",
        why: "We claim nothing until the wallet answers",
        shapes: [{ t: "doc", x: 40, y: 14, w: 80, h: 76 }, { t: "text", x: 80, y: 50, s: "Confirm in your wallet", size: 5, anchor: "middle" }, { t: "dot", x: 80, y: 60, ring: true }],
      },
      {
        title: "Submitted",
        screen: "B4",
        ms: 600,
        onScreen: "“Sent. Waiting for the network to confirm.” Hash shown with a link",
        motion: "Status text swaps (180 ms); hash resolves left to right (600 ms)",
        why: "A hash is not success; the calm pending state says so",
        shapes: [{ t: "doc", x: 40, y: 14, w: 80, h: 76 }, { t: "text", x: 80, y: 46, s: "Sent · waiting", size: 5, anchor: "middle" }, { t: "text", x: 80, y: 56, s: "0x4a7c…b091", size: 4.4, mono: true, anchor: "middle", tone: "ghost" }],
      },
      {
        title: "Funds locked",
        screen: "B3",
        ms: 900,
        onScreen: "FUNDS LOCKED stamp; Held in escrow 20,250.00; ledger bar fills blue; stub 1 begins paying",
        motion: "Sheet departs (200 ms); stamp strikes (260 ms); Held rolls 0.00 → 20,250.00 (500 ms) while the ledger bar fills left to right",
        why: "The one moment the money becomes real; the stamp and the rolling figure tie the number to the document",
        shapes: [...ledger(30, 8, 100, ["held", "held", "held"]), ...wb(30, 16, 100, ["pay", "w", "w"]), { t: "stamp", x: 110, y: 22, word: "LOCKED", tone: "held" }, { t: "arrow", x1: 30, y1: 5, x2: 128, y2: 5 }],
      },
      {
        title: "Supplier sees it",
        screen: "S3",
        ms: 420,
        onScreen: "Supplier's page: “20,250.00 USDC is locked. You can start production.” with proof link",
        motion: "Banner arrives (420 ms); stub 1 on their page tears and pays (900 ms) once the claim confirms",
        why: "This is the supplier's reason to start production; it must reach them the moment it's true",
        shapes: [...phoneWb(57, ["rel", "w", "w"]), { t: "bar", x: 60, y: 14, w: 40, h: 6, tone: "held" }],
      },
    ],
  },
  {
    id: "attest",
    name: "Inspector signs",
    intent: "An inspector on a factory floor uploads evidence and signs one narrow sentence, knowing it isn't a payment.",
    beats: [
      {
        title: "Evidence uploading",
        screen: "A3",
        ms: 300,
        onScreen: "Checklist: report ✓, photos ✓, carton count ✓, packing list 64%",
        motion: "Progress bar advances continuously; each finished row's tick draws (240 ms)",
        why: "Progress is information, so it moves; nothing else does",
        shapes: [...phone(57), { t: "tick", x: 63, y: 30 }, { t: "tick", x: 63, y: 38 }, { t: "tick", x: 63, y: 46 }, { t: "bar", x: 61, y: 53, w: 24, h: 1.6, tone: "held" }, { t: "bar", x: 61, y: 53, w: 38, h: 1.6, tone: "ghost", outline: true }, { t: "btn", x: 61, y: 82, w: 38, s: "Sign statement" }],
      },
      {
        title: "Last upload finishes, sign unlocks",
        screen: "A3",
        ms: 180,
        onScreen: "4 of 4; “Waiting for 1 upload” becomes “Ready to sign”; button enabled",
        motion: "Tick draws; status text swaps (180 ms); button fills (180 ms)",
        why: "The block lifts the instant its cause is gone",
        shapes: [...phone(57), { t: "tick", x: 63, y: 30 }, { t: "tick", x: 63, y: 38 }, { t: "tick", x: 63, y: 46 }, { t: "tick", x: 63, y: 54 }, { t: "btn", x: 61, y: 82, w: 38, s: "Sign statement", filled: true }],
      },
      {
        title: "The sentence fills in",
        screen: "A3",
        ms: 700,
        onScreen: "Statement with its blanks filled: deal, sampling method, 480 cartons, goods, date",
        motion: "Blanks write in left to right, 60 ms apart (420 ms each)",
        why: "The inspector watches exactly which words they are putting their name to",
        shapes: [...phone(57), { t: "doc", x: 60, y: 20, w: 40, h: 34 }, { t: "rows", x: 63, y: 28, w: 34, n: 4, gap: 6, tone: "ink" }, { t: "bar", x: 72, y: 26.6, w: 12, h: 2.6, tone: "held" }, { t: "bar", x: 66, y: 38.6, w: 16, h: 2.6, tone: "held" }, { t: "arrow", x1: 66, y1: 58, x2: 96, y2: 58 }],
      },
      {
        title: "Wallet signature",
        screen: "A3",
        ms: 0,
        onScreen: "“Signing is not a payment. Bound to WB-0427, stub 2, usable once.”",
        motion: "Held",
        why: "The irreversible step waits for a person",
        shapes: [...phone(57), { t: "doc", x: 60, y: 30, w: 40, h: 30 }, { t: "text", x: 80, y: 44, s: "Sign in wallet", size: 4.4, anchor: "middle" }],
      },
      {
        title: "Sealed",
        screen: "A3",
        ms: 700,
        onScreen: "Signature line drawn under the statement; SIGNED stamp; “Ama has 12 h to review”",
        motion: "Signature stroke draws (700 ms); SIGNED strikes (260 ms); next-step line arrives",
        why: "Signing is a small ceremony, but nothing about money moves; the next-step line says who acts now",
        shapes: [...phone(57), { t: "doc", x: 60, y: 20, w: 40, h: 34 }, { t: "rows", x: 63, y: 28, w: 34, n: 3, gap: 6 }, { t: "step", pts: [[64, 48], [70, 44], [74, 49], [80, 45], [86, 48]], tone: "ink" }, { t: "stamp", x: 88, y: 40, word: "SIGNED", tone: "held" }],
      },
    ],
  },
  {
    id: "release",
    name: "Approve and release",
    intent: "The signature moment. The buyer approves the inspection and watches stub 2 tear away to the supplier.",
    beats: [
      {
        title: "The decision appears on its stub",
        screen: "B3",
        ms: 420,
        onScreen: "Stub 2 outlined blue, highlighter on “9 h left”, Review evidence / Dispute",
        motion: "Stub 2 outline draws in (300 ms); its action block arrives (420 ms); highlighter sweeps (420 ms)",
        why: "One decision, placed on the money it affects; the highlighter is the only yellow on the page",
        shapes: [...ledger(30, 8, 100, ["released", "held", "ghost"]), ...wb(30, 16, 100, ["rel", "r", "w"]), { t: "bar", x: 54, y: 52, w: 14, h: 2.4, tone: "ghost" }],
      },
      {
        title: "Evidence beside the statement",
        screen: "B5",
        ms: 300,
        onScreen: "Panel: the signed sentence, 4 files with fingerprints, photos",
        motion: "Panel slides in from the right (300 ms); files arrive 90 ms apart",
        why: "The buyer checks the evidence against the exact words that were signed",
        shapes: [...wb(10, 16, 84, ["rel", "r", "w"]), { t: "doc", x: 100, y: 10, w: 52, h: 80 }, { t: "rows", x: 104, y: 22, w: 44, n: 3, gap: 5, tone: "ink" }, { t: "bar", x: 104, y: 42, w: 20, h: 14, tone: "ghost", outline: true }, { t: "bar", x: 128, y: 42, w: 20, h: 14, tone: "ghost", outline: true }, { t: "arrow", x1: 158, y1: 50, x2: 150, y2: 50 }],
      },
      {
        title: "Approve and release",
        screen: "B5",
        ms: 0,
        onScreen: "Confirm: “Release 6,000.00 USDC to Baiyun Brightpower now. This can't be undone.”",
        motion: "Held",
        why: "Irreversible, so it waits",
        shapes: [{ t: "doc", x: 40, y: 24, w: 80, h: 52 }, { t: "text", x: 80, y: 42, s: "Release 6,000.00 now?", size: 5, anchor: "middle" }, { t: "btn", x: 52, y: 58, w: 56, s: "Approve and release", filled: true, tone: "held" }],
      },
      {
        title: "Paying supplier",
        screen: "B3",
        ms: 300,
        onScreen: "Stub 2 filled blue, label “Paying supplier…”, hash shown",
        motion: "Stub fill deepens (300 ms); label swaps (180 ms)",
        why: "Approving isn't paying; the honest in-between state",
        shapes: [...wb(30, 16, 100, ["rel", "pay", "w"]), { t: "text", x: 66, y: 56, s: "Paying…", size: 4, tone: "held" }],
      },
      {
        title: "Stub 2 tears",
        screen: "B3",
        ms: 900,
        onScreen: "Stub 2 torn and green with RELEASED; Released 10,000.00; Held 10,175.00; ledger segment green",
        motion: "Perforation gives (270 ms), stub pulls away past its resting place (360 ms), lands with the one overshoot (450 ms). RELEASED strikes as it lands; figures roll (500 ms); ledger segment turns green",
        why: "Money leaving escrow is physical and irreversible. It is the product's single cinematic moment",
        shapes: [...ledger(30, 8, 100, ["released", "released", "ghost"]), ...wb(30, 16, 100, ["rel", "tear", "w"]), { t: "stamp", x: 74, y: 56, word: "RELEASED" }, { t: "arrow", x1: 64, y1: 46, x2: 70, y2: 62, tone: "released" }],
      },
      {
        title: "Supplier paid",
        screen: "S4",
        ms: 420,
        onScreen: "Supplier's page: stub 2 paid 6,000.00 with proof; timeline row",
        motion: "Timeline row arrives (420 ms); their stub shows torn at rest",
        why: "Both sides see the same document change",
        shapes: [...phoneWb(57, ["rel", "rel", "w"]), { t: "rows", x: 61, y: 70, w: 38, n: 2, gap: 5, tone: "released" }],
      },
    ],
  },
  {
    id: "dispute",
    name: "Dispute and decision",
    intent: "Something's wrong on arrival. One stub freezes, both sides give evidence, the arbiter picks one of two outcomes.",
    beats: [
      {
        title: "Dispute form",
        screen: "B6",
        ms: 300,
        onScreen: "Reason, photos required; “Only stub 3 (10,000.00) freezes. Stubs 1–2 stay paid.”",
        motion: "Sheet rises (300 ms); the freeze sentence arrives last (420 ms)",
        why: "Says the scope of the freeze before the buyer commits to it",
        shapes: [{ t: "doc", x: 40, y: 14, w: 80, h: 76 }, { t: "rows", x: 46, y: 26, w: 68, n: 2, gap: 8 }, { t: "bar", x: 46, y: 44, w: 20, h: 12, tone: "ghost", outline: true }, { t: "btn", x: 56, y: 74, w: 48, s: "Raise dispute", tone: "hold" }],
      },
      {
        title: "Stub 3 held",
        screen: "B3",
        ms: 700,
        onScreen: "HELD stamp on stub 3 only; stubs 1 and 2 unchanged; response countdown 72 h",
        motion: "Stub 3 outline turns red (300 ms); HELD strikes (260 ms). Stubs 1 and 2 do not move at all",
        why: "Stillness elsewhere is the message: a dispute freezes one part",
        shapes: [...wb(30, 16, 100, ["rel", "rel", "h"]), { t: "stamp", x: 104, y: 52, word: "HELD", tone: "hold" }],
      },
      {
        title: "Supplier responds",
        screen: "S5",
        ms: 420,
        onScreen: "Dispute room thread: buyer filing, supplier response with files, both timestamped",
        motion: "Response arrives in the thread (420 ms)",
        why: "Evidence, not chat: an ordered record both sides and the arbiter read",
        shapes: [...phone(57), { t: "doc", x: 60, y: 18, w: 34, h: 14, tone: "hold", fill: false }, { t: "doc", x: 66, y: 38, w: 34, h: 14 }, { t: "arrow", x1: 83, y1: 64, x2: 83, y2: 54, tone: "ghost" }],
      },
      {
        title: "Arbiter decides",
        screen: "R2",
        ms: 0,
        onScreen: "Both sides' evidence; Release to supplier / Refund to buyer; written reasoning required",
        motion: "Held",
        why: "Only the allowed outcomes are on screen, and nothing moves while a person judges",
        shapes: [{ t: "doc", x: 10, y: 14, w: 66, h: 72 }, { t: "doc", x: 84, y: 14, w: 66, h: 72 }, { t: "btn", x: 30, y: 90, w: 46, s: "Release to supplier" }, { t: "btn", x: 84, y: 90, w: 46, s: "Refund to buyer", tone: "refunded" }],
      },
      {
        title: "Resolved: stub tears to the buyer",
        screen: "B3",
        ms: 900,
        onScreen: "Stub 3 torn the other way, pink REFUNDED; Refunded 10,075.00",
        motion: "Same tear, mirrored direction (900 ms); REFUNDED strikes; Refunded figure rolls",
        why: "The same gesture for every outcome; only the direction says who got the money",
        shapes: [...wb(30, 16, 100, ["rel", "rel", "ref"]), { t: "stamp", x: 104, y: 56, word: "REFUNDED", tone: "refunded" }, { t: "arrow", x1: 110, y1: 46, x2: 102, y2: 62, tone: "refunded" }],
      },
    ],
  },
  {
    id: "refund",
    name: "Missed deadline",
    intent: "Arrival is never confirmed. A calm grace period, then the buyer takes the money back without anyone's signature.",
    beats: [
      {
        title: "Deadline passes",
        screen: "B3",
        ms: 300,
        onScreen: "Stub 3 outline dashed; “Overdue · 72 h grace”; countdown",
        motion: "Outline changes to dashed (300 ms); label swaps (180 ms). No flashing, no shake",
        why: "A grace period is a safety delay, so it looks calm and slow on purpose",
        shapes: [...wb(30, 16, 100, ["rel", "rel", "od"]), { t: "text", x: 104, y: 56, s: "72 h grace", size: 4, tone: "hold" }],
      },
      {
        title: "Grace running",
        screen: "B3",
        ms: 0,
        onScreen: "Countdown; “The supplier can still dispute until 13 Dec 23:59”",
        motion: "Held. Countdown ticks by the minute",
        why: "Both parties see the same clock",
        shapes: [...wb(30, 16, 100, ["rel", "rel", "od"]), { t: "bar", x: 82, y: 58, w: 30, h: 1.6, tone: "hold" }],
      },
      {
        title: "Refundable",
        screen: "B3",
        ms: 300,
        onScreen: "“Refundable”; Refund 10,075.00 button on stub 3",
        motion: "Label swaps (180 ms); button arrives (300 ms)",
        why: "The right appears exactly when it's earned",
        shapes: [...wb(30, 16, 100, ["rel", "rel", "od"]), { t: "btn", x: 84, y: 54, w: 36, s: "Refund 10,075.00", tone: "refunded" }],
      },
      {
        title: "Refund sheet",
        screen: "B7",
        ms: 300,
        onScreen: "Principal 10,000.00 + fee 75.00 to your refund address",
        motion: "Sheet rises; the two lines write in",
        why: "The buyer sees principal and fee returned separately",
        shapes: [{ t: "doc", x: 40, y: 20, w: 80, h: 60 }, { t: "rows", x: 46, y: 34, w: 68, n: 2, gap: 8, tone: "ink" }, { t: "btn", x: 56, y: 64, w: 48, s: "Refund to me", filled: true, tone: "refunded" }],
      },
      {
        title: "Stub 3 comes back",
        screen: "B3",
        ms: 900,
        onScreen: "Stub 3 torn toward the buyer, REFUNDED; Refunded 10,075.00",
        motion: "Mirrored tear (900 ms); stamp; figure rolls",
        why: "Same gesture, other direction",
        shapes: [...wb(30, 16, 100, ["rel", "rel", "ref"]), { t: "stamp", x: 104, y: 56, word: "REFUNDED", tone: "refunded" }],
      },
    ],
  },
  {
    id: "build",
    name: "Build and share",
    intent: "A buyer turns a WhatsApp agreement into a deal and a link in a few minutes.",
    beats: [
      {
        title: "Pick a template",
        screen: "B2",
        ms: 420,
        onScreen: "Templates; Standard 20/30/50 chosen; the split bar fills 20 / 30 / 50",
        motion: "Bar segments grow left to right, 90 ms apart (420 ms)",
        why: "The template is understood as a split of money before any form field",
        shapes: [{ t: "doc", x: 10, y: 12, w: 40, h: 20, tone: "held" }, { t: "doc", x: 56, y: 12, w: 40, h: 20 }, { t: "doc", x: 102, y: 12, w: 40, h: 20 }, ...ledger(10, 44, 132, ["held", "held", "held"]), { t: "arrow", x1: 10, y1: 52, x2: 140, y2: 52 }],
      },
      {
        title: "Adjust the split",
        screen: "B2",
        ms: 180,
        onScreen: "Dragging a divider; amounts update; total must stay 100%",
        motion: "Segments follow the pointer; if the total isn't 100% the bar outline turns red and Share is blocked with the reason",
        why: "Direct manipulation of money proportions, with the rule visible",
        shapes: [...ledger(10, 44, 132, ["held", "held", "held"]), { t: "line", x1: 76, y1: 38, x2: 76, y2: 52, tone: "ink", w: 1.2 }, { t: "arrow", x1: 70, y1: 58, x2: 84, y2: 58, tone: "ghost" }],
      },
      {
        title: "Plain-language summary",
        screen: "B2",
        ms: 420,
        onScreen: "“Ama pays 20,250.00. The supplier receives 4,000.00 when they accept…” one line per stub",
        motion: "Lines write in 90 ms apart",
        why: "The buyer reads the deal as sentences before sharing it",
        shapes: [{ t: "doc", x: 20, y: 14, w: 120, h: 70 }, { t: "rows", x: 28, y: 28, w: 104, n: 5, gap: 8, tone: "ink" }],
      },
      {
        title: "Share the link",
        screen: "B2",
        ms: 300,
        onScreen: "Link card; Send on WhatsApp / WeChat / copy",
        motion: "Card arrives (300 ms); copy confirms with a tick",
        why: "Ends where the deal began: in the chat",
        shapes: [{ t: "doc", x: 40, y: 26, w: 80, h: 44 }, { t: "text", x: 80, y: 42, s: "waybill.demo/d/WB-0427", size: 4, mono: true, anchor: "middle" }, { t: "btn", x: 46, y: 54, w: 32, s: "WhatsApp", filled: true }, { t: "btn", x: 82, y: 54, w: 32, s: "WeChat" }],
      },
    ],
  },
];
