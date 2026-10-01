import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// /api/deepgram-token minted real Deepgram keys for any request carrying ANY
// Authorization header, and nothing in the app called it (transcription uses
// Sarvam via server.js). It was deleted; this keeps it from quietly returning.
const SRC = path.resolve(__dirname, '../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sourceFiles(p)
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ? [p] : []
  })
}

describe('removed: /api/deepgram-token', () => {
  it('the route no longer exists', () => {
    expect(existsSync(path.join(SRC, 'app/api/deepgram-token'))).toBe(false)
  })

  it('nothing in src references it', () => {
    const hits = sourceFiles(SRC).filter((f) => readFileSync(f, 'utf8').includes('deepgram-token'))
    expect(hits).toEqual([])
  })
})
