'use client'

import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { useDealViews } from '@/data/use-deal-views'
import { useWalletDeals } from '@/data/wallet-deals'
import { heldFor, refundedFor, releasedFor } from '@/view/derive'
import { formatAmount, shortAddress } from '@/view/format'
import { needsFrom, sectionOf, statusLine, type Section } from '@/view/inbox'
import type { DealView, MilestoneState } from '@/view/types'
import { dealsInShell, isShell, shellLabel, type Shell } from '@/view/wallet'
import { ReadStatus } from '../ReadStatus'

const seg: Record<MilestoneState, string> = {
  released: 'bg-released',
  refunded: 'bg-refunded',
  in_review: 'bg-held',
  claimable: 'bg-held',
  disputed: 'bg-hold',
  waiting: 'border border-held/50',
  overdue: 'border border-dashed border-hold/70',
  refundable: 'border border-dashed border-refunded/70',
  resolved: 'bg-ink',
}

const INTRO: Record<Shell, string | null> = {
  buyer: null,
  supplier: null,
  attestor: null,
  arbiter:
    'You are asked to accept the role on each deal that names you; that only records that you agree and moves no money. After that, each dispute is one frozen part of one deal. You can release it to the supplier, refund it to the buyer, or split it. Nothing else, and never to yourself. If you miss the deadline, the default applies and your fee goes back to the buyer.',
}

function MiniLedger({ d }: { d: DealView }) {
  const unfunded = d.state === 'proposed' || d.state === 'accepted' || d.state === 'cancelled'
  return (
    <span className="flex h-1.5 w-full gap-[2px]" aria-hidden>
      {d.tranches.map((t) => (
        <span
          key={t.position}
          className={`rounded-[1px] ${unfunded ? 'border border-dashed border-rule' : seg[t.state]}`}
          style={{ flexGrow: t.bps, flexBasis: 0 }}
        />
      ))}
    </span>
  )
}

function Row({ d, need, shell }: { d: DealView; need: string | null; shell: Shell }) {
  const counterparty = shell === 'buyer' ? d.supplier : d.buyer
  return (
    <li>
      <Link
        href={shell === 'attestor' ? `/app/attest/${d.id}` : shell === 'supplier' ? `/d/${d.id}` : shell === 'arbiter' ? `/app/room/${d.id}` : `/app/deals/${d.id}`}
        className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 px-4 py-4 hover:bg-sheet md:grid-cols-[6rem_minmax(0,2fr)_minmax(8rem,1fr)_7rem_6rem] md:px-5"
      >
        <span className="mono text-[13px] font-medium">Deal {String(d.id)}</span>
        <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
          <span className="block truncate text-[14px] font-semibold">
            {d.terms?.goods ?? `${d.tranches.length} ${d.tranches.length === 1 ? 'part' : 'parts'}`}{' '}
            <span className="font-normal text-graphite">· {d.terms?.[shell === 'buyer' ? 'supplierName' : 'buyerName'] ?? shortAddress(counterparty)}</span>
          </span>
          <span className={`block truncate text-[12.5px] ${need ? 'text-ink' : 'text-graphite'}`}>{statusLine(d, need)}</span>
        </span>
        <span className="col-span-2 hidden md:col-span-1 md:block">
          <MiniLedger d={d} />
          {d.terms?.origin && d.terms.destination ? (
            <span className="mono mt-1 block text-[12px] text-graphite">
              {d.terms.origin.code} → {d.terms.destination.code}
            </span>
          ) : null}
        </span>
        <span className="mono row-start-1 text-right text-[13.5px] md:row-start-auto">{formatAmount(d.totalAmount)}</span>
        <span className="hidden text-right md:block">
          {need ? (
            <span className="rounded-md bg-held px-2.5 py-1 text-[12.5px] font-semibold text-sheet">{need}</span>
          ) : (
            <span className="text-[12.5px] text-graphite group-hover:text-ink">Open →</span>
          )}
        </span>
      </Link>
    </li>
  )
}

