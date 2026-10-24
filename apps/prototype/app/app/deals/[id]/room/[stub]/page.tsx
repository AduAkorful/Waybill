"use client";

import Link from "next/link";
import { use } from "react";
import { DisputeRoomView } from "@/components/DisputeRoomView";
import { useDemo } from "@/demo/store";

export default function BuyerRoom({ params }: { params: Promise<{ id: string; stub: string }> }) {
  const { id, stub } = use(params);
  const d = useDemo().deals[id.toUpperCase()];
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-20 md:px-8 md:pt-10">
      <Link href={`/app/deals/${id.toUpperCase()}`} className="text-[12.5px] text-graphite">
        ← {id.toUpperCase()}
      </Link>
      <div className="mt-4">{d ? <DisputeRoomView d={d} idx={Number(stub)} viewer="Buyer" /> : <p>No such deal.</p>}</div>
    </main>
  );
}
