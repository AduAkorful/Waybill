'use client'

import { useState } from 'react'
import { useSignMessage } from 'wagmi'
import { readTermsSigned } from '@/integration/terms'
import type { DealTerms, DealView } from '@/view/types'

const row = (label: string, value: string | undefined) => (value ? <div key={label} className="flex flex-wrap gap-x-2 text-[13px]"><dt className="label">{label}</dt><dd>{value}</dd></div> : null)

/**
 * The goods, names and places the buyer recorded off-chain. The contract holds none of this and does not enforce it.
 * Public details show at once; private ones need one free signature from a wallet named in the deal.
 */
export function PrivateTerms({ deal, wallet }: { deal: DealView; wallet: `0x${string}` }) {
  const { signMessageAsync } = useSignMessage()
  const [state, setState] = useState<{ kind: 'todo' } | { kind: 'working' } | { kind: 'none' } | { kind: 'error'; message: string } | { kind: 'ready'; terms: DealTerms }>({ kind: 'todo' })
  const terms = deal.terms ?? (state.kind === 'ready' ? state.terms : undefined)

  return (
    <section aria-label="Deal details" className="mt-6 rounded-md border border-rule bg-sheet px-4 py-3">
      <h2 className="label">Details recorded by the buyer</h2>
      {terms ? (
        <dl className="mt-2 space-y-1">
          {row('Goods', terms.goods)}
          {row('Units', terms.units === undefined ? undefined : String(terms.units))}
          {row('Cartons', terms.cartons === undefined ? undefined : String(terms.cartons))}
          {row('From', terms.origin ? `${terms.origin.city}, ${terms.origin.code}` : undefined)}
          {row('To', terms.destination ? `${terms.destination.city}, ${terms.destination.code}` : undefined)}
          {row('Buyer', terms.buyerName)}
          {row('Supplier', terms.supplierName)}
          {terms.milestoneTitles?.some((t) => t) ? row('Parts', terms.milestoneTitles.map((t, i) => `${i + 1}. ${t || '—'}`).join('  ·  ')) : null}
        </dl>
      ) : state.kind === 'none' ? (
        <p className="mt-1 text-[13px] text-graphite">The buyer has not recorded any details for this deal.</p>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] text-graphite">Kept off-chain and private to the people named in the deal. Showing them takes a free wallet signature.</p>
          <button
            type="button"
            disabled={state.kind === 'working'}
            onClick={async () => {
              setState({ kind: 'working' })
              try {
                const found = await readTermsSigned({ dealId: deal.id, signer: wallet, sign: (message) => signMessageAsync({ message }) })
                setState(found ? { kind: 'ready', terms: found.terms } : { kind: 'none' })
              } catch (e) {
                setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
              }
            }}
            className="mt-2 rounded-md border border-rule px-3 py-1.5 text-[13px] font-semibold disabled:opacity-40"
          >
            {state.kind === 'working' ? 'Waiting for your wallet…' : 'Show the details'}
          </button>
          {state.kind === 'error' ? <p role="alert" className="mt-2 text-[12.5px] text-hold">{state.message}</p> : null}
        </>
      )}
      {terms ? <p className="mt-2 text-[11.5px] text-graphite">Written by the buyer and not enforced by the contract; the amounts, deadlines and people on the waybill are what the contract holds.</p> : null}
    </section>
  )
}
