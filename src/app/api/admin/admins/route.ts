import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/progressAuth';
import { adminAuth } from '@/lib/firebaseAdmin';

// Admin-only and per-request: never prerender database responses into the build.
export const dynamic = 'force-dynamic';

// GET /api/admin/admins — list all admin accounts.
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const admins = await prisma.profileAdmin.findMany({
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({
      admins: admins.map((a) => ({
        id: a.id,
        userId: a.userId,
        name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.user?.email ?? '',
        createdAt: a.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Admins GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/admin/admins — create (or promote) an admin account.
// Body: { email, password?, firstName?, lastName? }
// If the email already has a Firebase user, it is promoted — its password is
// never changed (a password sent for an existing account is refused with 409).
// Otherwise a new Firebase user is created with the given password.
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const { email, password, firstName, lastName } = await request.json();
    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    const firebase = adminAuth();

    let uid: string;
    // An existing account is only ever PROMOTED — its password is never
    // touched. Setting a password here would let an admin take over any
    // therapist's or client's login just by knowing their email.
    let existing: { uid: string } | null = null;
    try {
      existing = await firebase.getUserByEmail(email);
    } catch {
      existing = null;
    }
    if (existing) {
      if (password) {
        return NextResponse.json(
          {
            error:
              'This email already has an account. Its password cannot be set here — leave the password blank to promote it to admin.',
          },
          { status: 409 }
        );
      }
      uid = existing.uid;
    } else {
      if (!password || String(password).length < 6) {
        return NextResponse.json(
          { error: 'A password of at least 6 characters is required for a new admin.' },
          { status: 400 }
        );
      }
      const created = await firebase.createUser({ email, password });
      uid = created.uid;
    }

    // Upsert the DB user as ADMIN + ensure an admin profile exists.
    await prisma.user.upsert({
      where: { id: uid },
      update: { role: 'ADMIN', email },
      create: { id: uid, email, role: 'ADMIN' },
    });

    const profile = await prisma.profileAdmin.upsert({
      where: { userId: uid },
      update: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
      },
      create: {
        userId: uid,
        firstName: firstName || 'Admin',
        lastName: lastName || '',
      },
    });

    return NextResponse.json({ success: true, admin: { id: profile.id, userId: uid, email } });
  } catch (error: any) {
    console.error('Admins POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
