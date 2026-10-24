import { describe, expect, test } from 'bun:test'
import { emptyDetails, emptyForm, TEMPLATES } from './builder'
import { DRAFT_TTL_MS, draftKey, isBlankDraft, parseDraft, serializeDraft } from './builder-draft'

const buyer = '0x00000000000000000000000000000000000000B1'
const NOW = 1_800_000_000_000

function filled() {
  const form = emptyForm(buyer, 75, TEMPLATES[2]!)
  form.supplier = '0x00000000000000000000000000000000000000c2'
  form.total = '1250.50'
  form.parts[1]!.attestors = ['0x00000000000000000000000000000000000000e4']
  const details = { ...emptyDetails(), goods: 'Cocoa beans', isPublic: true }
  return { template: TEMPLATES[2]!, form, details }
}

describe('builder draft', () => {
  test('key is per network and per wallet, case-insensitive on the address', () => {
    expect(draftKey(5042002, buyer)).toBe(draftKey(5042002, buyer.toLowerCase()))
    expect(draftKey(5042002, buyer)).not.toBe(draftKey(1, buyer))
    expect(draftKey(5042002, buyer)).not.toBe(draftKey(5042002, '0x00000000000000000000000000000000000000c2'))
  })
  test('round-trips form, template and details', () => {
    const d = filled()
    const back = parseDraft(serializeDraft(d.template, d.form, d.details, NOW), NOW + 1000)
    expect(back?.template.id).toBe(d.template.id)
    expect(back?.form).toEqual(d.form)
    expect(back?.details).toEqual(d.details)
  })
  test('stores only builder fields', () => {
    const d = filled()
    const raw = JSON.parse(serializeDraft(d.template, d.form, d.details, NOW))
    expect(Object.keys(raw).sort()).toEqual(['details', 'form', 'savedAt', 'templateId', 'v'])
  })
  test('expired, future, malformed or tampered drafts read as none', () => {
    const d = filled()
    const raw = serializeDraft(d.template, d.form, d.details, NOW)
    expect(parseDraft(raw, NOW + DRAFT_TTL_MS + 1)).toBeNull()
    expect(parseDraft(raw, NOW - 120_000)).toBeNull()
    expect(parseDraft(null)).toBeNull()
    expect(parseDraft('{not json')).toBeNull()
    const bad = (mut: (x: any) => void) => { const x = JSON.parse(raw); mut(x); return parseDraft(JSON.stringify(x), NOW) }
    expect(bad((x) => { x.v = 2 })).toBeNull()
    expect(bad((x) => { x.templateId = 'nope' })).toBeNull()
    expect(bad((x) => { x.form.feePayer = 9 })).toBeNull()
    expect(bad((x) => { x.form.parts = [] })).toBeNull()
    expect(bad((x) => { x.form.parts[0].condition = 5 })).toBeNull()
    expect(bad((x) => { x.form.panel = ['a'] })).toBeNull()
    expect(bad((x) => { x.form.total = 'x'.repeat(1000) })).toBeNull()
    expect(bad((x) => { x.details.isPublic = 'yes' })).toBeNull()
  })
  test('extra stored keys are dropped, not restored', () => {
    const d = filled()
    const x = JSON.parse(serializeDraft(d.template, d.form, d.details, NOW))
    x.form.privateKey = '0xdead'; x.details.secret = 's'
    const back = parseDraft(JSON.stringify(x), NOW)!
    expect('privateKey' in back.form).toBe(false)
    expect('secret' in back.details).toBe(false)
  })
  test('an untouched builder is blank, any edit is not', () => {
    const blank = emptyForm(buyer, 75, TEMPLATES[1]!)
    expect(isBlankDraft(emptyForm(buyer, 75, TEMPLATES[1]!), emptyDetails(), blank, TEMPLATES[1]!)).toBe(true)
    expect(isBlankDraft({ ...blank, total: '1' }, emptyDetails(), blank, TEMPLATES[1]!)).toBe(false)
    expect(isBlankDraft(blank, { ...emptyDetails(), goods: 'x' }, blank, TEMPLATES[1]!)).toBe(false)
    expect(isBlankDraft(emptyForm(buyer, 75, TEMPLATES[0]!), emptyDetails(), blank, TEMPLATES[0]!)).toBe(false)
  })
})
