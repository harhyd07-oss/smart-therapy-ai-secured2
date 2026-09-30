import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist, requireUser } from '@/lib/progressAuth';
import { notFound, therapistHasClient } from '@/lib/ownership';

export const dynamic = 'force-dynamic';

// GET /api/sessions — the signed-in caller's own sessions. A therapist gets
// theirs, a client gets theirs; both come from the ID token. The legacy
// ?therapistId= / ?clientId= query parameters are ignored.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    if (auth.therapist) {
      // Note count + report presence let the UI flag completed sessions whose
      // documentation is still outstanding ("Notes pending").
      const sessions = await prisma.session.findMany({
        where: { therapistId: auth.therapist.id },
        include: {
          client: true,
          report: { select: { id: true } },
          _count: { select: { notes: true } },
        },
        orderBy: { scheduledAt: 'desc' },
      });
      return NextResponse.json({ sessions });
    }

    const sessions = await prisma.session.findMany({
      where: { clientId: auth.client!.id },
      include: {
        therapist: true,
      },
      orderBy: { scheduledAt: 'desc' },
    });
    return NextResponse.json({ sessions });
  } catch (error: any) {
    console.error('Sessions GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/sessions — the signed-in therapist books a session with one of
// THEIR clients. The therapist comes from the token (a body therapistId is
// ignored). New therapist–client relationships start from an invite, never
// from here, so an unlinked client is a 404.
export async function POST(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;
  const therapistId = auth.therapist.id;

  try {
    const { clientId, scheduledAt } = await request.json();

    // If clientId is a userId (firebase UID), look up the profile ID
    let finalClientId = clientId;
    if (clientId && !clientId.includes('-')) {
      const clientProfile = await prisma.profileClient.findUnique({
        where: { userId: clientId },
      });
      if (clientProfile) {
        finalClientId = clientProfile.id;
      } else {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      }
    }

    if (!finalClientId || !(await therapistHasClient(therapistId, finalClientId))) {
      return notFound('Client');
    }

    const session = await prisma.session.create({
      data: {
        therapistId,
        clientId: finalClientId,
        scheduledAt: new Date(scheduledAt),
        status: 'SCHEDULED',
      },
      include: {
        client: true,
        therapist: true,
      },
    });

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('Session creation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
