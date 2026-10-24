import { describe, expect, test } from 'bun:test'

import {
  NotificationDispatcher,
  type EmailDelivery,
  type EmailProvider,
} from './notification-dispatcher'
import type { NotificationMessage } from './notification-outbox'

class FakeOutbox {
  sent: number[] = []
  failed: { id: number; delay: number; error: string }[] = []

  constructor(private readonly messages: NotificationMessage[]) {}

  async claimBatch() {
    return this.messages
  }

  async markSent(id: number) {
    this.sent.push(id)
  }

  async markFailed(id: number, delay: number, error: string) {
    this.failed.push({ id, delay, error })
  }
}

class FakeProvider implements EmailProvider {
  deliveries: EmailDelivery[] = []
  constructor(private readonly failingRecipient?: string) {}

  async send(delivery: EmailDelivery) {
    this.deliveries.push(delivery)
    if (delivery.to === this.failingRecipient) throw new Error('provider timeout')
  }
}

const message = (id: number, recipient: string): NotificationMessage => ({
  id,
  network: 'testnet',
  dedupeKey: `deal:${id}`,
  channel: 'email',
  recipient,
  template: 'milestone-claimable',
  payload: { dealId: String(id) },
  status: 'processing',
  attempts: 1,
  lastError: null,
})

describe('NotificationDispatcher', () => {
  test('delivers successful messages with exact template data', async () => {
    const outbox = new FakeOutbox([message(1, 'buyer@example.com')])
    const provider = new FakeProvider()
    const dispatcher = new NotificationDispatcher(outbox, provider)

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
    })
    expect(provider.deliveries).toEqual([{
      to: 'buyer@example.com',
      template: 'milestone-claimable',
      payload: { dealId: '1' },
    }])
    expect(outbox.sent).toEqual([1])
  })

  test('isolates provider failures and schedules retry', async () => {
    const outbox = new FakeOutbox([
      message(1, 'buyer@example.com'),
      message(2, 'supplier@example.com'),
    ])
    const provider = new FakeProvider('supplier@example.com')
    const dispatcher = new NotificationDispatcher(outbox, provider, 120)

    await expect(dispatcher.dispatchBatch(2, 60)).resolves.toEqual({
      claimed: 2,
      sent: 1,
      failed: 1,
    })
    expect(outbox.sent).toEqual([1])
    expect(outbox.failed).toEqual([{ id: 2, delay: 120, error: 'provider timeout' }])
  })

  test('rejects an unsafe retry delay', () => {
    expect(() => new NotificationDispatcher(new FakeOutbox([]), new FakeProvider(), 0)).toThrow(
      'retry delay',
    )
  })
})
