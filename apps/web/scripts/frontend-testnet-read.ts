import { createPublicClient, http } from 'viem'
import { ARC_TESTNET } from '@waybill/network/networks'
import {
  readDeal,
  readUsdcBalance,
  WAYBILL_ESCROW_ABI,
} from '../src/integration/escrow'
import { toViemChain } from '../src/integration/network'

const chain = toViemChain(ARC_TESTNET)
const client = createPublicClient({
  chain,
  transport: http(ARC_TESTNET.rpcUrl),
})

const [bytecode, deal, escrowBalance] = await Promise.all([
  client.getBytecode({ address: ARC_TESTNET.contracts.escrow }),
  readDeal(client, 0n, ARC_TESTNET),
  readUsdcBalance(client, ARC_TESTNET.contracts.escrow, ARC_TESTNET),
])

if (!bytecode || bytecode === '0x') {
  throw new Error(`No contract bytecode at ${ARC_TESTNET.contracts.escrow}`)
}

const result = {
  network: ARC_TESTNET.network,
  chainId: chain.id,
  escrow: ARC_TESTNET.contracts.escrow,
  usdc: ARC_TESTNET.usdc.address,
  runtimeBytecodeBytes: (bytecode.length - 2) / 2,
  dealZeroState: (deal as { state: number }).state,
  escrowUsdcBalance: escrowBalance.toString(),
  abiFunctions: WAYBILL_ESCROW_ABI.filter((item) => item.type === 'function').length,
}

console.log(JSON.stringify(result, null, 2))
