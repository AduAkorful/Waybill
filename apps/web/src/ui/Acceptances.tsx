import { shortAddress } from "@/view/format";
import type { DealView } from "@/view/types";
import { panelAccepted } from "@/view/panel";
import { Tick } from "./Sheet";

interface Row {
  key: string;
  role: string;
  who: string;
  done: boolean;
}

/** Everyone whose acceptance the contract requires before funding, read from the escrow. */
export function acceptanceRows(deal: DealView): Row[] {
  const rows: Row[] = [{ key: "supplier", role: "Supplier", who: shortAddress(deal.supplier), done: deal.supplierPayout !== null }];
  for (const t of deal.tranches) {
    if (t.condition === "attestation" && t.attestor) {
      rows.push({ key: `attestor-${t.index}`, role: `Attestor · stub ${t.index}`, who: shortAddress(t.attestor), done: t.attestorAccepted });
    }
  }
  if (deal.panel) {
    const accepted = panelAccepted(deal);
    deal.panel.members.forEach((m, i) => rows.push({ key: `panel-${i}`, role: `Panel · arbiter ${i + 1}`, who: shortAddress(m), done: deal.arbiterAccepted || accepted?.[m.toLowerCase()] === true }));
  } else {
    rows.push({ key: "arbiter", role: "Arbiter", who: shortAddress(deal.arbiter), done: deal.arbiterAccepted });
  }
  return rows;
}

/** Who has accepted the terms. Funding is blocked until every row is ticked. */
export function Acceptances({ deal }: { deal: DealView }) {
  const rows = acceptanceRows(deal);
  const missing = rows.filter((r) => !r.done);
  return (
    <div>
      <ul className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {rows.map((r) => (
          <li key={r.key} data-accept={r.key} className="flex items-start gap-2 bg-sheet px-3 py-2.5">
            <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${r.done ? "bg-released text-sheet" : "border border-dashed border-graphite/60"}`}>
              {r.done ? <Tick className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="min-w-0">
              <span className="label block">{r.role}</span>
              <span className="mono block truncate text-[12.5px]">{r.who}</span>
            </span>
          </li>
        ))}
      </ul>
      <p data-accept-note className="mt-2 text-[12.5px] text-graphite">
        {missing.length ? `Waiting for ${missing.map((m) => m.role.toLowerCase()).join(", ")} to accept before the deal can be funded.` : "Everyone has accepted."}
      </p>
    </div>
  );
}
