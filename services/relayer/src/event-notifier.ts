import type { WaybillNetwork } from '@waybill/network/networks'
import type { NotificationInput } from './notification-outbox'
import { planNotifications, type PlannedParty } from './notification-planner'

/** Events older than this are history being re-read (a backfill), not news, and are never mailed. */
export const MAX_NEWS_AGE_SECONDS = 48 * 3_600

export interface NotifiableEvent {
  eventName: string
  dealId?: bigint
  milestoneIndex?: number
  blockTimestamp?: bigint
  transactionHash: string
  logIndex: bigint
  payload: Record<string, unknown>
}

export interface EventNotifierDeps {
  network: WaybillNetwork
  parties(dealId: bigint): Promise<PlannedParty[]>
  /** The verified, switched-on email for a wallet, or null */
  recipient(wallet: string): Promise<string | null>
  enqueue(input: NotificationInput): Promise<unknown>
  now?: () => number
}

/** Turns a newly indexed escrow event into queued emails for the people it concerns who asked to be told. */
export class EventNotifier {
  constructor(private readonly deps: EventNotifierDeps) {}

  async handle(event: NotifiableEvent, isNew: boolean): Promise<number> {
    if (!isNew || event.dealId === undefined) return 0
    const now = (this.deps.now ?? (() => Math.floor(Date.now() / 1000)))()
    // without a block time we cannot tell news from history, so say nothing
    if (event.blockTimestamp === undefined || now - Number(event.blockTimestamp) > MAX_NEWS_AGE_SECONDS) return 0

    const planned = planNotifications(
      { name: event.eventName, dealId: event.dealId, ...(event.milestoneIndex === undefined ? {} : { milestoneIndex: event.milestoneIndex }), payload: event.payload },
      await this.deps.parties(event.dealId),
    )
    let queued = 0
    for (const item of planned) {
      const to = await this.deps.recipient(item.wallet)
      if (!to) continue
      await this.deps.enqueue({
        network: this.deps.network,
        dedupeKey: item.key,
        channel: 'email',
        recipient: to,
        template: item.template,
        payload: { ...item.data, role: item.role },
      })
      queued += 1
    }
    return queued
  }
}
