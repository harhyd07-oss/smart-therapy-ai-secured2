import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only the edges are mocked: Firebase token verification and Postgres. The real
// requireTherapist runs, so these tests exercise the actual auth path.
const verifyIdToken = vi.fn()
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const prisma = {
  user: { findUnique: vi.fn() },
  session: { findUnique: vi.fn() },
  usageEvent: { create: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma }))

const runAnalysis = vi.fn()
vi.mock('@/lib/rag/analysis', () => ({ runAnalysis }))

const store = {
  checkAIConsent: vi.fn(),
  getSessionTranscript: vi.fn(),
  appendCopilotEvent: vi.fn(),
  saveAIInsight: vi.fn(),
}
vi.mock('@/lib/rag/transcript-store', () => store)

const { POST } = await import('../route')

// Two therapists, each with their own session. Tokens map to Firebase uids.
const USERS: Record<string, { id: string; role: string; therapist: { id: string } | null }> = {
  'uid-a': { id: 'uid-a', role: 'THERAPIST', therapist: { id: 'therapist-a' } },
  'uid-b': { id: 'uid-b', role: 'THERAPIST', therapist: { id: 'therapist-b' } },
  'uid-client': { id: 'uid-client', role: 'CLIENT', therapist: null },
}
const SESSIONS: Record<string, { therapistId: string }> = {
  'session-a': { therapistId: 'therapist-a' },
}

function req(body: unknown, token?: string) {
  return new Request('http://localhost/api/ai-insight', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

const body = (over: Record<string, unknown> = {}) => ({
  sessionId: 'session-a',
  clientProfile: { clientId: 'uid-client', name: 'C' },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  verifyIdToken.mockImplementation(async (t: string) => {
    if (!t.startsWith('token-')) throw new Error('bad token')
    return { uid: t.slice('token-'.length) }
  })
  prisma.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where.id] ?? null)
  prisma.session.findUnique.mockImplementation(async ({ where }: any) => SESSIONS[where.id] ?? null)
  store.checkAIConsent.mockResolvedValue(true)
  store.getSessionTranscript.mockResolvedValue([{ text: 'hi' }])
  runAnalysis.mockResolvedValue({ summary: 's', module: 'm', riskFlag: false })
})

describe('POST /api/ai-insight authorization', () => {
  it('401 without a token', async () => {
    const res = await POST(req(body()))
    expect(res.status).toBe(401)
    expect(runAnalysis).not.toHaveBeenCalled()
  })

  it('401 with an invalid token', async () => {
    const res = await POST(req(body(), 'forged'))
    expect(res.status).toBe(401)
  })

  it('403 for a signed-in client', async () => {
    const res = await POST(req(body(), 'token-uid-client'))
    expect(res.status).toBe(403)
    expect(runAnalysis).not.toHaveBeenCalled()
  })

  it('404 for a different therapist', async () => {
    const res = await POST(req(body(), 'token-uid-b'))
    expect(res.status).toBe(404)
    expect(runAnalysis).not.toHaveBeenCalled()
    expect(store.saveAIInsight).not.toHaveBeenCalled()
  })

  it('404 for a different therapist even when the body claims the owner\'s therapistId', async () => {
    const res = await POST(req(body({ therapistId: 'uid-a' }), 'token-uid-b'))
    expect(res.status).toBe(404)
    expect(runAnalysis).not.toHaveBeenCalled()
  })

  it('404 for a session that does not exist', async () => {
    const res = await POST(req(body({ sessionId: 'nope' }), 'token-uid-a'))
    expect(res.status).toBe(404)
  })

  it('lets the owning therapist through, taking identity from the token not the body', async () => {
    const res = await POST(req(body({ therapistId: 'uid-b' }), 'token-uid-a'))
    expect(res.status).toBe(200)
    expect(runAnalysis).toHaveBeenCalledWith(expect.objectContaining({ therapistId: 'uid-a' }))
    expect(store.saveAIInsight).toHaveBeenCalledWith('session-a', expect.anything())
    expect(prisma.usageEvent.create).toHaveBeenCalledWith({
      data: { therapistId: 'therapist-a', sessionId: 'session-a', type: 'AI_ANALYSIS' },
    })
  })
})
