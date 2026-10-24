import { formatDateTime, formatDay, shortHash } from '@/view/format'
import type { HistoryGroup } from '@/view/attestor'

/** Same-day range collapses to one date. */
function when(g: HistoryGroup): string {
  if (g.last === null) return 'time unknown'
  if (g.count > 1 && g.first !== null) {
    const a = formatDay(g.first)
    const b = formatDay(g.last)
    return a === b ? a : `${a} to ${b}`
  }
  return formatDateTime(g.last)
}

function Row({ g, explorer }: { g: HistoryGroup; explorer: string }) {
  return (
    <li className="flex flex-col gap-0.5 px-3.5 py-2.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2">
      <span>
        {g.text}
        {g.count > 1 ? <span className="mono ml-2 rounded border border-rule px-1.5 text-[12px] text-graphite">× {g.count}</span> : null}
      </span>
      <span className="mono text-[12px] text-graphite">
        <span className="block sm:inline">{when(g)}</span>
        <span className="hidden sm:inline"> · </span>
        <a className="inline-flex min-h-11 items-center whitespace-nowrap underline sm:min-h-0" href={`${explorer}/tx/${g.lastTx}`} target="_blank" rel="noreferrer">
          {shortHash(g.lastTx)} ↗
        </a>
      </span>
    </li>
  )
}

/** A history list: repeated records are one row with a count, and a long list shows the newest rows with the rest folded away. */
export function HistoryRows({ groups, explorer, show = 10 }: { groups: HistoryGroup[]; explorer: string; show?: number }) {
  const head = groups.slice(0, show)
  const rest = groups.slice(show)
  const cls = 'divide-y divide-rule rounded-md border border-rule bg-sheet text-[13.5px]'
  return (
    <>
      <ol className={cls}>
        {head.map((g, i) => (
          <Row key={`${g.lastTx}-${i}`} g={g} explorer={explorer} />
        ))}
      </ol>
      {rest.length ? (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-[13px] underline">Show {rest.length} more</summary>
          <ol className={`${cls} mt-1`}>
            {rest.map((g, i) => (
              <Row key={`${g.lastTx}-r${i}`} g={g} explorer={explorer} />
            ))}
          </ol>
        </details>
      ) : null}
    </>
  )
}
