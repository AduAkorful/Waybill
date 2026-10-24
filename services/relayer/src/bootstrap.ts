import { fileURLToPath } from 'node:url'

import type { RuntimeEnvironment } from '../../../config/runtime-network'
import type { RelayerChain } from './chain'
import { createRelayerChain } from './chain'
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

  let loopPromise: Promise<void> | null = null
  let stopped = false
  return {
    config,
    relayer,
    indexer,
    async start() {
      if (loopPromise) return loopPromise
      await applyMigrations(pool, await dependencies.loadMigrations())
      stopped = false
      loopPromise = Promise.all([relayer.run(), indexer.run()]).then(() => undefined)
      return loopPromise
    },
    async stop() {
      if (stopped) return
      stopped = true
      relayer.stop()
      indexer.stop()
      await loopPromise
      loopPromise = null
      await pool.end()
    },
  }
}
