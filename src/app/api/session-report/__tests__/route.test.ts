import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only the edges are mocked: Firebase token verification and Postgres. The real
// requireTherapist runs, so these tests exercise the actual auth path.
const verifyIdToken = vi.fn()
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const prisma = {
  user: { findUnique: vi.fn() },
  session: { findUnique: vi.fn(), count: vi.fn() },
  sessionReport: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
}
vi.mock('@/lib/db', () => ({ prisma }))

const generateSessionReport = vi.fn()
vi.mock('@/lib/report/generate', () => ({ generateSessionReport }))
vi.mock('@/lib/report/session-data', () => ({ getReportStats: vi.fn() }))

const { POST, PATCH } = await import('../route')

const USERS: Record<string, { id: string; role: string; therapist: { id: string } | null }> = {
  'uid-a': { id: 'uid-a', role: 'THERAPIST', therapist: { id: 'therapist-a' } },
  'uid-b': { id: 'uid-b', role: 'THERAPIST', therapist: { id: 'therapist-b' } },
  'uid-client': { id: 'uid-client', role: 'CLIENT', therapist: null },
}
const SESSION_A = {
  id: 'session-a',
  therapistId: 'therapist-a',
  clientId: 'client-1',
  createdAt: new Date('2026-01-01'),
  client: { firstName: 'C', lastName: 'L', dateOfBirth: new Date('2018-01-01'), diagnosis: [] },
}

function req(method: string, body: unknown, token?: string) {
  return new Request('http://localhost/api/session-report', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyIdToken.mockImplementation(async (t: string) => {
    if (!t.startsWith('token-')) throw new Error('bad token')
    return { uid: t.slice('token-'.length) }
  })
  prisma.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where.id] ?? null)
  prisma.session.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === 'session-a' ? SESSION_A : null
  )
  prisma.session.count.mockResolvedValue(1)
  prisma.sessionReport.upsert.mockResolvedValue({ id: 'r1' })
  prisma.sessionReport.update.mockResolvedValue({ id: 'r1' })
  generateSessionReport.mockResolvedValue({ content: 'c', model: 'm', stats: {} })
})

describe('POST /api/session-report authorization', () => {
  it('401 without a token', async () => {
    const res = await POST(req('POST', { sessionId: 'session-a' }))
    expect(res.status).toBe(401)
    expect(generateSessionReport).not.toHaveBeenCalled()
  })

  it('403 for a signed-in client', async () => {
    const res = await POST(req('POST', { sessionId: 'session-a' }, 'token-uid-client'))
    expect(res.status).toBe(403)
  })

  it('404 for a different therapist (report never generated)', async () => {
    const res = await POST(req('POST', { sessionId: 'session-a' }, 'token-uid-b'))
    expect(res.status).toBe(404)
    expect(generateSessionReport).not.toHaveBeenCalled()
    expect(prisma.sessionReport.upsert).not.toHaveBeenCalled()
  })

  it('404 for a different therapist even when the body claims the owner\'s therapistId', async () => {
    const res = await POST(
      req('POST', { sessionId: 'session-a', therapistId: 'therapist-a' }, 'token-uid-b')
    )
    expect(res.status).toBe(404)
    expect(generateSessionReport).not.toHaveBeenCalled()
  })

  it('lets the owning therapist generate the report', async () => {
    const res = await POST(req('POST', { sessionId: 'session-a' }, 'token-uid-a'))
    expect(res.status).toBe(200)
    expect(generateSessionReport).toHaveBeenCalledWith('session-a', expect.anything())
  })
})

describe('PATCH /api/session-report authorization', () => {
  it('401 without a token', async () => {
    const res = await PATCH(req('PATCH', { sessionId: 'session-a', content: 'x' }))
    expect(res.status).toBe(401)
    expect(prisma.sessionReport.update).not.toHaveBeenCalled()
  })

  it('404 for a different therapist (report not overwritten)', async () => {
    const res = await PATCH(req('PATCH', { sessionId: 'session-a', content: 'x' }, 'token-uid-b'))
    expect(res.status).toBe(404)
    expect(prisma.sessionReport.update).not.toHaveBeenCalled()
  })

  it('lets the owning therapist save edits', async () => {
    const res = await PATCH(req('PATCH', { sessionId: 'session-a', content: 'x' }, 'token-uid-a'))
    expect(res.status).toBe(200)
    expect(prisma.sessionReport.update).toHaveBeenCalled()
  })
})
