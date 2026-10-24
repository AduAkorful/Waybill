import { expect, test } from 'bun:test'
import { outcomeText } from './outcome'

test('a split names the prepaid fee the buyer gets back', () => {
  const o = { kind: 'split' as const, supplierBps: 5000, supplierAmount: 7_500_000n, buyerAmount: 7_537_500n, buyerPrincipal: 7_500_000n, buyerFeeBack: 37_500n }
  expect(outcomeText(o)).toBe('Arbiter split it 50% to the supplier: supplier 7.50, buyer 7.5375 USDC (7.50 + 0.0375 prepaid fee back)')
  expect(outcomeText({ ...o, buyerAmount: 7_500_000n, buyerFeeBack: 0n })).toBe('Arbiter split it 50% to the supplier: supplier 7.50, buyer 7.50 USDC')
})
