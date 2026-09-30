import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/db';

/**
 * Verifies the Firebase ID token sent by the client in the
 * `Authorization: Bearer <idToken>` header and returns the decoded UID.
 */
async function verifyBearer(request: Request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Missing Authorization: Bearer <idToken> header' },
        { status: 401 }
      ),
    };
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { ok: true as const, uid: decoded.uid };
  } catch (err: any) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Invalid or expired authentication token' },
        { status: 401 }
      ),
    };
  }
}

/**
 * Verifies the caller's Firebase ID token, then confirms the corresponding
 * user is an active THERAPIST with a ProfileTherapist row.
 *
 * Usage inside a route handler:
 *
 *   const auth = await requireTherapist(request);
 *   if (!auth.ok) return auth.response;
 *   const { therapist } = auth;
 */
export async function requireTherapist(request: Request) {
  const verified = await verifyBearer(request);
  if (!verified.ok) return verified;

  const user = await prisma.user.findUnique({
    where: { id: verified.uid },
    include: { therapist: true },
  });

  if (!user || user.role !== 'THERAPIST' || !user.therapist) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Only authenticated therapists may access progress tracking' },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true as const,
    uid: verified.uid,
    therapist: user.therapist,
  };
}

/**
 * Verifies the caller's Firebase ID token, then confirms the corresponding
 * user has the ADMIN role in the database.
 *
 *   const auth = await requireAdmin(request);
 *   if (!auth.ok) return auth.response;
 */
export async function requireAdmin(request: Request) {
  const verified = await verifyBearer(request);
  if (!verified.ok) return verified;

  const user = await prisma.user.findUnique({ where: { id: verified.uid } });

  if (!user || user.role !== 'ADMIN') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Only admins may access this resource' }, { status: 403 }),
    };
  }

  return { ok: true as const, uid: verified.uid };
}
