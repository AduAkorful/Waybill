import { describe, expect, test } from 'bun:test'

import { RelayerRuntime, type RuntimePoller } from './runtime'

class FakePoller implements RuntimePoller {
  calls = 0
  constructor(private readonly failure?: Error) {}

  async pollOnce() {
    this.calls += 1
    if (this.failure) throw this.failure
    return { fromBlock: 1n, toBlock: 1n, scannedLogs: 0, emittedCandidates: 0 }
  }
}

describe('RelayerRuntime', () => {
  test('delegates one-shot polling', async () => {
    const poller = new FakePoller()
    const runtime = new RelayerRuntime(poller, { pollIntervalMs: 1 })

    await expect(runtime.runOnce()).resolves.toMatchObject({ scannedLogs: 0 })
    expect(poller.calls).toBe(1)
  })

  test('polls until stopped and respects the configured interval', async () => {
    const poller = new FakePoller()
    const sleeps: number[] = []
    let runtime!: RelayerRuntime
    runtime = new RelayerRuntime(poller, {
      pollIntervalMs: 1_500,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        runtime.stop()
      },
    })

    await runtime.run()
    expect(poller.calls).toBe(1)
    expect(sleeps).toEqual([1_500])
  })

  test('reports poll failures and still allows controlled shutdown', async () => {
    const error = new Error('RPC unavailable')
    const poller = new FakePoller(error)
    const errors: unknown[] = []
    let runtime!: RelayerRuntime
    runtime = new RelayerRuntime(poller, {
      pollIntervalMs: 10,
      reportError: (failure) => errors.push(failure),
      sleep: async () => runtime.stop(),
    })

    await runtime.run()
    expect(errors).toEqual([error])
    expect(poller.calls).toBe(1)
  })

  test('rejects an unsafe runtime interval', () => {
    expect(() => new RelayerRuntime(new FakePoller(), { pollIntervalMs: 0 })).toThrow(
      'positive safe integer',
    )
  })
})
