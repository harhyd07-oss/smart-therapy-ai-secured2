import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'

const h = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/db', async () => {
  const { createMockPrisma } = await import('@/test-utils/mockPrisma')
  h.db = createMockPrisma()
  return { prisma: h.db.prisma }
})
vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))

import { GET } from '../route'
import { POST } from '../request/route'

const USERS: Record<string, any> = {
  'uid-ta': { id: 'uid-ta', role: 'THERAPIST', therapist: { id: 'therapist-a' } },
  'uid-ca': { id: 'uid-ca', role: 'CLIENT', therapist: null },
}

beforeEach(() => {
  h.db.reset()
  h.db.on('user', 'findUnique', ({ where }: any) => USERS[where.id] ?? null)
  h.db.on('profileTherapist', 'findUnique', ({ where }: any) => ({ id: where.id }))
  h.db.on('plan', 'findUnique', () => ({ id: 'plan-1', isActive: true, toolQuota: null, durationMonths: 1 }))
  h.db.on('subscriptionRequest', 'create', ({ data }: any) => ({ id: 'req-1', ...data }))
})

const get = (url: string, as?: string) => GET(apiRequest(url, { as }))
const request = (body: unknown, as?: string) =>
  POST(apiRequest('/api/subscriptions/request', { method: 'POST', body, as }))

describe('GET /api/subscriptions', () => {
  it('401 without a token — no data read', async () => {
    expect((await get('/api/subscriptions?therapistId=therapist-a')).status).toBe(401)
    expect(h.db.dataCalls()).toEqual([])
  })

  it('403 for a client', async () => {
    expect((await get('/api/subscriptions', 'uid-ca')).status).toBe(403)
    expect(h.db.dataCalls()).toEqual([])
  })

  it('returns only the caller\'s subscription — a spoofed ?therapistId= is ignored', async () => {
    const res = await get('/api/subscriptions?therapistId=therapist-b', 'uid-ta')
    expect(res.status).toBe(200)
    expect(h.db.fn('subscription', 'findMany')).toHaveBeenCalledWith(
      expect.objectContaining({ where: { therapistId: 'therapist-a' } })
    )
    expect(h.db.fn('subscriptionRequest', 'findFirst')).toHaveBeenCalledWith(
      expect.objectContaining({ where: { therapistId: 'therapist-a', status: 'PENDING' } })
    )
  })
})

describe('POST /api/subscriptions/request', () => {
  it('401 without a token — nothing created', async () => {
    expect((await request({ therapistId: 'therapist-a', planId: 'plan-1' })).status).toBe(401)
    expect(h.db.dataCalls()).toEqual([])
  })

  it('403 for a client', async () => {
    expect((await request({ planId: 'plan-1' }, 'uid-ca')).status).toBe(403)
    expect(h.db.fn('subscriptionRequest', 'create')).not.toHaveBeenCalled()
  })

  it('the request always belongs to the caller — a spoofed body therapistId is ignored', async () => {
    const res = await request({ therapistId: 'therapist-b', planId: 'plan-1' }, 'uid-ta')
    expect(res.status).toBe(200)
    expect(h.db.fn('subscriptionRequest', 'create')).toHaveBeenCalledWith({
      data: expect.objectContaining({ therapistId: 'therapist-a', planId: 'plan-1' }),
    })
  })
})
