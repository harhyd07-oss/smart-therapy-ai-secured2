import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb } from '@/test-utils/fakePrisma'

vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))

import { GET as MEASUREMENT } from '../measurement/[clientId]/route.js'
import { GET as REPORT } from '../reports/[clientId]/route.js'

const measure = (clientId: string, as?: string) =>
  MEASUREMENT(apiRequest(`/api/progress-features/measurement/${clientId}`, { as }), { params: { clientId } })
const pdf = (clientId: string, as?: string) =>
  REPORT(apiRequest(`/api/progress-features/reports/${clientId}`, { as }), { params: { clientId } })

beforeEach(() => resetDb())

describe('GET /api/progress-features/measurement/[clientId]', () => {
  it('401 without a token', async () => {
    expect((await measure('client-a')).status).toBe(401)
  })

  it('404 for another therapist\'s client', async () => {
    expect((await measure('client-b', 'uid-ta')).status).toBe(404)
  })

  it('404 for a client with no therapist link at all', async () => {
    expect((await measure('client-x', 'uid-ta')).status).toBe(404)
  })

  it('own client: only the caller\'s own sessions and metrics — no cross-therapist merge', async () => {
    // client-a is ALSO treated by therapist B (s-shared, m-shared).
    const res = await measure('client-a', 'uid-ta')
    expect(res.status).toBe(200)
    const { metrics } = await res.json()
    expect(metrics.totalSessions).toBe(1) // s-a only, not s-shared
    expect(metrics.history.map((h: { value: number }) => h.value)).toEqual([7]) // m-a only, not m-shared
  })

  it('therapist B sees B\'s own data for the shared client, not A\'s', async () => {
    const { metrics } = await (await measure('client-a', 'uid-tb')).json()
    expect(metrics.totalSessions).toBe(1)
    expect(metrics.history.map((h: { value: number }) => h.value)).toEqual([1])
  })

  it('a client can read their own progress, and only their own', async () => {
    expect((await measure('client-a', 'uid-ca')).status).toBe(200)
    expect((await measure('client-b', 'uid-ca')).status).toBe(404)
  })
})

describe('GET /api/progress-features/reports/[clientId] (PDF)', () => {
  it('401 without a token', async () => {
    expect((await pdf('client-a')).status).toBe(401)
  })

  it('404 for another therapist\'s client', async () => {
    expect((await pdf('client-b', 'uid-ta')).status).toBe(404)
  })

  it('own client gets a PDF', async () => {
    const res = await pdf('client-a', 'uid-ta')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })
})
