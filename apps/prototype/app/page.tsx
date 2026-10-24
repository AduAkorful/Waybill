import { LandingHero } from "@/components/LandingHero";
import Link from "next/link";
import { PhoneFrame } from "@/components/PhoneFrame";
import { PublicShell } from "@/components/PublicShell";
import { SupplierLink } from "./frames/supplier/SupplierLink";
import { deal, tranches } from "@/demo/deal";
import { usdc } from "@/demo/format";

export const metadata = { title: "Waybill · Pay a deposit, release the rest when someone you trust confirms the goods" };

const steps = [
  {
    n: "01",
    pct: "20%",
    title: "Your supplier accepts",
    who: "No inspector needed",
    body: "You lock the full amount. The supplier sees it locked, accepts, and the first part is paid at once.",
  },
  {
    n: "02",
    pct: "30%",
    title: "An inspector checks the goods",
    who: "Signed by the inspector you chose",
    body: "They sign one narrow sentence about the sample, with photos and a report. You get 12 hours to look before it pays.",
  },
  {
    n: "03",
    pct: "50%",
    title: "Your forwarder confirms arrival",
    who: "Signed by your forwarder in Tema",
    body: "Cartons counted at the port. You get 48 hours to check, approve early, or dispute just this part.",
  },
];

const roles = [
  {
    who: "Importers",
    line: "Pay a deposit, and release the balance when someone you trust confirms the goods.",
    cta: "Start a deal",
    href: "/signin?as=buyer",
  },
  {
    who: "Suppliers · 供应商",
    line: "The money is locked before you produce, and you are paid the moment each part is confirmed. In English or 中文, no crypto knowledge needed.",
    cta: "I received a deal link",
    href: "/d/WB-0419",
  },
  {
    who: "Forwarders and inspectors",
    line: "Earn a fee for the confirmations you already make, and offer your clients protected payment. You sign exactly one sentence.",
    cta: "Become an attestor",
    href: "/signin?as=attestor",
  },
];

const compare: { row: string; cells: [string, string, string, string] }[] = [
  { row: "Works for deals agreed on WhatsApp or WeChat", cells: ["Yes", "Yes", "No, platform orders only", "Yes"] },
  { row: "Supplier can see the money before producing", cells: ["No", "No", "Yes", "Yes, locked and public"] },
  { row: "Paid only when someone you chose confirms", cells: ["No", "No", "Buyer confirms receipt", "Yes, per part"] },
  { row: "Money back if a part is never confirmed", cells: ["Rarely", "No", "Through a dispute", "Yes, after the grace period"] },
  { row: "A dispute stops only the part in question", cells: ["—", "—", "Whole order", "Yes"] },
  { row: "Who can move the money", cells: ["Your bank", "Whoever holds it", "The platform", "Only the deal's rules"] },
];

const rules = [
  ["Terms freeze when funded", "Parties, amounts, inspectors and deadlines cannot change once the money is locked."],
  ["Nobody can move the money", "Not Waybill, not an admin key. Funds go only to the supplier, back to you, or to fee recipients by the deal's rules."],
  ["A dispute freezes one part", "Parts already paid stay paid. Everything else carries on."],
  ["The arbiter has two choices", "Release that part to the supplier or return it to you. Nothing else."],
];

const notCovered = [
  "Goods that change after the inspected sample",
  "Loss or damage in transit after the last confirmation",
  "An inspector who is honest but mistaken",
  "Someone taking over your own wallet",
  "Customs, tax or contract-law outcomes",
];

