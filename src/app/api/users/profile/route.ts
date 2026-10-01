import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminAuth } from '@/lib/firebaseAdmin';
import { requireSignedIn } from '@/lib/progressAuth';

export const dynamic = 'force-dynamic';

// Every method acts on the CALLER's own account only. Identity (uid, email)
// comes from the verified Firebase ID token — any uid/email in the query or
// body is ignored. requireSignedIn (not requireUser) because signup and the
// first "do I have a profile?" lookup happen before a profile exists.

export async function POST(request: Request) {
  const auth = await requireSignedIn(request);
  if (!auth.ok) return auth.response;
  const { uid, email } = auth;

  try {
    const { role, firstName, lastName, specialty, dateOfBirth, diagnosis, inviteToken } = await request.json();

    if (!email || !role) {
      return NextResponse.json({ error: 'Missing core credentials' }, { status: 400 });
    }

    // Self-registration can only ever produce THERAPIST or CLIENT — never ADMIN.
    const roleEnum = role === 'THERAPIST' ? 'THERAPIST' : 'CLIENT';

    // Create user and profile transactionally; claim invite if present.
    const result = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          id: uid,
          email,
          role: roleEnum,
        },
      });

      if (roleEnum === 'THERAPIST') {
        const profile = await tx.profileTherapist.create({
          data: {
            userId: uid,
            firstName: firstName || 'Therapist',
            lastName: lastName || '',
            specialty: specialty || [],
          },
        });
        return { user: u, profile, session: null };
      }

      const profile = await tx.profileClient.create({
        data: {
          userId: uid,
          firstName: firstName || 'Client',
          lastName: lastName || '',
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : new Date(),
          diagnosis: diagnosis || [],
        },
      });

      // If this signup came from a therapist invite, claim it: create the assigned
      // session and mark the invite CLAIMED.
      let session = null;
      if (inviteToken) {
        const invite = await tx.invite.findUnique({ where: { token: inviteToken } });
        if (invite && invite.status === 'PENDING') {
          session = await tx.session.create({
            data: {
              therapistId: invite.therapistId,
              clientId: profile.id,
              scheduledAt: invite.scheduledAt,
              status: 'SCHEDULED',
            },
          });
          await tx.invite.update({
            where: { id: invite.id },
            data: { status: 'CLAIMED', claimedClientId: profile.id },
          });
        }
      }

      return { user: u, profile, session };
    });

    // Mirror the role onto the Firebase ID token as a custom claim. Firestore
    // rules cannot read Postgres, so this is the only way `patients/{uid}` can
    // distinguish a therapist from any other signed-in account.
    //
    // Deliberately AFTER the transaction and non-fatal: a claim failure must
    // not roll back a created account. The backfill script
    // (scripts/backfill-role-claims.mjs) repairs anyone who slips through.
    //
    // The claim only appears once the client refreshes its ID token — new
    // signups get it on their next token refresh, within the hour.
    try {
      await adminAuth().setCustomUserClaims(uid, { role: roleEnum });
    } catch (e) {
      console.error('Failed to set role claim for', uid, e);
    }

    return NextResponse.json({ success: true, user: result.user, profile: result.profile, session: result.session });
  } catch (error: any) {
    console.error('Error creating user profile in PostgreSQL:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireSignedIn(request);
  if (!auth.ok) return auth.response;
  const { uid } = auth;

  try {
    const { firstName, lastName, qualification, experience, specialty, bio, dateOfBirth, gender, diagnosis } = await request.json();

    // Which profile to update comes from the caller's own stored role, not the body.
    const existing = await prisma.user.findUnique({ where: { id: uid }, select: { role: true } });
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const role = existing.role;

    if (role === 'THERAPIST') {
      const updated = await prisma.profileTherapist.update({
        where: { userId: uid },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(qualification !== undefined && { qualification }),
          ...(experience !== undefined && { experience }),
          ...(specialty !== undefined && { specialty }),
          ...(bio !== undefined && { bio }),
        },
      });
      return NextResponse.json({ profile: updated });
    }

    if (role === 'CLIENT') {
      const updateData: any = {};
      if (dateOfBirth !== undefined) updateData.dateOfBirth = new Date(dateOfBirth);
      if (gender !== undefined) updateData.gender = gender;
      // firstName/lastName only updatable if NOT from invite (handled on frontend)
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;

      const updated = await prisma.profileClient.update({
        where: { userId: uid },
        data: updateData,
      });
      return NextResponse.json({ profile: updated });
    }

    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  } catch (error: any) {
    console.error('Profile PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/users/profile — permanently remove a user and all their data.
// Sessions/bookings/notes/invites are not cascade-deleted from the profile, so
// they are cleared explicitly inside a transaction before the user is removed
// (deleting the User cascades to the therapist/client profile itself).
//
// The browser deletes the Firebase account first (that step enforces Firebase's
// recent-login requirement) using an ID token captured BEFORE the deletion; the
// token still verifies afterwards, so the purge below runs as that same user.
export async function DELETE(request: Request) {
  const auth = await requireSignedIn(request);
  if (!auth.ok) return auth.response;
  const { uid } = auth;

  try {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      include: { therapist: true, client: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      if (user.therapist) {
        const tId = user.therapist.id;
        await tx.therapistNote.deleteMany({ where: { therapistId: tId } });
        await tx.session.deleteMany({ where: { therapistId: tId } });
        await tx.booking.deleteMany({ where: { therapistId: tId } });
        await tx.invite.deleteMany({ where: { therapistId: tId } });
        await tx.documentChunk.deleteMany({ where: { therapistId: tId } });
      }
      if (user.client) {
        const cId = user.client.id;
        // Deleting the client's sessions cascades their notes.
        await tx.booking.deleteMany({ where: { clientId: cId } });
        await tx.session.deleteMany({ where: { clientId: cId } });
      }
      // Removes the User and cascades to the therapist/client profile.
      await tx.user.delete({ where: { id: uid } });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Profile DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET — the caller's own user + profile; 404 when they haven't onboarded yet
// (AuthProvider relies on that 404 to send them to /onboarding).
export async function GET(request: Request) {
  const auth = await requireSignedIn(request);
  if (!auth.ok) return auth.response;
  const { uid } = auth;

  try {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      include: {
        therapist: true,
        client: true,
        admin: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
