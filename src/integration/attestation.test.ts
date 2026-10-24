import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, type Hex } from 'viem'
import { ARC_TESTNET } from '../../config/networks'
import {
  attestAction,
  buildAttestationTypedData,
  hashAttestation,
  signAttestation,
  WAYBILL_ATTESTATION_TYPES,
  WAYBILL_STATEMENT_VERSION,
} from './attestation'

const signer = '0x1111111111111111111111111111111111111111' as const
const evidenceHash =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const input = {
  dealId: 9n,
  milestoneIndex: 1,
  evidenceHash,
  signedAt: 1_900_000_000n,
  expiry: 2_000_000_000n,
  signer,
}

describe('signer-bound attestation boundary', () => {
  test('builds the exact current escrow domain and statement fields', () => {
    const typed = buildAttestationTypedData(input, ARC_TESTNET)
    expect(typed.domain).toEqual({
      name: 'WaybillEscrow',
      version: '1',
      chainId: ARC_TESTNET.chainId,
      verifyingContract: ARC_TESTNET.contracts.escrow,
    })
    expect(typed.types).toEqual(WAYBILL_ATTESTATION_TYPES)
    expect(typed.message.statementVersion).toBe(WAYBILL_STATEMENT_VERSION)
    expect(hashAttestation(input, ARC_TESTNET)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  test('encodes the signed attest transaction to the current escrow', () => {
    const action = attestAction(input, '0xbb' as Hex, ARC_TESTNET)
    const decoded = decodeFunctionData({
      abi: [{
        type: 'function',
        name: 'attest',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'dealId', type: 'uint256' },
          { name: 'milestoneIndex', type: 'uint8' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'signedAt', type: 'uint64' },
          { name: 'expiry', type: 'uint64' },
          { name: 'signer', type: 'address' },
          { name: 'signature', type: 'bytes' },
        ],
        outputs: [],
      }],
      data: action.data,
    })
    expect(action.to).toBe(ARC_TESTNET.contracts.escrow)
    expect(decoded.functionName).toBe('attest')
    expect(decoded.args?.[0]).toBe(9n)
  })

  test('uses the matching active wallet and preserves the signature result', async () => {
    let received: unknown
    const signature =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex
    const result = await signAttestation(
      {
        chain: { id: ARC_TESTNET.chainId },
        account: { address: signer, type: 'json-rpc' },
        signTypedData: async (request) => {
          received = request
          return signature
        },
      } as never,
      input,
      ARC_TESTNET,
    )
    expect(result).toBe(signature)
    expect(received).toMatchObject({
      primaryType: 'Attestation',
      domain: { verifyingContract: ARC_TESTNET.contracts.escrow },
    })
  })

  test('rejects invalid time bounds and a mismatched active wallet', async () => {
    expect(() =>
      buildAttestationTypedData({ ...input, expiry: input.signedAt }, ARC_TESTNET),
    ).toThrow('expiry')
    await expect(
      signAttestation(
        {
          chain: { id: ARC_TESTNET.chainId },
          account: { address: '0x2222222222222222222222222222222222222222', type: 'json-rpc' },
        } as never,
        input,
        ARC_TESTNET,
      ),
    ).rejects.toThrow('does not match')
  })
})
