import { usdc } from "@/demo/format";

export interface Part {
  name: string;
  bps: number;
  how: string;
}

export const standardParts: Part[] = [
  { name: "Acceptance", bps: 2000, how: "when the supplier accepts and you fund" },
  { name: "Inspection", bps: 3000, how: "when Lin Mei signs the pre-shipment inspection" },
  { name: "Arrival", bps: 5000, how: "when Kwabena Asante confirms arrival in Tema" },
];

/** The deal total split into parts. Blocks with a reason when the parts don't add to 100%. */
export function SplitBar({ parts, total }: { parts: Part[]; total: number }) {
  const sum = parts.reduce((s, p) => s + p.bps, 0);
  const ok = sum === 10_000;
  return (
    <div>
      <div className={`flex h-12 gap-1 rounded-md p-1 ${ok ? "" : "outline outline-2 outline-hold"}`}>
        {parts.map((p, i) => (
          <div
            key={p.name}
            data-seg={i}
            className="flex min-w-0 flex-col justify-center rounded-[4px] bg-held px-2.5 text-sheet"
            style={{ flexGrow: p.bps, flexBasis: 0, opacity: 1 - i * 0.18 }}
          >
            <span className="truncate text-[12px] font-semibold">
              {p.name} · {p.bps / 100}%
            </span>
            <span className="mono truncate text-[11px] opacity-90">{usdc((total * p.bps) / 10_000)}</span>
          </div>
        ))}
      </div>
      <p className={`mt-2 text-[12.5px] ${ok ? "text-graphite" : "font-semibold text-hold"}`}>
        {ok ? "Parts add up to 100%." : `Parts add up to ${sum / 100}%. Make them 100% to continue.`}
      </p>
    </div>
  );
}

export function Templates({ chosen = 1 }: { chosen?: number }) {
  const t = [
    { name: "Sample order", split: "100% on arrival" },
    { name: "Standard 20/30/50", split: "Accept · Inspect · Arrive" },
    { name: "30/70 with inspection", split: "Accept · Inspect" },
    { name: "Four-stage production", split: "10 · 20 · 30 · 40" },
  ];
  return (
    <ul className="grid gap-2 sm:grid-cols-4">
      {t.map((x, i) => (
        <li key={x.name} data-template={i} className={`rounded-md border p-3 ${i === chosen ? "border-held bg-held-wash" : "border-rule bg-sheet"}`}>
          <p className="text-[13.5px] font-semibold">{x.name}</p>
          <p className="text-[12px] text-graphite">{x.split}</p>
        </li>
      ))}
    </ul>
  );
}

export function PlainSummary({ total, fee, arbiterFee }: { total: number; fee: number; arbiterFee: number }) {
  const lines = [
    `You lock ${usdc(total + fee + arbiterFee)} USDC: the order, the 0.75% fee and the arbiter's ${usdc(arbiterFee)}.`,
    ...standardParts.map((p) => `The supplier receives ${usdc((total * p.bps) / 10_000)} ${p.how}.`),
    "If arrival isn't confirmed by 10 Dec plus 72 hours, you can take that part back.",
  ];
  return (
    <ol className="space-y-2 text-[14.5px] leading-snug">
      {lines.map((l, i) => (
        <li key={i} data-summary className="flex gap-3">
          <span className="mono w-4 shrink-0 text-[12px] text-graphite">{i + 1}</span>
          {l}
        </li>
      ))}
    </ol>
  );
}

export function ShareCard({ url }: { url: string }) {
  return (
    <div data-share className="rounded-md border border-rule bg-sheet p-4">
      <p className="label">Deal link</p>
      <p className="mono mt-1.5 rounded bg-paper px-3 py-2 text-[13.5px]">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper">Send on WhatsApp</button>
        <button className="rounded-md border border-rule px-3.5 py-2 text-[13px] font-semibold">WeChat</button>
        <button className="rounded-md border border-rule px-3.5 py-2 text-[13px] font-semibold">Copy</button>
      </div>
      <p className="mt-2 text-[12px] text-graphite">The supplier, Lin Mei, Kwabena and the arbiter each get their own invitation by email.</p>
    </div>
  );
}
