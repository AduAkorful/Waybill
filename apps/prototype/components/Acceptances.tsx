import { Tick } from "./Sheet";

export interface Acceptance {
  role: string;
  who: string;
  done: boolean;
}

/** Who has accepted the terms. Funding is blocked until every row is ticked. */
export function Acceptances({ rows }: { rows: Acceptance[] }) {
  const missing = rows.filter((r) => !r.done);
  return (
    <div>
      <ul className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-4">
        {rows.map((r) => (
          <li key={r.role} data-accept={r.role} className="flex items-start gap-2 bg-sheet px-3 py-2.5">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${r.done ? "bg-released text-sheet" : "border border-dashed border-graphite/60"}`}>
              {r.done ? <Tick className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="min-w-0">
              <span className="label block">{r.role}</span>
              <span className="block truncate text-[13px]">{r.who}</span>
            </span>
          </li>
        ))}
      </ul>
      <p data-accept-note className="mt-2 text-[12.5px] text-graphite">
        {missing.length ? `Waiting for ${missing.map((m) => m.role.toLowerCase()).join(", ")} to accept before you can fund.` : "Everyone has accepted. You can lock the money."}
      </p>
    </div>
  );
}
