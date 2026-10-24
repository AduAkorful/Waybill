import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '../../../config/networks'
import type { RelayerChain } from './chain'
import { createBackendApplication, type BackendPool } from './bootstrap'
import type { RelayerWriteClient } from './submission'

const environment = {
  WAYBILL_NETWORK: 'testnet',
  WAYBILL_RELAYER_START_BLOCK: '10',
  WAYBILL_RELAYER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
}

class FakePool implements BackendPool {
  ended = false
  async connect() {
    return {
      query: async <Row>() => ({ rows: [] as Row[] }),
      release: () => {},
    }
  }
  async query<Row>() {
    return { rows: [] as Row[] }
  }
  async end() {
    this.ended = true
  }
}

function fakeChain(): RelayerChain {
  return {
    escrow: ARC_TESTNET.contracts.escrow,
    client: {
      getBlockNumber: async () => 0n,
      getLogs: async () => [],
      readContract: async () => 0n,
      getBlock: async () => ({ timestamp: 0n }),
    } as never,
  }
}

function fakeSubmission(): RelayerWriteClient {
  return {
    escrow: ARC_TESTNET.contracts.escrow,
    getPendingNonce: async () => 0,
    writeContract: async () => `0x${'aa'.repeat(32)}`,
    waitForTransactionReceipt: async ({ hash }) => ({
      transactionHash: hash,
      status: 'success',
    }),
  }
}

describe('backend process bootstrap', () => {
  test('selects testnet and composes separate relayer/indexer loops', async () => {
    const pool = new FakePool()
    const app = createBackendApplication(environment, {
      createPool: () => pool,
      createChain: () => fakeChain(),
      createSubmissionClient: () => fakeSubmission(),
      loadMigrations: async () => [],
    })

    expect(app.config.network.network).toBe('testnet')
    expect(app.relayer).not.toBe(app.indexer)
    await app.stop()
    expect(pool.ended).toBe(true)
  })

  test('does not start loops when migrations fail', async () => {
    const pool = new FakePool()
    const app = createBackendApplication(environment, {
      createPool: () => pool,
      createChain: () => fakeChain(),
      createSubmissionClient: () => fakeSubmission(),
      loadMigrations: async () => {
        throw new Error('migration unavailable')
      },
    })

    await expect(app.start()).rejects.toThrow('migration unavailable')
    expect(pool.ended).toBe(false)
    await app.stop()
    expect(pool.ended).toBe(true)
  })
})
