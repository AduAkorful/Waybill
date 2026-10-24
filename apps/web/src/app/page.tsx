import Link from 'next/link'
import { getBrowserNetwork } from '@/integration/network'
import { countDeals, getPublicDeal } from '@/server/deal'
import { HeaderSignIn } from '@/ui/HeaderSignIn'
import { PublicShell } from '@/ui/PublicShell'
import { Waybill } from '@/ui/Waybill'

// Counts and the example deal are read from the chain and refreshed on this interval.
export const revalidate = 60

const steps = [
  ['Agree the parts', 'The buyer splits the order into parts and names who confirms each one: an inspector, a forwarder, the buyer, or a due date.'],
  ['The supplier accepts', 'The supplier and every named confirmer accept before any money moves. Nobody is bound by a deal they have not seen.'],
  ['The buyer locks the money', 'USDC goes into the escrow contract on Arc. It is held there, not by Waybill.'],
  ['Parts are released', 'As each confirmer signs, that part is paid to the supplier. If something is wrong, the buyer can dispute a part and a named arbiter decides.'],
] as const

const rules = [
  'Nobody at Waybill can move, freeze or redirect the money in a deal.',
  'Pausing stops new deals only. It never touches claims, refunds, disputes or decisions already in progress.',
  'Payments are in USDC on Arc and are checked against the contract, not against a database.',
  'If a deadline passes, the contract’s own rule applies. It does not wait for us.',
] as const

const notCovered = [
  'Whether the goods are good. Confirmers sign a statement; Waybill does not inspect anything.',
  'Converting USDC to local money, or moving it in and out of a bank.',
  'Legal advice or any guarantee that a dispute will go your way.',
] as const

/** The newest settled or funded deal, so the example on the front page is always a real one. */
async function exampleDeal(total: bigint) {
  for (let i = total - 1n; i >= 0n && i >= total - 10n; i--) {
    const read = await getPublicDeal(i)
    if (read.status === 'ready' && (read.deal.state === 'funded' || read.deal.state === 'settled')) return read.deal
  }
  return null
}

export default async function Home() {
  const net = getBrowserNetwork()
  const total = await countDeals()
  const example = await exampleDeal(total)

  return (
    <PublicShell>
      <main className="mx-auto max-w-5xl px-4 pb-24 md:px-8">
        <section className="pt-10 pb-12 md:pt-16">
          <p className="label">Early access · {net.network === 'testnet' ? 'Arc test network' : 'Arc'}</p>
          <h1 className="mt-2 max-w-3xl text-[26px] leading-[1.1] font-semibold tracking-tight min-[400px]:text-[36px] md:text-[52px]">
            Pay overseas suppliers in stages, released when named people confirm.
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-graphite">
            Waybill holds a buyer’s USDC in an escrow contract and pays a supplier one part at a time, as the people both sides agreed on sign for each part.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <HeaderSignIn className="inline-flex min-h-11 items-center rounded-md bg-ink px-5 text-[14px] font-semibold text-paper" />
            <Link href="#how" className="inline-flex min-h-11 items-center rounded-md border border-rule px-5 text-[14px] font-semibold hover:bg-sheet">How it works</Link>
          </div>
          <p className="mt-5 text-[13px] text-graphite">
            {total.toString()} {total === 1n ? 'deal' : 'deals'} created on this network so far
            {net.network === 'testnet' ? ' · test money only' : ''}
          </p>
        </section>

        <section aria-labelledby="how" className="border-t border-rule pt-8">
          <h2 id="how" className="text-[22px] font-semibold tracking-tight">How it works</h2>
          <ol className="mt-5 grid gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-4">
            {steps.map(([title, text], i) => (
              <li key={title} className="bg-sheet p-4">
                <span className="mono text-[12px] text-graphite">{i + 1}</span>
                <h3 className="mt-1 text-[15px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-graphite">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        {example ? (
          <section aria-labelledby="example" className="mt-12 border-t border-rule pt-8">
            <h2 id="example" className="text-[22px] font-semibold tracking-tight">A real deal</h2>
            <p className="mt-1 mb-4 text-[14px] text-graphite">
              Deal {example.id.toString()} on {net.network === 'testnet' ? 'the test network' : 'Arc'}, read from the contract just now.
            </p>
            <Waybill deal={example} detail="summary" compact redacted />
            <Link href={`/record/${example.id}`} className="mt-4 inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-[13px] font-semibold hover:bg-sheet">
              Open its public record
            </Link>
          </section>
        ) : null}

        <section aria-labelledby="rules" className="mt-12 border-t border-rule pt-8">
          <h2 id="rules" className="text-[22px] font-semibold tracking-tight">Rules that do not change</h2>
          <ul className="mt-4 grid gap-2 text-[14.5px] md:grid-cols-2">
            {rules.map((r) => (
              <li key={r} className="rounded-md border border-rule bg-sheet px-4 py-3">{r}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="not" className="mt-12 border-t border-rule pt-8">
          <h2 id="not" className="text-[22px] font-semibold tracking-tight">What it does not cover</h2>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[14.5px] text-graphite">
            {notCovered.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      </main>
    </PublicShell>
  )
}
