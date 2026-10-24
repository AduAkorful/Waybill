"use client";

import { FeesView } from "@/components/FeesView";
import { arbiter } from "@/demo/deal";
import { useDemo } from "@/demo/store";

export default function ArbiterFees() {
  const { deals } = useDemo();
  const rows = Object.values(deals)
    .filter((d) => d.arbiterFeePaid)
    .map((d) => {
      const dec = Object.values(d.disputes ?? {}).find((r) => r.decision);
      return { id: d.id, what: `Decision on stub ${dec?.stub ?? "?"}`, amount: d.arbiterFee, at: dec?.decision?.at ?? "", href: `/arbiter/${d.id}/${dec?.stub ?? 1}` };
    });
  return (
    <FeesView
      recipient={arbiter.name}
      title="Arbiter fees"
      rows={rows}
      action="withdrawArbiterFee(dealId)"
      explain="The fixed fee each buyer prepaid, credited only when you decide before the deadline. It never comes out of escrowed principal."
    />
  );
}
