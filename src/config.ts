/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig } from '@privy-io/wagmi'
import { http } from 'wagmi'
import { registerChain } from './tracing'
import { getBrowserChain, getBrowserNetwork } from './integration/network'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
const browserNetwork = getBrowserNetwork()
const browserChain = getBrowserChain()
registerChain(browserChain.id, browserNetwork.rpcUrl)

export const config = createConfig({
  chains: [browserChain],
  transports: {
    [browserChain.id]: http(browserNetwork.rpcUrl),
  },
})
