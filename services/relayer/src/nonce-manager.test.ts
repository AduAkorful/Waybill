import { describe, expect, test } from 'bun:test'

import { SerializedNonceManager } from './nonce-manager'

describe('SerializedNonceManager', () => {
  test('serializes concurrent sends with distinct nonces', async () => {
    const sent: number[] = []
    const manager = new SerializedNonceManager({
      getPendingNonce: async () => 20,
    })

    const results = await Promise.all([
      manager.run(async (nonce) => {
        await Bun.sleep(5)
        sent.push(nonce)
        return 'first'
      }),
      manager.run(async (nonce) => {
        sent.push(nonce)
        return 'second'
      }),
    ])

    expect(sent).toEqual([20, 21])
    expect(results).toEqual(['first', 'second'])
  })

  test('refreshes the pending nonce after a send failure', async () => {
    let reads = 0
    const sent: number[] = []
    const manager = new SerializedNonceManager({
      getPendingNonce: async () => {
        reads += 1
        return reads === 1 ? 30 : 31
      },
    })

    await expect(manager.run(async () => {
      throw new Error('transport unavailable')
    })).rejects.toThrow('transport unavailable')
    await manager.run(async (nonce) => {
      sent.push(nonce)
    })

    expect(sent).toEqual([31])
    expect(reads).toBe(2)
  })

  test('rejects unsafe pending nonces', async () => {
    const manager = new SerializedNonceManager({
      getPendingNonce: async () => Number.MAX_SAFE_INTEGER + 1,
    })

    await expect(manager.run(async () => {})).rejects.toThrow('safe integer')
  })
})
