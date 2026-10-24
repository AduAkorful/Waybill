import { digitPos, formatCents } from "@/view/format";

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
  label,
  className = "",
}: {
  from?: number;
  to: number;
  progress?: number;
  size?: number;
  /** Exact text for assistive tech, when the figure is rounded to cents */
  label?: string;
  className?: string;
}) {
  const start = from ?? to;
  const v = start + (to - start) * progress;
  const text = formatCents(Math.max(Math.round(start), to, size ?? 0));
  const rolling = progress > 0 && progress < 1;
  const digitsTotal = text.replace(/\D/g, "").length;
  let seen = 0;

  return (
    <span data-odo data-to={to} className={`mono relative inline-flex leading-none ${className}`}>
      {/* The real figure: read by screen readers and copied with the page. The rolling columns below are drawing only. */}
      <span className="sr-only">{label ?? `${formatCents(to)} USDC`}</span>
      {text.split("").map((ch, i) => {
        if (!/\d/.test(ch)) {
          // A comma belongs to the digit on its left
          const k = digitsTotal - seen;
          return (
            <span
              key={i}
              aria-hidden
              data-sep={ch === "," ? k : undefined}
              data-ch={ch}
              className="inline-block overflow-hidden select-none before:content-[attr(data-ch)]"
              style={ch === "," && !placeShown(v, k) ? { width: 0 } : undefined}
            />
          );
        }
        const k = digitsTotal - 1 - seen++;
        const blur = rolling && k < 4 ? Math.min(2, (4 - k) * 0.5) : 0;
        return (
          <span
            key={i}
            aria-hidden
            data-col={k}
            className="relative inline-block h-[1em] overflow-hidden select-none"
            style={{ width: placeShown(v, k) ? "0.6em" : 0 }}
          >
            <span
              data-k={k}
              className="absolute inset-x-0 top-0 flex flex-col"
              style={{ transform: `translateY(${-digitPos(v, k)}em)`, filter: blur ? `blur(${blur}px)` : undefined }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, j) => (
                // Digits are drawn with CSS content so the reel is not page text (no stacked 0-9 in copy or reader mode)
                <span key={j} data-d={d} className="block h-[1em] text-center before:content-[attr(data-d)]" />
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
