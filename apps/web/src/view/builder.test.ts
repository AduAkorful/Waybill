import { describe, expect, test } from 'bun:test'
import { buildDeal, emptyForm, feeFor, parseAmount, percentToBps, TEMPLATES, type BuilderForm, type BuilderLimits } from './builder'

const buyer = '0x00000000000000000000000000000000000000b1'
const supplier = '0x00000000000000000000000000000000000000c2'
const arbiter = '0x00000000000000000000000000000000000000d3'
const attestor = '0x00000000000000000000000000000000000000e4'
const limits: BuilderLimits = { minFeeBps: 50, maxFeeBps: 100, maxDealAmount: 10_000_000_000n, maxLocked: 50_000_000_000n, currentLocked: 0n, newDealsPaused: false }
const NOW = 1_800_000_000

function form(over: Partial<BuilderForm> = {}): BuilderForm {
  const f = emptyForm(buyer, 75, TEMPLATES[2]!)
  f.supplier = supplier
  f.arbiter = arbiter
  f.total = '1000'
  f.parts[1]!.attestors = [attestor]
  return { ...f, ...over }
}

describe('amount and percentage parsing', () => {
  test('amounts are exact to six decimals and never float', () => {
    expect(parseAmount('1250.5')).toBe(1_250_500_000n)
    expect(parseAmount('0.000001')).toBe(1n)
    expect(parseAmount('1.0000001')).toBeNull()
    expect(parseAmount('-1')).toBeNull()
    expect(parseAmount('1e3')).toBeNull()
  })
  test('percentages are whole basis points', () => {
    expect(percentToBps('33.33')).toBe(3333)
    expect(percentToBps('100')).toBe(10_000)
    expect(percentToBps('12.345')).toBeNull()
  })
  test('the fee rounds up like the escrow', () => {
    expect(feeFor(1_000_000n, 75)).toBe(7_500n)
    expect(feeFor(1n, 75)).toBe(1n)
  })
})

describe('building a deal', () => {
  test('a valid deal yields the exact createDeal arguments', () => {
    const r = buildDeal(form(), buyer, limits, { allowed: true, fee: 5_000_000n }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.deal.totalAmount).toBe(1_000_000_000n)
    expect(r.deal.milestoneInputs.map((m) => m.bps)).toEqual([3000n, 7000n])
    expect(r.deal.milestoneInputs[1]).toMatchObject({ condition: 1, threshold: 1, attestors: [attestor] })
    expect(r.deal.milestoneInputs[0]).toMatchObject({ condition: 0, attestors: [], threshold: 0, dependsOn: 65_535 })
    expect(r.deal.arbiterFee).toBe(5_000_000n)
    expect(r.deal.acceptanceDeadlineTs).toBe(BigInt(NOW + 7 * 86_400))
    expect(r.fee).toBe(7_500_000n)
  })

  test('the parts must total exactly 100%', () => {
    const f = form()
    f.parts[0]!.percent = '29.99'
    const r = buildDeal(f, buyer, limits, { allowed: true, fee: 0n }, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('99.99%')
  })

  test('mirrors the escrow role rules', () => {
    const errs = (f: BuilderForm, a = { allowed: true, fee: 0n }) => {
      const r = buildDeal(f, buyer, limits, a, NOW)
      return r.ok ? '' : r.errors.join(' | ')
    }
    expect(errs(form({ supplier: buyer }))).toContain('supplier cannot be your own')
    expect(errs(form({ arbiter: buyer }))).toContain('arbiter of your own')
    expect(errs(form({ arbiter: supplier }))).toContain('supplier cannot be the arbiter')
    expect(errs(form(), { allowed: false, fee: 0n })).toContain('not on the approved list')
    const f = form()
    f.parts[1]!.attestors = [arbiter]
    expect(errs(f)).toContain('arbiter cannot be an attestor')
    f.parts[1]!.attestors = [attestor, attestor]
    expect(errs(f)).toContain('listed twice')
    f.parts[1]!.attestors = []
    expect(errs(f)).toContain('at least one attestor')
  })

  test('enforces the escrow limits it can read', () => {
    const run = (l: Partial<BuilderLimits>, f = form()) => buildDeal(f, buyer, { ...limits, ...l }, { allowed: true, fee: 0n }, NOW)
    expect(run({ newDealsPaused: true }).ok).toBe(false)
    expect(run({ maxDealAmount: 999_999_999n }).ok).toBe(false)
    expect(run({ minFeeBps: 80 }).ok).toBe(false)
    const capped = run({ maxLocked: 1_000_000_000n })
    expect(capped.ok).toBe(false)
    if (!capped.ok) expect(capped.errors[0]).toContain('early-access cap')
  })

  test('rejects bad addresses and needs the arbiter checked', () => {
    expect(buildDeal(form({ supplier: '0x12' }), buyer, limits, { allowed: true, fee: 0n }, NOW).ok).toBe(false)
    const r = buildDeal(form(), buyer, limits, null, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toContain('not been checked')
  })
})
