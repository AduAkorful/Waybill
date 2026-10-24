import { usdc } from "@/demo/format";

/** What goes on a stub when it needs the buyer. Each says what happens next and by when. */

export function ReviewAction({
  left = "9 h 00 m",
  pct = 75,
  signer = "Lin Mei",
  signedAt = "06:40",
  files = 4,
  ends = "18:40 GMT",
  onReview,
  onDispute,
}: {
  left?: string;
  pct?: number;
  signer?: string;
  signedAt?: string;
  files?: number;
  ends?: string;
  onReview?: () => void;
  onDispute?: () => void;
}) {
  return (
    <div data-action>
      <p className="text-[13px] leading-snug">
        <span className="font-semibold">
          {signer} signed at {signedAt}.
        </span>{" "}
        Check the {files} files.
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span data-mark className="marked mono text-[15px] font-semibold">
          {left}
        </span>
        <span className="text-[12.5px] text-graphite">left · releases {ends} if you do nothing</span>
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-rule" role="presentation">
        <div className="h-full rounded-full bg-held" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onReview} className="rounded-md bg-held px-3.5 py-2 text-[13px] font-semibold text-sheet hover:opacity-90">
          Review evidence
        </button>
        <button onClick={onDispute} className="rounded-md px-3 py-2 text-[13px] font-semibold text-hold hover:bg-hold-wash">
          Dispute
        </button>
      </div>
    </div>
  );
}

export function PayingAction({ hash = "0xc81f…0b47", approvedAt = "10:11" }: { hash?: string; approvedAt?: string }) {
  return (
    <div data-action className="text-[13px]">
      <p data-paying className="flex items-center gap-2 font-semibold text-held">
        <span className="h-2 w-2 animate-pulse rounded-full bg-held" /> Paying supplier…
      </p>
      <p className="mt-1 text-graphite">
        You approved at {approvedAt}. Waybill pays the network fee. <span className="mono text-[12px]">{hash}</span>
      </p>
    </div>
  );
}

export function OverdueAction({ left = "71 h 40 m", until = "13 Dec, 23:59 GMT" }: { left?: string; until?: string }) {
  return (
    <div data-action className="text-[13px]">
      <p className="font-semibold">Arrival wasn't confirmed by 10 Dec.</p>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="mono text-[15px] font-semibold text-hold">{left}</span>
        <span className="text-[12.5px] text-graphite">of grace left</span>
      </p>
      <p className="mt-1 text-[12.5px] text-graphite">The forwarder can still confirm, or the supplier can dispute, until {until}. Then you can take this part back.</p>
    </div>
  );
}

export function RefundAction({ amount, fee, onRefund }: { amount: number; fee: number; onRefund?: () => void }) {
  return (
    <div data-action className="text-[13px]">
      <p className="font-semibold">Grace period over. No one confirmed arrival.</p>
      <button onClick={onRefund} className="mt-3 rounded-md bg-refunded px-3.5 py-2 text-[13px] font-semibold text-sheet">
        Refund {usdc(amount + fee)} to me
      </button>
      <p className="mt-1.5 text-[12px] text-graphite">
        {usdc(amount)} + its {usdc(fee)} fee. No one else needs to sign.
      </p>
    </div>
  );
}

export function DisputedAction({
  what = "arrival",
  at = "09:15",
  others = "Stubs 1 and 2 stay paid.",
  onRoom,
  onWithdraw,
}: {
  what?: string;
  at?: string;
  others?: string;
  onRoom?: () => void;
  onWithdraw?: () => void;
}) {
  return (
    <div data-action className="text-[13px]">
      <p className="font-semibold text-hold">
        You disputed {what} at {at}.
      </p>
      <p className="mt-1 text-[12.5px] text-graphite">Supplier response due in 72 h. {others}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button onClick={onRoom} className="rounded-md border border-rule px-3 py-1.5 text-[12.5px] font-semibold">
          Open dispute room
        </button>
        {onWithdraw ? (
          <button onClick={onWithdraw} className="rounded-md px-2.5 py-1.5 text-[12.5px] text-graphite hover:text-ink">
            Withdraw dispute
          </button>
        ) : null}
      </div>
    </div>
  );
}
