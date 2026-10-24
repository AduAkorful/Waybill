import { parseAbi, type PublicClient } from 'viem'

import { WAYBILL_DEAL_ABI, type RelayerChain } from './chain'

export const PARTY_ROLES = ['buyer', 'supplier', 'arbiter', 'panel', 'attestor'] as const
export type PartyRole = (typeof PARTY_ROLES)[number]

export interface DealParty {
  address: `0x${string}`
  role: PartyRole
  /** The part an attestor confirms; null for roles about the whole deal */
  milestoneIndex: number | null
}

const PARTY_ABI = parseAbi([
  'function getAttestors(uint256 dealId, uint8 milestoneIndex) view returns (address[])',
  'function getPanelMembers(uint256 dealId) view returns (address[3])',
])

const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * Everyone the escrow names in one deal, read at the block the deal was created in. The roles are what
 * the contract itself stores, so an invited attestor who has not accepted yet is still found.
 */
export async function readDealParties(
  chain: RelayerChain,
  dealId: bigint,
  blockNumber: bigint,
): Promise<DealParty[]> {
  const client = chain.client as PublicClient
  const deal = (await client.readContract({
    address: chain.escrow,
    abi: WAYBILL_DEAL_ABI,
    functionName: 'getDeal',
    args: [dealId],
    blockNumber,
  })) as { buyer: `0x${string}`; supplier: `0x${string}`; arbiter: `0x${string}`; milestoneCount: number }

  const positions = Array.from({ length: deal.milestoneCount }, (_, i) => i)
  const [attestorLists, panel] = await Promise.all([
    Promise.all(
      positions.map(
        (i) =>
          client.readContract({
            address: chain.escrow,
            abi: PARTY_ABI,
            functionName: 'getAttestors',
            args: [dealId, i],
            blockNumber,
          }) as Promise<readonly `0x${string}`[]>,
      ),
    ),
    client.readContract({
      address: chain.escrow,
      abi: PARTY_ABI,
      functionName: 'getPanelMembers',
      args: [dealId],
      blockNumber,
    }) as Promise<readonly `0x${string}`[]>,
  ])

  const parties: DealParty[] = [
    { address: deal.buyer, role: 'buyer', milestoneIndex: null },
    { address: deal.supplier, role: 'supplier', milestoneIndex: null },
    { address: deal.arbiter, role: 'arbiter', milestoneIndex: null },
  ]
  for (const member of panel) {
    if (member.toLowerCase() !== ZERO) parties.push({ address: member, role: 'panel', milestoneIndex: null })
  }
  attestorLists.forEach((list, i) => {
    for (const address of list) parties.push({ address, role: 'attestor', milestoneIndex: i })
  })
  return parties
}
