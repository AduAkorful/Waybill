import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { digitPos } from "@/view/format";
import { placeShown } from "./Odometer";

/**
 * Motion system. Only changes to money, trust, time and progress move. Every animation runs *from* an earlier state
 * *to* the designed screen, so the resting markup is always the finished state and reduced motion simply shows it.
 */

/** Durations in seconds */
export const D = {
  /** Ticks, presses, a checkbox */
  tick: 0.12,
  /** Digits rolling a step, hover, label swaps */
  quick: 0.18,
  /** Default workbench change: a panel, a chip, a sheet step */
  base: 0.3,
  /** A row or card arriving */
  arrive: 0.42,
  /** Figures rolling to a new total; shared moves */
  move: 0.5,
  /** Signature beats: a stamp landing with its context, a statement sealing */
  deliberate: 0.7,
  /** The one cinematic moment: the stub tear */
  cinematic: 0.9,
} as const;

/** Stagger between siblings, seconds */
export const S = {
  /** Words filling a statement's blanks */
  field: 0.06,
  /** Boxes, stubs, timeline rows */
  row: 0.09,
  /** Characters of a hash or code */
  letter: 0.035,
} as const;

/** Named eases. Cubic ones are mirrored as CSS variables in globals.css. */
export const EASES = {
  /** Entering: fast start, long soft landing */
  arrive: "0.16, 1, 0.3, 1",
  /** State changes inside a view */
  settle: "0.2, 0, 0, 1",
  /** Leaving */
  depart: "0.4, 0, 1, 1",
  /** The stub landing after it tears: the product's single overshoot */
  tear: "M0,0 C0.24,0 0.14,1.08 0.6,1.04 0.8,1.01 0.9,1 1,1",
  /** A rubber stamp striking: overshoot in, quick settle */
  strike: "M0,0 C0.25,0.4 0.35,1.12 0.55,1.06 0.75,1 0.85,1 1,1",
} as const;

export type EaseName = keyof typeof EASES;
export const E = (name: EaseName) => `wb.${name}`;

let registered = false;
export function registerMotion() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(CustomEase);
  for (const [name, def] of Object.entries(EASES)) {
    const path = def.startsWith("M")
      ? def
      : (() => {
          const [x1, y1, x2, y2] = def.split(",").map((n) => n.trim());
          return `M0,0 C${x1},${y1} ${x2},${y2} 1,1`;
        })();
    CustomEase.create(`wb.${name}`, path);
  }
  registered = true;
}

export const PRINCIPLES = [
  "The finished screen is the design; motion runs to it.",
  "Only money, trust, time and progress move.",
  "Workbench motion is 150–300 ms. Nothing plays for its own sake.",
  "Safety delays look slow on purpose: countdowns are calm, visible and never flash.",
  "One overshoot and one cinematic moment: the stub tear.",
  "A dispute moves one stub only; everything else stays still.",
];

/** What each motion becomes when the person asks for less */
export const REDUCED: { motion: string; becomes: string }[] = [
  { motion: "Rows, boxes and timeline events arriving", becomes: "Appear in place (150 ms fade)" },
  { motion: "Figures rolling", becomes: "Final figure shown" },
  { motion: "Stamps striking", becomes: "Stamp shown, no scale" },
  { motion: "Statement blanks writing in, signature drawing", becomes: "Shown complete" },
  { motion: "The stub tear", becomes: "Stub shown torn, in its resting place" },
  { motion: "Sheets rising", becomes: "Cut to the sheet" },
  { motion: "Countdowns and progress bars", becomes: "Unchanged (they're information)" },
];

// ——— Helpers used by scenes. Each adds `from` motion at `at`, ending on the markup's own state. ———

type Tl = gsap.core.Timeline;
type Pos = gsap.Position;

/** An Odometer rolls from `from` to the value in its data-to attribute, digit columns like a mechanical counter. */
export function rollOdo(tl: Tl, root: Element | null | undefined, from: number, at: Pos, dur: number = D.move) {
  if (!root) return;
  const to = Number((root as HTMLElement).dataset.to);
  const cols = Array.from(root.querySelectorAll<HTMLElement>("[data-k]"));
  const boxes = Array.from(root.querySelectorAll<HTMLElement>("[data-col]"));
  const seps = Array.from(root.querySelectorAll<HTMLElement>("[data-sep]"));
  let v = to;
  const proxy = {
    get v() {
      return v;
    },
    set v(x: number) {
      v = x;
      for (const c of cols) c.style.transform = `translateY(${-digitPos(x, Number(c.dataset.k))}em)`;
      for (const b of boxes) b.style.width = placeShown(x, Number(b.dataset.col)) ? "0.6em" : "0px";
      for (const s of seps) s.style.width = placeShown(x, Number(s.dataset.sep)) ? "" : "0px";
    },
  };
  tl.fromTo(proxy, { v: from }, { v: to, duration: dur, ease: E("settle") }, at);
}

