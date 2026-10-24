import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '../../../config/networks'
import type { RelayerCandidate } from './chain'
import {
  RELAYER_WRITE_ABI,
  submitEligibleCandidate,
  type RelayerWriteClient,
} from './submission'

const candidate = (operation: RelayerCandidate['operation']): RelayerCandidate => ({
  operation,
  dealId: 7n,
  milestoneIndex: 2,
  sourceEvent: 'MilestoneClaimable',
  requiresEligibilityRecheck: true,
})

function mockClient(status: 'success' | 'reverted' = 'success') {
  const calls: unknown[] = []
  const client: RelayerWriteClient = {
    escrow: ARC_TESTNET.contracts.escrow,
    writeContract: async (parameters) => {
      calls.push(parameters)
      return `0x${'ab'.repeat(32)}` as `0x${string}`
    },
    waitForTransactionReceipt: async ({ hash, confirmations }) => {
      expect(hash).toBe(`0x${'ab'.repeat(32)}`)
      expect(confirmations).toBe(1)
      return {
        status,
        transactionHash: hash,
      }
    },
  }
  return { client, calls }
}

describe('relayer submission boundary', () => {
  test('submits only the fixed escrow operation after eligibility passes', async () => {
    const { client, calls } = mockClient()
    const result = await submitEligibleCandidate(
      client,
      candidate('claim'),
      { eligible: true },
    )

    expect(result).toEqual({
      hash: `0x${'ab'.repeat(32)}`,
      status: 'success',
    })
    expect(calls).toEqual([{
      abi: RELAYER_WRITE_ABI,
      functionName: 'claim',
      args: [7n, 2],
    }])
  })

  test('encodes refund and default without exposing recipients or amounts', async () => {
    for (const operation of ['refund', 'applyDefault'] as const) {
      const { client, calls } = mockClient('reverted')
      await expect(
        submitEligibleCandidate(
          client,
          candidate(operation),
          { eligible: true },
        ),
      ).resolves.toEqual({
        hash: `0x${'ab'.repeat(32)}`,
        status: 'reverted',
      })
      expect(calls[0]).toMatchObject({
        functionName: operation,
        args: [7n, 2],
      })
    }
  })

  test('refuses to write when the fresh eligibility read failed', async () => {
    const { client, calls } = mockClient()
    await expect(
      submitEligibleCandidate(
        client,
        candidate('claim'),
        { eligible: false, reason: 'state changed' },
      ),
    ).rejects.toThrow('Refusing ineligible')
    expect(calls).toHaveLength(0)
  })

  test('rejects an unknown operation at runtime', async () => {
    const { client, calls } = mockClient()
    await expect(
      submitEligibleCandidate(
        client,
        { ...candidate('claim'), operation: 'arbitrary' as never },
        { eligible: true },
      ),
    ).rejects.toThrow('Unknown relayer operation')
    expect(calls).toHaveLength(0)
  })
})
