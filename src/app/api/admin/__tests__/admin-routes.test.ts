import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'

// Real requireAdmin + real route handlers. Only the edges are faked: token
// verification (fakeAuth), Firebase Admin user management, and Postgres
// (a recording mock). Synthetic identities only.
const h = vi.hoisted(() => ({
  db: null as any,
  fb: {
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
  },
}))
vi.mock('@/lib/db', async () => {
  const { createMockPrisma } = await import('@/test-utils/mockPrisma')
  h.db = createMockPrisma()
  return { prisma: h.db.prisma }
})
vi.mock('@/lib/firebaseAdmin', async () => {
  const fake = await import('@/test-utils/fakeAuth')
  return { adminAuth: () => ({ ...fake.adminAuth(), ...h.fb }) }
})

import * as admins from '../admins/route'
import * as overview from '../overview/route'
import * as plans from '../plans/route'
import * as plan from '../plans/[id]/route'
import * as subscriptions from '../subscriptions/route'
import * as subscription from '../subscriptions/[id]/route'
import * as subRequest from '../subscriptions/requests/[id]/route'
import * as access from '../therapists/[id]/access/route'
import * as therapist from '../therapists/[id]/route'

const USERS: Record<string, { id: string; role: string }> = {
  'uid-admin': { id: 'uid-admin', role: 'ADMIN' },
  'uid-ta': { id: 'uid-ta', role: 'THERAPIST' },
  'uid-ca': { id: 'uid-ca', role: 'CLIENT' },
}
const params = { params: { id: 'x-1' } }

// Every admin handler: [label, handler, method, url, body, ctx]
const HANDLERS: Array<[string, (req: any, ctx?: any) => Promise<Response>, string, string, unknown, any]> = [
  ['admins GET', admins.GET, 'GET', '/api/admin/admins', undefined, undefined],
  ['admins POST', admins.POST, 'POST', '/api/admin/admins', { email: 'new@synthetic.test', password: 'secret123' }, undefined],
  ['overview GET', overview.GET, 'GET', '/api/admin/overview', undefined, undefined],
  ['plans GET', plans.GET, 'GET', '/api/admin/plans', undefined, undefined],
  ['plans POST', plans.POST, 'POST', '/api/admin/plans', { name: 'Synthetic plan' }, undefined],
  ['plans/[id] PATCH', plan.PATCH, 'PATCH', '/api/admin/plans/x-1', { name: 'Renamed' }, params],
  ['plans/[id] DELETE', plan.DELETE, 'DELETE', '/api/admin/plans/x-1', undefined, params],
  ['subscriptions GET', subscriptions.GET, 'GET', '/api/admin/subscriptions', undefined, undefined],
  ['subscriptions/[id] PATCH', subscription.PATCH, 'PATCH', '/api/admin/subscriptions/x-1', { action: 'cancel' }, params],
  ['subscriptions/requests/[id] POST', subRequest.POST, 'POST', '/api/admin/subscriptions/requests/x-1', { action: 'approve' }, params],
  ['therapists/[id]/access PATCH', access.PATCH, 'PATCH', '/api/admin/therapists/x-1/access', { allModulesAllowed: true }, params],
  ['therapists/[id] GET', therapist.GET, 'GET', '/api/admin/therapists/x-1', undefined, params],
]

const call = (i: number, as?: string) => {
  const [, handler, method, url, body, ctx] = HANDLERS[i]
  return handler(apiRequest(url, { method, body, as }), ctx)
}
const firebaseWrites = () =>
  [h.fb.createUser, h.fb.updateUser, h.fb.setCustomUserClaims].some((f) => f.mock.calls.length > 0)

beforeEach(() => {
  h.db.reset()
  h.db.on('user', 'findUnique', ({ where }: any) => USERS[where.id] ?? null)
  for (const f of Object.values(h.fb)) f.mockReset()
  h.fb.getUserByEmail.mockRejectedValue(Object.assign(new Error('not found'), { code: 'auth/user-not-found' }))
  h.fb.createUser.mockImplementation(async ({ email }: any) => ({ uid: `uid-created-${email}` }))
})

