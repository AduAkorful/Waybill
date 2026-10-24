import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_BYTES = 12
const TAG_BYTES = 16

/** Parses WAYBILL_EVIDENCE_KEY: exactly 32 bytes as 0x-prefixed hex. */
export function parseEvidenceKey(raw: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('WAYBILL_EVIDENCE_KEY must be a 32-byte hex key')
  return Uint8Array.from(Buffer.from(raw.slice(2), 'hex'))
}

/**
 * AES-256-GCM. The stored form is iv || ciphertext || tag, so both stores hold only ciphertext and a changed
 * byte fails to decrypt instead of reading back as different evidence.
 */
export function encryptEvidence(key: Uint8Array, plain: Uint8Array): Uint8Array {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Uint8Array.from(Buffer.concat([iv, body, cipher.getAuthTag()]))
}

export function decryptEvidence(key: Uint8Array, stored: Uint8Array): Uint8Array {
  if (stored.length < IV_BYTES + TAG_BYTES + 1) throw new Error('Stored evidence is too short to be valid')
  const buffer = Buffer.from(stored)
  const iv = buffer.subarray(0, IV_BYTES)
  const tag = buffer.subarray(buffer.length - TAG_BYTES)
  const body = buffer.subarray(IV_BYTES, buffer.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Uint8Array.from(Buffer.concat([decipher.update(body), decipher.final()]))
}
