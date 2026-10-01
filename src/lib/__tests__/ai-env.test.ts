import { describe, expect, it } from 'vitest'
import { assertAiEnv, missingAiEnv, REQUIRED_AI_ENV } from '../../../config/ai-env'

// Synthetic values only — never a real key.
const SECRET = 'sk-or-SYNTHETIC-test-secret-value'
const full = { OPENROUTER_API_KEY: SECRET, MODEL: 'openai/gpt-oss-20b:free' }

describe('required AI configuration (production validation)', () => {
  it('requires exactly OPENROUTER_API_KEY and MODEL', () => {
    expect(REQUIRED_AI_ENV).toEqual(['OPENROUTER_API_KEY', 'MODEL'])
  })

  it('accepts a complete configuration', () => {
    expect(missingAiEnv(full)).toEqual([])
    expect(() => assertAiEnv(full)).not.toThrow()
  })

  it('rejects a missing OPENROUTER_API_KEY', () => {
    const env = { MODEL: full.MODEL }
    expect(missingAiEnv(env)).toEqual(['OPENROUTER_API_KEY'])
    expect(() => assertAiEnv(env)).toThrow(/Missing required AI configuration: OPENROUTER_API_KEY/)
  })

  it('rejects a missing MODEL', () => {
    const env = { OPENROUTER_API_KEY: SECRET }
    expect(missingAiEnv(env)).toEqual(['MODEL'])
    expect(() => assertAiEnv(env)).toThrow(/Missing required AI configuration: MODEL/)
  })

  it('treats blank / whitespace values as missing', () => {
    expect(missingAiEnv({ OPENROUTER_API_KEY: '  ', MODEL: '' })).toEqual(['OPENROUTER_API_KEY', 'MODEL'])
  })

  it('never puts a secret value in the error', () => {
    let message = ''
    try {
      assertAiEnv({ OPENROUTER_API_KEY: SECRET }) // MODEL missing
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/MODEL/)
    expect(message).not.toContain(SECRET)
  })

  it('does not require Sarvam (speech-to-text is out of scope here)', () => {
    expect(REQUIRED_AI_ENV).not.toContain('SARVAM_API_KEY')
  })
})
