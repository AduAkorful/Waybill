"use client";

import { useEffect, useState } from "react";

export function DemoMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`mono inline-flex items-center gap-1 rounded-full border border-dashed border-graphite/50 px-2 py-0.5 text-[10px] tracking-wide text-graphite uppercase ${className}`}
      title="Invented parties and figures. Not a real deal."
    >
      Demo data
    </span>
  );
}

type Theme = "system" | "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let saved: Theme = "system";
    try {
      saved = (localStorage.getItem("wb-theme") as Theme) || "system";
    } catch {}
    setTheme(saved);
  }, []);

  useEffect(() => {
    if (!theme) return;
    const el = document.documentElement;
    if (theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("wb-theme", theme);
    } catch {}
  }, [theme]);

  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const label = theme ?? "system";
  return (
    <button
      type="button"
      onClick={() => setTheme(next[label])}
      className="mono rounded-full border border-rule px-2.5 py-1 text-[10.5px] text-graphite uppercase hover:text-ink"
      aria-label={`Theme: ${label}. Switch theme`}
    >
      {label === "dark" ? "◐ Night" : label === "light" ? "○ Day" : "◑ Auto"}
    </button>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`condensed text-[16px] font-extrabold tracking-[0.2em] ${className}`}>
      WAYBILL
    </span>
  );
}
