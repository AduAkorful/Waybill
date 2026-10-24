import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";
import { Ledger } from "@/components/Ledger";
import { Timeline } from "@/components/Timeline";
import { Waybill } from "@/components/Waybill";
import { buyer, deal, otherDeals, supplier, timeline, tranches } from "@/demo/deal";
import { usdc } from "@/demo/format";

export const metadata = { title: "B3 Buyer deal · Waybill prototype" };

function DealRow({
  id,
  route,
  who,
  amount,
  state,
  tone,
  active,
}: {
  id: string;
  route: string;
  who: string;
  amount: number;
  state: string;
  tone: "held" | "released" | "neutral" | "mark";
  active?: boolean;
}) {
  const dot = tone === "held" ? "bg-held" : tone === "released" ? "bg-released" : tone === "mark" ? "bg-mark ring-2 ring-mark/40" : "bg-graphite/50";
  return (
    <a href="#" className={`relative block py-2.5 pr-3 pl-4 ${active ? "bg-sheet" : "hover:bg-sheet/60"}`} aria-current={active ? "page" : undefined}>
      {active ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-ink" /> : null}
      <p className="flex items-baseline justify-between gap-2">
        <span className="mono text-[12.5px] font-medium">{id}</span>
        <span className="mono text-[11px] text-graphite">{usdc(amount)}</span>
      </p>
      <p className="truncate text-[12.5px] text-graphite">{who}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px]">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {state}
        <span className="mono ml-auto text-[10.5px] text-graphite">{route}</span>
      </p>
    </a>
  );
}

/** The decision, placed on the stub it acts on. */
function ReviewAction() {
  return (
    <div>
      <p className="text-[13px] leading-snug">
        <span className="font-semibold">Lin Mei signed at 06:40.</span> Check the 4 files.
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="marked mono text-[15px] font-semibold">9 h 00 m</span>
        <span className="text-[12.5px] text-graphite">left · releases 18:40 GMT if you do nothing</span>
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-rule" role="presentation">
        <div className="h-full rounded-full bg-held" style={{ width: "75%" }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded-md bg-held px-3.5 py-2 text-[13px] font-semibold text-sheet hover:opacity-90">Review evidence</button>
        <button className="rounded-md px-3 py-2 text-[13px] font-semibold text-hold hover:bg-hold-wash">Dispute</button>
      </div>
    </div>
  );
}

export default function BuyerDealFrame() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-7">
          <Wordmark />
          <nav className="hidden gap-5 text-[13px] text-graphite md:flex" aria-label="Main">
            <a href="#" className="font-semibold text-ink">
              Deals
            </a>
            <a href="#">New deal</a>
            <a href="#">Attestors</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <DemoMark />
          <ThemeToggle />
          <span className="ml-1 hidden items-center gap-2 text-[12.5px] sm:flex">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10.5px] font-semibold text-paper">{buyer.initials}</span>
            {buyer.name}
          </span>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)_300px]">
        <aside className="hidden border-r border-rule py-4 lg:block" aria-label="Deals">
          <p className="label px-4 pb-1.5">Needs you</p>
          <DealRow id={deal.id} route="CAN → ACC" who={supplier.org} amount={deal.total} state="Review closes 18:40" tone="mark" active />
          <p className="label px-4 pt-5 pb-1.5">Active</p>
          <DealRow {...otherDeals[0]} who={otherDeals[0].counterparty} />
          <p className="label px-4 pt-5 pb-1.5">Settled</p>
          <DealRow {...otherDeals[1]} who={otherDeals[1].counterparty} />
        </aside>

        <main className="min-w-0 px-4 pt-6 pb-10 md:px-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="label">
                {deal.id} · funded {deal.fundedAt.split(",")[0]}
              </p>
              <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-tight md:text-[28px]">Power banks from Baiyun Brightpower</h1>
            </div>
            <div className="flex gap-2 text-[13px]">
              <button className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">Share link</button>
              <button className="rounded-md border border-rule px-3 py-1.5 hover:bg-sheet">Download record</button>
            </div>
          </div>

          <div className="mt-6">
            <Ledger ts={tranches} />
          </div>

          <div className="mt-8">
            <Waybill detail="summary" showLockStamp={false} compact actions={{ 2: <ReviewAction /> }} />
          </div>

          <p className="mt-10 max-w-2xl text-[12.5px] leading-relaxed text-graphite">
            Nobody, including Waybill, can move this money except by the rules above.{" "}
            <a href="#" className="underline decoration-rule underline-offset-2 hover:text-ink">
              What Waybill does not protect against
            </a>
          </p>
        </main>

        <aside className="border-t border-rule px-5 py-6 lg:border-t-0 lg:border-l" aria-label="Timeline">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="label">Timeline</h2>
            <span className="text-[11px] text-graphite">GMT</span>
          </div>
          <Timeline events={timeline} nowLabel="09:40" />
        </aside>
      </div>
    </div>
  );
}
