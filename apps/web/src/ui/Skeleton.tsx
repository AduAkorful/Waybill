/** A loading placeholder shaped like a page: pulsing bars, with the plain text for assistive technology. */
export function Skeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="animate-pulse space-y-4">
        <div className="h-3 w-24 rounded bg-rule" />
        <div className="h-8 w-2/3 rounded bg-rule" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-16 rounded-md bg-rule/60" />
        ))}
      </div>
      <p aria-hidden className="mt-4 text-[13px] text-graphite">{label}</p>
    </div>
  )
}