describe.each(HANDLERS.map((row, i) => [row[0], i] as const))('admin route %s', (_label, i) => {
  it('401 without a token — no database or Firebase Admin work', async () => {
    expect((await call(i)).status).toBe(401)
    expect(h.db.dataCalls()).toEqual([])
    expect(h.fb.getUserByEmail).not.toHaveBeenCalled()
    expect(firebaseWrites()).toBe(false)
  })

  it('401 with a forged token', async () => {
    const [, handler, method, url, body, ctx] = HANDLERS[i]
    const req = new Request(`http://localhost${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer forged' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    expect((await handler(req, ctx)).status).toBe(401)
    expect(h.db.dataCalls()).toEqual([])
  })

  it('403 for a signed-in client — no data touched', async () => {
    expect((await call(i, 'uid-ca')).status).toBe(403)
    expect(h.db.dataCalls()).toEqual([])
    expect(firebaseWrites()).toBe(false)
  })

  it('403 for a signed-in therapist — no data touched', async () => {
    expect((await call(i, 'uid-ta')).status).toBe(403)
    expect(h.db.dataCalls()).toEqual([])
    expect(firebaseWrites()).toBe(false)
  })

  it('an admin reaches the handler', async () => {
    const res = await call(i, 'uid-admin')
    expect([401, 403]).not.toContain(res.status)
    expect(h.db.dataCalls().length + h.fb.getUserByEmail.mock.calls.length).toBeGreaterThan(0)
  })
})

describe('admin routes are never statically prerendered', () => {
  it.each([
    ['admins', admins],
    ['overview', overview],
    ['plans', plans],
    ['plans/[id]', plan],
    ['subscriptions', subscriptions],
    ['subscriptions/[id]', subscription],
    ['subscriptions/requests/[id]', subRequest],
    ['therapists/[id]/access', access],
    ['therapists/[id]', therapist],
  ])('%s exports dynamic = force-dynamic', (_name, mod) => {
    expect((mod as { dynamic?: string }).dynamic).toBe('force-dynamic')
  })
})

describe('POST /api/admin/admins never overwrites an existing account\'s password', () => {
  const post = (body: unknown) => admins.POST(apiRequest('/api/admin/admins', { method: 'POST', body, as: 'uid-admin' }))

  it('refuses (409) when a password is sent for an existing account — nothing changes', async () => {
    h.fb.getUserByEmail.mockResolvedValue({ uid: 'uid-existing-therapist' })
    const res = await post({ email: 'existing@synthetic.test', password: 'attacker-chosen' })
    expect(res.status).toBe(409)
    expect(h.fb.updateUser).not.toHaveBeenCalled()
    expect(h.fb.createUser).not.toHaveBeenCalled()
    expect(h.db.dataCalls()).toEqual([])
  })

  it('promotes an existing account with no password — without touching its password', async () => {
    h.fb.getUserByEmail.mockResolvedValue({ uid: 'uid-existing' })
    const res = await post({ email: 'existing@synthetic.test' })
    expect(res.status).toBe(200)
    expect(h.fb.updateUser).not.toHaveBeenCalled()
    expect(h.fb.createUser).not.toHaveBeenCalled()
    expect(h.db.fn('user', 'upsert')).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'uid-existing' } })
    )
  })

  it('still creates a brand-new admin login with the given password', async () => {
    const res = await post({ email: 'fresh@synthetic.test', password: 'secret123' })
    expect(res.status).toBe(200)
    expect(h.fb.createUser).toHaveBeenCalledWith({ email: 'fresh@synthetic.test', password: 'secret123' })
    expect(h.fb.updateUser).not.toHaveBeenCalled()
  })

  it('the route source no longer calls updateUser at all', () => {
    const src = readFileSync(path.resolve(__dirname, '../admins/route.ts'), 'utf8')
    expect(src).not.toMatch(/updateUser/)
  })
})
