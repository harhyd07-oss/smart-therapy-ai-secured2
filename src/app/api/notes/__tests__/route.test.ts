import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb, table } from '@/test-utils/fakePrisma'

vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))

import { GET, POST } from '../route'

const list = (sessionId: string, as?: string) => GET(apiRequest(`/api/notes?sessionId=${sessionId}`, { as }))
const add = (body: unknown, as?: string) => POST(apiRequest('/api/notes', { method: 'POST', body, as }))

beforeEach(() => resetDb())

describe('GET /api/notes', () => {
  it('401 without a token', async () => {
    expect((await list('s-a')).status).toBe(401)
  })

  it('the session\'s therapist reads its notes', async () => {
    const res = await list('s-a', 'uid-ta')
    expect(res.status).toBe(200)
    expect((await res.json()).notes.map((n: { id: string }) => n.id)).toEqual(['n-a'])
  })

  it('404 for another therapist\'s session', async () => {
    expect((await list('s-b', 'uid-ta')).status).toBe(404)
  })

  it('403 for the session\'s own client — therapist notes are therapist-only', async () => {
    expect((await list('s-a', 'uid-ca')).status).toBe(403)
  })
})

describe('POST /api/notes', () => {
  it('401 without a token', async () => {
    expect((await add({ sessionId: 's-a', content: 'x' })).status).toBe(401)
  })

  it('the session\'s therapist adds a note, attributed to them', async () => {
    const res = await add({ sessionId: 's-a', content: 'calmer today' }, 'uid-ta')
    expect(res.status).toBe(200)
    expect((await res.json()).note).toMatchObject({ sessionId: 's-a', therapistId: 'therapist-a' })
  })

  it('404 writing into another therapist\'s session — nothing stored', async () => {
    expect((await add({ sessionId: 's-b', content: 'x' }, 'uid-ta')).status).toBe(404)
    expect(table('therapistNote')).toHaveLength(2)
  })

  it('a spoofed body therapistId neither unlocks another session nor changes the author', async () => {
    expect((await add({ sessionId: 's-b', therapistId: 'therapist-b', content: 'x' }, 'uid-ta')).status).toBe(404)
    const res = await add({ sessionId: 's-a', therapistId: 'therapist-b', content: 'x' }, 'uid-ta')
    expect((await res.json()).note.therapistId).toBe('therapist-a')
  })
})
