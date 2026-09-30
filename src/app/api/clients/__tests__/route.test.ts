import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb } from '@/test-utils/fakePrisma'

// Real requireTherapist + route; only token verification and Postgres are faked.
vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))

import { GET } from '../route'

const ids = async (res: Response) => ((await res.json()).clients as { id: string }[]).map((c) => c.id).sort()

beforeEach(() => resetDb())

describe('GET /api/clients', () => {
  it('401 without a token', async () => {
    expect((await GET(apiRequest('/api/clients'))).status).toBe(401)
  })

  it('401 with a forged token', async () => {
    const req = new Request('http://localhost/api/clients', { headers: { Authorization: 'Bearer forged' } })
    expect((await GET(req)).status).toBe(401)
  })

  it('403 for a signed-in client (therapist-only route)', async () => {
    expect((await GET(apiRequest('/api/clients', { as: 'uid-ca' }))).status).toBe(403)
  })

  it('without therapistId returns ONLY the signed-in therapist\'s clients (never everyone)', async () => {
    const res = await GET(apiRequest('/api/clients', { as: 'uid-ta' }))
    expect(res.status).toBe(200)
    expect(await ids(res)).toEqual(['client-a'])
  })

  it('a spoofed ?therapistId= of another therapist does not change whose clients come back', async () => {
    const res = await GET(apiRequest('/api/clients?therapistId=therapist-b', { as: 'uid-ta' }))
    expect(await ids(res)).toEqual(['client-a'])
  })

  it('therapist B sees their own clients, including one shared with A', async () => {
    const res = await GET(apiRequest('/api/clients', { as: 'uid-tb' }))
    expect(await ids(res)).toEqual(['client-a', 'client-b'])
  })

  it('counts only the signed-in therapist\'s sessions for a shared client', async () => {
    const res = await GET(apiRequest('/api/clients', { as: 'uid-ta' }))
    const [c] = (await res.json()).clients
    expect(c.sessionCount).toBe(1)
  })
})
