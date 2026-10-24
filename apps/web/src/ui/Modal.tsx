"use client";

import gsap from "gsap";
import { useEffect, useLayoutEffect, useRef } from "react";
import { D, E, registerMotion } from "./motion";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the dialog, locks page scroll while it is open and hands focus back on close. */
function useDialogFocus(open: boolean, panel: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);
    return () => {
      window.removeEventListener("keydown", onTab);
      document.body.style.overflow = scroll;
      prev?.focus();
    };
  }, [open, panel]);
}

/**
 * A dialog for one action. Centred card on desktop, bottom sheet on phones. Escape or the scrim closes it
 * (except while a transaction is in flight, when `locked` keeps it open).
 */
export function Modal({ open, onClose, locked = false, label, children }: { open: boolean; onClose: () => void; locked?: boolean; label: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !locked && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);
  useDialogFocus(open, panel);

  useLayoutEffect(() => {
    if (!open || !panel.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const mobile = window.matchMedia("(max-width: 639px)").matches;
    const t = gsap.from(panel.current, mobile ? { yPercent: 100, duration: D.base, ease: E("arrive") } : { y: 24, opacity: 0, duration: D.base, ease: E("arrive") });
    return () => {
      t.revert();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-ink/40" onClick={() => !locked && onClose()} />
      <div ref={panel} className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-rule bg-sheet p-5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] sm:w-[480px] sm:rounded-xl">
        {children}
      </div>
    </div>
  );
}

/** Side drawer for reading evidence beside the deal. Full screen on phones. */
export function Drawer({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useDialogFocus(open, panel);
  useLayoutEffect(() => {
    if (!open || !panel.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const t = gsap.from(panel.current, { xPercent: 100, duration: D.base, ease: E("arrive") });
    return () => {
      t.revert();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <div ref={panel} className="relative h-full w-full overflow-y-auto bg-sheet shadow-[-20px_0_60px_-30px_rgb(0_0_0/0.5)] sm:w-[480px]">
        <button onClick={onClose} className="absolute top-3 right-3 z-10 rounded-md border border-rule bg-paper px-2.5 py-1 text-[12.5px]">
          Close
        </button>
        {children}
      </div>
    </div>
  );
}
