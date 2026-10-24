import { digitPos, usdc } from "@/demo/format";

/** A whole-number place (and the comma left of it) shows only when the value reaches it; cents and units always show. */
export const placeShown = (v: number, k: number) => k <= 2 || Math.round(v) >= 10 ** k;

/**
 * Rolling USDC figure. `progress` freezes the roll at any point between `from` and `to`, so a still frame, a scrubbed
 * animatic and the live roll (motion.ts `rollOdo`) all render the same markup. Columns are laid out for `size`
 * (the largest value this figure may roll through) and leading places collapse to zero width.
 */
export function Odometer({
  from,
  to,
  progress = 1,
  size,
  className = "",
}: {
  from?: number;
  to: number;
  progress?: number;
  size?: number;
  className?: string;
}) {
  const start = from ?? to;
  const v = start + (to - start) * progress;
  const text = usdc(Math.max(Math.round(start), to, size ?? 0));
  const rolling = progress > 0 && progress < 1;
  const digitsTotal = text.replace(/\D/g, "").length;
  let seen = 0;

  return (
    <span data-odo data-to={to} className={`mono inline-flex leading-none ${className}`} aria-label={`${usdc(to)} USDC`}>
      {text.split("").map((ch, i) => {
        if (!/\d/.test(ch)) {
          // A comma belongs to the digit on its left
          const k = digitsTotal - seen;
          return (
            <span
              key={i}
              aria-hidden
              data-sep={ch === "," ? k : undefined}
              className="inline-block overflow-hidden"
              style={ch === "," && !placeShown(v, k) ? { width: 0 } : undefined}
            >
              {ch}
            </span>
          );
        }
        const k = digitsTotal - 1 - seen++;
        const blur = rolling && k < 4 ? Math.min(2, (4 - k) * 0.5) : 0;
        return (
          <span
            key={i}
            aria-hidden
            data-col={k}
            className="relative inline-block h-[1em] overflow-hidden"
            style={{ width: placeShown(v, k) ? "0.6em" : 0 }}
          >
            <span
              data-k={k}
              className="absolute inset-x-0 top-0 flex flex-col"
              style={{ transform: `translateY(${-digitPos(v, k)}em)`, filter: blur ? `blur(${blur}px)` : undefined }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, j) => (
                <span key={j} className="block h-[1em] text-center">
                  {d}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
