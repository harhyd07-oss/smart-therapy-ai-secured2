import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';
import { notFound } from '@/lib/ownership';

export const dynamic = 'force-dynamic';

// Therapist-only. Notes belong to a session, and only that session's
// therapist (from the ID token) may read or add them — anyone else gets the
// same 404 as a session that doesn't exist. A body therapistId is ignored.

async function ownedSession(sessionId: string, therapistId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { therapistId: true },
  });
  return !!session && session.therapistId === therapistId;
}

export async function GET(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!(await ownedSession(sessionId, auth.therapist.id))) {
      return notFound('Session');
    }

    const notes = await prisma.therapistNote.findMany({
      where: { sessionId, therapistId: auth.therapist.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ notes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const { sessionId, content, isPrivate } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (!(await ownedSession(sessionId, auth.therapist.id))) {
      return notFound('Session');
    }

    const note = await prisma.therapistNote.create({
      data: {
        sessionId,
        therapistId: auth.therapist.id,
        content,
        isPrivate: isPrivate ?? true,
      },
    });

    return NextResponse.json({ note });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
