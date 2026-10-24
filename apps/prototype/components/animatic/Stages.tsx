import { Wordmark } from "@/components/Chrome";
import { buyer } from "@/demo/deal";

/** A 1280×800 desktop workbench for animatic scenes: top bar, main column, optional side panel and modal. */
export function DeskStage({
  children,
  panel,
  modal,
  who = buyer.name,
  initials = buyer.initials,
}: {
  children: React.ReactNode;
  panel?: React.ReactNode;
  modal?: React.ReactNode;
  who?: string;
  initials?: string;
}) {
  return (
    <div className="relative flex h-full w-full flex-col bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-rule px-6 py-2.5">
        <div className="flex items-center gap-7">
          <Wordmark />
          <nav className="flex gap-5 text-[13px] text-graphite">
            <span className="font-semibold text-ink">Deals</span>
            <span>New deal</span>
            <span>Attestors</span>
          </nav>
        </div>
        <span className="flex items-center gap-2 text-[12.5px]">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-[10.5px] font-semibold text-paper">{initials}</span>
          {who}
        </span>
      </header>
      <div className={`grid min-h-0 flex-1 ${panel ? "grid-cols-[minmax(0,1fr)_460px]" : "grid-cols-1"}`}>
        <main className="min-w-0 overflow-hidden px-10 pt-6">{children}</main>
        {panel ? <div data-panel-wrap className="min-h-0">{panel}</div> : null}
      </div>
      {modal ? (
        <div className="absolute inset-0 grid place-items-center">
          <div data-scrim className="absolute inset-0 bg-ink/35" />
          <div data-modal className="relative w-[480px]">
            {modal}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A phone centred on the 1280×800 stage. `offset` scrolls the content; `overlay` sits on the bottom edge (sheets, sticky actions). */
export function PhoneStage({
  children,
  offset = 0,
  overlay,
  caption,
}: {
  children: React.ReactNode;
  offset?: number;
  overlay?: React.ReactNode;
  caption?: string;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center gap-16 bg-paper text-ink">
      <div className="relative h-[760px] w-[380px] overflow-hidden rounded-[44px] border-[10px] border-[#141518] bg-paper shadow-[0_30px_60px_-30px_rgb(0_0_0/0.5)]">
        <div className="absolute inset-x-0 top-0" style={{ transform: `translateY(${-offset}px)` }}>
          {children}
        </div>
        {overlay ? <div className="absolute inset-x-0 bottom-0">{overlay}</div> : null}
      </div>
      {caption ? <p className="label w-48">{caption}</p> : null}
    </div>
  );
}

/** Bottom sheet inside a phone. */
export function PhoneSheet({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div data-scrim className="absolute inset-x-0 bottom-0 h-[760px] bg-ink/35" />
      <div data-sheet className="relative rounded-t-2xl border-t border-rule bg-sheet px-5 pt-5 pb-7">
        {children}
      </div>
    </>
  );
}
