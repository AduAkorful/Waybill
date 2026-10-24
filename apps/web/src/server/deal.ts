import { createPublicClient, http, type PublicClient } from 'viem'
import { createWaybillApiClient, loadBrowserApiBaseUrl } from '@/integration/api'
import { readNextDealId } from '@/integration/escrow'
import { getBrowserChain, getBrowserNetwork } from '@/integration/network'
import { parseDealEvents, withEvents } from '@/view/events'
import { loadDealView } from '@/view/from-chain'
import type { DealView } from '@/view/types'

function client(): PublicClient {
  const network = getBrowserNetwork()
  return createPublicClient({
    chain: getBrowserChain(),
    transport: http(network.rpcUrl),
    batch: { multicall: true },
  }) as PublicClient
}

/** How many deals exist on the configured network. */
export async function countDeals(): Promise<bigint> {
  return readNextDealId(client(), getBrowserNetwork())
}

export type PublicDeal =
  | { status: 'missing' }
  | { status: 'ready'; deal: DealView; history: { status: 'ready' } | { status: 'unconfigured' } | { status: 'error'; message: string } }

/**
 * A deal as the public record shows it: the escrow read at render time, with the indexed history when the
 * relayer API is configured. A failed history read is reported next to the deal and never hides it.
 */
export async function getPublicDeal(id: bigint): Promise<PublicDeal> {
  const network = getBrowserNetwork()
  const rpc = client()
  if (id >= (await readNextDealId(rpc, network))) return { status: 'missing' }
  const view = await loadDealView(rpc, network, id)

  let api: ReturnType<typeof createWaybillApiClient> | null = null
  try {
    api = createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, network)
  } catch {
    return { status: 'ready', deal: view, history: { status: 'unconfigured' } }
  }
  try {
    const events = parseDealEvents(await api.getDealEvents(id))
    return { status: 'ready', deal: withEvents(view, events), history: { status: 'ready' } }
  } catch (e) {
    return { status: 'ready', deal: view, history: { status: 'error', message: e instanceof Error ? e.message : String(e) } }
  }
}
