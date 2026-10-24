import type {
  NotificationMessage,
  PostgresNotificationOutbox,
} from './notification-outbox'

export interface EmailDelivery {
  to: string
  template: string
  payload: Record<string, unknown>
}

export interface EmailProvider {
  send(delivery: EmailDelivery): Promise<void>
}

export interface NotificationOutboxGateway {
  claimBatch(limit: number, leaseSeconds: number): Promise<NotificationMessage[]>
  markSent(id: number): Promise<void>
  markFailed(id: number, retryAfterSeconds: number, error: string): Promise<void>
}

export interface DispatchResult {
  claimed: number
  sent: number
  failed: number
}

export class NotificationDispatcher {
  constructor(
    private readonly outbox: NotificationOutboxGateway | PostgresNotificationOutbox,
    private readonly provider: EmailProvider,
    private readonly retryAfterSeconds = 60,
  ) {
    if (
      !Number.isSafeInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > 86_400
    ) {
      throw new Error('Notification retry delay must be between 1 and 86400 seconds')
    }
  }

  async dispatchBatch(limit = 20, leaseSeconds = 300): Promise<DispatchResult> {
    const messages = await this.outbox.claimBatch(limit, leaseSeconds)
    let sent = 0
    let failed = 0
    for (const message of messages) {
      try {
        if (message.channel !== 'email') throw new Error('Unsupported notification channel')
        await this.provider.send({
          to: message.recipient,
          template: message.template,
          payload: message.payload,
        })
        await this.outbox.markSent(message.id)
        sent += 1
      } catch (error) {
        failed += 1
        await this.outbox.markFailed(
          message.id,
          this.retryAfterSeconds,
          error instanceof Error ? error.message : 'Unknown notification failure',
        )
      }
    }
    return { claimed: messages.length, sent, failed }
  }
}
