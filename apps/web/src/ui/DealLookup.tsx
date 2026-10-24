'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getReadClient } from '@/integration/read-client'
import { readNextDealId } from '@/integration/escrow'

/**
 * Opens a deal's public record from its number. Only digits are kept as you type, so nothing but a deal page can
 * be reached, and the number is checked against the escrow's deal count before the page opens.
 */
export function DealLookup() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function open() {
    if (value === '') return setNote('Type the deal number first.')
    if (!/^\d{1,12}$/.test(value)) return setNote('Digits only.')
    setBusy(true)
    setNote('')
    try {
      const count = await readNextDealId(getReadClient())
      if (BigInt(value) >= count) {
        setNote(`There is no deal ${value} on this network yet. The newest is ${count === 0n ? 'none' : (count - 1n).toString()}.`)
        return
      }
      router.push(`/record/${value}`)
    } catch {
      setNote('Could not check the deal number just now. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className=""
      onSubmit={(e) => {
        e.preventDefault()
        void open()
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block sm:flex-1">
          <span className="label block">Look up a deal number</span>
          <input
            inputMode="numeric"
            value={value}
            // spaces and letters are dropped as they are typed, so "2 8 4" becomes 284
            onChange={(e) => {
              setValue(e.target.value.replace(/\D/g, '').slice(0, 12))
              setNote('')
            }}
            aria-describedby="deal-lookup-note"
            placeholder="e.g. 284"
            className="mt-1.5 min-h-11 w-full rounded-md border border-rule bg-sheet px-3 text-base"
          />
        </label>
        <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-[14px] font-semibold text-paper disabled:opacity-70">
          {busy ? 'Checking…' : 'Open the public record'}
        </button>
      </div>
      <p id="deal-lookup-note" role="status" className="mt-2 min-h-5 text-[13px] text-hold">{note}</p>
    </form>
  )
}
