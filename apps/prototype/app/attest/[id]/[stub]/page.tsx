"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { StatementDoc, statementParts } from "@/components/StatementDoc";
import { TxFlow } from "@/components/TxFlow";
import { inspector, type EvidenceFile } from "@/demo/deal";
import { usdc } from "@/demo/format";
import { act, newHash, useDemo } from "@/demo/store";

interface Upload {
  name: string;
  progress: number | null;
  detail?: string;
  hash?: string;
}

const details: Record<string, string> = {
  "Inspection report": "PDF · 2.1 MB · AQL 2.5, level II",
  "Sample photos": "14 photos · labels and cartons visible",
  "Carton count": "All cartons counted",
  "Packing list": "PDF · 410 KB",
  "Delivery receipt": "PDF · signed at the port",
  "Arrival photos with labels": "9 photos · seals intact",
};

export default function SignScreen({ params }: { params: Promise<{ id: string; stub: string }> }) {
  const { id, stub } = use(params);
  const { deals } = useDemo();
  const d = deals[id.toUpperCase()];
  const t = d?.tranches.find((x) => x.index === Number(stub));
  const [uploads, setUploads] = useState<Upload[]>([]);

  useEffect(() => {
    if (d && t) setUploads(statementParts(d, t).checklist.map((name) => ({ name, progress: null })));
    // Only on first load of this stub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stub]);

  // Simulated uploads; each resumes where it left off and finishes with a content fingerprint.
  useEffect(() => {
    if (!uploads.some((u) => u.progress !== null && u.progress < 100)) return;
    const h = setInterval(() => {
      setUploads((us) =>
        us.map((u) =>
          u.progress !== null && u.progress < 100
            ? (() => {
                const p = Math.min(100, u.progress + 9 + Math.round(Math.random() * 14));
                if (p < 100) return { ...u, progress: p };
                const hh = newHash();
                return { ...u, progress: 100, detail: details[u.name] ?? "File", hash: `${hh.slice(0, 6)}…${hh.slice(-4)}` };
              })()
            : u,
        ),
      );
    }, 220);
    return () => clearInterval(h);
  }, [uploads]);

  if (!d || !t) return <p className="px-4 py-16 text-center">Nothing to sign here.</p>;

  const mine = t.confirmedBy.startsWith(inspector.name);
  const signedAlready = !!t.signedBy;
  const funded = d.state === "funded";
  const done = uploads.filter((u) => u.progress === 100).length;
  const allDone = uploads.length > 0 && done === uploads.length;
  const files: EvidenceFile[] = uploads.filter((u) => u.hash).map((u) => ({ name: u.name, detail: u.detail!, hash: u.hash! }));

  const status = signedAlready ? null : !mine ? "This milestone is confirmed by someone else." : !funded ? "The buyer hasn't funded this deal yet. Don't inspect until it's funded." : null;

  const side = signedAlready ? (
    <div className="rounded-md border border-rule bg-sheet p-4 text-[13.5px]">
      <p className="text-[15px] font-semibold">
        {t.state === "released" ? "Released. Your fee is credited." : t.state === "disputed" ? "Disputed by the buyer" : t.state === "claimable" ? "Approved. Paying the supplier." : "Signed. The buyer is reviewing."}
      </p>
      <p className="mt-1 text-graphite">
        {t.state === "in_review"
          ? `${d.buyer.name.split(" ")[0]} can approve or dispute until ${t.reviewEnds?.split(", ")[1]}. If they do nothing, ${usdc(t.amount)} releases and you earn ${usdc(t.feeAttestor)}.`
          : t.state === "disputed"
            ? "Only this part is frozen. The arbiter will read your statement and files. You don't need to do anything unless asked."
            : t.state === "released"
              ? `You earned ${usdc(t.feeAttestor)} on this part.`
              : "Nothing more for you to do."}
      </p>
      <Link href="/attest/fees" className="mt-3 inline-block font-semibold underline">
        Your fees
      </Link>
    </div>
  ) : (
    <div className="rounded-md border border-rule bg-sheet p-4">
      <dl className="grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <dt className="label">You earn</dt>
          <dd className="mono text-[16px] text-released">{usdc(t.feeAttestor)}</dd>
          <dd className="text-[11.5px] text-graphite">when this part releases</dd>
        </div>
        <div>
          <dt className="label">After you sign</dt>
          <dd className="leading-snug">
            {d.buyer.name.split(" ")[0]} has {t.reviewHours} h to review, then {usdc(t.amount)} goes to the supplier.
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        {status ? (
          <p className="rounded-md border border-dashed border-rule p-3 text-[13px] text-graphite">{status}</p>
        ) : !allDone ? (
          <p role="status" className="rounded-md border border-dashed border-rule p-3 text-center text-[13px] text-held">
            {uploads.length - done} of {uploads.length} files still needed before you can sign
          </p>
        ) : (
          <TxFlow
            confirmLabel="Sign statement"
            steps={[
              { label: "Sign the statement", wallet: { action: "Sign typed data · WaybillEscrow / 1 · Attestation", to: "Your signature only", note: `Not a payment. Bound to ${d.id}, stub ${t.index}, on Arc. Usable once.` } },
              { label: "Submit it", wallet: { action: `attest(${d.onchainId}, ${t.index - 1}, evidenceHash, …)`, to: "WaybillEscrow · demo", note: "Records your signature and the file fingerprints" } },
            ]}
            onCancel={() => {}}
            onDone={() => act.attest(d.id, t.index, inspector.name, files)}
          />
        )}
      </div>
      <p className="mt-2 text-center text-[12px] text-graphite">Signing is not a payment. You can sign once.</p>
    </div>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-24 md:px-8 md:pt-10">
      <Link href="/attest" className="text-[12.5px] text-graphite">
        ← Your work
      </Link>
      <p className="label mt-4">
        {d.id} · stub {t.index} of {d.tranches.length} · due {t.due}
      </p>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight md:text-[30px]">{t.title}</h1>
      <p className="mt-1 text-[14px] text-graphite">
        {d.cartons} cartons of {d.goods.charAt(0).toLowerCase() + d.goods.slice(1)} at {d.supplier.org}, {d.supplier.city}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <StatementDoc d={d} t={t} signer={t.signedBy} signed={signedAlready ? { at: `${t.signedAt} GMT` } : undefined} />

          <section aria-label="Evidence">
            <h2 className="label">
              Evidence · {signedAlready ? t.evidence?.length ?? 0 : done} of {signedAlready ? t.evidence?.length ?? 0 : uploads.length}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-graphite">Files are encrypted and stored twice. Only their fingerprints go on the record, so they can't be swapped later.</p>
            <ul className="mt-2 divide-y divide-rule overflow-hidden rounded-md border border-rule bg-sheet">
              {(signedAlready ? (t.evidence ?? []).map((f) => ({ ...f, progress: 100 })) : uploads).map((u) => (
                <li key={u.name} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${u.progress === 100 ? "bg-released text-sheet" : "border-2 border-dashed border-graphite/50"}`}
                    aria-hidden
                  >
                    {u.progress === 100 ? "✓" : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-2 text-[14px] font-semibold">
                      {u.name}
                      {u.hash ? <span className="mono text-[11px] font-normal text-graphite">{u.hash}</span> : null}
                    </p>
                    {u.progress === 100 ? (
                      <p className="text-[12.5px] text-graphite">{u.detail}</p>
                    ) : u.progress === null ? (
                      <button
                        disabled={!!status}
                        onClick={() => setUploads((us) => us.map((x) => (x.name === u.name ? { ...x, progress: 0 } : x)))}
                        className="mt-1 rounded-md border border-rule bg-paper px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40"
                      >
                        Upload
                      </button>
                    ) : (
                      <>
                        <p className="text-[12.5px] text-graphite">Uploading · {u.progress}% · resumes if the connection drops</p>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-rule">
                          <div className="h-full rounded-full bg-held transition-[width] duration-200" style={{ width: `${u.progress}%` }} />
                        </div>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!signedAlready && !status && uploads.some((u) => u.progress === null) ? (
              <button
                onClick={() => setUploads((us) => us.map((x) => (x.progress === null ? { ...x, progress: 0 } : x)))}
                className="mt-2 text-[12.5px] font-semibold text-held underline decoration-held/30 underline-offset-4"
              >
                Upload all
              </button>
            ) : null}
          </section>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">{side}</aside>
      </div>
    </main>
  );
}
