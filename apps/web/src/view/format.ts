/** USDC raw units (6 decimals) → text. Money is never held in a float. */

const USDC_DECIMALS = 6
const UNIT = 10n ** BigInt(USDC_DECIMALS)

/** "20,250.00", or "0.0075" when an amount has sub-cent digits: never rounds a figure the contract holds exactly. */
export function formatAmount(raw: bigint): string {
  const negative = raw < 0n
  const abs = negative ? -raw : raw
  const whole = (abs / UNIT).toLocaleString('en-US')
  const frac = (abs % UNIT).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

/** Decimals needed to show an amount exactly, at least two. */
const digitsFor = (raw: bigint): number => Math.max(2, 6 - (raw % UNIT === 0n ? 6 : (raw < 0n ? -raw : raw).toString().length - (raw < 0n ? -raw : raw).toString().replace(/0+$/, '').length))

/** Two amounts written with the same number of decimals, so they can be read side by side ("20.100000" and "1.163558"). */
export function formatAmountsAligned(...raws: bigint[]): string[] {
  const digits = Math.max(...raws.map(digitsFor))
  return raws.map((raw) => {
    const abs = raw < 0n ? -raw : raw
    const frac = (abs % UNIT).toString().padStart(USDC_DECIMALS, '0').slice(0, digits).padEnd(digits, '0')
    return `${raw < 0n ? '-' : ''}${(abs / UNIT).toLocaleString('en-US')}.${frac}`
  })
}

/** Raw units → whole cents, half up. For counters that animate at two decimals; exact text lives in aria-labels. */
export function toCents(raw: bigint): number {
  return Number((raw + 5_000n) / 10_000n)
}

/** Cents → "20,250.00" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Position (0–10) of the digit column for place `k` when a counter shows `v`, like a mechanical counter:
 * a digit only turns while the digit below it rolls over.
 */
export function digitPos(v: number, k: number): number {
  const unit = 10 ** k
  const r = k === 0 ? 0 : (v % unit) / unit
  const carry = k === 0 ? v % 1 : r > 0.9 ? (r - 0.9) * 10 : 0
  return ((Math.floor(v / unit) % 10) + carry) % 10
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}\u2060…\u2060${address.slice(-4)}` : address
}

export const shortHash = shortAddress

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(seconds: bigint) {
  const d = new Date(Number(seconds) * 1000)
  return {
    day: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`,
  }
}

/** "19 Oct 2026" in UTC */
export function formatDay(seconds: bigint): string {
  return parts(seconds).day
}

/** "19 Oct 2026, 09:40 UTC" */
export function formatDateTime(seconds: bigint): string {
  const p = parts(seconds)
  return `${p.day}, ${p.time} UTC`
}

const TEN_YEARS = 10n * 365n * 86_400n

/** A deadline as a date, unless it is so far off it means nothing as a date (a mis-set window): then "more than 10 years from now". */
export function formatUntil(seconds: bigint, now: bigint): string {
  return seconds - now > TEN_YEARS ? `more than 10 years from now (${parts(seconds).day})` : formatDateTime(seconds)
}

/** Chinese date in UTC: "2026年10月19日" */
export function formatDayZh(seconds: bigint): string {
  const d = new Date(Number(seconds) * 1000)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

/** Chinese date and time in UTC: "2026年10月19日 09:40 UTC" */
export function formatDateTimeZh(seconds: bigint): string {
  return `${formatDayZh(seconds)} ${parts(seconds).time} UTC`
}
