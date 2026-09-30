import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist, requireUser } from '@/lib/progressAuth';
import { notFound, therapistHasClient } from '@/lib/ownership';

export const dynamic = 'force-dynamic';

// GET /api/bookings — the signed-in caller's own bookings (therapist or
// client, from the ID token). Legacy ?therapistId= / ?clientId= are ignored.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    if (auth.therapist) {
      const bookings = await prisma.booking.findMany({
        where: { therapistId: auth.therapist.id },
        include: {
          client: true,
        },
        orderBy: { dateTime: 'asc' },
      });
      return NextResponse.json({ bookings });
    }

    const bookings = await prisma.booking.findMany({
      where: { clientId: auth.client!.id },
      include: {
        therapist: true,
      },
      orderBy: { dateTime: 'asc' },
    });
    return NextResponse.json({ bookings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/bookings — the signed-in therapist books one of THEIR clients.
// A body therapistId is ignored; an unlinked client is a 404.
export async function POST(request: Request) {
  const auth = await requireTherapist(request);
  if (!auth.ok) return auth.response;
  const therapistId = auth.therapist.id;

  try {
    const { clientId, dateTime, duration } = await request.json();

    if (!clientId || !(await therapistHasClient(therapistId, clientId))) {
      return notFound('Client');
    }

    const booking = await prisma.booking.create({
      data: {
        therapistId,
        clientId,
        dateTime: new Date(dateTime),
        duration: duration || 50,
      },
    });

    return NextResponse.json({ booking });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
