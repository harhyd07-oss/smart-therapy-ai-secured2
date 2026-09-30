/**
 * Normalises an Indian mobile number to E.164 (`+91XXXXXXXXXX`), or returns
 * null if the input isn't one. Shared by the Add Client dialog and
 * POST /api/invites so the UI and API apply exactly the same rule.
 *
 * Accepts `+91XXXXXXXXXX`, `91XXXXXXXXXX`, `0XXXXXXXXXX` or `XXXXXXXXXX`, with
 * any spaces, dashes, dots or brackets. The 10-digit number must start 6–9.
 */
export function normalizeIndianPhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.trim().replace(/[\s\-.()]/g, '');
  const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(compact);
  return match ? `+91${match[1]}` : null;
}

/** wa.me share link, addressed to `phone` when it is a valid Indian mobile. */
export function whatsAppLink(text: string, phone?: string | null): string {
  const to = normalizeIndianPhone(phone)?.slice(1) ?? '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
