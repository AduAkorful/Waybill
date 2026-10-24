import { describe, expect, test } from 'bun:test'
import { buyerFee, supplierFee } from './derive'
import { formatAmount, formatDateTime, shortAddress, toCents } from './format'
import { trancheAmounts } from './from-chain'
import { describeAttestorEvent, parseAttestor, parseAttestors } from './attestor'
import { parseDealEvents, splitDecisions } from './events'
import { refundedFor, releasedFor, splitBuyerReceives, unknownSplitParts } from './derive'
import type { DealView, Tranche } from './types'
import { dealsInShell, heldShells, parseWalletDeals, rolesIn } from './wallet'
import { needsFrom, sectionOf } from './inbox'
import { parseArbiters } from './arbiter'
import { disputeStage, percentToSplitBps, splitPrincipal } from './room'
import { describeChange, gasToUsdcUnits, lagOf, parseOperatorSummary } from './operator'

const part = (fee: bigint) => ({ fee }) as Tranche

describe('formatAmount', () => {
  test('shows two decimals and never rounds sub-cent digits away', () => {
    expect(formatAmount(20_250_000_000n)).toBe('20,250.00')
    expect(formatAmount(7_500n)).toBe('0.0075')
    expect(formatAmount(1_000_000n)).toBe('1.00')
    expect(formatAmount(0n)).toBe('0.00')
  })
  test('rounds to cents half up only for counters', () => {
    expect(toCents(7_500n)).toBe(1)
    expect(toCents(4_999n)).toBe(0)
  })
})

describe('trancheAmounts', () => {
  test('follows the contract: floor for all but the last, remainder to the last', () => {
    const out = trancheAmounts(1_000_001n, [3333n, 3333n, 3334n])
    expect(out).toEqual([333_300n, 333_300n, 333_401n])
    expect(out.reduce((a, b) => a + b, 0n)).toBe(1_000_001n)
  })
})

describe('fee split', () => {
  test('buyer pays all, supplier none, or the buyer half rounds up', () => {
    expect(buyerFee(part(7n), 'buyer')).toBe(7n)
    expect(buyerFee(part(7n), 'supplier')).toBe(0n)
    expect(buyerFee(part(7n), 'split')).toBe(4n)
    expect(supplierFee(part(7n), 'split')).toBe(3n)
  })
})

describe('time and address', () => {
  test('formats UTC', () => {
    expect(formatDateTime(1_792_962_911n)).toBe('25 Oct 2026, 21:15 UTC')
  })
  test('shortens long values only', () => {
    expect(shortAddress('0x4632A278FEb0a4D249561e7fC3f3708C4329D0F1')).toBe('0x4632\u2060…\u2060D0F1')
    expect(shortAddress('0x1234')).toBe('0x1234')
  })
})

describe('arbiter splits', () => {
  const hash = `0x${'ab'.repeat(32)}`
  const rows = [
    { eventName: 'DealCreated', blockNumber: '5', logIndex: '0', transactionHash: hash, milestoneIndex: null, blockTimestamp: '1700000000', payload: {} },
    {
      eventName: 'TrancheSplit', blockNumber: '9', logIndex: '2', transactionHash: hash, milestoneIndex: 0, blockTimestamp: null,
      payload: { supplierBps: '6000', supplierAmount: '600000', buyerAmount: '400000' },
    },
  ]
  // principal 1,000,000 with a 10,000 fee the buyer prepaid, split 60/40 in the supplier's favour
  const deal = {
    feePayer: 'buyer',
    state: 'funded',
    arbiterFee: 0n,
    tranches: [{ position: 0, state: 'resolved', amount: 1_000_000n, fee: 10_000n }],
  } as unknown as DealView

  test('parses the relayer list and reads block time as optional', () => {
    const events = parseDealEvents(rows)
    expect(events[0]?.time).toBe(1_700_000_000n)
    expect(events[1]?.time).toBeNull()
    expect(splitDecisions(events)).toEqual([
      { position: 0, supplierBps: 6000, supplierAmount: 600_000n, buyerPrincipal: 400_000n },
    ])
  })

  test('rejects malformed rows instead of showing part of a history', () => {
    expect(() => parseDealEvents({})).toThrow()
    expect(() => parseDealEvents([{ ...rows[0], transactionHash: '0x12' }])).toThrow('transaction hash')
    expect(() => parseDealEvents([{ ...rows[0], blockNumber: 5.5 }])).toThrow('blockNumber')
    expect(() => parseDealEvents([{ ...rows[0], blockNumber: -1 }])).toThrow('blockNumber')
  })

  test('accepts whole numbers sent as JSON numbers, as the relayer does for supplierBps', () => {
    expect(() => parseDealEvents([{ ...rows[0], blockNumber: 5 }])).not.toThrow()
  })

  test('counts a split part once its event is known, matching the contract', () => {
    const decision = { position: 0, supplierBps: 6000, supplierAmount: 600_000n, buyerPrincipal: 400_000n }
    expect(unknownSplitParts(deal)).toHaveLength(1)
    expect(releasedFor(deal)).toBe(0n)
    const known = { ...deal, splits: [decision] }
    expect(unknownSplitParts(known)).toHaveLength(0)
    expect(releasedFor(known)).toBe(600_000n)
    // the buyer gets 400,000 principal back plus 40% of the 10,000 fee they prepaid
    expect(splitBuyerReceives(known, known.tranches[0]!, decision)).toBe(404_000n)
    expect(refundedFor(known)).toBe(404_000n)
  })
})

