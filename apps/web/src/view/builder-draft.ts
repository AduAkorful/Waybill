import { emptyDetails, TEMPLATES, type BuilderForm, type DetailsForm, type PartForm, type Template } from './builder'

/**
 * A half-built deal kept in the browser so a reload does not lose it. Only what the buyer typed into the builder is
 * kept: addresses, amounts, durations and the optional shipment details. No keys, signatures or session data.
 */
export interface BuilderDraft {
  v: 1
  savedAt: number
  templateId: Template['id']
  form: BuilderForm
  details: DetailsForm
}

export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000
const MAX_TEXT = 400

/** One draft per network and signed-in wallet, so switching either never shows someone else's deal. */
export function draftKey(chainId: number, address: string): string {
  return `waybill:builder-draft:v1:${chainId}:${address.toLowerCase()}`
}

const text = (x: unknown): string | null => (typeof x === 'string' && x.length <= MAX_TEXT ? x : null)
const texts = (x: unknown, max: number): string[] | null => {
  if (!Array.isArray(x) || x.length > max) return null
  const out = x.map(text)
  return out.every((s) => s !== null) ? (out as string[]) : null
}

function readPart(x: unknown): PartForm | null {
  if (!x || typeof x !== 'object') return null
  const p = x as Record<string, unknown>
  const attestors = texts(p.attestors, 5)
  const fields = [text(p.title), text(p.percent), text(p.dueDays), text(p.graceDays), text(p.reviewHours)]
  if (attestors === null || fields.some((f) => f === null) || (p.condition !== 0 && p.condition !== 1)) return null
  const [title, percent, dueDays, graceDays, reviewHours] = fields as string[]
  return { title, percent, condition: p.condition, attestors, dueDays, graceDays, reviewHours } as PartForm
}

function readForm(x: unknown): BuilderForm | null {
  if (!x || typeof x !== 'object') return null
  const f = x as Record<string, unknown>
  const strings = (['supplier', 'refund', 'arbiter', 'total', 'feeBps', 'acceptDays', 'decisionHours'] as const).map((k) => text(f[k]))
  const panel = texts(f.panel, 3)
  if (strings.some((s) => s === null) || panel === null || (panel.length !== 0 && panel.length !== 3)) return null
  if (f.feePayer !== 0 && f.feePayer !== 1 && f.feePayer !== 2) return null
  if (!Array.isArray(f.parts) || f.parts.length < 1 || f.parts.length > 8) return null
  const parts = f.parts.map(readPart)
  if (parts.some((p) => p === null)) return null
  const [supplier, refund, arbiter, total, feeBps, acceptDays, decisionHours] = strings as string[]
  return { supplier, refund, arbiter, panel, total, feeBps, feePayer: f.feePayer, acceptDays, decisionHours, parts: parts as PartForm[] } as BuilderForm
}

function readDetails(x: unknown): DetailsForm | null {
  if (!x || typeof x !== 'object') return null
  const d = x as Record<string, unknown>
  const out = emptyDetails() as unknown as Record<string, unknown>
  for (const k of Object.keys(out)) {
    if (k === 'isPublic') {
      if (typeof d.isPublic !== 'boolean') return null
      out.isPublic = d.isPublic
    } else {
      const s = text(d[k])
      if (s === null) return null
      out[k] = s
    }
  }
  return out as unknown as DetailsForm
}

/** Reads a stored draft; anything malformed, from another version, or older than the TTL reads as no draft. */
export function parseDraft(raw: string | null, now: number = Date.now()): { template: Template; form: BuilderForm; details: DetailsForm } | null {
  if (!raw) return null
  let x: unknown
  try { x = JSON.parse(raw) } catch { return null }
  if (!x || typeof x !== 'object') return null
  const d = x as Record<string, unknown>
  if (d.v !== 1 || typeof d.savedAt !== 'number' || now - d.savedAt > DRAFT_TTL_MS || d.savedAt > now + 60_000) return null
  const template = TEMPLATES.find((t) => t.id === d.templateId)
  const form = readForm(d.form)
  const details = readDetails(d.details)
  if (!template || !form || !details) return null
  return { template, form, details }
}

export function serializeDraft(template: Template, form: BuilderForm, details: DetailsForm, now: number = Date.now()): string {
  const draft: BuilderDraft = { v: 1, savedAt: now, templateId: template.id, form, details }
  return JSON.stringify(draft)
}

/** Whether a form holds anything the buyer typed, so an untouched builder never writes a draft. */
export function isBlankDraft(form: BuilderForm, details: DetailsForm, blank: BuilderForm, template: Template): boolean {
  return template.id === TEMPLATES[1]!.id && JSON.stringify(form) === JSON.stringify(blank) && JSON.stringify(details) === JSON.stringify(emptyDetails())
}
