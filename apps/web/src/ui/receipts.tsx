'use client'

import { useSyncExternalStore } from 'react'
import type { Hex } from 'viem'
import { getBrowserNetwork } from '@/integration/network'
import { shortHash } from '@/view/format'

interface Receipt {
  hash: Hex
  label: string
}

let receipts: readonly Receipt[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Remember a confirmed transaction so its explorer link stays on screen after the dialog closes. */
export function rememberReceipt(label: string, hash: Hex): void {
  if (receipts.some((r) => r.hash === hash)) return
  receipts = [{ hash, label }, ...receipts].slice(0, 3)
  emit()
}

function dismiss(hash: Hex) {
  receipts = receipts.filter((r) => r.hash !== hash)
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Confirmed transactions from this visit, each with its explorer link, until dismissed. Never stored. */
export function ReceiptStrip() {
  const list = useSyncExternalStore(subscribe, () => receipts, () => [] as readonly Receipt[])
  if (list.length === 0) return null
  const explorer = getBrowserNetwork().explorerUrl.replace(/\/+$/, '')
  return (
    <ul aria-label="Confirmed transactions" className="fixed right-3 bottom-16 z-40 w-[min(22rem,calc(100vw-1.5rem))] space-y-2 lg:bottom-4">
      {list.map((r) => (
        <li key={r.hash} className="flex items-center gap-2 rounded-md border border-released/40 bg-paper px-3 py-2 text-[12.5px] shadow-sm">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-released" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{r.label} · confirmed</span>
            <a className="mono underline" href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">{shortHash(r.hash)} ↗</a>
          </span>
          <button type="button" onClick={() => dismiss(r.hash)} aria-label={`Dismiss receipt ${shortHash(r.hash)}`} className="px-2 text-graphite hover:text-ink">×</button>
        </li>
      ))}
    </ul>
  )
}
