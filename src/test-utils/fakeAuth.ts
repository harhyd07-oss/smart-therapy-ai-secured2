/**
 * Test-only stand-in for `@/lib/firebaseAdmin`.
 *
 *   vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
 *
 * The real requireTherapist / requireUser / requireAdmin run on top of it, so
 * tests exercise the actual auth path. A token `token-<uid>` verifies as that
 * uid; anything else is rejected exactly like a forged/expired Firebase token.
 */
export function adminAuth() {
  return {
    verifyIdToken: async (token: string) => {
      if (!token.startsWith('token-')) throw new Error('invalid token')
      const uid = token.slice('token-'.length)
      // Synthetic, derived from the uid — lets tests prove identity (incl.
      // email) comes from the verified token rather than the request.
      return { uid, email: `${uid}@token.test` }
    },
  }
}

/**
 * Build a Request as a browser would send it. `as` is the Firebase uid whose
 * verified token is attached; omit it for an unauthenticated request.
 */
export function apiRequest(
  url: string,
  { method = 'GET', body, as }: { method?: string; body?: unknown; as?: string } = {}
): any {
  return new Request(`http://localhost${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Authorization: `Bearer token-${as}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
