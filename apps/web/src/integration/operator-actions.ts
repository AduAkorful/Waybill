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
