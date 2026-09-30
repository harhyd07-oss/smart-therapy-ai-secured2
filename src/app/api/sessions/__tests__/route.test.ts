import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb, table } from '@/test-utils/fakePrisma'

// Real requireUser / requireTherapist + routes; only token verification,
// Postgres and Firestore provisioning are faked.
vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))
const provision = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session-provisioning', () => ({ provisionSessionDocs: provision }))

import { GET as LIST, POST as CREATE } from '../route'
import { GET as GET_ONE, PATCH } from '../[sessionId]/route'

const one = (id: string, as?: string) => GET_ONE(apiRequest(`/api/sessions/${id}`, { as }), { params: { sessionId: id } })
const patch = (id: string, body: unknown, as?: string) =>
  PATCH(apiRequest(`/api/sessions/${id}`, { method: 'PATCH', body, as }), { params: { sessionId: id } })
const sessionIds = async (res: Response) => ((await res.json()).sessions as { id: string }[]).map((s) => s.id).sort()

beforeEach(() => {
  resetDb()
  provision.mockReset()
})

describe('GET /api/sessions (list)', () => {
  it('401 without a token', async () => {
    expect((await LIST(apiRequest('/api/sessions'))).status).toBe(401)
  })

  it('therapist gets only their own sessions', async () => {
    const res = await LIST(apiRequest('/api/sessions', { as: 'uid-ta' }))
    expect(res.status).toBe(200)
    expect(await sessionIds(res)).toEqual(['s-a'])
  })

  it('client gets only their own sessions (legit client access preserved)', async () => {
    expect(await sessionIds(await LIST(apiRequest('/api/sessions', { as: 'uid-cb' })))).toEqual(['s-b'])
  })

  it('spoofed ?therapistId= / ?clientId= cannot pull another party\'s sessions', async () => {
    expect(await sessionIds(await LIST(apiRequest('/api/sessions?therapistId=therapist-b', { as: 'uid-ta' })))).toEqual(['s-a'])
    expect(await sessionIds(await LIST(apiRequest('/api/sessions?clientId=client-a', { as: 'uid-cb' })))).toEqual(['s-b'])
  })
})

describe('POST /api/sessions', () => {
  const when = '2099-02-01T10:00:00Z'

  it('401 without a token', async () => {
    const res = await CREATE(apiRequest('/api/sessions', { method: 'POST', body: { clientId: 'client-a', scheduledAt: when } }))
    expect(res.status).toBe(401)
  })

  it('403 for a client (therapist-only)', async () => {
    const res = await CREATE(apiRequest('/api/sessions', { method: 'POST', body: { clientId: 'client-a', scheduledAt: when }, as: 'uid-ca' }))
    expect(res.status).toBe(403)
  })

  it('therapist books their own client, as themselves', async () => {
    const res = await CREATE(apiRequest('/api/sessions', { method: 'POST', body: { clientId: 'client-a', scheduledAt: when }, as: 'uid-ta' }))
    expect(res.status).toBe(200)
    expect((await res.json()).session).toMatchObject({ therapistId: 'therapist-a', clientId: 'client-a' })
  })

  it('404 booking another therapist\'s client', async () => {
    const res = await CREATE(apiRequest('/api/sessions', { method: 'POST', body: { clientId: 'client-b', scheduledAt: when }, as: 'uid-ta' }))
    expect(res.status).toBe(404)
    expect(table('session')).toHaveLength(3)
  })

  it('a spoofed body therapistId is ignored — the session is still created as the caller', async () => {
    const res = await CREATE(
      apiRequest('/api/sessions', { method: 'POST', body: { therapistId: 'therapist-b', clientId: 'client-a', scheduledAt: when }, as: 'uid-ta' })
    )
    expect((await res.json()).session.therapistId).toBe('therapist-a')
  })

  it('a spoofed body therapistId cannot unlock another therapist\'s client', async () => {
    const res = await CREATE(
      apiRequest('/api/sessions', { method: 'POST', body: { therapistId: 'therapist-b', clientId: 'client-b', scheduledAt: when }, as: 'uid-ta' })
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/sessions/[id]', () => {
  it('401 without a token', async () => {
    expect((await one('s-a')).status).toBe(401)
  })

  it('the session\'s therapist and client can read it', async () => {
    expect((await one('s-a', 'uid-ta')).status).toBe(200)
    expect((await one('s-a', 'uid-ca')).status).toBe(200)
  })

  it('404 for another therapist', async () => {
    expect((await one('s-b', 'uid-ta')).status).toBe(404)
  })

  it('404 for another client', async () => {
    expect((await one('s-b', 'uid-ca')).status).toBe(404)
  })

  it('same 404 for a session that does not exist', async () => {
    const res = await one('nope', 'uid-ta')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual((await (await one('s-b', 'uid-ta')).json()))
  })
})

describe('PATCH /api/sessions/[id]', () => {
  it('401 without a token', async () => {
    expect((await patch('s-a', { action: 'cancel' })).status).toBe(401)
  })

  it('404 when another therapist tries to cancel — and nothing changes', async () => {
    const res = await patch('s-b', { action: 'cancel' }, 'uid-ta')
    expect(res.status).toBe(404)
    expect(table('session').find((s) => s.id === 's-b')!.status).toBe('SCHEDULED')
  })

  it('404 when another therapist tries to start it — no Firestore provisioning', async () => {
    expect((await patch('s-b', { action: 'start' }, 'uid-ta')).status).toBe(404)
    expect(provision).not.toHaveBeenCalled()
  })

  it('404 when another client tries to join it', async () => {
    expect((await patch('s-a', { action: 'start' }, 'uid-cb')).status).toBe(404)
    expect(provision).not.toHaveBeenCalled()
  })

  it('the session\'s client can join (start) and leave (end) — legit client access preserved', async () => {
    expect((await patch('s-a', { action: 'start' }, 'uid-ca')).status).toBe(200)
    expect(provision).toHaveBeenCalledWith('s-a')
    expect((await patch('s-a', { action: 'end' }, 'uid-ca')).status).toBe(200)
    expect(table('session').find((s) => s.id === 's-a')!.status).toBe('COMPLETED')
  })

  it('the session\'s therapist can cancel it', async () => {
    const res = await patch('s-a', { action: 'cancel' }, 'uid-ta')
    expect(res.status).toBe(200)
    expect((await res.json()).session.status).toBe('CANCELLED')
  })
})
