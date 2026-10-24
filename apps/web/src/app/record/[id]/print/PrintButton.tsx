'use client'

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded border border-black px-3 py-1.5 text-[13px] font-semibold">
      Print or save as PDF
    </button>
  )
}
