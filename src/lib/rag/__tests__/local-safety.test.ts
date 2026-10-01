import { describe, expect, it, vi } from 'vitest'

// If the local check ever reached for an AI client, this would catch it.
const chatJSON = vi.hoisted(() => vi.fn())
vi.mock('@/lib/report/openrouter-client', () => ({ chatJSON, COPILOT_MODEL: 'test-model', extractJSON: vi.fn() }))

import { checkLocalSafety, nextLocalRisk, normalizeForSafety } from '../local-safety'

// Synthetic transcript lines only.
describe('checkLocalSafety', () => {
  it('detects an English high-risk phrase', () => {
    expect(checkLocalSafety('sometimes i feel like i want to die').level).toBe('watch')
  })

  it('detects Hinglish high-risk phrases', () => {
    expect(checkLocalSafety('mujhe lagta hai main jeena nahi chahta').level).toBe('watch')
    expect(checkLocalSafety('kabhi kabhi khud ko nuksaan pahunchane ka mann karta hai').level).toBe('watch')
  })

  it('is case-insensitive', () => {
    expect(checkLocalSafety('I WANT TO DIE').level).toBe('watch')
    expect(checkLocalSafety('Mar Jana Chahta hoon').level).toBe('watch')
  })

  it('handles punctuation, apostrophes and spacing variations', () => {
    expect(checkLocalSafety("I   don't   want to live...").level).toBe('watch')
    expect(checkLocalSafety('i dont want to live').level).toBe('watch')
    expect(checkLocalSafety('kill-myself').level).toBe('watch')
    expect(checkLocalSafety('self–harm?!').level).toBe('watch')
    expect(checkLocalSafety('sometimes\n  i want\tto die').level).toBe('watch')
  })

  it('does not trigger on a safe transcript', () => {
    expect(checkLocalSafety('we played the memory game and i won twice').level).toBe('none')
    expect(checkLocalSafety('aaj school mein bahut maza aaya').level).toBe('none')
    expect(checkLocalSafety('').level).toBe('none')
  })

  it('matches whole words, not arbitrary substrings', () => {
    // "skill myself" contains "kill myself" as a substring — must not match.
    expect(checkLocalSafety('i taught the skill myself').level).toBe('none')
    expect(checkLocalSafety('the plant will die soon').level).toBe('none')
  })

  it('only ever returns watch or none — never urgent — and never echoes text', () => {
    const result = checkLocalSafety('i want to kill myself')
    expect(result).toEqual({ level: 'watch' })
  })

  it('normalises to plain lowercase words', () => {
    expect(normalizeForSafety("  Don't   STOP, ok?! ")).toBe('dont stop ok')
  })
})

describe('nextLocalRisk (the per-transcript-update rule)', () => {
  it('raises watch on a risky CLIENT chunk', () => {
    expect(nextLocalRisk('none', { speaker: 'client', text: 'i want to die' })).toBe('watch')
  })

  it('ignores therapist speech (a screening question must not trip it)', () => {
    expect(
      nextLocalRisk('none', { speaker: 'therapist', text: 'have you ever thought about suicide' })
    ).toBe('none')
  })

  it('never downgrades: a later safe chunk keeps watch', () => {
    const after = nextLocalRisk('watch', { speaker: 'client', text: 'we played a fun game' })
    expect(after).toBe('watch')
  })

  it('runs independently of the AI safety call — no AI client is touched', () => {
    nextLocalRisk('none', { speaker: 'client', text: 'i want to die' })
    checkLocalSafety('mar jana chahta hoon')
    expect(chatJSON).not.toHaveBeenCalled()
  })
})
