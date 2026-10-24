"use client";

import { useEffect, useState } from "react";

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
      className="mono inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-rule px-3 text-[12px] whitespace-nowrap text-graphite uppercase hover:text-ink"
      aria-label={`${label === "dark" ? "Night" : label === "light" ? "Day" : "Auto"}, theme. Switch theme`}
    >
      <span aria-hidden>{label === "dark" ? "◐" : label === "light" ? "○" : "◑"}</span><span className="hidden min-[400px]:inline">{label === "dark" ? "Night" : label === "light" ? "Day" : "Auto"}</span>
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
