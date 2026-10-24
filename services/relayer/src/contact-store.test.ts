import { describe, expect, test } from 'bun:test'

import {
  PostgresContactStore,
  type ContactInput,
  type DealFlag,
} from './contact-store'

class FakeDatabase {
  readonly calls: { text: string; values: readonly unknown[] }[] = []

  async query<Row>(text: string, values: readonly unknown[] = []) {
    this.calls.push({ text, values })
    if (text.includes('waybill_contacts') && text.includes('RETURNING')) {
      return {
        rows: [{
          network: 'testnet',
          wallet: values[1],
          role: values[2],
          email: values[3],
          notifications_enabled: values[4],
        }] as Row[],
      }
    }
    if (text.includes('waybill_deal_flags') && text.includes('RETURNING')) {
      return {
        rows: [{
          network: 'testnet',
          deal_id: values[1],
          label: values[2],
          is_test: values[3],
          notes: values[4],
        }] as Row[],
      }
    }
    return { rows: [] as Row[] }
  }
}

const contact: ContactInput = {
  network: 'testnet',
  wallet: `0x${'12'.repeat(20)}`,
  role: 'buyer',
  email: 'buyer@example.com',
  notificationsEnabled: true,
}

const flag: DealFlag = {
  network: 'testnet',
  dealId: 6n,
  label: 'labelled testnet self-dealing',
  isTest: true,
  notes: 'Never present as third-party volume',
}

describe('PostgresContactStore', () => {
  test('upserts contacts and labelled deal flags with network isolation', async () => {
    const database = new FakeDatabase()
    const store = new PostgresContactStore(database)

    await expect(store.upsertContact(contact)).resolves.toEqual(contact)
    await expect(store.upsertDealFlag(flag)).resolves.toEqual(flag)
    expect(database.calls[0]?.values).toEqual([
      'testnet',
      contact.wallet,
      'buyer',
      contact.email,
      true,
    ])
    expect(database.calls[1]?.values).toEqual([
      'testnet',
      '6',
      flag.label,
      true,
      flag.notes,
    ])
    expect(database.calls[0]?.text).not.toContain(contact.email)
    expect(database.calls[1]?.text).not.toContain(flag.label)
  })

  test('reads a missing contact or flag as null', async () => {
    const store = new PostgresContactStore({
      query: async () => ({ rows: [] }),
    })
    await expect(store.getContact('testnet', contact.wallet, 'buyer')).resolves.toBeNull()
    await expect(store.getDealFlag('mainnet', 6n)).resolves.toBeNull()
  })

  test('rejects unsafe contacts and unlabelled flags', async () => {
    const store = new PostgresContactStore(new FakeDatabase())
    await expect(store.upsertContact({ ...contact, wallet: '0x12' })).rejects.toThrow('wallet')
    await expect(store.upsertContact({ ...contact, email: 'bad' })).rejects.toThrow('email')
    await expect(store.upsertDealFlag({ ...flag, label: ' ' })).rejects.toThrow('label')
    await expect(store.getDealFlag('testnet', -1n)).rejects.toThrow('non-negative')
  })
})
