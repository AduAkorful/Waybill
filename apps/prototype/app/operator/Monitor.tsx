"use client";

import Link from "next/link";
import { heldFor } from "@/demo/deals";
import { usdc } from "@/demo/format";
import { opsBase } from "@/demo/ops";
import { orderedIds, useDemo } from "@/demo/store";

const stateLabel: Record<string, string> = { proposed: "Waiting for acceptances", accepted: "Ready to fund", funded: "Funded", settled: "Settled", cancelled: "Cancelled" };

export function Monitor() {
  const { deals, ops } = useDemo();
  const list = orderedIds(deals).map((id) => deals[id]!);
  const counts = Object.keys(stateLabel).map((k) => [k, list.filter((d) => d.state === k).length] as const);
  const disputes = list.flatMap((d) => Object.values(d.disputes ?? {}).filter((x) => !x.decision && !x.withdrawn).map((x) => ({ d, x })));
  const locked = list.reduce((s, d) => s + heldFor(d), 0);
  const openSum = list.filter((d) => d.state === "funded").reduce((s, d) => s + heldFor(d), 0);
  const v = opsBase.volume;
  const vTotal = v.thirdParty + v.team + v.test;
  const r = opsBase.relayer;
  const gasLow = r.balanceUsdc < r.warnBelowUsdc;
  const cap = opsBase.caps;

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label">Operator · read only</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Monitor</h1>
        </div>
        <Link
          href="/operator/pause"
          className={`rounded-md border px-3.5 py-2 text-[13px] font-semibold ${ops.paused ? "border-hold bg-hold-wash text-hold" : "border-rule hover:bg-sheet"}`}
        >
          {ops.paused ? "New deals are paused · manage" : "New deals are open · pause…"}
        </Link>
      </div>
      <p className="mt-2 max-w-2xl text-[14px] text-graphite">This console reads. It can pause new deals and nothing else: no screen here can move, freeze or redirect anyone's funds, and no deal page has an operator action.</p>

      {ops.paused ? (
        <div role="status" className="mt-4 rounded-md border border-hold/50 bg-hold-wash px-4 py-3 text-[13.5px]">
          <span className="font-semibold text-hold">New deals paused since {ops.pausedAt}.</span> Creating and funding new deals is off. Claims, refunds, disputes, decisions, retries and fee withdrawals all still work.
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card title="Volume locked to date" note="Only third-party volume is adoption. Team and test volume are labelled and never counted as customers.">
          <p className="mono text-[26px] font-medium">{usdc(vTotal)} <span className="text-[13px] text-graphite">USDC</span></p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-rule" aria-hidden>
            <span className="bg-released" style={{ width: `${(v.thirdParty / vTotal) * 100}%` }} />
            <span className="bg-held" style={{ width: `${(v.team / vTotal) * 100}%` }} />
            <span className="bg-graphite/50" style={{ width: `${(v.test / vTotal) * 100}%` }} />
          </div>
          <dl className="mt-3 space-y-1.5 text-[13.5px]">
            <Key dot="bg-released" k="Third-party customers" v={v.thirdParty} />
            <Key dot="bg-held" k="Team deals" v={v.team} />
            <Key dot="bg-graphite/50" k="Test and self-dealing, labelled" v={v.test} />
          </dl>
        </Card>

        <Card title="Locked right now" note="Compared with the early-access limits and with the sum of open deals.">
          <p className="mono text-[26px] font-medium">{usdc(locked)} <span className="text-[13px] text-graphite">of {usdc(cap.totalLockedUsdc)}</span></p>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-rule" role="img" aria-label={`${Math.round((locked / cap.totalLockedUsdc) * 100)}% of the total cap`}>
            <span className="block h-full bg-held" style={{ width: `${Math.min(100, (locked / cap.totalLockedUsdc) * 100)}%` }} />
          </div>
          <dl className="mt-3 space-y-1.5 text-[13.5px]">
            <Row k="Locked on chain" v={`${usdc(locked)} USDC`} />
            <Row k="Sum of open deals" v={`${usdc(openSum)} USDC`} />
            <Row k="Reconciliation" v={locked === openSum ? <span className="text-released">Matches</span> : <span className="font-semibold text-hold">Mismatch · investigate</span>} />
            <Row k="Largest single deal allowed" v={`${usdc(cap.perDealUsdc)} USDC`} />
          </dl>
        </Card>

        <Card title="Deals by state">
          <ul className="divide-y divide-rule text-[14px]">
            {counts.map(([k, n]) => (
              <li key={k} className="flex items-baseline justify-between py-2">
                <span>{stateLabel[k]}</span>
                <span className="mono">{n}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Open disputes" note="Names are hidden here; the public record shows the parts that are public.">
          {disputes.length === 0 ? (
            <p className="text-[14px] text-graphite">None open.</p>
          ) : (
            <ul className="divide-y divide-rule text-[14px]">
              {disputes.map(({ d, x }) => (
                <li key={`${d.id}-${x.stub}`} className="flex items-baseline justify-between gap-3 py-2">
                  <span>
                    <Link href={`/record/${d.id}`} target="_blank" className="mono underline decoration-rule underline-offset-2">{d.id}</Link> · stub {x.stub}
                  </span>
                  <span className="text-right text-[12.5px] text-graphite">{x.responseClosed ? `arbiter decides by ${x.decideBy}` : `response due ${x.responseDue}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Relayer" note="Pays network gas for claims and refunds. It cannot choose recipients or amounts.">
          <dl className="space-y-1.5 text-[13.5px]">
            <Row k="Wallet" v={<span className="mono">{r.address}</span>} />
            <Row k="Gas balance" v={<span className={gasLow ? "font-semibold text-hold" : ""}><span className="mono">{usdc(r.balanceUsdc)}</span> USDC{gasLow ? " · top up" : ""}</span>} />
            <Row k="Last poll" v={`${r.lastPolledSecondsAgo} s ago`} />
            <Row k="Read to block" v={<span className="mono">{r.cursorBlock.toLocaleString("en-US")} of {r.chainHeadBlock.toLocaleString("en-US")}</span>} />
            <Row k="Pending / failed (24 h)" v={<span className="mono">{r.pendingAttempts} / {r.failedAttempts24h}</span>} />
          </dl>
        </Card>

        <Card title="Health">
          <ul className="divide-y divide-rule text-[14px]">
            {opsBase.health.map((h) => (
              <li key={h.name} className="flex items-baseline justify-between gap-3 py-2">
                <span className="flex items-baseline gap-2">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${h.ok ? "bg-released" : "bg-hold"}`} />
                  {h.name}
                </span>
                <span className="text-right text-[12.5px] text-graphite">{h.note}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <section className="mt-6">
        <h2 className="text-[18px] font-semibold tracking-tight">Recent changes</h2>
        <ol className="mt-2 divide-y divide-rule rounded-md border border-rule bg-sheet text-[13.5px]">
          {ops.log.map((l, i) => (
            <li key={i} className="flex gap-3 px-3.5 py-2.5">
              <span className="mono w-40 shrink-0 text-[12px] text-graphite">{l.at}</span>
              {l.text}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-rule bg-sheet p-4 md:p-5">
      <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
      {note ? <p className="mt-0.5 mb-3 text-[12.5px] text-graphite">{note}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-graphite">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

function Key({ dot, k, v }: { dot: string; k: string; v: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex items-baseline gap-2">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${dot}`} />
        {k}
      </dt>
      <dd className="mono">{usdc(v)}</dd>
    </div>
  );
}
