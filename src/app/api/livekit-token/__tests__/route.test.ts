import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenVerifier } from 'livekit-server-sdk'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb } from '@/test-utils/fakePrisma'

// Real requireUser + route + livekit-server-sdk signing; only Firebase token
// verification and Postgres are faked (see src/test-utils). Fixture sessions:
//   s-a: therapist A (uid-ta, "Tara A") with client A (uid-ca, "Cara A")
//   s-b: therapist B (uid-tb) with client B (uid-cb)
vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))

import { GET } from '../route'

const KEY = 'test-livekit-key'
const SECRET = 'test-livekit-secret-that-is-long-enough-for-hs256'

beforeAll(() => {
  process.env.LIVEKIT_API_KEY = KEY
  process.env.LIVEKIT_API_SECRET = SECRET
})
beforeEach(() => resetDb())

const token = (query: string, as?: string) => GET(apiRequest(`/api/livekit-token?${query}`, { as }))

/** Verifies the JWT's signature with the real SDK and returns its claims. */
async function claims(res: Response) {
  expect(res.status).toBe(200)
  const { token: jwt } = await res.json()
  const c = await new TokenVerifier(KEY, SECRET).verify(jwt)
  return { ...c, identity: c.sub, meta: JSON.parse(c.metadata ?? '{}') }
}

describe('GET /api/livekit-token — authentication', () => {
  it('401 without an Authorization token', async () => {
    expect((await token('room=s-a')).status).toBe(401)
  })

  it('401 with an invalid Firebase token', async () => {
    const req = new Request('http://localhost/api/livekit-token?room=s-a', {
      headers: { Authorization: 'Bearer forged' },
    }) as any
    expect((await GET(req)).status).toBe(401)
  })

  it('401 even when the forged request asks for therapist', async () => {
    expect((await token('room=s-a&role=therapist&name=Tara%20A')).status).toBe(401)
  })
})

describe('GET /api/livekit-token — the session\'s therapist', () => {
  it('gets a token with therapist metadata and roomAdmin', async () => {
    const c = await claims(await token('room=s-a', 'uid-ta'))
    expect(c.meta).toEqual({ role: 'therapist', displayName: 'Tara A' })
    expect(c.video).toMatchObject({ roomJoin: true, room: 's-a', roomAdmin: true })
  })

  it('LiveKit identity is the verified Firebase uid; name comes from the DB profile', async () => {
    const c = await claims(await token('room=s-a', 'uid-ta'))
    expect(c.identity).toBe('uid-ta')
    expect(c.name).toBe('Tara A')
  })
})

describe('GET /api/livekit-token — the session\'s client', () => {
  it('gets a token with client metadata and NO roomAdmin', async () => {
    const c = await claims(await token('room=s-a', 'uid-ca'))
    expect(c.meta).toEqual({ role: 'client', displayName: 'Cara A' })
    expect(c.video).toMatchObject({ roomJoin: true, room: 's-a' })
    expect(c.video?.roomAdmin).toBeFalsy()
  })

  it('LiveKit identity is the verified Firebase uid', async () => {
    expect((await claims(await token('room=s-a', 'uid-ca'))).identity).toBe('uid-ca')
  })

  it('a forged ?role=therapist still yields only client permissions', async () => {
    const c = await claims(await token('room=s-a&role=therapist', 'uid-ca'))
    expect(c.meta.role).toBe('client')
    expect(c.video?.roomAdmin).toBeFalsy()
  })
})

describe('GET /api/livekit-token — forged identity / name', () => {
  it('a forged ?name= / ?identity= changes neither the identity nor the display name', async () => {
    const c = await claims(await token('room=s-a&name=Tara%20A&identity=uid-ta', 'uid-ca'))
    expect(c.identity).toBe('uid-ca')
    expect(c.name).toBe('Cara A')
    expect(c.meta.displayName).toBe('Cara A')
  })

  it('two callers can never share an identity — each gets their own uid', async () => {
    const t = await claims(await token('room=s-a&name=Same', 'uid-ta'))
    const c = await claims(await token('room=s-a&name=Same', 'uid-ca'))
    expect(t.identity).not.toBe(c.identity)
  })
})

describe('GET /api/livekit-token — not a participant', () => {
  it('404 for a therapist from another session', async () => {
    expect((await token('room=s-a', 'uid-tb')).status).toBe(404)
  })

  it('404 for a client from another session', async () => {
    expect((await token('room=s-a', 'uid-cb')).status).toBe(404)
  })

  it('404 for another therapist even with ?role=therapist', async () => {
    expect((await token('room=s-a&role=therapist', 'uid-tb')).status).toBe(404)
  })

  it('404 for a session that does not exist (same response as not-yours)', async () => {
    const missing = await token('room=no-such-session', 'uid-ta')
    const notYours = await token('room=s-b', 'uid-ta')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual(await notYours.json())
  })

  it('400 without a room', async () => {
    expect((await token('', 'uid-ta')).status).toBe(400)
  })
})
