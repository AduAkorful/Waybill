import { isClosed } from './derive'
import type { DealState, DealView } from './types'

const BASE: Record<DealState, string> = {
  proposed: 'Not funded',
  accepted: 'Not funded',
  funded: 'Funded',
  settled: 'Settled',
  cancelled: 'Cancelled before funding',
}

/** One honest headline for a deal: a funded deal with a dispute open says so, so it never reads as plain "Funded". */
export function dealHeadline(deal: DealView): string {
  if (deal.state === 'funded') {
    const open = deal.tranches.filter((t) => t.state === 'disputed').length
    if (open > 0) return `Funded · ${open} ${open === 1 ? 'part' : 'parts'} in dispute`
    const closed = deal.tranches.filter(isClosed).length
    if (closed > 0 && closed < deal.tranches.length) return `Funded · ${closed} of ${deal.tranches.length} parts closed`
  }
  return BASE[deal.state]
}
