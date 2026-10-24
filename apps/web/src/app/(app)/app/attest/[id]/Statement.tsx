import { formatAmount, formatDateTime, shortAddress } from '@/view/format'
import type { DealView, Tranche } from '@/view/types'

/** The sentence an attestor signs, and what signing does not cover. Worded from the deal's own figures, nothing invented. */
export function Statement({ deal, part, signer }: { deal: DealView; part: Tranche; signer: string }) {
  return (
    <section className="rounded-md border border-rule bg-sheet p-4" aria-label="Statement">
      <p className="label">The statement you sign</p>
      <p className="mt-2 text-[14.5px] leading-relaxed">
        I, <span className="mono">{shortAddress(signer)}</span>, confirm that what part {part.index} of {deal.tranches.length} of deal {String(deal.id)} covers
        ({formatAmount(part.amount)} USDC, due {formatDateTime(part.deadline)}) has been done as agreed, and that the files I attach show what I saw.
      </p>
      <p className="label mt-4">What signing does not cover</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-snug text-graphite">
        <li>Anything beyond what your files show.</li>
        <li>What the buyer or supplier intend, or do afterwards.</li>
        <li>The terms of the deal; you are confirming one fact.</li>
      </ul>
      <p className="mt-4 text-[12.5px] text-graphite">
        Signing is not a payment. When enough attestors sign, the buyer has {part.reviewWindow} hours to review; the part is then paid to the supplier unless the buyer disputes it.
        If a dispute is decided against your statement, it counts on your public record.
      </p>
    </section>
  )
}
