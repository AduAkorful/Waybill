import type { IpfsPinner } from './evidence-storage'

/** Pins one blob to IPFS through Pinata's file pinning API and returns its ipfs:// URI. */
export class PinataPinner implements IpfsPinner {
  constructor(
    private readonly jwt: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = 'https://api.pinata.cloud/pinning/pinFileToIPFS',
  ) {
    if (!jwt.trim()) throw new Error('Pinata JWT cannot be empty')
  }

  async pin(input: { bytes: Uint8Array; mimeType: string }): Promise<{ uri: string }> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), 'evidence.bin')
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }))
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.jwt}` },
      body: form,
    })
    if (!response.ok) throw new Error(`IPFS pinning failed (${response.status})`)
    const body = (await response.json()) as { IpfsHash?: unknown }
    if (typeof body.IpfsHash !== 'string' || !/^[A-Za-z0-9]{10,}$/.test(body.IpfsHash)) {
      throw new Error('IPFS pinning returned no content id')
    }
    return { uri: `ipfs://${body.IpfsHash}` }
  }
}
