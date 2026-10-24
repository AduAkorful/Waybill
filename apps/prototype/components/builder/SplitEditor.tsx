"use client";

import { useRef } from "react";
import { usdc } from "@/demo/format";

export interface SplitPart {
  name: string;
  bps: number;
}

const STEP = 100; // 1%
const MIN = 100;

/**
 * The deal total as one bar. Drag a divider (or focus it and use the arrow keys) to move money between two
 * neighbouring parts; the total always stays 100%. Typing a percentage in the rows below can break the sum,
 * and then the bar says so and the builder blocks.
 */
export function SplitEditor({ parts, total, onChange }: { parts: SplitPart[]; total: number; onChange: (bps: number[]) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const sum = parts.reduce((s, p) => s + p.bps, 0);
  const ok = sum === 10_000;

  const move = (i: number, boundary: number) => {
    // boundary is the cumulative bps at the divider after part i
    const before = parts.slice(0, i).reduce((s, p) => s + p.bps, 0);
    const pair = parts[i]!.bps + parts[i + 1]!.bps;
    const left = Math.min(pair - MIN, Math.max(MIN, Math.round((boundary - before) / STEP) * STEP));
    const next = parts.map((p) => p.bps);
    next[i] = left;
    next[i + 1] = pair - left;
    onChange(next);
  };

  const onPointer = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = bar.current!.getBoundingClientRect();
    const drag = (ev: PointerEvent) => move(i, ((ev.clientX - rect.left) / rect.width) * sum);
    const up = () => {
      window.removeEventListener("pointermove", drag);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", drag);
    window.addEventListener("pointerup", up);
  };

  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    const before = parts.slice(0, i + 1).reduce((s, p) => s + p.bps, 0);
    move(i, before + d * (e.shiftKey ? 5 : 1) * STEP);
  };

  let run = 0;
  return (
    <div>
      <div ref={bar} className={`relative flex h-14 gap-0.5 rounded-md p-1 ${ok ? "" : "outline outline-2 outline-hold"}`}>
        {parts.map((p, i) => {
          run += p.bps;
          return (
            <div key={i} className="contents">
              <div
                data-seg={i}
                className="flex min-w-0 flex-col justify-center rounded-[4px] bg-held px-2.5 text-sheet"
                style={{ flexGrow: Math.max(p.bps, 1), flexBasis: 0, opacity: 1 - i * 0.12 }}
              >
                <span className="truncate text-[12px] font-semibold">{p.bps / 100}%</span>
                <span className="mono truncate text-[11px] opacity-90">{usdc(Math.round((total * p.bps) / 10_000))}</span>
              </div>
              {i < parts.length - 1 ? (
                <button
                  type="button"
                  role="slider"
                  aria-label={`Move money between “${p.name || `part ${i + 1}`}” and “${parts[i + 1]!.name || `part ${i + 2}`}”`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={run / 100}
                  aria-valuetext={`${run / 100}% of the total is before this divider`}
                  onPointerDown={onPointer(i)}
                  onKeyDown={onKey(i)}
                  className="group relative z-10 -mx-2.5 w-6 shrink-0 cursor-ew-resize touch-none focus-visible:outline-none"
                >
                  <span className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded bg-ink/70 group-hover:bg-ink group-focus-visible:bg-ink group-focus-visible:ring-2 group-focus-visible:ring-ink/40" />
                  <span aria-hidden className="absolute top-1/2 left-1/2 grid h-6 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-paper text-[9px] text-ink shadow ring-1 ring-ink/40">⋮</span>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className={`mt-2 text-[12.5px] ${ok ? "text-graphite" : "font-semibold text-hold"}`} role={ok ? undefined : "alert"}>
        {ok ? "Parts add up to 100%. Drag a divider, or use the arrow keys on one, to move money between two parts." : `Parts add up to ${sum / 100}%. Make them 100% to continue.`}
      </p>
    </div>
  );
}
