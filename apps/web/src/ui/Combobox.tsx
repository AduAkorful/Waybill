'use client'

import { useId, useState } from 'react'

export interface ComboOption {
  value: string
  label: string
}

/**
 * A text box that suggests from a list, following the combobox pattern: arrow keys move through the suggestions,
 * Enter picks one, Escape closes the list. Whatever is typed is kept as typed; the list only helps.
 */
export function Combobox({ label, value, onChange, options, placeholder, className = '' }: { label: string; value: string; onChange: (v: string) => void; options: ComboOption[]; placeholder?: string; className?: string }) {
  const uid = useId()
  const listId = `${uid}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const needle = value.trim().toLowerCase()
  const shown = options.filter((o) => needle === '' || o.value.toLowerCase().includes(needle) || o.label.toLowerCase().includes(needle)).slice(0, 8)
  const expanded = open && shown.length > 0 && !(shown.length === 1 && shown[0]!.value.toLowerCase() === needle)

  const pick = (o: ComboOption) => {
    onChange(o.value)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${uid}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && shown.length) {
            e.preventDefault()
            setOpen(true)
            setActive((a) => (a + 1) % shown.length)
          } else if (e.key === 'ArrowUp' && shown.length) {
            e.preventDefault()
            setActive((a) => (a <= 0 ? shown.length - 1 : a - 1))
          } else if (e.key === 'Enter' && expanded && active >= 0) {
            e.preventDefault()
            pick(shown[active]!)
          } else if (e.key === 'Escape' && expanded) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`} hidden={!expanded} className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-rule bg-paper text-[13px] shadow-sm">
        {shown.map((o, i) => (
          <li
            key={o.value}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault()
              pick(o)
            }}
            className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-sheet' : ''}`}
          >
            <span className="block font-semibold">{o.label}</span>
            <span className="mono block truncate text-[12px] text-graphite">{o.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
