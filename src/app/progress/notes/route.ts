// /progress/notes — same handlers as /api/progress/notes, so both paths share
// one copy of the auth + ownership logic. Route segment config must be a
// literal in this file (Next.js reads it statically), so it isn't re-exported.
export const dynamic = 'force-dynamic';
export { GET, POST } from '@/app/api/progress/notes/route';