export default function Landing() {
  return (
    <PublicShell>
      <LandingHero />

      {/* How it works: the three stubs */}
      <section id="how" className="border-y border-rule bg-sheet">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <p className="label">How it works</p>
          <h2 className="mt-2 max-w-2xl text-[30px] leading-tight font-semibold tracking-tight md:text-[36px]">
            One deal, three stubs. Each tears off only when it's confirmed.
          </h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n} className="bg-paper p-6">
                <p className="flex items-baseline justify-between">
                  <span className="mono text-[13px] text-graphite">{s.n}</span>
                  <span className="condensed text-[30px] leading-none font-extrabold">{s.pct}</span>
                </p>
                <h3 className="mt-6 text-[18px] font-semibold">{s.title}</h3>
                <p className="label mt-1 text-held">{s.who}</p>
                <p className="mt-3 text-[14px] leading-relaxed text-graphite">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[13px] text-graphite">
            Example: a {usdc(deal.total)} USDC order on the Standard 20/30/50 template. You choose the split, the inspector and the forwarder when
            you create the deal.
          </p>
        </div>
      </section>

      {/* The supplier's view: the moment that makes or breaks the deal */}
      <section id="suppliers" className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 md:px-8 lg:grid-cols-[1fr_auto]">
        <div className="max-w-xl">
          <p className="label">What your supplier sees</p>
          <h2 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight md:text-[38px]">
            Send one link. Your supplier sees the money is real before they start.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-graphite">
            They open it from WeChat, in Chinese, with no account and no crypto words. Every part, who confirms it, and what happens if
            something goes wrong is on one page. Accepting takes about two minutes, and a wallet is made for them.
          </p>
          <ul className="mt-6 space-y-2.5 text-[14.5px]">
            <li className="flex gap-2.5">
              <span className="text-released">✓</span> Fees are paid by you, so they see the full amount
            </li>
            <li className="flex gap-2.5">
              <span className="text-released">✓</span> Each part is paid to them as soon as it's confirmed, without them paying network fees
            </li>
            <li className="flex gap-2.5">
              <span className="text-released">✓</span> They can answer any dispute with their own evidence
            </li>
          </ul>
        </div>
        <div className="mx-auto w-full max-w-[400px] lg:w-[400px]">
          <PhoneFrame>
            <SupplierLink initial="zh" />
          </PhoneFrame>
        </div>
      </section>

      {/* Compared with what importers use today */}
      <section className="border-y border-rule bg-sheet">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8">
          <p className="label">Compared with what you use today</p>
          <h2 className="mt-2 max-w-2xl text-[30px] leading-tight font-semibold tracking-tight">
            A deposit you don't have to trust a stranger with.
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-ink/80">
                  <th className="w-[30%] py-2.5 pr-4 font-semibold" />
                  <th className="py-2.5 pr-4 font-semibold">Bank wire</th>
                  <th className="py-2.5 pr-4 font-semibold">USDT / USDC transfer</th>
                  <th className="py-2.5 pr-4 font-semibold">Trade Assurance</th>
                  <th className="rounded-t-md bg-held-wash px-3 py-2.5 font-semibold text-held">Waybill</th>
                </tr>
              </thead>
              <tbody>
                {compare.map((r, i) => (
                  <tr key={r.row} className="border-b border-rule">
                    <th scope="row" className="py-3 pr-4 font-medium">
                      {r.row}
                    </th>
                    {r.cells.map((c, j) => (
                      <td
                        key={j}
                        className={
                          j === 3
                            ? `bg-held-wash px-3 py-3 font-semibold ${i === compare.length - 1 ? "rounded-b-md" : ""}`
                            : "py-3 pr-4 text-graphite"
                        }
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] text-graphite">
            General comparison of how each method works, not a review of any provider. Trade Assurance covers orders paid through Alibaba.com.
          </p>
        </div>
      </section>

      {/* Roles */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          {roles.map((r, i) => (
            <div key={r.who} id={i === 2 ? "attestors" : undefined}>
              <p className="label">{r.who}</p>
              <p className="mt-3 text-[19px] leading-snug font-medium tracking-tight">{r.line}</p>
              <Link href={r.href} className="mt-4 inline-block text-[14px] font-semibold text-held underline decoration-held/30 underline-offset-4">
                {r.cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Rules + what it doesn't cover */}
      <section id="rules" className="border-t border-rule">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 md:px-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="label">The rules</p>
            <h2 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight">Money moves by rules everyone saw before paying.</h2>
            <dl className="mt-8 grid gap-6 sm:grid-cols-2">
              {rules.map(([t, d]) => (
                <div key={t} className="border-t border-ink/80 pt-3">
                  <dt className="text-[15px] font-semibold">{t}</dt>
                  <dd className="mt-1 text-[14px] leading-relaxed text-graphite">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="self-start rounded-md border border-dashed border-hold/50 p-6">
            <p className="label text-hold">What Waybill does not protect against</p>
            <ul className="mt-4 space-y-2.5 text-[14px] leading-relaxed">
              {notCovered.map((n) => (
                <li key={n} className="flex gap-2.5">
                  <span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-hold" />
                  {n}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[12.5px] text-graphite">An arbiter's decision covers one frozen part of one deal. You keep your legal remedies.</p>
          </div>
        </div>
      </section>

      {/* Fees */}
      <section id="fees" className="border-t border-rule bg-sheet">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:px-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="label">Fees</p>
            <h2 className="mt-2 text-[30px] leading-tight font-semibold tracking-tight">0.75% of each part that's paid.</h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-graphite">
              Charged only when a part releases, and returned with any part that's refunded. 40% of the fee on a confirmed part goes to the
              people who signed it. The arbiter's fee is fixed and agreed before you pay.
            </p>
          </div>
          <table className="w-full self-end text-[14px]">
            <caption className="label mb-2 text-left">On a {usdc(deal.total)} USDC order</caption>
            <thead>
              <tr className="border-b border-ink/80 text-left">
                <th className="py-2 font-semibold">Part</th>
                <th className="py-2 text-right font-semibold">Amount</th>
                <th className="py-2 text-right font-semibold">Fee</th>
                <th className="py-2 text-right font-semibold">To signers</th>
              </tr>
            </thead>
            <tbody className="mono text-[13px]">
              {tranches.map((t) => (
                <tr key={t.index} className="border-b border-rule">
                  <td className="py-2.5 font-sans text-[14px]">{t.short}</td>
                  <td className="py-2.5 text-right">{usdc(t.amount)}</td>
                  <td className="py-2.5 text-right">{usdc(t.fee)}</td>
                  <td className="py-2.5 text-right text-graphite">{usdc(t.feeAttestor)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2.5 font-sans text-[14px] font-semibold">Total</td>
                <td className="py-2.5 text-right font-semibold">{usdc(deal.total)}</td>
                <td className="py-2.5 text-right font-semibold">{usdc(deal.feeTotal)}</td>
                <td className="py-2.5 text-right text-graphite">{usdc(tranches.reduce((s, t) => s + t.feeAttestor, 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </PublicShell>
  );
}
