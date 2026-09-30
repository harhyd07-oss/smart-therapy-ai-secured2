/**
 * Test-only, in-memory stand-in for `@/lib/db`'s Prisma client.
 *
 *   vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))
 *
 * Implements just the query shapes the API routes use (where with equality /
 * `in` / gte / lte, include, select, orderBy, distinct, take, _count), so
 * route tests exercise real filtering instead of hand-stubbed return values.
 * Call resetDb() in beforeEach to restore the fixture below.
 *
 * Fixture — two therapists, each with their own client, plus one client both
 * therapists see (to prove per-therapist scoping):
 *
 *   therapist A (uid-ta / therapist-a) ── s-a ──────── client A (uid-ca / client-a)
 *   therapist B (uid-tb / therapist-b) ── s-b ──────── client B (uid-cb / client-b)
 *   therapist B (uid-tb / therapist-b) ── s-shared ─── client A (uid-ca / client-a)
 *   client X (uid-cx / client-x) has no therapist at all.
 */

type Row = Record<string, any>

const PAST = new Date('2026-01-10T10:00:00Z')
const FUTURE = new Date('2099-01-10T10:00:00Z')

function fixture(): Record<string, Row[]> {
  return {
    user: [
      { id: 'uid-ta', email: 'ta@test', role: 'THERAPIST' },
      { id: 'uid-tb', email: 'tb@test', role: 'THERAPIST' },
      { id: 'uid-ca', email: 'ca@test', role: 'CLIENT' },
      { id: 'uid-cb', email: 'cb@test', role: 'CLIENT' },
      { id: 'uid-cx', email: 'cx@test', role: 'CLIENT' },
      { id: 'uid-admin', email: 'admin@test', role: 'ADMIN' },
    ],
    profileTherapist: [
      { id: 'therapist-a', userId: 'uid-ta', firstName: 'Tara', lastName: 'A' },
      { id: 'therapist-b', userId: 'uid-tb', firstName: 'Theo', lastName: 'B' },
    ],
    profileClient: [
      { id: 'client-a', userId: 'uid-ca', firstName: 'Cara', lastName: 'A', diagnosis: [] },
      { id: 'client-b', userId: 'uid-cb', firstName: 'Cody', lastName: 'B', diagnosis: [] },
      { id: 'client-x', userId: 'uid-cx', firstName: 'Cleo', lastName: 'X', diagnosis: [] },
    ],
    session: [
      { id: 's-a', therapistId: 'therapist-a', clientId: 'client-a', status: 'SCHEDULED', scheduledAt: FUTURE, confirmedByPatient: false, startedAt: null, endedAt: null },
      { id: 's-b', therapistId: 'therapist-b', clientId: 'client-b', status: 'SCHEDULED', scheduledAt: FUTURE, confirmedByPatient: false, startedAt: null, endedAt: null },
      { id: 's-shared', therapistId: 'therapist-b', clientId: 'client-a', status: 'COMPLETED', scheduledAt: PAST, confirmedByPatient: true, startedAt: PAST, endedAt: PAST },
    ],
    booking: [
      { id: 'bk-a', therapistId: 'therapist-a', clientId: 'client-a', dateTime: FUTURE, duration: 50 },
      { id: 'bk-b', therapistId: 'therapist-b', clientId: 'client-b', dateTime: FUTURE, duration: 50 },
    ],
    therapistNote: [
      { id: 'n-a', sessionId: 's-a', therapistId: 'therapist-a', content: 'note A', isPrivate: true, createdAt: PAST },
      { id: 'n-b', sessionId: 's-b', therapistId: 'therapist-b', content: 'note B', isPrivate: true, createdAt: PAST },
    ],
    sessionReport: [
      { id: 'rep-a', sessionId: 's-a', therapistId: 'therapist-a', clientId: 'client-a', content: 'report A' },
      { id: 'rep-b', sessionId: 's-b', therapistId: 'therapist-b', clientId: 'client-b', content: 'report B' },
    ],
    progressMetric: [
      { id: 'm-a', clientId: 'client-a', therapistId: 'therapist-a', metricType: 'MOOD_SCORE', value: 7, recordedAt: PAST },
      { id: 'm-b', clientId: 'client-b', therapistId: 'therapist-b', metricType: 'MOOD_SCORE', value: 3, recordedAt: PAST },
      { id: 'm-shared', clientId: 'client-a', therapistId: 'therapist-b', metricType: 'MOOD_SCORE', value: 1, recordedAt: PAST },
    ],
    progressReport: [
      { id: 'pr-a', clientId: 'client-a', therapistId: 'therapist-a', title: 'A', createdAt: PAST },
      { id: 'pr-b', clientId: 'client-b', therapistId: 'therapist-b', title: 'B', createdAt: PAST },
    ],
    progressNote: [
      { id: 'pn-a', clientId: 'client-a', therapistId: 'therapist-a', reportId: null, content: 'pn A', createdAt: PAST },
      { id: 'pn-b', clientId: 'client-b', therapistId: 'therapist-b', reportId: null, content: 'pn B', createdAt: PAST },
    ],
    usageEvent: [],
  }
}

