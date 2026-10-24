import { describe, expect, test } from 'bun:test'
import { renderEmail } from './email-render'
import { planNotifications, type PlannedParty } from './notification-planner'

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const parties: PlannedParty[] = [
  { address: A(1), role: 'buyer', milestoneIndex: null },
  { address: A(2), role: 'supplier', milestoneIndex: null },
  { address: A(3), role: 'arbiter', milestoneIndex: null },
  { address: A(4), role: 'attestor', milestoneIndex: 0 },
]
const ev = (name: string, payload: Record<string, unknown> = {}, milestoneIndex?: number) => ({ name, dealId: 7n, payload, ...(milestoneIndex === undefined ? {} : { milestoneIndex }) })
const who = (name: string, payload?: Record<string, unknown>, m?: number, p = parties) =>
  planNotifications(ev(name, payload, m), p).map((n) => `${n.wallet.slice(-1)}:${n.role}:${n.template}`).sort()

describe('who is told', () => {
  test('everyone but the buyer is invited when a deal is created', () => {
    expect(who('DealCreated')).toEqual(['2:supplier:invited', '3:arbiter:invited', '4:attestor:invited'])
  })
  test('the buyer hears about each acceptance; funding tells everyone else', () => {
    expect(who('SupplierAccepted')).toEqual(['1:buyer:accepted'])
    expect(who('DealFunded')).toEqual(['2:supplier:funded', '3:arbiter:funded', '4:attestor:funded'])
  })
  test('a dispute reaches the other side and the arbiter, not the person who raised it', () => {
    expect(who('DisputeRaised', { raiser: A(1) }, 0)).toEqual(['2:supplier:dispute_raised', '3:arbiter:dispute_raised'])
    expect(who('DisputeRaised', { raiser: A(2) }, 0)).toEqual(['1:buyer:dispute_raised', '3:arbiter:dispute_raised'])
  })
  test('a decision tells buyer and supplier once, whichever event reports it', () => {
    const keys = new Set([...['DisputeResolved', 'PanelResolved', 'TrancheSplit']].flatMap((n) => planNotifications(ev(n, {}, 0), parties).map((x) => x.key)))
    expect(keys.size).toBe(2)
    expect(who('DisputeResolved', {}, 0)).toEqual(['1:buyer:dispute_decided', '2:supplier:dispute_decided'])
  })
  test('panel members are told as arbiters, and a wallet in two roles gets one message', () => {
    const panel: PlannedParty[] = [...parties, { address: A(5), role: 'panel', milestoneIndex: null }, { address: A(3), role: 'panel', milestoneIndex: null }]
    expect(who('DealFunded', {}, undefined, panel)).toEqual(['2:supplier:funded', '3:arbiter:funded', '4:attestor:funded', '5:arbiter:funded'])
  })
  test('unrelated events tell nobody', () => {
    expect(who('FeesWithdrawn')).toEqual([])
    expect(who('NewDealsPaused')).toEqual([])
  })
  test('part numbers are shown as people count them', () => {
    expect(planNotifications(ev('MilestoneRefundable', {}, 0), parties)[0]!.data.part).toBe('1')
  })
})

describe('email wording', () => {
  test('links to the page for the recipient’s role and carries no commercial detail', () => {
    const mail = renderEmail('dispute_raised', { deal: '7', part: '1', role: 'supplier' }, 'https://app.example/')!
    expect(mail.text).toContain('https://app.example/d/7')
    expect(mail.subject).toBe('A dispute was raised on deal 7 part 1')
    expect(renderEmail('invited', { deal: '7', role: 'arbiter' }, 'https://app.example')!.text).toContain('/app/room/7')
  })
  test('the verification link carries the token and says what happens if ignored', () => {
    const mail = renderEmail('verify_email', { token: 'abc_DEF-123' }, 'https://app.example')!
    expect(mail.text).toContain('https://app.example/verify-email?token=abc_DEF-123')
    expect(mail.text).toContain('ignore it')
  })
  test('an unknown template or a missing role sends nothing', () => {
    expect(renderEmail('surprise', { deal: '1', role: 'buyer' }, 'https://x')).toBeNull()
    expect(renderEmail('funded', { deal: '1' }, 'https://x')).toBeNull()
  })
  test('html is escaped', () => {
    expect(renderEmail('funded', { deal: '<b>', role: 'buyer' }, 'https://x')!.html).not.toContain('<b>')
  })
})