/** Text resolves from scrambled characters to its own content, left to right (hashes, addresses) */
export function resolveText(tl: Tl, el: Element | null | undefined, at: Pos, dur = 0.6, alphabet = "0123456789abcdef") {
  if (!el) return;
  const final = el.textContent ?? "";
  const noise = Array.from(final, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]!);
  let p = 1;
  const proxy = {
    get v() {
      return p;
    },
    set v(x: number) {
      p = x;
      const n = Math.floor(x * final.length);
      el.textContent =
        final.slice(0, n) + Array.from(final.slice(n), (c, i) => (/[\s…·.↗x]/.test(c) ? c : noise[n + i])).join("");
    },
  };
  tl.fromTo(proxy, { v: 0 }, { v: 1, duration: dur, ease: "none" }, at);
}

/** A line of text or a blank writes in left to right */
export function writeIn(tl: Tl, targets: gsap.TweenTarget, at: Pos, stagger: number = S.field) {
  tl.fromTo(
    targets,
    { clipPath: "inset(0 100% 0 0)" },
    { clipPath: "inset(0 0% 0 0)", duration: D.arrive, ease: E("settle"), stagger },
    at,
  );
}

/** SVG strokes draw on; paths need pathLength="1" and stroke-dasharray 1 */
export function draw(tl: Tl, targets: gsap.TweenTarget, at: Pos, dur: number = D.deliberate) {
  tl.fromTo(targets, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: dur, ease: E("settle") }, at);
}

/** A stamp strikes */
export function strike(tl: Tl, targets: gsap.TweenTarget, at: Pos) {
  tl.from(targets, { scale: 1.18, opacity: 0, duration: D.quick + 0.08, ease: E("strike") }, at);
}

/** Something arrives from an offset */
export function arrive(tl: Tl, targets: gsap.TweenTarget, at: Pos, vars: gsap.TweenVars = {}) {
  tl.from(targets, { opacity: 0, y: 14, duration: D.arrive, ease: E("arrive"), stagger: S.row, ...vars }, at);
}

/** A sheet rises from the bottom edge */
export function rise(tl: Tl, targets: gsap.TweenTarget, at: Pos) {
  tl.from(targets, { yPercent: 100, duration: D.base, ease: E("arrive") }, at);
}

/** Quick label/state swap: old state blurs out, new one blurs in */
export function swap(tl: Tl, targets: gsap.TweenTarget, at: Pos) {
  tl.from(targets, { opacity: 0, filter: "blur(4px)", y: 4, duration: D.quick, ease: E("settle") }, at);
}

/**
 * The stub tear. The perforation gives (clip-path goes from straight to torn edge), the stub pulls away past its
 * resting place, then lands with the product's one overshoot. Ends exactly on the stub's markup.
 */
let tearCount = 0;
export function tear(tl: Tl, stub: Element | null | undefined, at: Pos, straight: string, torn: string, dir: 1 | -1 = 1) {
  if (!stub) return;
  const el = stub as HTMLElement;
  const label = `tear${tearCount++}`;
  tl.addLabel(label, at);
  // Resting pose must match Stub.tsx: released leans left of centre, refunded the other way.
  const rest = dir === 1 ? { x: 3, y: 9, rotation: -1.2 } : { x: -3, y: 9, rotation: 1.4 };
  tl.fromTo(el, { clipPath: straight }, { clipPath: torn, duration: D.cinematic * 0.3, ease: "power2.in" }, label);
  tl.fromTo(
    el,
    { x: 0, y: 0, rotation: 0 },
    { x: dir * 16, y: 34, rotation: dir * 5, duration: D.cinematic * 0.4, ease: E("depart") },
    `${label}+=${D.cinematic * 0.22}`,
  );
  tl.to(el, { ...rest, duration: D.cinematic * 0.5, ease: E("tear") }, ">");
}
