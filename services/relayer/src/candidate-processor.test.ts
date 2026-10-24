import { describe, expect, test } from 'bun:test'

import type { MilestoneSnapshot, RelayerCandidate } from './chain'
import type {
  AttemptReservation,
  RelayerAttemptKey,
  RelayerAttemptStore,
} from './attempt-store'
import { RelayerCandidateProcessor, type CandidateStateReader } from './candidate-processor'
import { SerializedNonceManager } from './nonce-manager'
import type { RelayerWriteClient } from './submission'

const candidate: RelayerCandidate = {
  operation: 'claim',
  dealId: 7n,
  milestoneIndex: 1,
  sourceEvent: 'MilestoneClaimable',
  requiresEligibilityRecheck: true,
}

const claimable: MilestoneSnapshot = {
  state: 2,
  deadline: 0n,
  gracePeriod: 0,
  reviewWindow: 0,
  disputed: false,
  responseDeadline: 0n,
  arbiterDeadline: 0n,
}

function stateReader(snapshot: MilestoneSnapshot): CandidateStateReader {
  return {
    readMilestone: async () => snapshot,
    nowSeconds: async () => 100n,
  }
}

class FakeAttempts implements RelayerAttemptStore {
  reservation: AttemptReservation = {
    attempt: {
      operation: 'claim',
      dealId: 7n,
      milestoneIndex: 1,
      status: 'pending',
      txHash: null,
      attemptCount: 1,
    },
    shouldSubmit: true,
  }
  submitted: `0x${string}`[] = []
  receipts: ('success' | 'reverted')[] = []

  async reserve(_key: RelayerAttemptKey) {
    return this.reservation
  }

  async markSubmitted(_key: RelayerAttemptKey, hash: `0x${string}`) {
    this.submitted.push(hash)
  }

  async markReceipt(_key: RelayerAttemptKey, status: 'success' | 'reverted') {
    this.receipts.push(status)
  }
}

function writeClient(wait: 'success' | 'reverted' | 'throw' = 'success') {
  const calls: unknown[] = []
  const client: RelayerWriteClient = {
    escrow: `0x${'ee'.repeat(20)}`,
    getPendingNonce: async () => 5,
    writeContract: async (parameters) => {
      calls.push(parameters)
      return `0x${'ab'.repeat(32)}`
    },
    waitForTransactionReceipt: async ({ hash }) => {
      if (wait === 'throw') throw new Error('receipt provider unavailable')
      return { transactionHash: hash, status: wait }
    },
  }
  return { client, calls }
}

describe('RelayerCandidateProcessor', () => {
  test('freshly checks state, reserves, persists hash, and records success', async () => {
    const attempts = new FakeAttempts()
    const { client, calls } = writeClient()
    const processor = new RelayerCandidateProcessor(
      stateReader(claimable),
      attempts,
      client,
      new SerializedNonceManager(client),
    )

    await expect(processor.process(candidate)).resolves.toEqual({
      hash: `0x${'ab'.repeat(32)}`,
      status: 'success',
    })
    expect(calls).toHaveLength(1)
    expect(attempts.submitted).toEqual([`0x${'ab'.repeat(32)}`])
    expect(attempts.receipts).toEqual(['success'])
  })

  test('does not write when the signal is stale or the action is already terminal', async () => {
    const staleAttempts = new FakeAttempts()
    const staleClient = writeClient()
    const stale = new RelayerCandidateProcessor(
      stateReader({ ...claimable, state: 0 }),
      staleAttempts,
      staleClient.client,
      new SerializedNonceManager(staleClient.client),
    )
    await expect(stale.process(candidate)).resolves.toMatchObject({ kind: 'ineligible' })
    expect(staleClient.calls).toHaveLength(0)

    const duplicateAttempts = new FakeAttempts()
    duplicateAttempts.reservation = {
      ...duplicateAttempts.reservation,
      shouldSubmit: false,
      attempt: { ...duplicateAttempts.reservation.attempt, status: 'success' },
    }
    const duplicateClient = writeClient()
    const duplicate = new RelayerCandidateProcessor(
      stateReader(claimable),
      duplicateAttempts,
      duplicateClient.client,
      new SerializedNonceManager(duplicateClient.client),
    )
    await expect(duplicate.process(candidate)).resolves.toMatchObject({ kind: 'duplicate' })
    expect(duplicateClient.calls).toHaveLength(0)
  })

  test('records reverted receipts and preserves submitted hash if waiting fails', async () => {
    const revertedAttempts = new FakeAttempts()
    const revertedClient = writeClient('reverted')
    const reverted = new RelayerCandidateProcessor(
      stateReader(claimable),
      revertedAttempts,
      revertedClient.client,
      new SerializedNonceManager(revertedClient.client),
    )
    await expect(reverted.process(candidate)).resolves.toMatchObject({ status: 'reverted' })
    expect(revertedAttempts.receipts).toEqual(['reverted'])

    const waitingAttempts = new FakeAttempts()
    const waitingClient = writeClient('throw')
    const waiting = new RelayerCandidateProcessor(
      stateReader(claimable),
      waitingAttempts,
      waitingClient.client,
      new SerializedNonceManager(waitingClient.client),
    )
    await expect(waiting.process(candidate)).rejects.toThrow('receipt provider unavailable')
    expect(waitingAttempts.submitted).toEqual([`0x${'ab'.repeat(32)}`])
    expect(waitingAttempts.receipts).toEqual([])
  })
})
