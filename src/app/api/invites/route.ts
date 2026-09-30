import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';
import { normalizeIndianPhone } from '@/lib/phone';

// POST /api/invites — the signed-in therapist creates a patient invite
// (name, phone number, diagnosis). Returns the generated token so the client
// can build a shareable link.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;
    const therapistId = auth.therapist.id;

    const { firstName, lastName, diagnosis, scheduledAt, phoneNumber } = await request.json();

    if (!firstName) {
      return NextResponse.json({ error: 'firstName is required' }, { status: 400 });
    }

    const phone = normalizeIndianPhone(phoneNumber);
    if (!phone) {
      return NextResponse.json(
        { error: 'A valid Indian mobile number is required, e.g. +91 9876543210' },
        { status: 400 }
      );
    }

    const invite = await prisma.invite.create({
      data: {
        token: randomUUID(),
        therapistId,
        firstName,
        lastName: lastName || '',
        diagnosis: Array.isArray(diagnosis) ? diagnosis : [],
        phoneNumber: phone,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      },
    });

    return NextResponse.json({ token: invite.token, invite });
  } catch (error: any) {
    console.error('Invite creation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/invites — list the signed-in therapist's invites (for the dashboard).
export async function GET(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

    const invites = await prisma.invite.findMany({
      where: { therapistId: auth.therapist.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ invites });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
