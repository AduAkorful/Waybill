import { usdc } from "@/demo/format";

interface Entry {
  who: string;
  role: string;
  at: string;
  text: string;
  files: string[];
  tone: "hold" | "neutral";
}

export const disputeEntries: Entry[] = [
  {
    who: "Ama Owusu",
    role: "Buyer · raised the dispute",
    at: "14 Dec, 09:15",
    text: "212 of 480 units fail to charge. Photos of the failed units and a test video attached.",
    files: ["failed-units.jpg ×18", "charge-test.mp4"],
    tone: "hold",
  },
  {
    who: "Baiyun Brightpower",
    role: "Supplier · response",
    at: "15 Dec, 16:02",
    text: "Units passed inspection on 18 Oct. We believe they were stored in heat at the port. Inspection batch photos attached.",
    files: ["batch-test-log.pdf", "warehouse-temp.png"],
    tone: "neutral",
  },
];

/** Evidence in order, not a chat: filing, response, appended files, each timestamped and fingerprinted. */
export function DisputeRoom({ entries = disputeEntries }: { entries?: Entry[] }) {
  return (
    <ol className="space-y-3">
      {entries.map((e, i) => (
        <li key={i} data-entry className={`rounded-md border bg-sheet p-3.5 ${e.tone === "hold" ? "border-hold/40" : "border-rule"}`}>
          <p className="flex items-baseline justify-between gap-2">
            <span className="text-[13.5px] font-semibold">{e.who}</span>
            <span className="mono text-[11px] text-graphite">{e.at}</span>
          </p>
          <p className="label">{e.role}</p>
          <p className="mt-1.5 text-[13.5px] leading-snug">{e.text}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {e.files.map((f) => (
              <span key={f} className="mono rounded border border-rule px-1.5 py-0.5 text-[11px] text-graphite">
                {f}
              </span>
            ))}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** The arbiter's only choices for one frozen stub. Reasoning is required before either is enabled. */
export function ArbiterDecision({ amount, fee }: { amount: number; fee: number }) {
  return (
    <div data-decision className="rounded-md border border-rule bg-sheet p-4">
      <p className="label">Your decision on stub 3 · {usdc(amount)} USDC</p>
      <label className="label mt-3 block" htmlFor="reason">
        Reasoning (published on the deal record)
      </label>
      <textarea
        id="reason"
        rows={3}
        defaultValue="Inspection covered a sample on 18 Oct. Failure rate on arrival (44%) is far outside the sample and the supplier's storage claim isn't supported by the port log."
        className="mt-1 w-full rounded-md border border-rule bg-paper p-2.5 text-[13px] leading-snug"
      />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button className="rounded-md border border-released/50 px-3 py-2.5 text-left text-[13px] font-semibold text-released">
          Release to supplier
          <span className="block text-[11.5px] font-normal text-graphite">{usdc(amount)} to their payout address</span>
        </button>
        <button data-choice="refund" className="rounded-md bg-refunded px-3 py-2.5 text-left text-[13px] font-semibold text-sheet">
          Refund to buyer
          <span className="block text-[11.5px] font-normal opacity-85">
            {usdc(amount + fee)} incl. fee to their refund address
          </span>
        </button>
      </div>
      <p className="mt-2 text-[11.5px] text-graphite">No other recipient or amount is possible. Your 100.00 fee is paid when you decide before 22 Dec.</p>
    </div>
  );
}
