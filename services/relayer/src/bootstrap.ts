import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'

import type { RuntimeEnvironment } from '@waybill/network/runtime'
import type { RelayerChain } from './chain'
import { createRelayerChain, readLiveDeal } from './chain'
import { REGISTRY_EVENT_ABI, REGISTRY_EVENT_NAMES, readAttestor } from './registry'
import { createWaybillApi } from './api'
import { loadApiConfig } from './api-config'
import { checkHealth, databaseHealth, rpcHealth } from './health'
import type { RelayerConfig } from './config'
import { loadRelayerConfig } from './config'
import { PostgresAttemptStore } from './attempt-store'
import { RelayerCandidateProcessor, createCandidateStateReader } from './candidate-processor'
import { PostgresCursorStore } from './cursor-store'
import { RelayerEventWorker, createRelayerLogReader } from './event-worker'
import { ChainEventIndexer, createIndexerLogReader } from './indexer'
import { SerializedNonceManager } from './nonce-manager'
import {
  applyMigrations,
  createPostgresPool,
  loadMigrations,
  type Migration,
  type MigrationPool,
} from './postgres'
import { PostgresReadModelStore } from './read-model-store'
import { WaybillReadService } from './read-service'
import { createRelayerSubmissionClient } from './submission'
import { RelayerRuntime } from './runtime'

export interface BackendPool extends MigrationPool {
  query<Row>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>
  end(): Promise<void>
}

export interface BackendApplication {
  readonly config: RelayerConfig
  readonly relayer: RelayerRuntime
  readonly indexer: RelayerRuntime
  readonly registryIndexer: RelayerRuntime
  /** The HTTP read API, or null when WAYBILL_API_PORT is not set */
  readonly api: Server | null
  start(): Promise<void>
  stop(): Promise<void>
}

export interface BootstrapDependencies {
  createPool(environment: RuntimeEnvironment): BackendPool
  createChain(manifest: RelayerConfig['network']): RelayerChain
  createSubmissionClient(
    manifest: RelayerConfig['network'],
    privateKey: RelayerConfig['privateKey'],
  ): ReturnType<typeof createRelayerSubmissionClient>
  loadMigrations(): Promise<Migration[]>
}

const defaultDependencies: BootstrapDependencies = {
  createPool: (environment) => createPostgresPool(environment) as unknown as BackendPool,
  createChain: createRelayerChain,
  createSubmissionClient: createRelayerSubmissionClient,
  loadMigrations: () =>
    loadMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
}

export function createBackendApplication(
  environment: RuntimeEnvironment,
  overrides: Partial<BootstrapDependencies> = {},
): BackendApplication {
  const dependencies = { ...defaultDependencies, ...overrides }
  const config = loadRelayerConfig(environment)
  const pool = dependencies.createPool(environment)
  const chain = dependencies.createChain(config.network)
  const readModel = new PostgresReadModelStore(pool)
  const submission = dependencies.createSubmissionClient(config.network, config.privateKey)
  const nonceManager = new SerializedNonceManager(submission)
  const attempts = new PostgresAttemptStore(pool)
  const processor = new RelayerCandidateProcessor(
    createCandidateStateReader(chain),
    attempts,
    submission,
    nonceManager,
  )
  const relayer = new RelayerRuntime(
    new RelayerEventWorker(
      createRelayerLogReader(chain),
      new PostgresCursorStore(pool, 'escrow-relayer'),
      config,
      async (candidate) => {
        await processor.process(candidate)
      },
    ),
    {
      pollIntervalMs: config.pollIntervalMs,
      reportError: (error) => console.error('[waybill-relayer]', error),
    },
  )
  const indexer = new RelayerRuntime(
    new ChainEventIndexer(
      createIndexerLogReader(chain),
      new PostgresCursorStore(pool, 'escrow-indexer'),
      readModel,
      {
        ...config.network,
        startBlock: config.startBlock,
        maxBlockRange: config.maxBlockRange,
        confirmations: config.confirmations,
      },
    ),
    {
      pollIntervalMs: config.pollIntervalMs,
      reportError: (error) => console.error('[waybill-indexer]', error),
    },
  )

  const apiConfig = loadApiConfig(environment)
  const readService = new WaybillReadService(readModel, {
    readDeal: (_network, dealId) => readLiveDeal(chain, dealId),
  })
  const api = apiConfig
    ? createWaybillApi({
        network: config.network.network,
        allowedOrigins: apiConfig.allowedOrigins,
        health: () =>
          checkHealth([
            rpcHealth('rpc', () => chain.client.getBlockNumber()),
            databaseHealth('database', () => pool.query('SELECT 1')),
          ]),
        readDeal: (dealId) => readService.getDeal(config.network.network, dealId),
        readDealEvents: (dealId) => readModel.getDealEvents(config.network.network, dealId),
        listWalletDeals: (address) => readModel.getWalletDeals(config.network.network, address),
        listAttestors: async () => {
          const addresses = await readModel.listAttestorAddresses(config.network.network, REGISTRY_EVENT_NAMES)
          return Promise.all(addresses.map((address) => readAttestor(chain.client, config.network, address)))
        },
        readAttestor: async (address) => {
          const events = await attestorHistory(address)
          if (events.length === 0) return null
          return { ...(await readAttestor(chain.client, config.network, address as `0x${string}`)), events }
        },
      })
    : null

  const registryIndexer = new RelayerRuntime(
    new ChainEventIndexer(
      createIndexerLogReader(chain),
      new PostgresCursorStore(pool, 'registry-indexer'),
      readModel,
      {
        ...config.network,
        startBlock: config.network.attestorRegistryDeployBlock ?? config.startBlock,
        maxBlockRange: config.maxBlockRange,
        confirmations: config.confirmations,
        target: { address: config.network.contracts.attestorRegistry, events: REGISTRY_EVENT_ABI },
      },
    ),
    {
      pollIntervalMs: config.pollIntervalMs,
      reportError: (error) => console.error('[waybill-registry-indexer]', error),
    },
  )

  const attestorHistory = (address: string) =>
    readModel.getAttestorEvents(config.network.network, address, REGISTRY_EVENT_NAMES)

  let loopPromise: Promise<void> | null = null
  let stopped = false
  return {
    config,
    relayer,
    indexer,
    registryIndexer,
    api,
    async start() {
      if (loopPromise) return loopPromise
      await applyMigrations(pool, await dependencies.loadMigrations())
      stopped = false
      if (api && apiConfig) {
        await new Promise<void>((resolve, reject) => {
          api.once('error', reject)
          api.listen(apiConfig.port, () => {
            api.off('error', reject)
            resolve()
          })
        })
      }
      loopPromise = Promise.all([relayer.run(), indexer.run(), registryIndexer.run()]).then(() => undefined)
      return loopPromise
    },
    async stop() {
      if (stopped) return
      stopped = true
      relayer.stop()
      indexer.stop()
      registryIndexer.stop()
      if (api?.listening) await new Promise<void>((resolve) => api.close(() => resolve()))
      await loopPromise
      loopPromise = null
      await pool.end()
    },
  }
}
