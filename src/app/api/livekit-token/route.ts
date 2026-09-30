import { AccessToken } from 'livekit-server-sdk'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/progressAuth'
import { notFound } from '@/lib/ownership'

export const dynamic = 'force-dynamic';

// GET /api/livekit-token?room=<sessionId>
//
// Only the session's own therapist or own client gets a token. Everything that
// matters comes from trusted sources, never from the request:
//   - identity: the verified Firebase uid (unique, so two people with the same
//     display name can't collide or impersonate each other in the room);
//   - role / roomAdmin: which side of the Postgres Session the caller is on;
//   - name: the caller's own database profile;
//   - room: the Session's id as stored in Postgres.
// `?room=` only says which session is being asked about. Any `role`, `name`
// or `identity` query parameter is ignored. A session the caller isn't part of
// is a 404, the same as one that doesn't exist.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req)
  if (!auth.ok) return auth.response

  const sessionId = new URL(req.url).searchParams.get('room')
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, therapistId: true, clientId: true },
  })

  const role =
    session && auth.therapist && session.therapistId === auth.therapist.id
      ? 'therapist'
      : session && auth.client && session.clientId === auth.client.id
        ? 'client'
        : null
  if (!session || !role) return notFound('Session')

  const profile = role === 'therapist' ? auth.therapist! : auth.client!
  const displayName =
    `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() ||
    (role === 'therapist' ? 'Therapist' : 'Client')

  // Publishing the role as participant metadata makes it readable by the other
  // side of the call, so a peer can tell the client from the therapist instead
  // of guessing "whoever isn't me".
  //
  // Attention scoring depends on this: it will only attach face tracking to a
  // participant it can positively confirm is the CLIENT, and refuses to start
  // when the role is absent or unparseable. Removing this field does not break
  // the call — it silently disables attention scoring. See
  // src/hooks/useAttentionScoring.ts.
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity: auth.uid,
      name: displayName,
      metadata: JSON.stringify({ role, displayName }),
    }
  )

  at.addGrant({
    roomJoin: true,
    room: session.id,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: role === 'therapist',
  })

  return NextResponse.json({ token: await at.toJwt() })
}
