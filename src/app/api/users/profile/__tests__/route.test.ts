import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'

// Real requireSignedIn + route. Faked: token verification (a spy around
// fakeAuth, so we can see HOW it was called), Firebase Admin claims, Postgres.
const h = vi.hoisted(() => ({ db: null as any, verify: vi.fn(), setCustomUserClaims: vi.fn() }))
vi.mock('@/lib/db', async () => {
  const { createMockPrisma } = await import('@/test-utils/mockPrisma')
  h.db = createMockPrisma()
  return { prisma: h.db.prisma }
})
vi.mock('@/lib/firebaseAdmin', async () => {
  const fake = await import('@/test-utils/fakeAuth')
  h.verify.mockImplementation(fake.adminAuth().verifyIdToken)
  return { adminAuth: () => ({ verifyIdToken: h.verify, setCustomUserClaims: h.setCustomUserClaims }) }
})

import { DELETE, GET, POST, PUT } from '../route'

// Synthetic records. uid-ca is the caller in most tests; uid-victim is
// someone else whose uid an attacker puts in the request.
const USERS: Record<string, any> = {
  'uid-ca': { id: 'uid-ca', role: 'CLIENT', therapist: null, client: { id: 'client-a', userId: 'uid-ca' }, admin: null },
  'uid-victim': { id: 'uid-victim', role: 'THERAPIST', therapist: { id: 'therapist-v', userId: 'uid-victim' }, client: null, admin: null },
}

beforeEach(() => {
  h.db.reset()
  h.setCustomUserClaims.mockReset()
  h.db.on('user', 'findUnique', ({ where }: any) => USERS[where.id] ?? null)
  h.db.on('user', 'create', ({ data }: any) => data)
  h.db.on('profileClient', 'create', ({ data }: any) => ({ id: 'client-new', ...data }))
  h.db.on('profileTherapist', 'create', ({ data }: any) => ({ id: 'therapist-new', ...data }))
  h.db.on('profileClient', 'update', ({ where, data }: any) => ({ ...where, ...data }))
  h.db.on('profileTherapist', 'update', ({ where, data }: any) => ({ ...where, ...data }))
})

const req = (method: string, opts: { url?: string; body?: unknown; as?: string } = {}) =>
  apiRequest(opts.url ?? '/api/users/profile', { method, body: opts.body, as: opts.as })

describe('/api/users/profile — authentication', () => {
  it.each([
    ['GET', GET],
    ['POST', POST],
    ['PUT', PUT],
    ['DELETE', DELETE],
  ])('%s → 401 without a token, before any database work', async (method, handler) => {
    const res = await (handler as any)(req(method, { body: method === 'GET' ? undefined : { uid: 'uid-victim' } }))
    expect(res.status).toBe(401)
    expect(h.db.dataCalls()).toEqual([])
    expect(h.db.fn('user', 'findUnique')).not.toHaveBeenCalled()
  })

  it('401 with a forged token', async () => {
    const res = await GET(new Request('http://localhost/api/users/profile', { headers: { Authorization: 'Bearer forged' } }))
    expect(res.status).toBe(401)
  })
})

describe('GET — only the caller\'s own profile', () => {
  it('a spoofed ?uid= is ignored: the caller gets their own record', async () => {
    const res = await GET(req('GET', { url: '/api/users/profile?uid=uid-victim', as: 'uid-ca' }))
    expect(res.status).toBe(200)
    expect((await res.json()).user.id).toBe('uid-ca')
    expect(h.db.fn('user', 'findUnique')).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'uid-ca' } }))
  })

  it('404 (onboarding signal) for a signed-in user with no profile — not someone else\'s', async () => {
    const res = await GET(req('GET', { url: '/api/users/profile?uid=uid-victim', as: 'uid-new' }))
    expect(res.status).toBe(404)
  })
})

describe('POST — onboarding uses the token identity', () => {
  it('ignores a spoofed body uid/email', async () => {
    const res = await POST(req('POST', {
      as: 'uid-new',
      body: { uid: 'uid-victim', email: 'victim@spoof.test', role: 'CLIENT', firstName: 'Synth' },
    }))
    expect(res.status).toBe(200)
    expect(h.db.fn('user', 'create')).toHaveBeenCalledWith({
      data: { id: 'uid-new', email: 'uid-new@token.test', role: 'CLIENT' },
    })
    expect(h.setCustomUserClaims).toHaveBeenCalledWith('uid-new', { role: 'CLIENT' })
    expect(h.setCustomUserClaims).not.toHaveBeenCalledWith('uid-victim', expect.anything())
  })

  it('keeps self-selected THERAPIST registration', async () => {
    await POST(req('POST', { as: 'uid-new', body: { role: 'THERAPIST' } }))
    expect(h.db.fn('user', 'create')).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'THERAPIST' }),
    })
  })

  it('cannot create an ADMIN', async () => {
    await POST(req('POST', { as: 'uid-new', body: { role: 'ADMIN' } }))
    const [{ data }] = h.db.fn('user', 'create').mock.calls[0]
    expect(data.role).not.toBe('ADMIN')
    expect(h.setCustomUserClaims).not.toHaveBeenCalledWith(expect.anything(), { role: 'ADMIN' })
  })
})

describe('PUT — only the caller\'s own profile', () => {
  it('ignores a spoofed body uid and role', async () => {
    const res = await PUT(req('PUT', {
      as: 'uid-ca',
      body: { uid: 'uid-victim', role: 'THERAPIST', firstName: 'Changed' },
    }))
    expect(res.status).toBe(200)
    // The caller is a CLIENT (from the DB), so only their client profile changes.
    expect(h.db.fn('profileClient', 'update')).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'uid-ca' } })
    )
    expect(h.db.fn('profileTherapist', 'update')).not.toHaveBeenCalled()
  })
})

describe('DELETE — only the caller\'s own account', () => {
  it('ignores a spoofed body uid', async () => {
    const res = await DELETE(req('DELETE', { as: 'uid-ca', body: { uid: 'uid-victim' } }))
    expect(res.status).toBe(200)
    expect(h.db.fn('user', 'delete')).toHaveBeenCalledWith({ where: { id: 'uid-ca' } })
    expect(h.db.fn('user', 'delete')).not.toHaveBeenCalledWith({ where: { id: 'uid-victim' } })
  })

  it('works with a token captured before the Firebase account was deleted', async () => {
    // The browser deletes the Firebase user first, then sends the token it
    // captured beforehand. Verification must not depend on the Firebase account
    // still existing (no revocation / user lookup), and needs no profile check.
    const res = await DELETE(req('DELETE', { as: 'uid-ca' }))
    expect(res.status).toBe(200)
    const verifyArgs = h.verify.mock.calls.at(-1)!
    expect(verifyArgs).toHaveLength(1) // verifyIdToken(token) — no checkRevoked
  })
})