/** One role's deals, in the same three sections as the prototype, read from the escrow for each deal the relayer lists. */
export function RoleHome() {
  const { role } = useParams<{ role: string }>()
  const read = useWalletDeals()
  const { address } = useAccount()
  if (!isShell(role)) notFound()
  const listed = read.status === 'ready' ? dealsInShell(read.deals, role) : []
  const { done, reads } = useDealViews(listed.map((d) => d.dealId))

  if (read.status !== 'ready' || !address) return <ReadStatus read={read} />

  const loaded: DealView[] = []
  const failed: { id: bigint; message: string }[] = []
  for (const l of listed) {
    const r = reads.get(String(l.dealId))
    if (r?.status === 'ready') loaded.push(r.deal)
    else if (r?.status === 'error') failed.push({ id: l.dealId, message: r.message })
  }

  const needs = loaded.filter((d) => sectionOf(role, d, address) === 'needs')
  const waiting = loaded.filter((d) => sectionOf(role, d, address) === 'waiting')
  const finished = loaded.filter((d) => sectionOf(role, d, address) === 'done')
  const sum = (f: (d: DealView) => bigint) => loaded.reduce((s, d) => s + f(d), 0n)
  const showTotals = (role === 'buyer' || role === 'supplier') && loaded.length > 0

  const section = (kind: Section, title: string, items: DealView[], empty: string) => (
    <section className="mt-8">
      <h2 className="label mb-2 px-1">
        {title} · {items.length}
      </h2>
      {items.length ? (
        <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-paper">
          {items.map((d) => (
            <Row key={String(d.id)} d={d} need={kind === 'needs' ? needsFrom(role, d, address) : null} shell={role} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-rule px-4 py-6 text-center text-[13px] text-graphite">
          {done ? empty : 'Loading…'}
        </p>
      )}
    </section>
  )

  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            {shellLabel[role]} · <span className="mono normal-case">{shortAddress(address)}</span>
          </p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">
            {listed.length === 0
              ? `No deals name this wallet as ${shellLabel[role].toLowerCase()}`
              : !done && needs.length === 0
                ? `Reading your deals… ${loaded.length + failed.length} of ${listed.length}`
                : needs.length
                  ? `${needs.length} ${needs.length === 1 ? 'deal needs' : 'deals need'} you today`
                  : 'Nothing needs you today'}
          </h1>
          {INTRO[role] ? <p className="mt-1 max-w-2xl text-[13.5px] text-graphite">{INTRO[role]}</p> : null}
        </div>
      </div>

      {showTotals ? (
        <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-rule bg-rule">
          {(
            [
              ['Held in escrow', sum(heldFor), 'text-held'],
              [role === 'buyer' ? 'Released to suppliers' : 'Released to you', sum(releasedFor), 'text-released'],
              [role === 'buyer' ? 'Refunded to you' : 'Refunded to buyers', sum(refundedFor), 'text-graphite'],
            ] as const
          ).map(([l, v, c]) => (
            <div key={l} className="bg-sheet px-3 py-3 md:px-4">
              <dt className="label">{l}</dt>
              <dd className={`mono mt-1 text-[17px] md:text-[22px] ${c}`}>{formatAmount(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {!showTotals && listed.length > 0 ? (
        <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-rule bg-rule">
          {(
            [
              ['Needs you', needs.length],
              ['Waiting on others', waiting.length],
              ['Settled', finished.length],
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="bg-sheet px-3 py-3 md:px-4">
              <dt className="label">{l}</dt>
              <dd className="mono mt-1 text-[17px] md:text-[22px]">{done || loaded.length > 0 ? v : '…'}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {listed.length > 0 ? (
        <>
          {section('needs', 'Needs you', needs, 'Nothing waiting on you.')}
          {section('waiting', 'Waiting on others', waiting, 'No deals in progress.')}
          {section('done', 'Settled', finished, 'No settled deals yet.')}
        </>
      ) : (
        <p className="mt-8 rounded-md border border-dashed border-rule px-4 py-6 text-center text-[13px] text-graphite">
          Deals appear here as soon as one names this wallet.
        </p>
      )}

      {failed.length > 0 ? (
        <ul role="alert" className="mt-6 space-y-1 text-[12.5px] text-hold">
          {failed.map((f) => (
            <li key={String(f.id)}>
              Deal {String(f.id)} could not be read from the chain: {f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  )
}

