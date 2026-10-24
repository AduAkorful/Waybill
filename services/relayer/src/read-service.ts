import type { WaybillNetwork } from '@waybill/network/networks'
import type { DealProjection } from './read-model-store'

export interface DealProjectionReader {
  getDeal(network: WaybillNetwork, dealId: bigint): Promise<DealProjection | null>
}

export interface LiveDealReader<LiveDeal> {
  readDeal(network: WaybillNetwork, dealId: bigint): Promise<LiveDeal>
}

export type DealRead<LiveDeal> =
  | {
      network: WaybillNetwork
      dealId: bigint
      source: 'chain'
      stale: false
      live: LiveDeal
      projection: DealProjection | null
    }
  | {
      network: WaybillNetwork
      dealId: bigint
      source: 'projection'
      stale: true
      live: null
      projection: DealProjection
      warning: string
    }

export class WaybillReadService<LiveDeal> {
  constructor(
    private readonly projections: DealProjectionReader,
    private readonly chain: LiveDealReader<LiveDeal>,
  ) {}

  async getDeal(network: WaybillNetwork, dealId: bigint): Promise<DealRead<LiveDeal>> {
    if (dealId < 0n) throw new Error('dealId must be non-negative')
    const projection = await this.projections.getDeal(network, dealId)
    try {
      const live = await this.chain.readDeal(network, dealId)
      return { network, dealId, source: 'chain', stale: false, live, projection }
    } catch (error) {
      if (!projection) throw error
      return {
        network,
        dealId,
        source: 'projection',
        stale: true,
        live: null,
        projection,
        warning: 'Live chain read failed; projection may be stale',
      }
    }
  }
}
