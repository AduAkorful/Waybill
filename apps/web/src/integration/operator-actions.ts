import { encodeFunctionData, parseAbi } from 'viem'
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
