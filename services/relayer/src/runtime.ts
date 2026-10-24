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

export class RelayerRuntime {
  private stopped = false
  private wake: (() => void) | null = null

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
    // end a long wait at once, so shutdown never waits out a slow loop's interval
    this.wake?.()
  }

  async run(): Promise<void> {
    this.stopped = false
    const sleep =
      this.options.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, milliseconds)
          this.wake = () => {
            clearTimeout(timer)
            resolve()
          }
        }))
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
