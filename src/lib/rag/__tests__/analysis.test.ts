import { beforeEach, describe, expect, it, vi } from 'vitest'

// No real AI or database calls. The suggestion model and the safety scan are
// separate mocks so each can succeed or fail independently; the context is a
// synthetic transcript in the "[SPEAKER]: text" format runAnalysis receives.
const h = vi.hoisted(() => ({
  chatJSON: vi.fn(),
  runSafetyScan: vi.fn(),
  transcript: '',
}))

vi.mock('@/lib/report/openrouter-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/report/openrouter-client')>()
  return { ...real, chatJSON: h.chatJSON, COPILOT_MODEL: 'test-model' }
})
vi.mock('../safety', async (importOriginal) => {
  const real = await importOriginal<typeof import('../safety')>()
  return { ...real, runSafetyScan: h.runSafetyScan }
})
vi.mock('../retrieval', () => ({
  retrieveRAGContext: async () => ({
    client: { clientId: 'c-1', name: 'Synthetic Child', age: 9, conditions: [], sessionNumber: 1 },
    transcript: h.transcript,
    transcriptMinutes: 5,
    studyMaterial: [],
    previousNotes: [],
    moduleEvents: [],
    inCallNotes: [],
  }),
}))
vi.mock('../prompt', () => ({ SYSTEM_PROMPT: 'sys', buildAnalysisPrompt: () => 'user prompt' }))

import { runAnalysis } from '../analysis'

const SAFE = '[THERAPIST]: how was your week\n[CLIENT]: good, i played football'
const SUGGESTION = JSON.stringify({
  emotions: ['calm'],
  summary: 'Client engaged well.',
  steps: ['Continue'],
  module: 'worry-vault',
  riskFlag: false,
})
const opts = { sessionId: 's-1', therapistId: 'uid-t', clientProfile: {} as any }

beforeEach(() => {
  h.chatJSON.mockReset()
  h.runSafetyScan.mockReset()
  h.transcript = SAFE
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('runAnalysis — suggestion and safety settle independently', () => {
  it('both succeed → normal result', async () => {
    h.chatJSON.mockResolvedValue(SUGGESTION)
    h.runSafetyScan.mockResolvedValue({ level: 'none', cue: '', rationale: '' })
    const r = await runAnalysis(opts)
    expect(r.summary).toBe('Client engaged well.')
    expect(r.riskLevel).toBe('none')
    expect(r.riskFlag).toBe(false)
    expect(r.riskCheckUnavailable).toBeUndefined()
  })

  it('safety fails + suggestion succeeds → watch + "Risk check unavailable", suggestion kept', async () => {
    h.chatJSON.mockResolvedValue(SUGGESTION)
    h.runSafetyScan.mockRejectedValue(new Error('upstream 503'))
    const r = await runAnalysis(opts)
    expect(r.summary).toBe('Client engaged well.')
    expect(r.riskLevel).toBe('watch')
    expect(r.riskFlag).toBe(true)
    expect(r.riskCheckUnavailable).toBe(true)
    expect(r.riskDetail).toMatch(/Risk check unavailable/)
  })

  it('both fail → still watch + "Risk check unavailable" (never none, never a 500)', async () => {
    h.chatJSON.mockRejectedValue(new Error('timeout'))
    h.runSafetyScan.mockRejectedValue(new Error('timeout'))
    const r = await runAnalysis(opts)
    expect(r.riskLevel).toBe('watch')
    expect(r.riskFlag).toBe(true)
    expect(r.riskCheckUnavailable).toBe(true)
    expect(r.riskDetail).toMatch(/Risk check unavailable/)
    expect(r.summary).toMatch(/Analysis failed/)
  })

  it('suggestion fails + safety succeeds → the safety verdict is preserved', async () => {
    h.chatJSON.mockRejectedValue(new Error('timeout'))
    h.runSafetyScan.mockResolvedValue({ level: 'urgent', cue: 'x', rationale: 'Synthetic urgent rationale.' })
    const r = await runAnalysis(opts)
    expect(r.riskLevel).toBe('urgent')
    expect(r.riskFlag).toBe(true)
    expect(r.riskDetail).toBe('Synthetic urgent rationale.')
    expect(r.riskCheckUnavailable).toBeUndefined()
    expect(r.summary).toMatch(/Analysis failed/)
  })

  it('error details (which can echo request content) are not logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.chatJSON.mockRejectedValue(new Error('SECRET-PROMPT-ECHO'))
    h.runSafetyScan.mockRejectedValue(new Error('SECRET-PROMPT-ECHO'))
    await runAnalysis(opts)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-PROMPT-ECHO')
  })
})

describe('runAnalysis — local keyword check merges in, upward only', () => {
  it('raises an AI "none" to watch when the client said a risk phrase', async () => {
    h.transcript = '[THERAPIST]: how are you\n[CLIENT]: honestly i want to die'
    h.chatJSON.mockResolvedValue(SUGGESTION)
    h.runSafetyScan.mockResolvedValue({ level: 'none', cue: '', rationale: '' })
    const r = await runAnalysis(opts)
    expect(r.riskLevel).toBe('watch')
    expect(r.riskFlag).toBe(true)
    expect(r.riskDetail).toMatch(/Possible risk language/)
    expect(r.riskDetail).not.toContain('want to die') // never echoes the transcript
  })

  it('never downgrades an AI urgent', async () => {
    h.transcript = '[CLIENT]: i want to die'
    h.chatJSON.mockResolvedValue(SUGGESTION)
    h.runSafetyScan.mockResolvedValue({ level: 'urgent', cue: '', rationale: 'Synthetic urgent.' })
    expect((await runAnalysis(opts)).riskLevel).toBe('urgent')
  })

  it('ignores the therapist\'s own words', async () => {
    h.transcript = '[THERAPIST]: have you ever thought about suicide\n[CLIENT]: no, never'
    h.chatJSON.mockResolvedValue(SUGGESTION)
    h.runSafetyScan.mockResolvedValue({ level: 'none', cue: '', rationale: '' })
    expect((await runAnalysis(opts)).riskLevel).toBe('none')
  })
})
