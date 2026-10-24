import { describe, expect, test } from 'bun:test'

import { readMilestone, type RelayerChain } from './chain'

// QA §35: getMilestone may decode as a positional tuple; arbiterDeadline is struct index 13
// (index 20 is responseHash).
function chainReturning(result: unknown): RelayerChain {
  return {
    escrow: '0x0000000000000000000000000000000000000001',
    client: { readContract: async () => result } as unknown as RelayerChain['client'],
  }
}

describe('readMilestone positional decoding', () => {
  test('maps arbiterDeadline from index 13 and responseDeadline from index 19', async () => {
    const tuple: unknown[] = new Array(22).fill(0n)
    tuple[3] = 100n
    tuple[4] = 2
    tuple[5] = 3
    tuple[6] = 7
    tuple[10] = true
    tuple[13] = 555n
    tuple[19] = 444n
    tuple[20] = `0x${'ab'.repeat(32)}`
    const snapshot = await readMilestone(chainReturning(tuple), 1n, 0)
    expect(snapshot.arbiterDeadline).toBe(555n)
    expect(snapshot.responseDeadline).toBe(444n)
    expect(snapshot.state).toBe(7)
    expect(snapshot.disputed).toBe(true)
  })
})
