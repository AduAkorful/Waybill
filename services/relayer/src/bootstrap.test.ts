import { describe, expect, test } from 'bun:test'

import { ARC_TESTNET } from '@waybill/network/networks'
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

function fakeChain(chainId = ARC_TESTNET.chainId): RelayerChain {
  return {
    escrow: ARC_TESTNET.contracts.escrow,
    client: {
      getChainId: async () => chainId,
      getBlockNumber: async () => 0n,
      getBalance: async () => 10n ** 19n,
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

  test('has no HTTP API unless WAYBILL_API_PORT is set', async () => {
    const app = createBackendApplication(environment, {
      createPool: () => new FakePool(),
      createChain: () => fakeChain(),
      createSubmissionClient: () => fakeSubmission(),
      loadMigrations: async () => [],
    })
    expect(app.api).toBeNull()
    await app.stop()
  })

  test('serves the read API with listed origins only, and closes it on stop', async () => {
    const pool = new FakePool()
    const app = createBackendApplication(
      {
        ...environment,
        WAYBILL_API_PORT: '38457',
        WAYBILL_RELAYER_POLL_INTERVAL_MS: '1000',
        WAYBILL_API_ALLOWED_ORIGINS: 'https://app.example',
      },
      {
        createPool: () => pool,
        createChain: () => fakeChain(),
        createSubmissionClient: () => fakeSubmission(),
        loadMigrations: async () => [],
      },
    )
    const started = app.start()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const allowed = await fetch('http://127.0.0.1:38457/v1/network', {
      headers: { origin: 'https://app.example' },
    })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example')
    const refused = await fetch('http://127.0.0.1:38457/v1/network', {
      headers: { origin: 'https://evil.example' },
    })
    expect(refused.status).toBe(403)
    expect((await fetch('http://127.0.0.1:38457/v1/deals/3/events')).status).toBe(200)
    await app.stop()
    await started
    expect(app.api?.listening).toBe(false)
  })

  test('rejects a bad API port or origin at startup', () => {
    for (const bad of [
      { WAYBILL_API_PORT: 'abc' },
      { WAYBILL_API_PORT: '70000' },
      { WAYBILL_API_PORT: '3000', WAYBILL_API_ALLOWED_ORIGINS: '*' },
    ]) {
      expect(() =>
        createBackendApplication({ ...environment, ...bad }, {
          createPool: () => new FakePool(),
          createChain: () => fakeChain(),
          createSubmissionClient: () => fakeSubmission(),
        }),
      ).toThrow()
    }
  })

  test('refuses to start when the RPC serves another chain', async () => {
    const pool = new FakePool()
    const app = createBackendApplication(environment, {
      createPool: () => pool,
      createChain: () => fakeChain(1),
      createSubmissionClient: () => fakeSubmission(),
      loadMigrations: async () => [],
    })
    await expect(app.start()).rejects.toThrow('The RPC serves chain 1')
    await app.stop()
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
