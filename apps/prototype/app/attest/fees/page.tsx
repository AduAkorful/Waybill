"use client";

import { FeesView } from "@/components/FeesView";
import { inspector } from "@/demo/deal";
import { attestorEarnings } from "@/demo/deals";
import { useDemo } from "@/demo/store";

export default function AttestorFees() {
  const { deals } = useDemo();
  const rows = attestorEarnings(deals, inspector.name).map((r) => ({ id: r.id, what: `Stub ${r.stub} · ${r.what.toLowerCase()}`, amount: r.amount, at: r.at, href: `/attest/${r.id}/${r.stub}` }));
  return (
    <FeesView
      recipient={inspector.name}
      title="Your fees"
      rows={rows}
      action="withdrawFees()"
      explain="40% of the 0.75% fee on each part you confirmed, credited when that part is released. Withdraw any time to your own wallet."
    />
  );
}
