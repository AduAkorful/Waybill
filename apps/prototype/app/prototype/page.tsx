import { DemoMark, ThemeToggle, Wordmark } from "@/components/Chrome";

export const metadata = { title: "Waybill prototype" };

const frames = [
  { href: "/", code: "P1", name: "Landing", note: "Stage · the case for Waybill, the supplier's view, comparison, rules, fees" },
  { href: "/record/WB-0388", code: "P2", name: "Public deal record", note: "Proof page anyone can open · names and goods redacted" },
  { href: "/attestors/pearlgate", code: "P3", name: "Attestor profile", note: "Reputation as counts from outcomes" },
  { href: "/signin", code: "P4", name: "Sign in", note: "Invitation context beside email or wallet sign-in" },
  { href: "/frames/supplier", code: "S1", name: "Supplier link", note: "Web and phone · before accepting · English and 中文" },
  { href: "/frames/buyer", code: "B3", name: "Buyer deal", note: "Workbench · stub 2 needs a decision, 9 h left" },
  { href: "/frames/attestor", code: "A3", name: "Attestor signing", note: "Phone · evidence checklist, one upload still running" },
  { href: "/frames/tear", code: "★", name: "Stub tear", note: "Signature moment frozen at its peak" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <a href="/"><Wordmark /></a>
        <div className="flex gap-2">
          <DemoMark />
          <ThemeToggle />
        </div>
      </div>
      <h1 className="mt-10 text-[28px] font-semibold tracking-tight">Prototype index</h1>
      <p className="mt-1 max-w-xl text-[14px] text-graphite">
        Direction: Carbon Copy. Every deal is a waybill whose stubs tear off as tranches release. Still frames at full fidelity, invented
        demo data.
      </p>
      <ul className="mt-8 divide-y divide-rule border-y border-rule">
        {frames.map((f) => (
          <li key={f.href}>
            <a href={f.href} className="flex items-baseline gap-4 py-4 hover:bg-sheet">
              <span className="mono w-8 text-[13px] text-graphite">{f.code}</span>
              <span className="text-[16px] font-semibold">{f.name}</span>
              <span className="text-[13px] text-graphite">{f.note}</span>
            </a>
          </li>
        ))}
      </ul>

      <h2 className="mt-14 text-[22px] font-semibold tracking-tight">Clickable prototype</h2>
      <p className="mt-1 max-w-xl text-[14px] text-graphite">
        Batches (a) to (c): the public site, buyer, supplier, attestor and arbiter, each on phone and desktop. Actions are simulated and saved in this browser; open the buyer and supplier views in two tabs
        to see both sides change. “Reset demo” in the buyer's top bar starts over.
      </p>
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {[
          { href: "/", name: "Public site", note: "Landing, attestor directory and profiles, public deal records, printable summary, sign-in with invitation context" },
          { href: "/signin?as=attestor&invite=WB-0440", name: "Invitation sign-in · WB-0440", note: "What an inspector sees when they follow an email invitation" },
          { href: "/app", name: "Buyer · deals", note: "Fund, review evidence, approve and release, dispute, withdraw, refund, cancel" },
          { href: "/d/WB-0419", name: "Supplier link · WB-0419", note: "Accept in 中文 or English and create a payout wallet; the buyer can then fund" },
          { href: "/d/WB-0427", name: "Supplier link · WB-0427", note: "Funds locked, payments tracked, respond to a dispute, change payout wallet" },
          { href: "/attest", name: "Attestor · Lin Mei", note: "Accept an invitation, upload evidence and sign, see fees and withdraw, edit profile" },
          { href: "/app/new", name: "Buyer · deal builder", note: "Six templates, draggable split, plain-language summary, create and share on WhatsApp or WeChat" },
          { href: "/app/settings", name: "Buyer · settings", note: "Profile, wallet and network, notifications, display, public-page default, early-access limits" },
          { href: "/operator", name: "Operator · monitor and pause", note: "Read-only volumes, deals by state, disputes, relayer health, and the new-deal pause" },
          { href: "/arbiter", name: "Arbiter · dispute console", note: "Dispute room, response window, release / refund / split with published reasoning, fees" },
        ].map((f) => (
          <li key={f.href}>
            <a href={f.href} className="flex items-baseline gap-4 py-4 hover:bg-sheet">
              <span className="text-[16px] font-semibold">{f.name}</span>
              <span className="text-[13px] text-graphite">{f.note}</span>
            </a>
          </li>
        ))}
      </ul>

      <h2 className="mt-14 text-[22px] font-semibold tracking-tight">Motion</h2>
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {[
          { href: "/storyboard", name: "Storyboards", note: "8 flows, 40 beats: what's on screen, how it moves, why" },
          { href: "/motion", name: "Motion system", note: "Durations, staggers, playable eases, reduced-motion map" },
          { href: "/animatic", name: "Animatic", note: "Every flow at real speed from the real components; scrub, half speed, reduced motion" },
        ].map((f) => (
          <li key={f.href}>
            <a href={f.href} className="flex items-baseline gap-4 py-4 hover:bg-sheet">
              <span className="text-[16px] font-semibold">{f.name}</span>
              <span className="text-[13px] text-graphite">{f.note}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
