import { describe, expect, test } from 'bun:test'

import {
  PostgresNotificationOutbox,
  type NotificationInput,
} from './notification-outbox'

class FakeDatabase {
  readonly calls: { text: string; values: readonly unknown[] }[] = []

  async query<Row>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values })
    if (text.includes('INSERT')) {
      return {
        rows: [{
          id: 4,
          network: 'testnet',
          dedupe_key: 'deal:1:claim',
          channel: 'email',
          recipient: 'buyer@example.com',
          template: 'milestone-claimable',
          payload: { dealId: '1' },
          status: 'pending',
          attempts: 0,
          last_error: null,
        }] as Row[],
      }
    }
    if (text.includes('WITH candidates')) {
      return {
        rows: [{
          id: 4,
          network: 'testnet',
          dedupe_key: 'deal:1:claim',
          channel: 'email',
          recipient: 'buyer@example.com',
          template: 'milestone-claimable',
          payload: { dealId: '1' },
          status: 'processing',
          attempts: 1,
          last_error: null,
        }] as Row[],
      }
    }
    return { rows: [] as Row[] }
  }
}

const input: NotificationInput = {
  network: 'testnet',
  dedupeKey: 'deal:1:claim',
  channel: 'email',
  recipient: 'buyer@example.com',
  template: 'milestone-claimable',
  payload: { dealId: '1' },
}

describe('PostgresNotificationOutbox', () => {
  test('enqueues a deduplicated template payload', async () => {
    const database = new FakeDatabase()
    const outbox = new PostgresNotificationOutbox(database)

    await expect(outbox.enqueue(input)).resolves.toMatchObject({
      id: 4,
      status: 'pending',
      attempts: 0,
    })
    expect(database.calls[0]?.values).toEqual([
      'testnet',
      'deal:1:claim',
      'email',
      'buyer@example.com',
      'milestone-claimable',
      JSON.stringify(input.payload),
    ])
    expect(database.calls[0]?.text).not.toContain('buyer@example.com')
  })

  test('claims leased work and records success or retryable failure', async () => {
    const database = new FakeDatabase()
    const outbox = new PostgresNotificationOutbox(database)

    await expect(outbox.claimBatch(10, 300)).resolves.toMatchObject([{
      id: 4,
      status: 'processing',
      attempts: 1,
    }])
    await expect(outbox.markSent(4)).resolves.toBeUndefined()
    await expect(outbox.markFailed(4, 60, 'provider timeout')).resolves.toBeUndefined()
    expect(database.calls[0]?.values).toEqual([10, 300])
    expect(database.calls[2]?.values).toEqual([4, 60, 'provider timeout'])
  })

  test('rejects unsafe recipients, payloads, and worker bounds', async () => {
    const outbox = new PostgresNotificationOutbox(new FakeDatabase())
    await expect(outbox.enqueue({ ...input, recipient: 'not-an-email' })).rejects.toThrow(
      'recipient',
    )
    await expect(outbox.enqueue({ ...input, payload: { amount: 1n } })).rejects.toThrow(
      'BigInt',
    )
    await expect(outbox.claimBatch(0, 60)).rejects.toThrow('batch limit')
    await expect(outbox.claimBatch(1, 3_601)).rejects.toThrow('lease')
    await expect(outbox.markFailed(4, 60, '')).rejects.toThrow('failure cannot be empty')
  })
})
