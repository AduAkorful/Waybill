import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'

import type { RuntimeEnvironment } from '@waybill/network/runtime'
import type { RelayerChain } from './chain'
import { createRelayerChain, readLiveDeal } from './chain'
import { REGISTRY_EVENT_ABI, REGISTRY_EVENT_NAMES, readAttestor } from './registry'
import { parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createWaybillApi } from './api'
import { ARBITER_EVENT_ABI, ARBITER_EVENT_NAMES, readArbiter } from './arbiters'
import { loadApiConfig } from './api-config'
import { LabelService } from './deal-labels'
import { DealTermsService, PostgresTermsStore } from './deal-terms'
import { loadEmailSetup } from './email-config'
import { EventNotifier } from './event-notifier'
import { NotificationDispatcher } from './notification-dispatcher'
import { PostgresNotificationOutbox } from './notification-outbox'
import { PostgresWalletEmailStore, WalletEmailService } from './wallet-emails'
import { PostgresOperatorStore, readOperatorChain } from './operator'
import { loadEvidenceService } from './evidence-config'
import { PostgresEvidenceStore } from './evidence-store'
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
  secureTables,
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
  readonly arbiterIndexer: RelayerRuntime
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
  const emailSetup = loadEmailSetup(environment)
  const outbox = new PostgresNotificationOutbox(pool)
  const walletEmails = new PostgresWalletEmailStore(pool)
  const notifier = emailSetup
    ? new EventNotifier({
        network: config.network.network,
        parties: (dealId) => readModel.listDealParties(config.network.network, dealId),
        recipient: (wallet) => walletEmails.recipient(config.network.network, wallet),
        enqueue: (input) => outbox.enqueue(input),
      })
    : null
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
        ...(notifier ? { onEvent: (event, isNew) => notifier.handle(event, isNew).then(() => undefined), onEventError: (error) => console.error('[waybill-notifier]', error) } : {}),
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
  const evidenceStore = new PostgresEvidenceStore(pool)
  const evidence = apiConfig
    ? loadEvidenceService(environment, config.network, {
        pointers: evidenceStore,
        isDealParty: (dealId, address) => readModel.isDealParty(config.network.network, dealId, address),
      })
    : null
  const escrowReads = parseAbi(['function pauser() view returns (address)', 'function nextDealId() view returns (uint256)'])
  const labels = new LabelService({
    context: { network: config.network.network, chainId: config.network.chainId, escrow: config.network.contracts.escrow },
    store: { setLabels: (ranges, label, isTest) => new PostgresOperatorStore(pool).setLabels(config.network.network, ranges, label, isTest) },
    readPauser: () => chain.client.readContract({ address: config.network.contracts.escrow, abi: escrowReads, functionName: 'pauser' }),
    readTotalDeals: () => chain.client.readContract({ address: config.network.contracts.escrow, abi: escrowReads, functionName: 'nextDealId' }),
  })
  const emails = emailSetup
    ? new WalletEmailService({
        context: { network: config.network.network, chainId: config.network.chainId },
        network: config.network.network,
        store: walletEmails,
        // sent straight away and never queued, so the one-time token is not kept anywhere but the mail itself
        sendVerification: (to, token) => emailSetup.provider.send({ to, template: 'verify_email', payload: { token } }),
      })
    : null
  const dispatcher = emailSetup ? new NotificationDispatcher(outbox, emailSetup.provider) : null
  const notifications = dispatcher
    ? new RelayerRuntime({ pollOnce: () => dispatcher.dispatchBatch() }, { pollIntervalMs: 10_000, reportError: (error) => console.error('[waybill-notifications]', error) })
    : null
  const terms = new DealTermsService({
    context: (dealId) => ({ network: config.network.network, chainId: config.network.chainId, escrow: config.network.contracts.escrow, dealId }),
    network: config.network.network,
    store: new PostgresTermsStore(pool),
    isBuyer: async (dealId, address) => (await readModel.listDealParties(config.network.network, dealId)).some((p) => p.role === 'buyer' && p.address.toLowerCase() === address.toLowerCase()),
    isParty: (dealId, address) => readModel.isDealParty(config.network.network, dealId, address),
    dealState: async (dealId) => (await readModel.getDeal(config.network.network, dealId))?.state ?? null,
  })
  const api = apiConfig
    ? createWaybillApi({
        evidence,
        labels,
        terms,
        emails,
        network: config.network.network,
        indexStartBlock: config.startBlock,
        allowedOrigins: apiConfig.allowedOrigins,
        health: () =>
          checkHealth([
            rpcHealth('rpc', () => chain.client.getBlockNumber()),
            databaseHealth('database', () => pool.query('SELECT 1')),
          ]),
        readDeal: (dealId) => readService.getDeal(config.network.network, dealId),
        readDealEvents: (dealId) => readModel.getDealEvents(config.network.network, dealId),
        listWalletDeals: (address) => readModel.getWalletDeals(config.network.network, address),
        operatorSummary: async () => {
          const streams = ['escrow-relayer', 'escrow-indexer', 'registry-indexer', 'arbiter-indexer']
          const [chainState, index] = await Promise.all([
            readOperatorChain(chain.client, config.network, privateKeyToAccount(config.privateKey).address),
            new PostgresOperatorStore(pool).summary(config.network.network, streams),
          ])
          return { network: config.network.network, chainId: config.network.chainId, escrow: config.network.contracts.escrow, chain: chainState, index }
        },
        listArbiters: async () => {
          const addresses = await readModel.listArbiterAddresses(config.network.network, ARBITER_EVENT_NAMES)
          return Promise.all(addresses.map((address) => readArbiter(chain.client, config.network, address)))
        },
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

  const arbiterIndexer = new RelayerRuntime(
    new ChainEventIndexer(
      createIndexerLogReader(chain),
      new PostgresCursorStore(pool, 'arbiter-indexer'),
      readModel,
      {
        ...config.network,
        startBlock: config.network.arbiterListDeployBlock ?? config.startBlock,
        maxBlockRange: config.maxBlockRange,
        confirmations: config.confirmations,
        target: { address: config.network.contracts.arbiterList, events: ARBITER_EVENT_ABI },
      },
    ),
    {
      pollIntervalMs: config.pollIntervalMs,
      reportError: (error) => console.error('[waybill-arbiter-indexer]', error),
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
    arbiterIndexer,
    api,
    async start() {
      if (loopPromise) return loopPromise
      await applyMigrations(pool, await dependencies.loadMigrations())
      await secureTables(pool)
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
      loopPromise = Promise.all([relayer.run(), indexer.run(), registryIndexer.run(), arbiterIndexer.run(), ...(notifications ? [notifications.run()] : [])]).then(() => undefined)
      return loopPromise
    },
    async stop() {
      if (stopped) return
      stopped = true
      relayer.stop()
      indexer.stop()
      registryIndexer.stop()
      arbiterIndexer.stop()
      notifications?.stop()
      if (api?.listening) await new Promise<void>((resolve) => api.close(() => resolve()))
      await loopPromise
      loopPromise = null
      await pool.end()
    },
  }
}
