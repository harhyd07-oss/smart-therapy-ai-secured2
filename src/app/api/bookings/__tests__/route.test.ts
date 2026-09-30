import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb, table } from '@/test-utils/fakePrisma'

vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))

import { GET, POST } from '../route'

const bookingIds = async (res: Response) => ((await res.json()).bookings as { id: string }[]).map((b) => b.id).sort()
const book = (body: unknown, as?: string) => POST(apiRequest('/api/bookings', { method: 'POST', body, as }))

beforeEach(() => resetDb())

describe('GET /api/bookings', () => {
  it('401 without a token', async () => {
    expect((await GET(apiRequest('/api/bookings'))).status).toBe(401)
  })

  it('therapist and client each see only their own bookings', async () => {
    expect(await bookingIds(await GET(apiRequest('/api/bookings', { as: 'uid-ta' })))).toEqual(['bk-a'])
    expect(await bookingIds(await GET(apiRequest('/api/bookings', { as: 'uid-cb' })))).toEqual(['bk-b'])
  })

  it('spoofed query ids do not widen the result', async () => {
    expect(await bookingIds(await GET(apiRequest('/api/bookings?therapistId=therapist-b', { as: 'uid-ta' })))).toEqual(['bk-a'])
    expect(await bookingIds(await GET(apiRequest('/api/bookings?clientId=client-a', { as: 'uid-cb' })))).toEqual(['bk-b'])
  })
})

describe('POST /api/bookings', () => {
  const dateTime = '2099-02-01T10:00:00Z'

  it('401 without a token', async () => {
    expect((await book({ clientId: 'client-a', dateTime })).status).toBe(401)
  })

  it('therapist books their own client', async () => {
    const res = await book({ clientId: 'client-a', dateTime }, 'uid-ta')
    expect(res.status).toBe(200)
    expect((await res.json()).booking).toMatchObject({ therapistId: 'therapist-a', clientId: 'client-a' })
  })

  it('404 for another therapist\'s client, even with a spoofed body therapistId', async () => {
    expect((await book({ clientId: 'client-b', dateTime }, 'uid-ta')).status).toBe(404)
    expect((await book({ therapistId: 'therapist-b', clientId: 'client-b', dateTime }, 'uid-ta')).status).toBe(404)
    expect(table('booking')).toHaveLength(2)
  })
})
