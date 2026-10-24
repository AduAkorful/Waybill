"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { registerMotion } from "@/components/motion";

/**
 * Generic animatic player. Give it the storyboard flows (beats with timings) and, per flow, one scene per beat.
 * Each scene renders its END state and adds `from` motion to a sub-timeline. The player sequences scenes, holds each
 * end state so it can be read, and offers a scrubber, beat markers, half speed and a reduced-motion preview.
 */

export interface AnimaticBeat {
  title: string;
  /** Motion length in ms; 0 = a held state that waits for the person */
  ms: number;
  motion: string;
}
export interface AnimaticFlow {
  id: string;
  name: string;
  beats: AnimaticBeat[];
}
export interface Scene {
  render: () => ReactNode;
  build: (tl: gsap.core.Timeline, q: (sel: string) => Element[], at: string) => void;
}

interface Mark {
  at: number;
  title: string;
  motion: string;
}

export function Player({
  flows,
  scenes,
  initialFlow,
  stage = { width: 1280, height: 800 },
  dwell = 1.3,
  held = 2.2,
}: {
  initialFlow?: string;
  flows: AnimaticFlow[];
  scenes: Record<string, Scene[]>;
  stage?: { width: number; height: number };
  /** Seconds each beat's end state stays on screen; `held` for beats that wait for the person */
  dwell?: number;
  held?: number;
}) {
  const [flowId, setFlowId] = useState(flows.some((f) => f.id === initialFlow) ? initialFlow! : flows[0]!.id);
  const [playing, setPlaying] = useState(true);
  const [slow, setSlow] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [progress, setProgress] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [total, setTotal] = useState(0);
  const [scale, setScale] = useState(1);

  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const flow = flows.find((f) => f.id === flowId)!;
  const flowScenes = scenes[flowId] ?? [];

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, entry!.contentRect.width / stage.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage.width]);

  useLayoutEffect(() => {
    registerMotion();
    const root = stageRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, onUpdate: () => setProgress(tl.progress()), onComplete: () => setPlaying(false) });
      const roots = Array.from(root.querySelectorAll<HTMLElement>("[data-scene]"));
      gsap.set(roots, { autoAlpha: 0 });
      const found: Mark[] = [];
      let t = 0;
      flow.beats.forEach((beat, i) => {
        const el = roots[i];
        const scene = flowScenes[i];
        if (!el || !scene) return;
        const label = `beat${i}`;
        tl.addLabel(label, t);
        tl.set(el, { autoAlpha: 1 }, label);
        let built = 0;
        if (reduced) {
          // fromTo, not from: the scene is hidden when this is created, so `from` would fade 0 → 0
          tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15 }, label);
        } else {
          const sub = gsap.timeline();
          sub.addLabel("s", 0);
          scene.build(sub, gsap.utils.selector(el), "s");
          built = sub.duration();
          tl.add(sub, label);
        }
        // The longer of the storyboard's timing and the scene's actual motion, so nothing is cut off
        const motion = reduced ? 0.15 : Math.max(beat.ms / 1000, built, 0.15);
        found.push({ at: t, title: beat.title, motion: beat.motion });
        t += motion + (beat.ms ? dwell : held);
        if (i < flow.beats.length - 1) tl.set(el, { autoAlpha: 0 }, t);
      });
      tl.set({}, {}, t);
      tlRef.current = tl;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __animatic?: gsap.core.Timeline }).__animatic = tl;
      setMarks(found);
      setTotal(t);
      setProgress(0);
      tl.timeScale(slow ? 0.5 : 1);
      if (playing) tl.play(0);
    }, root);
    return () => {
      ctx.revert();
      tlRef.current = null;
    };
    // Rebuild only when the flow or motion mode changes; play state and speed are applied separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, reduced]);

  useEffect(() => {
    tlRef.current?.timeScale(slow ? 0.5 : 1);
  }, [slow]);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (playing) {
      if (tl.progress() >= 1) tl.restart();
      else tl.play();
    } else tl.pause();
  }, [playing]);

  const now = progress * total;
  const current = marks.reduce((c, m, i) => (m.at <= now + 0.001 ? i : c), 0);
  const seek = (p: number) => {
    tlRef.current?.progress(p);
    setPlaying(false);
  };

  return (
    <div>
      <div role="tablist" aria-label="Flows" className="flex flex-wrap gap-2">
        {flows.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === flowId}
            onClick={() => {
              setFlowId(f.id);
              setPlaying(true);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] ${f.id === flowId ? "border-ink bg-ink text-paper" : "border-rule text-graphite hover:text-ink"}`}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div ref={frameRef} className="mt-6 w-full">
        <div className="relative overflow-hidden rounded-lg border border-rule shadow-[var(--shadow)]" style={{ height: stage.height * scale }}>
          <div ref={stageRef} className="absolute left-0 top-0 origin-top-left" style={{ width: stage.width, height: stage.height, transform: `scale(${scale})` }}>
            {flowScenes.map((s, i) => (
              <div key={`${flowId}-${i}`} data-scene className="absolute inset-0 overflow-hidden" style={{ visibility: "hidden" }}>
                {s.render()}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <button onClick={() => setPlaying((p) => !p)} className="w-24 rounded-md bg-ink px-4 py-2 font-semibold text-paper">
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => {
            tlRef.current?.restart();
            setPlaying(true);
          }}
          className="rounded-md border border-rule px-4 py-2"
        >
          Restart
        </button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> Half speed
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduced motion
        </label>
        <span className="ml-auto font-mono text-xs tabular-nums opacity-70">
          {now.toFixed(1)} / {total.toFixed(1)} s
        </span>
      </div>

      <div className="relative mt-4">
        <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} onChange={(e) => seek(Number(e.target.value) / 1000)} aria-label="Scrub the animatic" className="w-full accent-[var(--held)]" />
        <ol className="relative mt-1 h-5">
          {marks.map((m, i) => (
            <li key={m.title + i} className="absolute top-0 -translate-x-1/2" style={{ left: `${(m.at / (total || 1)) * 100}%` }}>
              <button onClick={() => seek(m.at / (total || 1) + 0.0001)} className={`font-mono text-[11px] ${i === current ? "font-bold" : "opacity-60"}`} aria-label={`Go to beat ${i + 1}: ${m.title}`}>
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 grid gap-2 border-t border-rule pt-4 md:grid-cols-[16rem_1fr]">
        <p className="font-medium">
          <span className="mr-2 font-mono text-xs opacity-60">{current + 1}</span>
          {marks[current]?.title}
        </p>
        <p className="text-sm opacity-70">{reduced ? "Reduced motion: the end state appears with a short fade." : marks[current]?.motion}</p>
      </div>
    </div>
  );
}
