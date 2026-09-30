'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { authFetch, progressFetch } from '@/lib/progressApi';
import type { PracticeBooking, PracticeClient, PracticeInvite, PracticeSession } from '@/lib/practice';

/**
 * Loads everything the practice pages show — sessions, bookings and, for
 * therapists, clients and pending invites — and exposes `refresh` so any
 * action (book, cancel, add note…) can re-sync the page.
 */
export function usePracticeData() {
  const { uid, role, profile } = useAuthStore();
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [bookings, setBookings] = useState<PracticeBooking[]>([]);
  const [clients, setClients] = useState<PracticeClient[]>([]);
  const [invites, setInvites] = useState<PracticeInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile?.id || !role) return;
    const isTherapist = role === 'THERAPIST';
    const param = isTherapist ? `therapistId=${profile.id}` : `clientId=${profile.id}`;
    try {
      const [sRes, bRes, cRes, iData] = await Promise.all([
        // Authenticated: the server scopes all three to the token's owner.
        authFetch(`/api/sessions?${param}`),
        authFetch(`/api/bookings?${param}`),
        isTherapist ? authFetch(`/api/clients?therapistId=${profile.id}`) : null,
        // Authenticated: invites carry client phone numbers.
        isTherapist ? progressFetch('/api/invites').catch(() => null) : null,
      ]);
      if (sRes.ok) setSessions((await sRes.json()).sessions ?? []);
      if (bRes.ok) setBookings((await bRes.json()).bookings ?? []);
      if (cRes?.ok) setClients((await cRes.json()).clients ?? []);
      if (iData) setInvites(iData.invites ?? []);
      setError(sRes.ok ? null : 'Could not load your sessions. Please refresh.');
    } catch {
      setError('Could not reach the server. Check your connection and refresh.');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, role]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { uid, role, profile, sessions, bookings, clients, invites, loading, error, refresh };
}

/** Redirect signed-out users to /auth and non-therapists to their home. */
export function useTherapistGuard() {
  const { uid, role } = useAuthStore();
  const router = useRouter();
  useEffect(() => {
    if (!uid) router.push('/auth');
    else if (role && role !== 'THERAPIST') router.push(role === 'ADMIN' ? '/admin' : '/');
  }, [uid, role, router]);
}

/** Re-renders every `intervalMs` so countdowns and "missed" states stay current. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
