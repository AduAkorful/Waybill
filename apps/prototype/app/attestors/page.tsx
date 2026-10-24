"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PublicShell } from "@/components/PublicShell";
import { attestors, attestorStats, type AttestorKind } from "@/demo/attestors";
import { useDemo } from "@/demo/store";

const kinds: ("All" | AttestorKind)[] = ["All", "Inspector", "Forwarder", "Clearing agent"];

export default function AttestorDirectory() {
  const { deals } = useDemo();
  const [kind, setKind] = useState<"All" | AttestorKind>("All");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return attestors
      .filter((a) => (kind === "All" || a.kind === kind) && (!term || `${a.org} ${a.name} ${a.city} ${a.corridor}`.toLowerCase().includes(term)))
      .map((a) => ({ a, s: attestorStats(a, deals) }))
      .sort((x, y) => (x.a.status === y.a.status ? y.s.signed - x.s.signed : x.a.status === "Active" ? -1 : 1));
  }, [deals, kind, q]);

  return (
    <PublicShell active="/attestors">
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 md:px-8 md:pt-14">
        <p className="label">Attestors</p>
        <h1 className="mt-2 max-w-3xl text-[34px] leading-[1.08] font-semibold tracking-tight md:text-[44px]">
          The people who confirm the goods, and what their record shows.
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-graphite">
          You name the inspector and forwarder when you create a deal; the supplier has to accept them. Everything here is a count from real deal outcomes, not
          a rating anyone can edit or buy.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Role" className="flex flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] ${kind === k ? "border-ink bg-ink text-paper" : "border-rule text-graphite hover:text-ink"}`}
              >
                {k === "All" ? "Everyone" : k === "Clearing agent" ? "Clearing agents" : `${k}s`}
              </button>
            ))}
          </div>
          <label className="ml-auto block w-full sm:w-72">
            <span className="sr-only">Search by name or city</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or city"
              className="w-full rounded-md border border-rule bg-sheet px-3.5 py-2 text-[14px] outline-none focus:border-held"
            />
          </label>
        </div>

        {rows.length ? (
          <ul className="mt-6 divide-y divide-rule overflow-hidden rounded-md border border-rule">
            {rows.map(({ a, s }) => (
              <li key={a.slug}>
                <Link href={`/attestors/${a.slug}`} className="grid items-center gap-x-6 gap-y-2 px-4 py-4 hover:bg-sheet md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_repeat(3,6.5rem)] md:px-5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-paper">{a.initials}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold">{a.org}</span>
                      <span className="block truncate text-[12.5px] text-graphite">
                        {a.name} · {a.city} · {a.kind}
                      </span>
                    </span>
                  </span>
                  <span className="min-w-0 text-[12.5px] text-graphite">
                    <span className="block">{a.signs.join(" · ")}</span>
                    <span className="block truncate">{a.corridor}</span>
                    {a.status !== "Active" ? <span className="mt-1 inline-block font-semibold text-hold">{a.status}</span> : null}
                  </span>
                  {[
                    ["Signed", String(s.signed)],
                    ["No dispute", `${s.share}%`],
                    ["Upheld against", String(s.upheld)],
                  ].map(([k, v]) => (
                    <span key={k} className="hidden md:block">
                      <span className="label block">{k}</span>
                      <span className={`mono text-[16px] ${k === "Upheld against" && s.upheld ? "text-hold" : ""}`}>{v}</span>
                    </span>
                  ))}
                  <span className="mono text-[12px] text-graphite md:hidden">
                    {s.signed} signed · {s.share}% no dispute · {s.upheld} upheld against
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-md border border-dashed border-rule px-4 py-10 text-center text-[14px] text-graphite">
            No attestors match. Try a different role or city.
          </p>
        )}

        <div className="mt-10 grid gap-6 rounded-md border border-rule bg-sheet p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-[18px] font-semibold">Are you a forwarder or inspector?</p>
            <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-graphite">
              Earn a fee for confirmations you already make. You sign exactly one sentence per part, never a free-form opinion, and your record builds from
              outcomes.
            </p>
          </div>
          <Link href="/signin?as=attestor" className="rounded-md bg-held px-5 py-3 text-center text-[14.5px] font-semibold text-sheet">
            Become an attestor
          </Link>
        </div>

        <p className="mt-6 text-[12.5px] text-graphite">
          Tiers: Registered means business details and a signing wallet are on file. Verified (a partner business check) and Bonded come in later phases.
          Demo data.
        </p>
      </main>
    </PublicShell>
  );
}