describe('attestor model', () => {
  const who = `0x${'ab'.repeat(20)}`
  const row = { address: who, status: 'registered', attested: 12, upheld: 1, slashed: 0, profile: { name: 'Lin Mei', city: 'Ningbo', agentId: '0' }, pending: null }

  test('parses the relayer record and an absent profile', () => {
    expect(parseAttestor(row)).toMatchObject({ address: who, attested: 12, profile: { name: 'Lin Mei', agentId: 0n }, pending: null })
    expect(parseAttestor({ ...row, profile: null }).profile).toBeNull()
    expect(parseAttestor({ ...row, pending: { status: 'suspended', eta: '1800000000', automatic: true } }).pending).toEqual({ status: 'suspended', eta: 1_800_000_000n, automatic: true })
  })

  test('rejects anything it does not understand instead of showing a partial directory', () => {
    expect(() => parseAttestors({})).toThrow()
    expect(() => parseAttestor({ ...row, address: '0x12' })).toThrow('invalid address')
    expect(() => parseAttestor({ ...row, status: 'gold' })).toThrow('status')
    expect(() => parseAttestor({ ...row, attested: '12' })).toThrow('attested count')
  })

  test('words registry events from their own arguments', () => {
    const ev = (name: string, args: Record<string, unknown>) => ({ name, args, position: null, blockNumber: 1n, logIndex: 0n, txHash: `0x${'aa'.repeat(32)}` as `0x${string}`, time: null })
    expect(describeAttestorEvent(ev('OutcomeRecorded', { kind: 1 }))).toContain('decided against')
    expect(describeAttestorEvent(ev('StatusExecuted', { status: 2 }))).toContain('suspended')
    expect(describeAttestorEvent(ev('SomethingNew', {}))).toBe('SomethingNew')
  })
})

describe('wallet deals', () => {
  const raw = [
    { dealId: '278', state: 'SETTLED', roles: [{ role: 'buyer', milestoneIndex: null }] },
    {
      dealId: '2',
      state: null,
      roles: [
        { role: 'attestor', milestoneIndex: 0 },
        { role: 'panel', milestoneIndex: null },
      ],
    },
  ]

  test('parses ids to bigint and part numbers', () => {
    const deals = parseWalletDeals(raw)
    expect(deals[0]!.dealId).toBe(278n)
    expect(deals[1]!.roles[0]).toEqual({ role: 'attestor', part: 0 })
  })

  test('groups by shell, with panel members under arbiter', () => {
    const deals = parseWalletDeals(raw)
    expect(heldShells(deals)).toEqual(['buyer', 'attestor', 'arbiter'])
    expect(dealsInShell(deals, 'arbiter').map((d) => d.dealId)).toEqual([2n])
    expect(rolesIn(deals[1]!, 'attestor')).toEqual([{ role: 'attestor', part: 0 }])
  })

  test('rejects what it does not understand', () => {
    expect(() => parseWalletDeals({})).toThrow()
    expect(() => parseWalletDeals([{ dealId: 'x', state: null, roles: [] }])).toThrow()
    expect(() => parseWalletDeals([{ dealId: '1', state: null, roles: [{ role: 'admin', milestoneIndex: null }] }])).toThrow()
    expect(() => parseWalletDeals([{ dealId: '1', state: null, roles: [] }])).toThrow()
  })
})

