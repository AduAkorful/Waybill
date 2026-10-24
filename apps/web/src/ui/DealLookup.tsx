'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Opens a deal's public record from its number. Only digits are accepted, so nothing but a deal page can be reached. */
export function DealLookup() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const valid = /^\d{1,12}$/.test(value.trim())
  return (
    <form
      className="mt-8 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) router.push(`/record/${value.trim()}`)
      }}
    >
      <label className="block">
        <span className="label block">Look up a deal number</span>
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 284"
          className="mt-1.5 min-h-11 w-44 rounded-md border border-rule bg-sheet px-3 text-base"
        />
      </label>
      <button type="submit" disabled={!valid} className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-[14px] font-semibold text-paper disabled:opacity-40">
        Open the public record
      </button>
    </form>
  )
}
