import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';
import { notFound } from '@/lib/ownership';

const ALLOWED_TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'];

// POST /api/usage — log a resource-usage event for the signed-in therapist.
// Body: { type, label?, sessionId?, count? }. The therapist comes from the ID
// token (a body therapistId is ignored); a sessionId must be one of theirs.
export async function POST(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;
  const therapistId = auth.therapist.id;

  try {
    const { type, label, sessionId, count } = await request.json();

    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: 'A valid type is required' }, { status: 400 });
    }

    if (sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { therapistId: true },
      });
      if (!session || session.therapistId !== therapistId) {
        return notFound('Session');
      }
    }

    const n = Number(count);
    await prisma.usageEvent.create({
      data: {
        therapistId,
        type,
        label: label ?? null,
        sessionId: sessionId ?? null,
        count: Number.isFinite(n) && n > 0 ? Math.round(n) : 1,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Usage log error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
