"use client";

import { DemoInvites } from "@/components/builder/DemoInvites";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Acceptances } from "@/components/Acceptances";
import { EvidencePanel } from "@/components/Evidence";
import { LiveLedger, LiveWaybill } from "@/components/live/Live";
import { Drawer, Modal } from "@/components/Modal";
import { LineItems } from "@/components/Sheet";
import { DisputedAction, PayingAction, RefundAction, ReviewAction } from "@/components/StubActions";
import { Timeline } from "@/components/Timeline";
import { TxFlow, type TxStep } from "@/components/TxFlow";
import { heldFor, needsBuyer, refundedFor, type DealRecord } from "@/demo/deals";
import type { Tranche } from "@/demo/deal";
import { act, demoNow, newHash, orderedIds, useDemo } from "@/demo/store";
import { usdc } from "@/demo/format";

const ESCROW = "WaybillEscrow · demo";

type Dialog =
  | { kind: "fund" }
  | { kind: "approve"; t: Tranche }
  | { kind: "dispute"; t: Tranche }
  | { kind: "withdraw"; t: Tranche }
  | { kind: "refund"; t: Tranche }
  | { kind: "cancel" }
  | null;

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function DealScreen({ id }: { id: string }) {
  const { deals, ops } = useDemo();
  const d = deals[id];
  const [dialog, setDialog] = useState<Dialog>(null);
  const [evidence, setEvidence] = useState<Tranche | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const now = demoNow();

  // The relayer pays claimable stubs on the supplier's behalf: a fixed `claim`, sent shortly after it becomes claimable.
  const claimable = d?.tranches.find((t) => t.state === "claimable");
  useEffect(() => {
    if (!claimable) return;
    const h = setTimeout(() => act.claim(id, claimable.index), 2400);
    return () => clearTimeout(h);
  }, [id, claimable?.index, claimable]);

  if (!d) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <p className="label">Not found</p>
        <h1 className="mt-1 text-[24px] font-semibold">No deal called {id}</h1>
        <Link href="/app" className="mt-4 inline-block text-held underline">
          Back to deals
        </Link>
      </main>
    );
  }

  const close = () => !busy && setDialog(null);
  const done = (fn: () => void) => () => {
    fn();
    setBusy(false);
    setDialog(null);
  };
  const funded = d.state === "funded" || d.state === "settled";

  // ——— Stub actions ———
  const actions: Record<number, React.ReactNode> = {};
  for (const t of d.tranches) {
    if (t.state === "in_review") {
      const ends = t.reviewEnds?.split(", ")[1]?.replace(" GMT", "") ?? "18:40";
      const left = Math.max(0, minutes(ends) - minutes(now));
      actions[t.index] = (
        <ReviewAction
          left={`${Math.floor(left / 60)} h ${String(left % 60).padStart(2, "0")} m`}
          pct={Math.round((left / (t.reviewHours * 60)) * 100)}
          ends={`${ends} GMT`}
          signer={t.signedBy ?? t.confirmedBy.split(",")[0]}
          signedAt={t.signedAt ?? ""}
          files={t.evidence?.length ?? 0}
          onReview={() => setEvidence(t)}
          onDispute={() => setDialog({ kind: "dispute", t })}
        />
      );
    } else if (t.state === "claimable") {
      actions[t.index] = <PayingAction hash="sending…" approvedAt={now} />;
    } else if (t.state === "disputed") {
      const others = d.tranches.filter((x) => x.index !== t.index && x.state === "released").map((x) => x.index);
      actions[t.index] = (
        <DisputedAction
          what={t.short.toLowerCase()}
          at={d.timeline.filter((e) => e.text.startsWith(`Disputed stub ${t.index}`)).at(-1)?.at ?? now}
          others={others.length ? `Stub${others.length > 1 ? "s" : ""} ${others.join(" and ")} stay${others.length > 1 ? "" : "s"} paid.` : "Other stubs are not affected."}
          onRoom={() => router.push(`/app/deals/${d.id}/room/${t.index}`)}
          onWithdraw={() => setDialog({ kind: "withdraw", t })}
        />
      );
    } else if (t.state === "refundable") {
      actions[t.index] = <RefundAction amount={t.amount} fee={t.fee} onRefund={() => setDialog({ kind: "refund", t })} />;
    }
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/d/${d.id}`);
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_300px]">
      <DealRail current={d.id} deals={deals} />

      <main className="min-w-0 px-4 pt-6 pb-10 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="label">
              <Link href="/app" className="hover:text-ink lg:hidden">
                ← Deals ·{" "}
              </Link>
              {d.id} · {stateLabel(d)}
            </p>
            <h1 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight md:text-[28px]">
              {d.goods.split(",")[0]} from {d.supplier.org.split(" ").slice(0, 2).join(" ")}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2 text-[13px]">
            <button onClick={share} className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">
              {copied ? "Link copied ✓" : "Copy supplier link"}
            </button>
            <Link href={`/d/${d.id}`} target="_blank" className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">
              Supplier's view ↗
            </Link>
            {funded || d.state === "cancelled" ? (
              <Link href={`/record/${d.id}`} target="_blank" className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">
                Public record ↗
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-6">
          {d.state === "proposed" ? (
            <div className="space-y-3">
              <Acceptances rows={d.acceptances} />
              {d.onchainId > 440 ? <DemoInvites deal={d} /> : null}
              <div className="flex flex-wrap gap-2">
                <button disabled className="cursor-not-allowed rounded-md bg-ink/20 px-4 py-2.5 text-[14px] font-semibold text-paper">
                  Fund {usdc(d.funded)}
                </button>
                <button onClick={() => setDialog({ kind: "cancel" })} className="rounded-md px-3 py-2.5 text-[13.5px] text-graphite hover:text-hold">
                  Cancel deal
                </button>
              </div>
            </div>
          ) : d.state === "accepted" ? (
            <div className="space-y-3">
              <Acceptances rows={d.acceptances} />
              <button
                disabled={ops.paused}
                onClick={() => setDialog({ kind: "fund" })}
                className="rounded-md bg-held px-5 py-2.5 text-[14px] font-semibold text-sheet disabled:cursor-not-allowed disabled:opacity-40"
              >
                Fund {usdc(d.funded)} USDC
              </button>
              {ops.paused ? (
                <p role="status" className="rounded-md border border-hold/50 bg-hold-wash px-3.5 py-2.5 text-[13px]">
                  <span className="font-semibold text-hold">Funding is paused.</span> The Waybill team paused creating and funding new deals. Your terms are safe and the supplier's acceptance stands. Funding opens again when the pause ends. Deals already funded are not affected.
                </p>
              ) : null}
            </div>
          ) : d.state === "cancelled" ? (
            <p className="rounded-md border border-rule bg-sheet p-4 text-[14px]">This deal was cancelled before funding. Nothing was locked and it can't be funded now.</p>
          ) : (
            <>
              {d.state === "settled" ? (
                <p className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-released/40 bg-released-wash px-4 py-3 text-[14px]">
                  <span>
                    <span className="font-semibold text-released">Settled.</span> Every part has reached its final fate.
                  </span>
                  <Link href={`/print/${d.id}`} target="_blank" className="text-[13px] font-semibold underline">
                    Download record
                  </Link>
                </p>
              ) : null}
              <LiveLedger ts={d.tranches} refunded={refundedFor(d)} arbiterFee={d.arbiterFee} size={d.funded} held={d.state === "settled" ? heldFor(d) : undefined} />
            </>
          )}
        </div>

        <div className="mt-8">
          <LiveWaybill info={d} ts={d.tranches} detail="summary" compact showLockStamp={false} proposed={!funded} actions={actions} />
        </div>

        {funded ? (
          <section className="mt-10 max-w-2xl rounded-md border border-rule bg-sheet p-4">
            <p className="label">Public page</p>
            <p className="mt-1 text-[13.5px] leading-snug">
              Anyone with the link sees amounts, parts and dates. Choose whether names appear. Wallet addresses on the explorer stay public either way.
            </p>
            <div role="group" aria-label="Public page names" className="mt-3 inline-flex rounded-full border border-rule p-0.5 text-[12.5px]">
              {[
                [false, "Status only"],
                [true, "Show names"],
              ].map(([v, l]) => (
                <button
                  key={String(l)}
                  onClick={() => act.setPublicNames(d.id, v as boolean)}
                  aria-pressed={!!d.publicNames === v}
                  className={`rounded-full px-3 py-1 ${!!d.publicNames === v ? "bg-ink text-paper" : "text-graphite"}`}
                >
                  {l as string}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <p className="mt-10 max-w-2xl text-[12.5px] leading-relaxed text-graphite">
          {funded ? "Terms froze when you funded. " : "Terms freeze when you fund. "}Nobody, including Waybill, can move this money except by these rules.{" "}
          <Link href="/#rules" className="underline decoration-rule underline-offset-2 hover:text-ink">
            What Waybill does not protect against
          </Link>
        </p>
      </main>

      <aside className="border-t border-rule px-5 py-6 lg:border-t-0 lg:border-l" aria-label="Timeline">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="label">Timeline</h2>
          <span className="text-[11px] text-graphite">GMT</span>
        </div>
        <Timeline events={d.timeline} nowLabel={d.timeline.some((e) => e.upcoming) ? now : undefined} />
      </aside>

      {/* ——— Dialogs ——— */}
      <Drawer open={!!evidence} onClose={() => setEvidence(null)} label="Evidence">
        <EvidencePanel
          d={d}
          t={evidence ?? undefined}
          onApprove={() => {
            const t = evidence!;
            setEvidence(null);
            setDialog({ kind: "approve", t });
          }}
          onDispute={() => {
            const t = evidence!;
            setEvidence(null);
            setDialog({ kind: "dispute", t });
          }}
        />
      </Drawer>

      <Modal open={dialog?.kind === "fund"} onClose={close} locked={busy} label="Fund this deal">
        <p className="label">{d.id} · lock the money</p>
        <h2 className="mt-1 text-[19px] font-semibold">Fund this deal</h2>
        <div className="mt-4">
          <LineItems
            items={[
              { label: "Deal total", amount: d.total, note: `Paid to the supplier in ${d.tranches.length} parts` },
              { label: "Waybill fee, 0.75%", amount: d.feeTotal, note: "Returned with any part that's refunded" },
              { label: "Arbiter fee", amount: d.arbiterFee, note: "Paid only if a dispute is decided in time" },
            ]}
            total={d.funded}
            totalLabel="You lock"
          />
        </div>
        <p className="mt-3 mb-4 text-[12.5px] text-graphite">On Arc. Once sent, Waybill can't reverse it; only the deal's rules can move this money.</p>
        <TxFlow
          confirmLabel="Fund"
          steps={fundSteps(d)}
          onCancel={close}
          onDone={done(() => act.fund(d.id, newHash()))}
        />
      </Modal>

      {dialog?.kind === "approve" ? (
        <Modal open onClose={close} locked={busy} label="Approve and release">
          <p className="label">
            Stub {dialog.t.index} · {dialog.t.short.toLowerCase()}
          </p>
          <h2 className="mt-1 text-[19px] leading-tight font-semibold">
            Release {usdc(dialog.t.amount)} USDC to {d.supplier.org.split(" ").slice(0, 2).join(" ")} now?
          </h2>
          <p className="mt-2 mb-4 text-[13.5px] leading-relaxed">
            This ends your review early. The money goes to their payout address and Waybill can't return it. Other stubs stay locked.
          </p>
          <TxFlow
            confirmLabel="Approve and release"
            steps={[{ label: "Approve", wallet: { action: `approveMilestone(${d.onchainId}, ${dialog.t.index - 1})`, to: ESCROW, note: "Ends the review window. Payment is sent next." } }]}
            onCancel={close}
            onDone={done(() => act.approve(d.id, dialog.t.index))}
          />
        </Modal>
      ) : null}

      {dialog?.kind === "dispute" ? <DisputeDialog d={d} t={dialog.t} onClose={close} onDone={done} /> : null}

      {dialog?.kind === "withdraw" ? (
        <Modal open onClose={close} label="Withdraw dispute">
          <h2 className="text-[19px] font-semibold">Withdraw the dispute on stub {dialog.t.index}?</h2>
          <p className="mt-2 mb-4 text-[13.5px]">The stub goes back to your review. If you then do nothing, it releases when the review window ends.</p>
          <TxFlow
            confirmLabel="Withdraw dispute"
            steps={[{ label: "Withdraw", wallet: { action: `withdrawDispute(${d.onchainId}, ${dialog.t.index - 1})`, to: ESCROW } }]}
            onCancel={close}
            onDone={done(() => act.withdrawDispute(d.id, dialog.t.index))}
          />
        </Modal>
      ) : null}

      {dialog?.kind === "refund" ? (
        <Modal open onClose={close} locked={busy} label="Refund">
          <p className="label">
            Stub {dialog.t.index} · {dialog.t.short.toLowerCase()} not confirmed
          </p>
          <h2 className="mt-1 text-[19px] font-semibold">Take this part back</h2>
          <div className="mt-4">
            <LineItems
              items={[
                { label: `Stub ${dialog.t.index}`, amount: dialog.t.amount },
                { label: "Its 0.75% fee", amount: dialog.t.fee },
              ]}
              total={dialog.t.amount + dialog.t.fee}
              totalLabel="Back to you"
            />
          </div>
          <p className="mt-3 mb-4 text-[12.5px] text-graphite">To your refund address 0x46…D0F1. Parts already paid stay paid.</p>
          <TxFlow
            tone="refunded"
            confirmLabel="Refund to me"
            steps={[{ label: "Refund", wallet: { action: `refund(${d.onchainId}, ${dialog.t.index - 1})`, to: ESCROW, amount: dialog.t.amount + dialog.t.fee, note: "To your refund address" } }]}
            onCancel={close}
            onDone={done(() => act.refund(d.id, dialog.t.index))}
          />
        </Modal>
      ) : null}

      {dialog?.kind === "cancel" ? (
        <Modal open onClose={close} label="Cancel deal">
          <h2 className="text-[19px] font-semibold">Cancel {d.id}?</h2>
          <p className="mt-2 mb-4 text-[13.5px]">Nothing has been funded, so nothing moves. The supplier link stops working and the deal can't be restarted.</p>
          <TxFlow tone="hold" confirmLabel="Cancel deal" steps={[{ label: "Cancel", wallet: { action: `cancelUnaccepted(${d.onchainId})`, to: ESCROW } }]} onCancel={close} onDone={done(() => act.cancel(d.id))} />
        </Modal>
      ) : null}

    </div>
  );
}

function fundSteps(d: DealRecord): TxStep[] {
  return [
    {
      label: `Allow ${usdc(d.funded)} USDC`,
      wallet: { action: "approve(spender, amount)", to: "USDC on Arc", amount: d.funded, note: "Exact amount only. This doesn't move money yet." },
    },
    { label: "Lock it in escrow", wallet: { action: `fund(${d.onchainId})`, to: ESCROW, amount: d.funded, note: "Moves the money into the deal" } },
  ];
}

function DisputeDialog({ d, t, onClose, onDone }: { d: DealRecord; t: Tranche; onClose: () => void; onDone: (fn: () => void) => () => void }) {
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const ready = reason.trim().length >= 12 && files.length > 0;
  const others = d.tranches.filter((x) => x.index !== t.index && x.state === "released");
  return (
    <Modal open onClose={onClose} label="Dispute">
      <p className="label">
        Stub {t.index} · {t.short.toLowerCase()}
      </p>
      <h2 className="mt-1 text-[19px] font-semibold">Dispute this part</h2>
      <label className="label mt-4 block" htmlFor="reason">
        What's wrong
      </label>
      <textarea
        id="reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="For example: the inspection photos show a different model from the one we ordered."
        className="mt-1 w-full rounded-md border border-rule bg-paper p-2.5 text-[14px] outline-none focus:border-held"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {files.map((f) => (
          <span key={f} className="mono rounded border border-rule px-1.5 py-0.5 text-[11px] text-graphite">
            {f}
          </span>
        ))}
        <button onClick={() => setFiles((x) => [...x, x.length ? `photo-${x.length + 1}.jpg` : "photos-x6.jpg"])} className="rounded border border-dashed border-graphite/60 px-2 py-0.5 text-[12px]">
          + Add evidence
        </button>
      </div>
      <p className="mt-3 rounded-md bg-hold-wash p-2.5 text-[13px] text-hold">
        Only stub {t.index} ({usdc(t.amount)}) freezes.{" "}
        {others.length ? `Stub${others.length > 1 ? "s" : ""} ${others.map((x) => x.index).join(" and ")} stay${others.length > 1 ? "" : "s"} paid. ` : ""}The supplier gets 72 h to respond, then the arbiter
        decides.
      </p>
      <div className="mt-4">
        {ready ? (
          <TxFlow
            tone="hold"
            confirmLabel="Raise dispute"
            steps={[{ label: "Dispute", wallet: { action: `dispute(${d.onchainId}, ${t.index - 1}, evidenceHash)`, to: ESCROW, note: "Freezes this stub only" } }]}
            onCancel={onClose}
            onDone={onDone(() => act.dispute(d.id, t.index, reason.trim().slice(0, 120), files))}
          />
        ) : (
          <p className="rounded-md border border-dashed border-rule p-3 text-center text-[13px] text-graphite" role="status">
            Write what's wrong and add at least one file to continue.
          </p>
        )}
      </div>
    </Modal>
  );
}

function stateLabel(d: DealRecord) {
  if (d.state === "proposed") return "waiting for acceptances";
  if (d.state === "accepted") return "ready to fund";
  if (d.state === "cancelled") return "cancelled";
  if (d.state === "settled") return "settled";
  return `funded ${d.fundedAt?.split(",")[0] ?? ""}`;
}

function DealRail({ current, deals }: { current: string; deals: Record<string, DealRecord> }) {
  const groups: [string, DealRecord[]][] = [
    ["Needs you", orderedIds(deals).map((i) => deals[i]!).filter((d) => d && needsBuyer(d))],
    ["Waiting on others", orderedIds(deals).map((i) => deals[i]!).filter((d) => d && !needsBuyer(d) && d.state !== "settled" && d.state !== "cancelled")],
    ["Done", orderedIds(deals).map((i) => deals[i]!).filter((d) => d && (d.state === "settled" || d.state === "cancelled"))],
  ];
  return (
    <aside className="hidden border-r border-rule py-4 lg:block" aria-label="Deals">
      {groups.map(([g, list]) =>
        list.length ? (
          <div key={g} className="mb-4">
            <p className="label px-4 pb-1.5">{g}</p>
            {list.map((d) => {
              const need = needsBuyer(d);
              return (
                <Link
                  key={d.id}
                  href={`/app/deals/${d.id}`}
                  aria-current={d.id === current ? "page" : undefined}
                  className={`relative block py-2.5 pr-3 pl-4 ${d.id === current ? "bg-sheet" : "hover:bg-sheet/60"}`}
                >
                  {d.id === current ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-ink" /> : null}
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="mono text-[12.5px] font-medium">{d.id}</span>
                    <span className="mono text-[11px] text-graphite">{usdc(d.total)}</span>
                  </span>
                  <span className="block truncate text-[12.5px] text-graphite">{d.supplier.org}</span>
                  {need ? <span className="marked mt-1 inline-block text-[11.5px] font-semibold">{need}</span> : null}
                </Link>
              );
            })}
          </div>
        ) : null,
      )}
    </aside>
  );
}
