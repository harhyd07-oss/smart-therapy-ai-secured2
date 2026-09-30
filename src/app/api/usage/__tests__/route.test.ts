import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb, table } from '@/test-utils/fakePrisma'

vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))

import { POST } from '../route'

const log = (body: unknown, as?: string) => POST(apiRequest('/api/usage', { method: 'POST', body, as }))

beforeEach(() => resetDb())

describe('POST /api/usage', () => {
  it('401 without a token', async () => {
    expect((await log({ type: 'MODULE_LAUNCH' })).status).toBe(401)
    expect(table('usageEvent')).toHaveLength(0)
  })

  it('logs against the signed-in therapist, ignoring a spoofed body therapistId', async () => {
    const res = await log({ therapistId: 'therapist-b', type: 'MODULE_LAUNCH', sessionId: 's-a' }, 'uid-ta')
    expect(res.status).toBe(200)
    expect(table('usageEvent')).toEqual([expect.objectContaining({ therapistId: 'therapist-a', sessionId: 's-a' })])
  })

  it('404 when attributing usage to another therapist\'s session', async () => {
    expect((await log({ type: 'TRANSCRIPTION', sessionId: 's-b' }, 'uid-ta')).status).toBe(404)
    expect(table('usageEvent')).toHaveLength(0)
  })

  it('403 for a client (therapist-only)', async () => {
    expect((await log({ type: 'MODULE_LAUNCH' }, 'uid-ca')).status).toBe(403)
  })
})
