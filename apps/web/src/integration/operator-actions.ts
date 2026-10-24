import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, encodeFunctionData, parseAbi, type PublicClient } from 'viem'
import type { WaybillNetworkManifest } from '@waybill/network/networks'
import type { EncodedWalletAction } from './escrow'
import { getBrowserNetwork } from './network'

const PAUSE_ABI = parseAbi(['function pauseNewDeals()', 'function unpauseNewDeals()'])

/**
 * The only two operator actions the web app can encode, kept apart from the user actions on purpose. Both take no
 * arguments and only gate the creation and funding of new deals; the escrow has no function that lets anyone move,
 * freeze or redirect funds already locked, so none can be encoded here.
 */
export type OperatorAction = 'pauseNewDeals' | 'unpauseNewDeals'

export function encodeOperatorAction(action: OperatorAction, network: WaybillNetworkManifest = getBrowserNetwork()): EncodedWalletAction {
  if (action !== 'pauseNewDeals' && action !== 'unpauseNewDeals') throw new Error('Unsupported operator action')
  return {
    to: network.contracts.escrow,
    data: encodeFunctionData({ abi: PAUSE_ABI, functionName: action }),
    chainId: network.chainId,
  }
}

const ARBITER_LIST_ABI = parseAbi([
  'function scheduleAddArbiter(address arbiter, uint256 fee)',
  'function executeAddArbiter(address arbiter)',
  'function scheduleRemoveArbiter(address arbiter)',
  'function executeRemoveArbiter(address arbiter)',
])

/**
 * The pauser's four approved-list actions. The list decides who can be named on a NEW deal and holds no money; each
 * change waits 48 hours on-chain before it can be executed, and a deal already created keeps its arbiter.
 */
export type ArbiterListAction =
  | { kind: 'scheduleAddArbiter'; arbiter: `0x${string}`; fee: bigint }
  | { kind: 'executeAddArbiter'; arbiter: `0x${string}` }
  | { kind: 'scheduleRemoveArbiter'; arbiter: `0x${string}` }
  | { kind: 'executeRemoveArbiter'; arbiter: `0x${string}` }

export function encodeArbiterListAction(action: ArbiterListAction, network: WaybillNetworkManifest = getBrowserNetwork()): EncodedWalletAction {
  if (!/^0x[0-9a-fA-F]{40}$/.test(action.arbiter) || /^0x0{40}$/.test(action.arbiter)) throw new Error('arbiter must be a non-zero wallet address')
  const data =
    action.kind === 'scheduleAddArbiter'
      ? (() => {
          if (action.fee < 0n) throw new Error('fee cannot be negative')
          return encodeFunctionData({ abi: ARBITER_LIST_ABI, functionName: 'scheduleAddArbiter', args: [action.arbiter, action.fee] })
        })()
      : action.kind === 'executeAddArbiter' || action.kind === 'scheduleRemoveArbiter' || action.kind === 'executeRemoveArbiter'
        ? encodeFunctionData({ abi: ARBITER_LIST_ABI, functionName: action.kind, args: [action.arbiter] })
        : (() => {
            throw new Error('Unsupported arbiter list action')
          })()
  return { to: network.contracts.arbiterList, data, chainId: network.chainId }
}

const CAPS_ABI = parseAbi([
  'function lowerCaps(uint256 newMaxDealAmount, uint256 newMaxLocked)',
  'function scheduleRaiseCaps(uint256 newMaxDealAmount, uint256 newMaxLocked)',
  'function executeRaiseCaps()',
  'function getPendingCaps() view returns (uint256 newMaxDealAmount, uint256 newMaxLocked, uint64 eta)',
])

/**
 * The pauser's three cap actions on the escrow. Caps are checked only when a deal is created or funded: lowering
 * applies at once (and cancels a scheduled raise), raising waits 48 hours on-chain. Neither touches money already held.
 */
export type CapsAction =
  | { kind: 'lowerCaps'; maxDealAmount: bigint; maxLocked: bigint }
  | { kind: 'scheduleRaiseCaps'; maxDealAmount: bigint; maxLocked: bigint }
  | { kind: 'executeRaiseCaps' }

export function encodeCapsAction(action: CapsAction, network: WaybillNetworkManifest = getBrowserNetwork()): EncodedWalletAction {
  const data =
    action.kind === 'executeRaiseCaps'
      ? encodeFunctionData({ abi: CAPS_ABI, functionName: 'executeRaiseCaps' })
      : action.kind === 'lowerCaps' || action.kind === 'scheduleRaiseCaps'
        ? (() => {
            if (action.maxDealAmount <= 0n || action.maxLocked <= 0n) throw new Error('caps must be above zero')
            return encodeFunctionData({ abi: CAPS_ABI, functionName: action.kind, args: [action.maxDealAmount, action.maxLocked] })
          })()
        : (() => {
            throw new Error('Unsupported caps action')
          })()
  return { to: network.contracts.escrow, data, chainId: network.chainId }
}

export type PendingCaps = { maxDealAmount: bigint; maxLocked: bigint; eta: bigint } | null

/**
 * The scheduled raise, null when none, or 'unsupported' when this escrow was deployed before caps could change (it has
 * no getPendingCaps, so the call returns no data). Any other failure is thrown, never read as "no raise".
 */
export async function readPendingCaps(
  publicClient: Pick<PublicClient, 'readContract'>,
  network: WaybillNetworkManifest = getBrowserNetwork(),
): Promise<PendingCaps | 'unsupported'> {
  try {
    const [maxDealAmount, maxLocked, eta] = await publicClient.readContract({ address: network.contracts.escrow, abi: CAPS_ABI, functionName: 'getPendingCaps' })
    return eta === 0n ? null : { maxDealAmount, maxLocked, eta }
  } catch (error) {
    const zeroData = error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionZeroDataError || e instanceof ContractFunctionRevertedError)
    if (zeroData) return 'unsupported'
    throw error
  }
}
