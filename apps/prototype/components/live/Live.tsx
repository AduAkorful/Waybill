"use client";

import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";
import type { Tranche } from "@/demo/deal";
import { straightTop, tornTop } from "@/demo/tear";
import { Ledger } from "../Ledger";
import { arrive, D, E, registerMotion, rollOdo, strike, swap, tear } from "../motion";
import { Waybill, type WaybillInfo } from "../Waybill";

const reduce = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A waybill that animates its own state changes. The markup always renders the new state; on change, motion runs
 * from the old one: a stub tears when it's paid or refunded, a stamp strikes when it's frozen.
 */
export function LiveWaybill(props: React.ComponentProps<typeof Waybill> & { info: WaybillInfo; ts: Tranche[] }) {
  const root = useRef<HTMLDivElement>(null);
  const prev = useRef<Record<number, string> | null>(null);

  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = Object.fromEntries(props.ts.map((t) => [t.index, t.state]));
    if (!before || !root.current || reduce()) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.addLabel("s", 0);
      for (const t of props.ts) {
        const was = before[t.index];
        if (was === t.state) continue;
        const card = root.current!.querySelector(`[data-stub-card="${t.index}"]`);
        const seed = `${props.info.id}-${t.index}`;
        if (t.state === "released" || t.state === "refunded") {
          tear(tl, card, "s", straightTop(seed), tornTop(seed), t.state === "released" ? 1 : -1);
          strike(tl, card?.querySelectorAll("[data-stamp]") ?? [], `s+=${D.cinematic * 0.85}`);
        } else if (t.state === "disputed") {
          tl.from(card, { boxShadow: "0 0 0 0px var(--hold)", duration: D.base, ease: E("settle") }, "s");
          strike(tl, card?.querySelectorAll("[data-stamp]") ?? [], "s+=0.15");
          arrive(tl, card?.querySelectorAll("[data-action]") ?? [], "s+=0.25", { y: 6 });
        } else {
          swap(tl, card?.querySelectorAll("header, [data-action]") ?? [], "s");
        }
      }
    }, root);
    return () => ctx.revert();
  }, [props.ts, props.info.id]);

  return (
    <div ref={root}>
      <Waybill {...props} />
    </div>
  );
}

/** A ledger whose three figures roll from their previous values when the deal changes. */
export function LiveLedger(props: React.ComponentProps<typeof Ledger>) {
  const root = useRef<HTMLDivElement>(null);
  const prev = useRef<{ held: number; released: number; refunded: number } | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = (sel: string) => Number((el.querySelector(`${sel} [data-odo]`) as HTMLElement | null)?.dataset.to ?? 0);
    const now = { held: read("[data-held]"), released: read("[data-released]"), refunded: read("[data-refunded]") };
    const before = prev.current;
    prev.current = now;
    if (!before || reduce()) return;
    if (before.held === now.held && before.released === now.released && before.refunded === now.refunded) return;
    registerMotion();
    const ctx = gsap.context(() => {
      // Figures move as the stub lands, not before it tears
      const tl = gsap.timeline({ delay: D.cinematic * 0.75 });
      (["held", "released", "refunded"] as const).forEach((k) => {
        if (before[k] !== now[k]) rollOdo(tl, el.querySelector(`[data-${k}] [data-odo]`), before[k], 0);
      });
      tl.from(el.querySelectorAll("[data-ledger-seg]"), { opacity: 0.5, duration: D.base, ease: E("settle") }, 0);
    }, root);
    return () => ctx.revert();
    // Re-run only when the money actually moves, so an unrelated re-render can't cut a roll short
  }, [props.ts.map((t) => t.state).join(","), props.refunded, props.held]);

  return (
    <div ref={root}>
      <Ledger {...props} />
    </div>
  );
}
