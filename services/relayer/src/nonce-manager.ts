export interface PendingNonceReader {
  getPendingNonce(): Promise<number>
}

export class SerializedNonceManager {
  private nextNonce: number | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly reader: PendingNonceReader) {}

  async run<Result>(send: (nonce: number) => Promise<Result>): Promise<Result> {
    let release!: () => void
    const previous = this.queue
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous

    try {
      if (this.nextNonce === null) {
        this.nextNonce = await this.reader.getPendingNonce()
        this.validateNonce(this.nextNonce)
      }
      const nonce = this.nextNonce
      const result = await send(nonce)
      this.nextNonce = nonce + 1
      this.validateNonce(this.nextNonce)
      return result
    } catch (error) {
      this.nextNonce = null
      throw error
    } finally {
      release()
    }
  }

  private validateNonce(nonce: number): void {
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      throw new Error('Relayer nonce must be a non-negative safe integer')
    }
  }
}
