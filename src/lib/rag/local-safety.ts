// Local, deterministic safety net for session transcripts.
//
// The AI safety pass (./safety.ts) is the real judge of risk, but it only runs
// when the therapist presses Analyse — and it can fail. This check runs on
// EVERY client transcript chunk as it arrives, synchronously, with no AI call,
// so obvious risk language is never missed just because nobody asked.
//
// Deliberately conservative in what it claims:
//   - it only ever raises 'watch', never 'urgent' — a keyword can't tell "I want
//     to kill myself" from "this homework is killing me" well enough to declare
//     a crisis; the AI pass (and the therapist) decide that;
//   - it returns a level only — never the matched words — so no transcript text
//     can leak into logs or UI state through it.
//
// No imports on purpose: it is used both server-side (runAnalysis) and in the
// therapist's browser (useSessionTranscription).

export type LocalRiskLevel = 'none' | 'watch'

// Whole phrases, matched on word boundaries after normalisation (lowercase,
// apostrophes dropped, other punctuation → space, whitespace collapsed). Keep
// entries in that normalised form. English, then romanised Hindi (Hinglish).
const RISK_PHRASES: readonly string[] = [
  // English
  'kill myself',
  'killing myself',
  'end my life',
  'take my own life',
  'want to die',
  'wanna die',
  'wish i was dead',
  'wish i were dead',
  'better off dead',
  'dont want to live',
  'no reason to live',
  'not worth living',
  'suicide',
  'suicidal',
  'hurt myself',
  'hurting myself',
  'harm myself',
  'self harm',
  'cut myself',
  'cutting myself',
  // Hinglish
  'mar jana chahta',
  'mar jana chahti',
  'marna chahta',
  'marna chahti',
  'mar jaun',
  'mar jaunga',
  'mar jaungi',
  'jeena nahi chahta',
  'jeena nahi chahti',
  'jina nahi chahta',
  'jina nahi chahti',
  'khud ko maar',
  'khud ko mar',
  'khud ko nuksan',
  'khud ko nuksaan',
  'khud ko hurt',
  'apni jaan le',
  'suicide kar',
]

/** Lowercase, drop apostrophes, turn other punctuation into spaces, collapse whitespace. */
export function normalizeForSafety(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 'watch' if the text contains any risk phrase as whole words, else 'none'. */
export function checkLocalSafety(text: string): { level: LocalRiskLevel } {
  if (!text) return { level: 'none' }
  const haystack = ` ${normalizeForSafety(text)} `
  const hit = RISK_PHRASES.some((phrase) => haystack.includes(` ${phrase} `))
  return { level: hit ? 'watch' : 'none' }
}

/**
 * The per-update rule used by the live transcription hook: only the CLIENT's
 * speech is checked (a therapist's screening question must not trip it), and
 * once raised, the level never goes back down for the session.
 */
export function nextLocalRisk(
  current: LocalRiskLevel,
  chunk: { speaker: string; text: string }
): LocalRiskLevel {
  if (current === 'watch') return 'watch'
  if (chunk.speaker !== 'client') return current
  return checkLocalSafety(chunk.text).level
}
