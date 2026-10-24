import {
  RelayerEventWorker,
  type RelayerLogReader,
} from './event-worker'
import type { CursorStore } from './eligibility'
import type { RelayerConfig } from './config'
import type { RelayerCandidateProcessor } from './candidate-processor'

export interface RuntimeOptions {
  pollIntervalMs: number
  sleep?: (milliseconds: number) => Promise<void>
  reportError?: (error: unknown) => void
}

export interface RuntimePoller {
  pollOnce(): Promise<unknown | null>
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export class RelayerRuntime {
  private stopped = false

  constructor(
    private readonly worker: RuntimePoller | RelayerEventWorker,
    private readonly options: RuntimeOptions,
  ) {
    if (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs < 1) {
      throw new Error('Relayer poll interval must be a positive safe integer')
    }
  }

  async runOnce(): Promise<unknown | null> {
    return this.worker.pollOnce()
  }

  stop(): void {
    this.stopped = true
  }

  async run(): Promise<void> {
    this.stopped = false
    const sleep = this.options.sleep ?? defaultSleep
    while (!this.stopped) {
      try {
        await this.worker.pollOnce()
      } catch (error) {
        this.options.reportError?.(error)
      }
      if (!this.stopped) await sleep(this.options.pollIntervalMs)
    }
  }
}

export function createRelayerRuntime(
  reader: RelayerLogReader,
  cursorStore: CursorStore,
  config: Pick<RelayerConfig, 'network' | 'startBlock' | 'maxBlockRange' | 'confirmations'>,
  processor: RelayerCandidateProcessor,
  options: RuntimeOptions,
): RelayerRuntime {
  const worker = new RelayerEventWorker(
    reader,
    cursorStore,
    config,
    async (candidate) => {
      await processor.process(candidate)
    },
  )
  return new RelayerRuntime(worker, options)
}
