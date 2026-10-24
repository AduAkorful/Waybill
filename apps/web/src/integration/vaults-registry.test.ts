import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import {
  encodeVaultRegistryAction,
  VAULTS_REGISTRY_ABI,
} from './vaults-registry'

const attestor = '0x1111111111111111111111111111111111111111' as const
const harmed = '0x2222222222222222222222222222222222222222' as const

describe('vault and registry action boundary', () => {
  test('targets only the configured financing vault for lender/loan actions', () => {
    const deposit = encodeVaultRegistryAction(
      { kind: 'depositFinancing', amount: 1_000_000n },
      ARC_TESTNET,
    )
    const borrow = encodeVaultRegistryAction(
      { kind: 'borrow', dealId: 3n, amount: 500_000n, interestBps: 250 },
      ARC_TESTNET,
    )

    expect(deposit.to).toBe(ARC_TESTNET.contracts.financingVault)
    expect(borrow.to).toBe(ARC_TESTNET.contracts.financingVault)
    expect(decodeFunctionData({ abi: VAULTS_REGISTRY_ABI, data: deposit.data }).functionName).toBe(
      'deposit',
    )
    expect(decodeFunctionData({ abi: VAULTS_REGISTRY_ABI, data: borrow.data }).functionName).toBe(
      'borrow',
    )
  })

  test('targets only the bond vault for approvals, deposits, and slashes', () => {
    const approval = encodeVaultRegistryAction(
      { kind: 'approveBond', amount: 2_000_000n },
      ARC_TESTNET,
    )
    const slash = encodeVaultRegistryAction(
      {
        kind: 'flagNegligent',
        dealId: 3n,
        milestoneIndex: 1,
        attestor,
        slashBps: 5_000,
        harmed,
      },
      ARC_TESTNET,
    )

    expect(approval.to).toBe(ARC_TESTNET.usdc.address)
    expect(slash.to).toBe(ARC_TESTNET.contracts.bondVault)
    expect(decodeFunctionData({ abi: VAULTS_REGISTRY_ABI, data: slash.data }).functionName).toBe(
      'flagNegligent',
    )
  })

  test('encodes a self-managed registry profile at the configured registry', () => {
    const profile = encodeVaultRegistryAction(
      { kind: 'setAttestorProfile', name: 'Attestor', city: 'Accra', agentId: 42n },
      ARC_TESTNET,
    )
    expect(profile.to).toBe(ARC_TESTNET.contracts.attestorRegistry)
    expect(decodeFunctionData({ abi: VAULTS_REGISTRY_ABI, data: profile.data }).functionName).toBe(
      'setProfile',
    )
  })

  test('rejects zero/over-cap amounts, invalid slash bounds, and empty profiles', () => {
    expect(() =>
      encodeVaultRegistryAction({ kind: 'depositBond', amount: 0n }, ARC_TESTNET),
    ).toThrow('greater than zero')
    expect(() =>
      encodeVaultRegistryAction(
        { kind: 'borrow', dealId: 1n, amount: 1n, interestBps: 2_001 },
        ARC_TESTNET,
      ),
    ).toThrow('interestBps')
    expect(() =>
      encodeVaultRegistryAction(
        {
          kind: 'flagNegligent',
          dealId: 1n,
          milestoneIndex: 0,
          attestor,
          slashBps: 0,
          harmed,
        },
        ARC_TESTNET,
      ),
    ).toThrow('greater than zero')
    expect(() =>
      encodeVaultRegistryAction(
        { kind: 'setAttestorProfile', name: ' ', city: 'Accra', agentId: 0n },
        ARC_TESTNET,
      ),
    ).toThrow('required')
  })
})
