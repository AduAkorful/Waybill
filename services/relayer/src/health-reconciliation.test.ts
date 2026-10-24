import { describe, expect, test } from 'bun:test'

import { checkHealth, databaseHealth, rpcHealth } from './health'
import { reconcile } from './reconciliation'

describe('health checks', () => {
  test('reports readiness only when required dependencies are healthy', async () => {
    await expect(checkHealth([
      { name: 'optional', required: false, check: async () => { throw new Error('down') } },
      { name: 'database', required: true, check: async () => 'ok' },
      rpcHealth('rpc', async () => 12n),
    ])).resolves.toEqual({
      live: true,
      ready: true,
      components: [
        { name: 'optional', required: false, ok: false, detail: 'down' },
        { name: 'database', required: true, ok: true, detail: 'ok' },
        { name: 'rpc', required: true, ok: true, detail: 'head=12' },
      ],
    })
  })

  test('marks required database and RPC failures as not ready', async () => {
    const result = await checkHealth([
      databaseHealth('database', async () => { throw new Error('connection refused') }),
      rpcHealth('rpc', async () => -1n),
    ])
    expect(result.live).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.components.map((component) => component.ok)).toEqual([false, false])
  })
})

describe('reconciliation', () => {
  test('accepts a consistent observation', () => {
    expect(reconcile({
      network: 'testnet',
      observedNetwork: 'testnet',
      chainHead: 100n,
      cursor: { blockNumber: 99n, logIndex: 5n },
      latestProjectionBlock: 98n,
      currentLocked: 50n,
      escrowTokenBalance: 75n,
    })).toEqual({ ok: true, issues: [] })
  })

  test('reports network, stale-read, and collateral contradictions', () => {
    const result = reconcile({
      network: 'mainnet',
      observedNetwork: 'testnet',
      chainHead: 100n,
      cursor: { blockNumber: 101n, logIndex: 0n },
      latestProjectionBlock: 102n,
      currentLocked: 100n,
      escrowTokenBalance: 99n,
    })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'NETWORK_MISMATCH',
      'CURSOR_AHEAD_OF_HEAD',
      'PROJECTION_AHEAD_OF_HEAD',
      'ESCROW_UNDERCOLLATERALIZED',
    ])
  })

  test('reports negative observations', () => {
    const result = reconcile({
      network: 'testnet',
      observedNetwork: 'testnet',
      chainHead: -1n,
      cursor: null,
      latestProjectionBlock: null,
      currentLocked: 0n,
      escrowTokenBalance: 0n,
    })
    expect(result.issues[0]?.code).toBe('NEGATIVE_OBSERVATION')
  })
})
