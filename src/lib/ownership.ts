import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Ownership checks. Authentication (who is calling) comes from
 * src/lib/progressAuth.ts; these answer the separate question of whether that
 * caller may touch a given record, using only database relationships — never
 * an id the caller supplied as proof.
 *
 * A therapist "has" a client when at least one Session links them. That is the
 * authoritative relationship: claiming an invite creates the first Session,
 * and /api/clients, Firestore provisioning and the privacy backfill all use it.
 */
export async function therapistHasClient(therapistId: string, clientId: string): Promise<boolean> {
  const link = await prisma.session.findFirst({
    where: { therapistId, clientId },
    select: { id: true },
  });
  return !!link;
}

/** The caller as resolved by requireUser / requireTherapist. */
export interface Caller {
  therapist?: { id: string } | null;
  client?: { id: string } | null;
}

/** True when the caller is the therapist or the client on this record. */
export function isParty(caller: Caller, record: { therapistId: string; clientId: string }): boolean {
  return (
    (!!caller.therapist && record.therapistId === caller.therapist.id) ||
    (!!caller.client && record.clientId === caller.client.id)
  );
}

/**
 * Scope for reading one client's cross-session data (progress-features):
 *   - a therapist must be linked to the client, and sees only rows they own
 *     ({ therapistId }) — never another therapist's data about the same child;
 *   - a client may read only their own data (no extra filter).
 * Returns null when the caller has no access, which the route turns into 404.
 */
export async function clientDataScope(
  caller: Caller,
  clientId: string
): Promise<{ therapistId?: string } | null> {
  if (caller.therapist) {
    return (await therapistHasClient(caller.therapist.id, clientId))
      ? { therapistId: caller.therapist.id }
      : null;
  }
  if (caller.client) return caller.client.id === clientId ? {} : null;
  return null;
}

/**
 * 404 for "doesn't exist" and "exists but isn't yours" alike, so ids can't be
 * used to probe for other therapists' or clients' records.
 */
export function notFound(what = 'Resource') {
  return NextResponse.json({ error: `${what} not found` }, { status: 404 });
}
