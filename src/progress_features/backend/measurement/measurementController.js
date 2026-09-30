// measurementController.js
//
// GET /api/progress-features/measurement/:clientId
//
// This is the actual handler logic. It's imported by the thin Next.js route
// file at src/app/api/progress-features/measurement/[clientId]/route.js —
// Next.js requires the file-based route to exist at that exact path to
// register the endpoint, so that file just re-exports this GET function.
//
// Access: the caller comes from the verified ID token. A therapist must be
// linked to the client and sees only their own sessions/metrics; a client may
// see only their own. Anyone else gets 404, same as an unknown client.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/progressAuth';
import { clientDataScope, notFound } from '@/lib/ownership';
import { getClientMetrics } from './measurementService.js';

export async function GET(request, { params }) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { clientId } = params;
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const scope = await clientDataScope(auth, clientId);
    if (!scope) return notFound('Client');

    const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
    if (!client) return notFound('Client');

    const metrics = await getClientMetrics(prisma, clientId, scope);
    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('measurementController GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
