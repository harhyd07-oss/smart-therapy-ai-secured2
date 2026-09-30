import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression: provisioning used to merge-write `aiConsent: {}` onto
// sessions/{id}. With merge, an empty map REPLACES the existing one, so every
// join (and every rejoin/reload) silently wiped both parties' consent.
// Provisioning must never write aiConsent at all — consent is owned by the
// participants' own writes (`aiConsent.therapist` / `aiConsent.client`).

type Write = { path: string; op: 'set' | 'update'; data: Record<string, unknown>; opts?: unknown }

const h = vi.hoisted(() => ({
  writes: [] as Write[],
  existing: new Set<string>(),
  findUnique: vi.fn(),
}))

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  getApp: () => ({}),
  initializeApp: vi.fn(),
  cert: vi.fn(),
}))

vi.mock('firebase-admin/firestore', () => {
  const ref = (path: string) => ({
    get: async () => ({ exists: h.existing.has(path) }),
    set: async (data: Record<string, unknown>, opts?: unknown) => {
      h.writes.push({ path, op: 'set', data, opts })
    },
    update: async (data: Record<string, unknown>) => {
      h.writes.push({ path, op: 'update', data })
    },
  })
  return {
    getFirestore: () => ({
      collection: (c: string) => ({ doc: (id: string) => ref(`${c}/${id}`) }),
    }),
    FieldValue: {
      serverTimestamp: () => 'SERVER_TIMESTAMP',
      arrayUnion: (...v: unknown[]) => ({ arrayUnion: v }),
    },
  }
})

vi.mock('@/lib/db', () => ({ prisma: { session: { findUnique: h.findUnique } } }))

const { provisionSessionDocs } = await import('../session-provisioning')

const SESSION = 'session-1'

beforeEach(() => {
  h.writes.length = 0
  h.existing.clear()
  h.findUnique.mockResolvedValue({
    id: SESSION,
    therapist: { userId: 'uid-therapist' },
    client: { userId: 'uid-client' },
  })
})

const touchesConsent = (w: Write) => Object.keys(w.data).some((k) => k.split('.')[0] === 'aiConsent')

describe('provisionSessionDocs — never touches aiConsent', () => {
  it('first join: the sessions/{id} merge-write has no aiConsent field', async () => {
    await provisionSessionDocs(SESSION)

    const sessionWrite = h.writes.find((w) => w.path === `sessions/${SESSION}`)
    expect(sessionWrite).toBeDefined()
    expect(sessionWrite!.opts).toEqual({ merge: true })
    expect(sessionWrite!.data).not.toHaveProperty('aiConsent')
    expect(sessionWrite!.data).toMatchObject({ sessionId: SESSION })
  })

  it('re-provision (rejoin / second participant / end): no write anywhere touches aiConsent', async () => {
    h.existing.add(`liveSessions/${SESSION}`)
    await provisionSessionDocs(SESSION)

    expect(h.writes.length).toBeGreaterThan(0)
    expect(h.writes.filter(touchesConsent)).toEqual([])
  })

  it('first join: no write anywhere touches aiConsent', async () => {
    await provisionSessionDocs(SESSION)
    expect(h.writes.filter(touchesConsent)).toEqual([])
  })
})
