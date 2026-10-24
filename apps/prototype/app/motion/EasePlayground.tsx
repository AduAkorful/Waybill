"use client";

import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { D, E, EASES, registerMotion, S, type EaseName } from "@/components/motion";

const easeUse: Record<EaseName, string> = {
  arrive: "Rows, cards, sheets and panels entering",
  settle: "State changes inside a view: fills, outlines, figures rolling",
  depart: "Sheets and panels leaving",
  tear: "The stub landing after it tears. The only overshoot in the product",
  strike: "Rubber stamps: LOCKED, RELEASED, HELD, REFUNDED, SIGNED",
};

function EaseRow({ name }: { name: EaseName }) {
  const dot = useRef<HTMLSpanElement>(null);
  // The curve depends on GSAP's parsed ease, which only exists in the browser; draw it after mount.
  const [pts, setPts] = useState("");
  useEffect(() => {
    registerMotion();
    const ease = gsap.parseEase(E(name));
    setPts(
      Array.from({ length: 41 }, (_, i) => {
        const t = i / 40;
        return `${i === 0 ? "M" : "L"} ${4 + t * 92} ${46 - ease(t) * 38}`;
      }).join(" "),
    );
  }, [name]);

  const play = () => {
    if (!dot.current) return;
    gsap.fromTo(dot.current, { left: "0%" }, { left: "100%", duration: name === "tear" ? D.cinematic : D.deliberate, ease: E(name) });
  };

  return (
    <li className="grid items-center gap-4 border-b border-rule py-4 md:grid-cols-[10rem_7rem_minmax(0,1fr)_auto]">
      <div>
        <p className="mono text-[13.5px] font-medium">{name}</p>
        <p className="mono text-[11px] text-graphite">{EASES[name].startsWith("M") ? "custom path" : `cubic-bezier(${EASES[name]})`}</p>
      </div>
      <svg viewBox="0 0 100 50" className="h-14 w-28 rounded border border-rule bg-sheet" aria-hidden>
        <line x1="4" y1="8" x2="96" y2="8" stroke="var(--rule)" strokeDasharray="2 2" />
        {pts ? <path d={pts} fill="none" stroke="var(--held)" strokeWidth="1.6" /> : null}
      </svg>
      <div>
        <p className="text-[13.5px]">{easeUse[name]}</p>
        <div className="relative mt-3 h-3 rounded-full bg-rule/60">
          <span ref={dot} className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-held" style={{ left: "0%" }} />
        </div>
      </div>
      <button onClick={play} className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] hover:bg-sheet">
        Play
      </button>
    </li>
  );
}

export function Durations() {
  const max = D.cinematic;
  return (
    <ul className="space-y-2.5">
      {(Object.keys(D) as (keyof typeof D)[]).map((k) => (
        <li key={k} className="grid grid-cols-[7rem_4rem_minmax(0,1fr)] items-center gap-3 text-[13px]">
          <span className="mono">{k}</span>
          <span className="mono text-right text-graphite">{Math.round(D[k] * 1000)} ms</span>
          <span className="h-2 rounded-full bg-held/80" style={{ width: `${(D[k] / max) * 100}%` }} />
        </li>
      ))}
    </ul>
  );
}

export function Staggers() {
  return (
    <ul className="space-y-1.5 text-[13px]">
      {(Object.keys(S) as (keyof typeof S)[]).map((k) => (
        <li key={k} className="flex gap-3">
          <span className="mono w-16">{k}</span>
          <span className="mono w-16 text-graphite">{Math.round(S[k] * 1000)} ms</span>
          <span className="text-graphite">{k === "row" ? "boxes, stubs, timeline rows" : k === "field" ? "statement blanks, sheet lines" : "hash and code characters"}</span>
        </li>
      ))}
    </ul>
  );
}

export function EasePlayground() {
  return (
    <ul className="border-t border-rule">
      {(Object.keys(EASES) as EaseName[]).map((n) => (
        <EaseRow key={n} name={n} />
      ))}
    </ul>
  );
}
