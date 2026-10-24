/**
 * Storyboard thumbnails: schematic 160×100 drawings. Dashed arrows mean movement, as in a hand-drawn storyboard.
 * Tones are the product's colours so the boards preview the system.
 */

export type Tone = "ink" | "held" | "released" | "refunded" | "hold" | "ghost";
export type Shape =
  | { t: "doc"; x: number; y: number; w: number; h: number; tone?: Tone; fill?: boolean }
  | { t: "rows"; x: number; y: number; w: number; n: number; gap?: number; tone?: Tone }
  | { t: "stamp"; x: number; y: number; tone?: Tone; word: string; rot?: number }
  | { t: "text"; x: number; y: number; s: string; size?: number; tone?: Tone; mono?: boolean; anchor?: "start" | "middle" | "end" }
  | { t: "arrow"; x1: number; y1: number; x2: number; y2: number; tone?: Tone }
  | { t: "btn"; x: number; y: number; w: number; s: string; filled?: boolean; tone?: Tone }
  | { t: "phone"; x: number; y: number; w?: number; h?: number }
  | { t: "bar"; x: number; y: number; w: number; h: number; tone?: Tone; outline?: boolean }
  | { t: "tick"; x: number; y: number; tone?: Tone; cross?: boolean }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; tone?: Tone; dash?: boolean; w?: number }
  | { t: "perf"; x: number; y: number; w: number }
  | { t: "stub"; x: number; y: number; w: number; h: number; tone?: Tone; torn?: boolean; rot?: number; fill?: boolean }
  | { t: "dot"; x: number; y: number; tone?: Tone; ring?: boolean }
  | { t: "step"; pts: [number, number][]; tone?: Tone; dash?: boolean };

const color = (t: Tone = "ink") =>
  t === "ghost" ? "var(--graphite)" : `var(--${t})`;

const wash = (t: Tone = "ink") =>
  t === "held" ? "var(--held-wash)" : t === "released" ? "var(--released-wash)" : t === "refunded" ? "var(--refunded-wash)" : t === "hold" ? "var(--hold-wash)" : "var(--sheet)";

// Jagged top edge for a torn stub
const jag = (x: number, y: number, w: number) => {
  const n = 10;
  let d = `M ${x} ${y + 1}`;
  for (let i = 1; i <= n; i++) d += ` L ${x + (i / n) * w} ${y + (i % 2 ? 2.2 : 0.4)}`;
  return d;
};