describe('inbox', () => {
  const wallet = '0x00000000000000000000000000000000000000aa' as `0x${string}`
  const other = '0x00000000000000000000000000000000000000bb' as `0x${string}`
  const tranche = (over: Partial<Tranche>): Tranche => ({ index: 1, attestors: over.attestor ? [over.attestor] : [], position: 0, state: 'waiting', attestor: null, attestorAccepted: false, attested: false, responseSubmitted: false, disputeRaiser: null, responseDeadline: 0n, amount: 1_000_000n, ...over }) as Tranche
  const deal = (over: Partial<DealView>, parts: Tranche[]): DealView =>
    ({ state: 'funded', supplierPayout: other, arbiter: other, chainTime: 100n, tranches: parts, ...over }) as DealView

  test('buyer: review, fund, refund', () => {
    expect(needsFrom('buyer', deal({}, [tranche({ state: 'in_review' })]), wallet)).toBe('Review')
    expect(needsFrom('buyer', deal({ state: 'accepted' }, [tranche({})]), wallet)).toBe('Fund')
    expect(needsFrom('buyer', deal({}, [tranche({ state: 'refundable' })]), wallet)).toBe('Refund')
    expect(needsFrom('buyer', deal({}, [tranche({})]), wallet)).toBeNull()
  })

  test('supplier: accept while unaccepted', () => {
    expect(needsFrom('supplier', deal({ state: 'proposed', supplierPayout: null }, [tranche({})]), wallet)).toBe('Accept')
  })

  test('attestor: only parts naming this wallet', () => {
    expect(needsFrom('attestor', deal({}, [tranche({ attestor: wallet })]), wallet)).toBe('Sign')
    expect(needsFrom('attestor', deal({}, [tranche({ attestor: other })]), wallet)).toBeNull()
  })

  test('arbiter: decides once the response window has closed', () => {
    const d = (now: bigint) => deal({ arbiter: wallet, chainTime: now }, [tranche({ state: 'disputed', responseDeadline: 50n, arbiterDeadline: 90n })])
    expect(needsFrom('arbiter', d(50n), wallet)).toBeNull()
    expect(needsFrom('arbiter', d(51n), wallet)).toBe('Decide')
    expect(needsFrom('arbiter', d(91n), wallet)).toBeNull()
  })

  test('arbiter on testnet (no early rule): a response does not ask for a decision before the window ends', () => {
    const d = (now: bigint) => deal({ arbiter: wallet, chainTime: now }, [tranche({ state: 'disputed', responseSubmitted: true, responseDeadline: 50n, arbiterDeadline: 90n })])
    expect(needsFrom('arbiter', d(10n), wallet)).toBeNull()
    expect(needsFrom('arbiter', d(51n), wallet)).toBe('Decide')
    expect(needsFrom('arbiter', d(91n), wallet)).toBeNull()
  })

  test('arbiter: accepts a proposed deal once', () => {
    const d = (accepted: boolean) => deal({ state: 'proposed', arbiter: wallet, arbiterAccepted: accepted }, [tranche({})])
    expect(needsFrom('arbiter', d(false), wallet)).toBe('Accept')
    expect(needsFrom('arbiter', d(true), wallet)).toBeNull()
  })

  test('settled deals are done and need nothing', () => {
    const d = deal({ state: 'settled' }, [tranche({ state: 'released' })])
    expect(sectionOf('buyer', d, wallet)).toBe('done')
  })
})

describe('arbiter list', () => {
  const row = { address: `0x${'ab'.repeat(20)}`, allowed: true, fee: '5000000', pendingAdd: null, pendingRemove: { eta: '1800000000' } }
  test('parses amounts to bigint and keeps pending changes', () => {
    const [a] = parseArbiters([row])
    expect(a!.fee).toBe(5_000_000n)
    expect(a!.pendingRemove).toEqual({ eta: 1_800_000_000n })
    expect(a!.pendingAdd).toBeNull()
  })
  test('rejects what it does not understand', () => {
    expect(() => parseArbiters({})).toThrow()
    expect(() => parseArbiters([{ ...row, fee: 'x' }])).toThrow('fee')
    expect(() => parseArbiters([{ ...row, address: '0x1' }])).toThrow('address')
  })
})

