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

/** The mark: a waybill with its tear-off stub, the stub marked released. Colours follow the theme; the stub stays highlighter yellow. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={`shrink-0 ${className}`}>
      <rect width="48" height="48" rx="11" fill="var(--ink)" />
      <rect x="11" y="8" width="26" height="32" rx="2.5" fill="var(--sheet)" />
      <path d="M11 27h26v10.5a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 11 37.5z" fill="#f6d55c" />
      <circle cx="11" cy="27" r="3" fill="var(--ink)" />
      <circle cx="37" cy="27" r="3" fill="var(--ink)" />
      <path d="M15 14.5h18M15 19.5h11" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M18.2 33.6l3.6 3.4 8-8.2" fill="none" stroke="#3b2f00" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark and name together. The name is the page's text; the mark is decoration. */
export function Wordmark({ className = "", mark = true, markClass = "h-7 w-7", textOnWideOnly = false }: { className?: string; mark?: boolean; markClass?: string; /** below 360 px the mark stands alone; the name stays for screen readers */ textOnWideOnly?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {mark ? <LogoMark className={markClass} /> : null}
      <span className={`condensed text-[16px] font-extrabold tracking-[0.2em] ${textOnWideOnly ? "max-[359px]:sr-only" : ""} ${className}`}>
        WAYBILL
      </span>
    </span>
  );
}
