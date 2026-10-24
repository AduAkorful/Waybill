type Tone = "held" | "released" | "refunded" | "hold";

const toneClass: Record<Tone, string> = {
  held: "text-held border-held",
  released: "text-released border-released",
  refunded: "text-refunded border-refunded",
  hold: "text-hold border-hold",
};

/** A rubber stamp: the only place the document is "marked" rather than typed. */
export function Stamp({
  tone,
  children,
  sub,
  rotate = -6,
  className = "",
}: {
  tone: Tone;
  children: React.ReactNode;
  sub?: string;
  rotate?: number;
  className?: string;
}) {
  return (
    <span
      data-stamp
      className={`stamp inline-flex flex-col items-center rounded-[3px] border-2 px-2 py-0.5 leading-none ${toneClass[tone]} ${className}`}
      style={{ transform: `rotate(${rotate}deg)`, boxShadow: "inset 0 0 0 1.5px var(--sheet), inset 0 0 0 3px currentColor" }}
    >
      <span className="condensed text-[13px] font-extrabold tracking-[0.14em] uppercase">{children}</span>
      {sub ? <span className="mono mt-0.5 text-[9.5px] tracking-wide">{sub}</span> : null}
    </span>
  );
}