describe('dispute room', () => {
  const p = { responseDeadline: 100n, arbiterDeadline: 200n, responseSubmitted: false }
  test('stages follow the escrow clocks', () => {
    for (const early of [false, true]) {
      expect(disputeStage(p, 100n, early)).toBe('response_open')
      expect(disputeStage(p, 101n, early)).toBe('decision_open')
      expect(disputeStage(p, 200n, early)).toBe('decision_open')
      expect(disputeStage(p, 201n, early)).toBe('deadline_passed')
    }
  })
  test('with the early rule, a response opens decisions at decisionOpensAt (after the rebuttal day), up to the reset deadline', () => {
    const r = { responseDeadline: 100n, arbiterDeadline: 150n, responseSubmitted: true, decisionOpensAt: 40n }
    expect(disputeStage(r, 1n, true)).toBe('rebuttal_open')
    expect(disputeStage(r, 39n, true)).toBe('rebuttal_open')
    expect(disputeStage(r, 40n, true)).toBe('decision_open')
    expect(disputeStage(r, 150n, true)).toBe('decision_open')
    expect(disputeStage(r, 151n, true)).toBe('deadline_passed')
  })
  test('with the early rule, a responded part whose opening time was not read is never offered a decision', () => {
    const r = { responseDeadline: 100n, arbiterDeadline: 150n, responseSubmitted: true }
    expect(disputeStage(r, 120n, true)).toBe('rebuttal_open')
  })
  test('without the early rule (the current testnet escrow), a response does not open decisions before the window ends', () => {
    const r = { responseDeadline: 100n, arbiterDeadline: 200n, responseSubmitted: true }
    expect(disputeStage(r, 1n, false)).toBe('response_open')
    expect(disputeStage(r, 100n, false)).toBe('response_open')
    expect(disputeStage(r, 101n, false)).toBe('decision_open')
  })
  test('a split never creates or loses a unit', () => {
    expect(splitPrincipal(1_000_001n, 6_000)).toEqual({ supplier: 600_000n, buyer: 400_001n })
    expect(splitPrincipal(7n, 5_000)).toEqual({ supplier: 3n, buyer: 4n })
    expect(() => splitPrincipal(1n, 10_001)).toThrow()
  })
  test('typed percentages become valid split shares only', () => {
    expect(percentToSplitBps('62.5')).toBe(6250)
    expect(percentToSplitBps('0')).toBeNull()
    expect(percentToSplitBps('100')).toBeNull()
    expect(percentToSplitBps('abc')).toBeNull()
  })
})

describe('operator summary', () => {
  const addr = `0x${'ab'.repeat(20)}`
  const raw = {
    network: 'testnet',
    chainId: 5042002,
    escrow: addr,
    chain: { totalDeals: '281', currentLocked: '0', maxLocked: '1000', maxDealAmount: '100', newDealsPaused: false, pauser: addr, treasury: addr, relayer: { address: addr, gasBalance: '5000000000000' }, head: '900' },
    index: {
      dealsByState: { FUNDED: 2 },
      volume: [{ label: null, isTest: null, created: { deals: 2, amount: '2000000' }, funded: { deals: 1, amount: '1000000' } }],
      openDisputes: 1,
      cursors: [{ stream: 'escrow-indexer', block: '880', updatedAt: 1800000000 }],
      adminLog: [{ name: 'NewDealsPaused', block: '5', txHash: '0x12', time: null }],
    },
  }
  test('parses amounts to bigint and keeps unlabelled volume as unlabelled', () => {
    const s = parseOperatorSummary(raw)
    expect(s.chain.maxLocked).toBe(1000n)
    expect(s.index.volume[0]).toMatchObject({ label: null, isTest: null, created: { deals: 2, amount: 2_000_000n } })
    expect(s.index.adminLog[0]!.time).toBeNull()
  })
  test('rejects anything it does not understand', () => {
    expect(() => parseOperatorSummary({ ...raw, chain: { ...raw.chain, newDealsPaused: 'no' } })).toThrow('pause state')
    expect(() => parseOperatorSummary({ ...raw, chain: { ...raw.chain, maxLocked: 'x' } })).toThrow('cap')
    expect(() => parseOperatorSummary({})).toThrow()
  })
  test('lag never goes negative and gas converts explicitly', () => {
    expect(lagOf(900n, 880n)).toBe(20n)
    expect(lagOf(10n, 20n)).toBe(0n)
    expect(gasToUsdcUnits(5_000_000_000_000n)).toBe(5n)
    expect(describeChange('Mystery')).toBe('Mystery')
  })
})

describe('aligned amounts', () => {
  test('both amounts use the same number of decimals', async () => {
    const { formatAmountsAligned } = await import('./format')
    expect(formatAmountsAligned(20_100_000n, 1_163_558n)).toEqual(['20.100000', '1.163558'])
    expect(formatAmountsAligned(20_100_000n, 1_000_000n)).toEqual(['20.10', '1.00'])
  })
})

describe('Chinese dates', () => {
  test('are written year, month, day in UTC', async () => {
    const { formatDayZh, formatDateTimeZh } = await import('./format')
    expect(formatDayZh(1_792_962_911n)).toBe('2026年10月25日')
    expect(formatDateTimeZh(1_792_962_911n)).toBe('2026年10月25日 21:15 UTC')
  })
})
