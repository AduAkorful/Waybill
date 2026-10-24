import {
  readMilestone,
  type MilestoneSnapshot,
  type RelayerCandidate,
  type RelayerChain,
} from './chain'
import {
  attemptKeyFor,
  type RelayerAttemptStore,
} from './attempt-store'
import {
  checkCandidateEligibility,
  type EligibilityResult,
} from './eligibility'
import {
  submitEligibleCandidate,
  type RelayerWriteClient,
  type SubmissionResult,
} from './submission'
import { SerializedNonceManager } from './nonce-manager'

export interface CandidateStateReader {
  readMilestone(dealId: bigint, milestoneIndex: number): Promise<MilestoneSnapshot>
  nowSeconds(): Promise<bigint>
}

export interface CandidateProcessSkipped {
  kind: 'ineligible' | 'duplicate'
  eligibility?: EligibilityResult
  reason?: string
}

export type CandidateProcessResult = SubmissionResult | CandidateProcessSkipped

export function createCandidateStateReader(chain: RelayerChain): CandidateStateReader {
  return {
    readMilestone: (dealId, milestoneIndex) => readMilestone(chain, dealId, milestoneIndex),
    async nowSeconds() {
      const block = await chain.client.getBlock({ blockTag: 'latest' })
      return block.timestamp
    },
  }
}

export class RelayerCandidateProcessor {
  constructor(
    private readonly stateReader: CandidateStateReader,
    private readonly attempts: RelayerAttemptStore,
    private readonly submissionClient: RelayerWriteClient,
    private readonly nonceManager: SerializedNonceManager,
  ) {}

  async process(candidate: RelayerCandidate): Promise<CandidateProcessResult> {
    const snapshot = await this.stateReader.readMilestone(
      candidate.dealId,
      candidate.milestoneIndex,
    )
    const eligibility = checkCandidateEligibility(
      candidate,
      snapshot,
      await this.stateReader.nowSeconds(),
    )
    if (eligibility.eligible === false) {
      return { kind: 'ineligible', eligibility }
    }

    const key = attemptKeyFor(candidate)
    const reservation = await this.attempts.reserve(key)
    if (!reservation.shouldSubmit) {
      return {
        kind: 'duplicate',
        reason: `attempt is already ${reservation.attempt.status}`,
      }
    }

    const result = await submitEligibleCandidate(
      this.submissionClient,
      candidate,
      eligibility,
      this.nonceManager,
      (hash) => this.attempts.markSubmitted(key, hash),
    )
    await this.attempts.markReceipt(key, result.status)
    return result
  }
}
