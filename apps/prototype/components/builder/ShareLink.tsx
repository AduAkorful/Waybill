"use client";

import Link from "next/link";
import { useState } from "react";

/** The finished deal's link. Copy works; WhatsApp opens a prefilled message; WeChat has no web share, so it copies and says what to do. */
export function ShareLink({ id, goods, buyerName, dealHref }: { id: string; goods: string; buyerName: string; dealHref: string }) {
  const [note, setNote] = useState("");
  const url = typeof window === "undefined" ? `/d/${id}` : `${window.location.origin}/d/${id}`;
  const message = `${buyerName} invited you to review a Waybill deal for ${goods}: ${url}`;

  const copy = async (then: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setNote(then);
    } catch {
      setNote("Couldn't copy automatically. Select the link above and copy it.");
    }
  };

  return (
    <div data-share className="rounded-md border border-rule bg-sheet p-4 md:p-5">
      <p className="label">Supplier link</p>
      <p className="mono mt-1.5 rounded bg-paper px-3 py-2 text-[13.5px] break-all select-all">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="rounded-md bg-ink px-3.5 py-2 text-[13px] font-semibold text-paper">
          Send on WhatsApp
        </a>
        <button onClick={() => copy("Link copied. Open WeChat, choose the supplier's chat and paste it.")} className="rounded-md border border-rule px-3.5 py-2 text-[13px] font-semibold hover:bg-paper">
          WeChat
        </button>
        <button onClick={() => copy("Link copied ✓")} className="rounded-md border border-rule px-3.5 py-2 text-[13px] font-semibold hover:bg-paper">
          Copy
        </button>
        <Link href={dealHref} className="ml-auto self-center text-[13px] font-semibold text-held underline decoration-held/30 underline-offset-4">
          Open the deal →
        </Link>
      </div>
      <p aria-live="polite" className="mt-2 min-h-[18px] text-[12.5px] text-released">
        {note}
      </p>
      <p className="mt-1 text-[12px] text-graphite">The supplier's page is in English and 中文. Each inspector, forwarder and the arbiter also gets their own invitation by email.</p>
    </div>
  );
}