function Draw({ s }: { s: Shape }) {
  switch (s.t) {
    case "doc":
      return (
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="1" fill={s.fill === false ? "none" : "var(--sheet)"} stroke={color(s.tone)} strokeWidth="0.8" strokeDasharray={s.tone === "ghost" ? "2 2" : undefined} />
      );
    case "rows":
      return (
        <g>
          {Array.from({ length: s.n }, (_, i) => (
            <line key={i} x1={s.x} x2={s.x + s.w} y1={s.y + i * (s.gap ?? 5)} y2={s.y + i * (s.gap ?? 5)} stroke={color(s.tone ?? "ghost")} strokeWidth="0.6" opacity="0.7" />
          ))}
        </g>
      );
    case "stamp": {
      const w = Math.max(24, s.word.length * 3.6 + 6);
      return (
        <g transform={`rotate(${s.rot ?? -8} ${s.x} ${s.y})`}>
          <rect x={s.x - w / 2} y={s.y - 4.5} width={w} height="9" rx="0.8" fill="none" stroke={color(s.tone ?? "released")} strokeWidth="0.9" />
          <text x={s.x} y={s.y + 1.9} fontSize="4.6" textAnchor="middle" letterSpacing="0.8" fill={color(s.tone ?? "released")} fontFamily="var(--font-archivo)" fontWeight="800">
            {s.word}
          </text>
        </g>
      );
    }
    case "text":
      return (
        <text x={s.x} y={s.y} fontSize={s.size ?? 5} textAnchor={s.anchor ?? "start"} fill={color(s.tone)} fontFamily={s.mono ? "var(--font-plex-mono)" : "var(--font-archivo)"}>
          {s.s}
        </text>
      );
    case "arrow": {
      const c = color(s.tone ?? "held");
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const hx = (a: number) => s.x2 - 3.2 * Math.cos(ang + a);
      const hy = (a: number) => s.y2 - 3.2 * Math.sin(ang + a);
      return (
        <g>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={c} strokeWidth="0.9" strokeDasharray="2 1.6" />
          <path d={`M ${hx(0.5)} ${hy(0.5)} L ${s.x2} ${s.y2} L ${hx(-0.5)} ${hy(-0.5)}`} fill="none" stroke={c} strokeWidth="0.9" />
        </g>
      );
    }
    case "btn":
      return (
        <g>
          <rect x={s.x} y={s.y} width={s.w} height="7" rx="1" fill={s.filled ? color(s.tone) : "none"} stroke={color(s.tone)} strokeWidth="0.7" />
          <text x={s.x + s.w / 2} y={s.y + 4.9} fontSize="3.8" textAnchor="middle" fill={s.filled ? "var(--sheet)" : color(s.tone)} fontFamily="var(--font-archivo)">
            {s.s}
          </text>
        </g>
      );
    case "phone":
      return <rect x={s.x} y={s.y} width={s.w ?? 44} height={s.h ?? 84} rx="5" fill="var(--sheet)" stroke="var(--ink)" strokeWidth="0.9" />;
    case "bar":
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="0.6" fill={s.outline ? "none" : color(s.tone)} stroke={color(s.tone)} strokeWidth={s.outline ? 0.8 : 0} opacity={s.outline ? 1 : 0.9} />;
    case "tick":
      return s.cross ? (
        <path d={`M ${s.x - 1.8} ${s.y - 1.8} L ${s.x + 1.8} ${s.y + 1.8} M ${s.x + 1.8} ${s.y - 1.8} L ${s.x - 1.8} ${s.y + 1.8}`} stroke={color(s.tone ?? "hold")} strokeWidth="0.9" />
      ) : (
        <path d={`M ${s.x - 2} ${s.y} L ${s.x - 0.5} ${s.y + 1.6} L ${s.x + 2.2} ${s.y - 1.8}`} fill="none" stroke={color(s.tone ?? "released")} strokeWidth="0.9" />
      );
    case "line":
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color(s.tone)} strokeWidth={s.w ?? 0.8} strokeDasharray={s.dash ? "2 2" : undefined} />;
    case "perf":
      return <line x1={s.x} y1={s.y} x2={s.x + s.w} y2={s.y} stroke="var(--graphite)" strokeWidth="0.8" strokeDasharray="0.6 1.6" strokeLinecap="round" />;
    case "stub": {
      const c = color(s.tone ?? "ghost");
      const f = s.fill === false ? "none" : wash(s.tone);
      const body = s.torn ? (
        <g>
          <path d={`${jag(s.x, s.y, s.w)} L ${s.x + s.w} ${s.y + s.h} L ${s.x} ${s.y + s.h} Z`} fill={f} stroke={c} strokeWidth="0.8" />
        </g>
      ) : (
        <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={f} stroke={c} strokeWidth="0.8" />
      );
      return s.rot ? <g transform={`rotate(${s.rot} ${s.x + s.w / 2} ${s.y + s.h / 2})`}>{body}</g> : body;
    }
    case "step":
      return <polyline points={s.pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color(s.tone)} strokeWidth="0.9" strokeDasharray={s.dash ? "1 2" : undefined} />;
    case "dot":
      return (
        <g>
          {s.ring ? <circle cx={s.x} cy={s.y} r="3.2" fill="none" stroke={color(s.tone ?? "held")} strokeWidth="0.5" opacity="0.5" /> : null}
          <circle cx={s.x} cy={s.y} r="1.6" fill={s.ring ? "var(--sheet)" : color(s.tone ?? "held")} stroke={color(s.tone ?? "held")} strokeWidth="0.8" />
        </g>
      );
  }
}

export function Sketch({ shapes, label }: { shapes: Shape[]; label: string }) {
  return (
    <svg viewBox="0 0 160 100" className="block w-full rounded-md border border-rule bg-paper" role="img" aria-label={label}>
      {shapes.map((s, i) => (
        <Draw key={i} s={s} />
      ))}
    </svg>
  );
}
