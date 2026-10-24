import { DEMO_RATE_GHS } from "./deal";

/** USDC cents → "20,250.00". Always two decimals. */
export function usdc(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** Labelled local-currency estimate at the demo rate, rounded to the cedi. */
export function ghsEstimate(cents: number): string {
  return `≈ GH₵${Math.round((cents / 100) * DEMO_RATE_GHS).toLocaleString("en-US")} est.`;
}

/**
 * Position (0–10) of the digit column for place `k` when a counter shows `v`, like a mechanical counter:
 * a digit only turns while the digit below it rolls over.
 */
export function digitPos(v: number, k: number): number {
  const unit = 10 ** k;
  const r = k === 0 ? 0 : (v % unit) / unit;
  const carry = k === 0 ? v % 1 : r > 0.9 ? (r - 0.9) * 10 : 0;
  return ((Math.floor(v / unit) % 10) + carry) % 10;
}

export function shortHash(h: string): string {
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
