import { earlyResolve } from '@/integration/network'
import type { Metadata } from 'next'
import { PublicShell } from '@/ui/PublicShell'

export const metadata: Metadata = {
  title: 'Terms, privacy and security',
  description: 'Plain-language summary of how Waybill works and what it does not do. A draft pending review by counsel.',
}

/**
 * Plain statements of how the product behaves today. They promise nothing the software does not do: where a policy
 * (retention periods, a security contact) is not decided yet, the text says so instead of inventing one.
 */
/** What happens after a response depends on the escrow this site uses; say only what that escrow enforces. */
function afterResponse(): string {
  let early = false
  try {
    early = earlyResolve()
  } catch {
    // no network configured at build: describe the rule of the current testnet escrow
  }
  return early
    ? 'After a response, the side who raised the dispute has 24 hours to answer it, and the arbiter can decide once that time ends, or sooner if they say they have nothing to add. With no response, the arbiter decides after the response time ends.'
    : 'The arbiter can decide once that time has ended, whether or not a response was filed.'
}

const sections = [
  {
    id: 'terms',
    title: 'Terms',
    points: [
      'Waybill is for businesses. You confirm business use when you create a deal.',
      'Waybill is not a bank, custodian, lender or court. Money in a deal is held by a smart contract on Arc and moves only by the rules fixed when the deal is created. Nobody at Waybill can move, freeze or redirect it.',
      'An arbiter’s decision decides where one frozen part goes. It does not settle customs, tax or wider contract claims, and you keep your legal remedies.',
      'Attestors sign narrow, templated statements. Waybill does not inspect goods and does not guarantee what an attestor confirms.',
      'Early-access limits on deal size and on the total held in escrow apply and are shown in the product. This service may currently run on a test network with test money.',
      'The details a buyer records about goods and people are kept by Waybill, not by the contract, and the contract does not enforce them.',
    ],
  },
  {
    id: 'disputes',
    title: 'How disputes work',
    points: [
      'A buyer can dispute a part while it is in review. A supplier can dispute a part that is overdue, during its grace period. A dispute freezes only that part; the others carry on.',
      `The other side has 72 hours to respond with their side and files. ${afterResponse()}`,
      'Both sides can add evidence until the decision. Files are encrypted, and only the people named in the deal and the arbiter can read them.',
      'The arbiter, or any two of a three-member panel who agree, decides the frozen part: pay the supplier, refund the buyer, or split it. The written reasoning is stored with the dispute files for both sides to read.',
      'If no decision is made by the deadline shown on the deal, a default applies: a dispute the buyer raised is refunded to the buyer, and one the supplier raised is paid to the supplier. The arbiter fee then goes back to the buyer.',
      'The buyer can withdraw a dispute they raised at any time before it is decided.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    points: [
      'Everything written to the blockchain, including wallet addresses, amounts and deadlines, is public and cannot be removed.',
      'Details about goods, names and places stay off the public record unless the buyer chooses to make them public.',
      'An email address is stored only if you add it in settings, is used only for updates about your deals, and is mailed only after you confirm it from a link sent to it. You can switch updates off at any time.',
      'Evidence files are encrypted before they are stored, and only the people named in the deal can read them. How long they are kept will be set before launch.',
    ],
  },
  {
    id: 'security',
    title: 'Security',
    points: [
      'Waybill will never ask for your seed phrase or private key, in the app, by email or in a chat message.',
      'Every payment is a transaction you sign in your own wallet. Waybill’s servers cannot sign for you.',
      'A security contact and a way to report a problem will be published here before launch.',
    ],
  },
] as const

export default function Legal() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-20 md:px-8 md:pt-14 lg:grid lg:grid-cols-[13rem_minmax(0,48rem)] lg:gap-x-16">
        <div className="lg:col-start-2 lg:row-start-1">
        <p role="note" className="inline-block rounded-md border border-hold/50 bg-hold-wash px-3 py-1.5 text-[13px] font-semibold">Draft, pending review by counsel</p>
        <h1 className="mt-2 text-[34px] leading-tight font-semibold tracking-tight">Terms, privacy and security</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-graphite">
          Plain-language statements of how Waybill works today. The full documents are written and reviewed before launch, and nothing here is legal advice.
        </p>
        </div>
        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1"><nav aria-label="On this page" className="mt-5 flex flex-wrap gap-x-5 text-[13.5px] lg:sticky lg:top-24 lg:mt-2 lg:flex-col">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-11 min-w-11 items-center justify-center underline lg:justify-start">{s.title}</a>
          ))}
        </nav></div>
        <div className="lg:col-start-2 lg:row-start-2">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-10 scroll-mt-20 border-t border-ink/80 pt-4">
            <h2 id={`${s.id}-h`} className="text-[20px] font-semibold">{s.title}</h2>
            <ul className="mt-3 space-y-2.5 text-[14.5px] leading-relaxed">
              {s.points.map((p) => (
                <li key={p} className="flex gap-3">
                  <span aria-hidden className="mt-[10px] h-px w-3 shrink-0 bg-graphite" />
                  {p}
                </li>
              ))}
            </ul>
          </section>
        ))}
        </div>
      </main>
    </PublicShell>
  )
}
