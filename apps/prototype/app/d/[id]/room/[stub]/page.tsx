"use client";

import Link from "next/link";
import { use } from "react";
import { DemoMark, Wordmark } from "@/components/Chrome";
import { DisputeRoomView } from "@/components/DisputeRoomView";
import { useDemo } from "@/demo/store";

/** The supplier's way into the dispute room, from their deal link. No account needed. */
export default function SupplierRoom({ params }: { params: Promise<{ id: string; stub: string }> }) {
  const { id, stub } = use(params);
  const d = useDemo().deals[id.toUpperCase()];
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5 md:px-8">
          <Wordmark className="text-[14px]" />
          <DemoMark />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-20 md:px-8 md:pt-10">
        <Link href={`/d/${id.toUpperCase()}`} className="text-[12.5px] text-graphite">
          ← Back to the deal
        </Link>
        <div className="mt-4">{d ? <DisputeRoomView d={d} idx={Number(stub)} viewer="Supplier" /> : <p>No such deal.</p>}</div>
        <p className="mt-6 text-[12px] text-graphite">The dispute room is in English for now; a Chinese version will follow native review.</p>
      </main>
    </div>
  );
}
