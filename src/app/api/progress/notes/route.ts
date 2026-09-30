import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';
import { notFound, therapistHasClient } from '@/lib/ownership';

export const dynamic = 'force-dynamic';

// GET /api/progress/notes?clientId=xxx&reportId=yyy
export async function GET(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const reportId = searchParams.get('reportId');

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }
    if (!(await therapistHasClient(auth.therapist.id, clientId))) {
      return notFound('Client');
    }

    const notes = await prisma.progressNote.findMany({
      where: {
        clientId,
        therapistId: auth.therapist.id,
        ...(reportId ? { reportId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ notes });
  } catch (error: any) {
    console.error('Progress notes GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/progress/notes
// Body: { clientId, content, reportId?, isPrivate? }
export async function POST(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { clientId, content, reportId, isPrivate } = body || {};

    if (!clientId || !content) {
      return NextResponse.json({ error: 'clientId and content are required' }, { status: 400 });
    }

    // Only this therapist's own client, and only a report of theirs about them.
    if (!(await therapistHasClient(auth.therapist.id, clientId))) {
      return notFound('Client');
    }
    if (reportId) {
      const report = await prisma.progressReport.findUnique({
        where: { id: reportId },
        select: { therapistId: true, clientId: true },
      });
      if (!report || report.therapistId !== auth.therapist.id || report.clientId !== clientId) {
        return notFound('Progress report');
      }
    }

    const note = await prisma.progressNote.create({
      data: {
        clientId,
        therapistId: auth.therapist.id,
        reportId: reportId || null,
        content,
        isPrivate: isPrivate === false ? false : true,
      },
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error: any) {
    console.error('Progress notes POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