// relation name → how to join it
const RELATIONS: Record<string, Record<string, { table: string; local: string; foreign: string; many?: boolean }>> = {
  user: {
    therapist: { table: 'profileTherapist', local: 'id', foreign: 'userId' },
    client: { table: 'profileClient', local: 'id', foreign: 'userId' },
  },
  profileTherapist: { user: { table: 'user', local: 'userId', foreign: 'id' } },
  profileClient: { user: { table: 'user', local: 'userId', foreign: 'id' } },
  session: {
    client: { table: 'profileClient', local: 'clientId', foreign: 'id' },
    therapist: { table: 'profileTherapist', local: 'therapistId', foreign: 'id' },
    report: { table: 'sessionReport', local: 'id', foreign: 'sessionId' },
    notes: { table: 'therapistNote', local: 'id', foreign: 'sessionId', many: true },
  },
  booking: {
    client: { table: 'profileClient', local: 'clientId', foreign: 'id' },
    therapist: { table: 'profileTherapist', local: 'therapistId', foreign: 'id' },
  },
  progressReport: {
    progressNotes: { table: 'progressNote', local: 'id', foreign: 'reportId', many: true },
  },
}

let db = fixture()
let seq = 0

/** Restore the fixture. Call in beforeEach. */
export function resetDb() {
  db = fixture()
  seq = 0
}

/** Direct read access to the in-memory tables, for assertions. */
export function table(name: string): Row[] {
  return db[name]
}

const same = (a: any, b: any) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      if ('in' in v) return (v.in as any[]).some((x) => same(x, row[k]))
      if ('gte' in v || 'lte' in v) {
        return (v.gte === undefined || row[k] >= v.gte) && (v.lte === undefined || row[k] <= v.lte)
      }
      return false
    }
    return same(row[k], v)
  })
}

function related(tableName: string, row: Row, rel: string): Row | Row[] | null {
  const r = RELATIONS[tableName]?.[rel]
  if (!r) throw new Error(`fakePrisma: no relation ${tableName}.${rel}`)
  const hits = db[r.table].filter((x) => same(x[r.foreign], row[r.local]))
  return r.many ? hits : hits[0] ?? null
}

function shape(tableName: string, row: Row, args: Row = {}): Row {
  if (args.select) {
    const out: Row = {}
    for (const [k, v] of Object.entries(args.select)) {
      if (!v) continue
      out[k] = RELATIONS[tableName]?.[k] ? project(tableName, row, k, v) : row[k]
    }
    return out
  }
  const out: Row = { ...row }
  for (const [k, v] of Object.entries(args.include ?? {})) {
    if (!v) continue
    if (k === '_count') {
      out._count = {}
      for (const rel of Object.keys((v as Row).select ?? {})) {
        out._count[rel] = (related(tableName, row, rel) as Row[]).length
      }
    } else {
      out[k] = project(tableName, row, k, v)
    }
  }
  return out
}

function project(tableName: string, row: Row, rel: string, spec: any) {
  const target = RELATIONS[tableName][rel].table
  const value = related(tableName, row, rel)
  const opts = spec === true ? {} : spec
  if (Array.isArray(value)) return value.map((x) => shape(target, x, opts))
  return value ? shape(target, value, opts) : null
}

function model(name: string) {
  const rows = () => db[name]
  const find = (args: Row = {}) => {
    let out = rows().filter((r) => matches(r, args.where))
    if (args.orderBy) {
      const [[k, dir]] = Object.entries(args.orderBy as Row)
      out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === 'desc' ? -1 : 1))
    }
    if (args.distinct) {
      const seen = new Set<string>()
      out = out.filter((r) => {
        const key = (args.distinct as string[]).map((k) => String(r[k])).join('|')
        return seen.has(key) ? false : (seen.add(key), true)
      })
    }
    if (args.take) out = out.slice(0, args.take)
    return out
  }
  return {
    findUnique: async (args: Row) => {
      const r = find(args)[0]
      return r ? shape(name, r, args) : null
    },
    findFirst: async (args: Row = {}) => {
      const r = find(args)[0]
      return r ? shape(name, r, args) : null
    },
    findMany: async (args: Row = {}) => find(args).map((r) => shape(name, r, args)),
    count: async (args: Row = {}) => find(args).length,
    create: async (args: Row) => {
      const row = { id: `${name}-new-${++seq}`, createdAt: new Date(), ...args.data }
      rows().push(row)
      return shape(name, row, args)
    },
    update: async (args: Row) => {
      const r = find(args)[0]
      if (!r) throw new Error(`fakePrisma: ${name} to update not found`)
      Object.assign(r, args.data)
      return shape(name, r, args)
    },
    upsert: async (args: Row) => {
      const r = find(args)[0]
      if (r) {
        Object.assign(r, args.update)
        return shape(name, r, args)
      }
      const row = { id: `${name}-new-${++seq}`, ...args.create }
      rows().push(row)
      return shape(name, row, args)
    },
    delete: async (args: Row) => {
      const r = find(args)[0]
      if (!r) throw new Error(`fakePrisma: ${name} to delete not found`)
      db[name] = rows().filter((x) => x !== r)
      return r
    },
  }
}

export const prisma = new Proxy({} as Record<string, ReturnType<typeof model>>, {
  get: (_t, prop: string) => {
    if (!(prop in db)) throw new Error(`fakePrisma: unknown model ${prop}`)
    return model(prop)
  },
})
