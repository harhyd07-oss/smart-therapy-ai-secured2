import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/test-utils/fakeAuth'
import { resetDb, table } from '@/test-utils/fakePrisma'

vi.mock('@/lib/firebaseAdmin', () => import('@/test-utils/fakeAuth'))
vi.mock('@/lib/db', () => import('@/test-utils/fakePrisma'))

import * as apiMetrics from '../metrics/route'
import * as apiMetric from '../metrics/[id]/route'
import * as apiNotes from '../notes/route'
import * as apiReports from '../reports/route'
import * as dupMetrics from '@/app/progress/metrics/route'
import * as dupMetric from '@/app/progress/metrics/[id]/route'
import * as dupNotes from '@/app/progress/notes/route'
import * as dupReports from '@/app/progress/reports/route'

beforeEach(() => resetDb())

describe('/progress/* duplicates delegate to /api/progress/*', () => {
  it('export the very same handlers (one copy of the auth logic)', () => {
    expect(dupMetrics.GET).toBe(apiMetrics.GET)
    expect(dupMetrics.POST).toBe(apiMetrics.POST)
    expect(dupMetric.PATCH).toBe(apiMetric.PATCH)
    expect(dupMetric.DELETE).toBe(apiMetric.DELETE)
    expect(dupNotes.GET).toBe(apiNotes.GET)
    expect(dupNotes.POST).toBe(apiNotes.POST)
    expect(dupReports.GET).toBe(apiReports.GET)
    expect(dupReports.POST).toBe(apiReports.POST)
  })

  it('keep their own force-dynamic segment config', () => {
    for (const m of [dupMetrics, dupMetric, dupNotes, dupReports]) expect(m.dynamic).toBe('force-dynamic')
  })
})

// Every behaviour below is asserted on BOTH mount points.
describe.each([
  { base: '/api/progress', metrics: apiMetrics, metric: apiMetric, notes: apiNotes, reports: apiReports },
  { base: '/progress', metrics: dupMetrics, metric: dupMetric, notes: dupNotes, reports: dupReports },
])('$base/*', ({ base, metrics, metric, notes, reports }) => {
  const byId = (method: 'PATCH' | 'DELETE', id: string, as?: string, body?: unknown) =>
    (method === 'PATCH' ? metric.PATCH : metric.DELETE)(
      apiRequest(`${base}/metrics/${id}`, { method, body, as }),
      { params: { id } }
    )

  it('401 without a token', async () => {
    expect((await metrics.GET(apiRequest(`${base}/metrics?clientId=client-a`))).status).toBe(401)
    expect((await notes.GET(apiRequest(`${base}/notes?clientId=client-a`))).status).toBe(401)
    expect((await reports.GET(apiRequest(`${base}/reports?clientId=client-a`))).status).toBe(401)
  })

  it('own client: reads only the caller\'s own rows, not another therapist\'s about the same child', async () => {
    const res = await metrics.GET(apiRequest(`${base}/metrics?clientId=client-a`, { as: 'uid-ta' }))
    expect(res.status).toBe(200)
    expect((await res.json()).metrics.map((m: { id: string }) => m.id)).toEqual(['m-a'])
  })

  it('404 reading another therapist\'s client (metrics / notes / reports)', async () => {
    expect((await metrics.GET(apiRequest(`${base}/metrics?clientId=client-b`, { as: 'uid-ta' }))).status).toBe(404)
    expect((await notes.GET(apiRequest(`${base}/notes?clientId=client-b`, { as: 'uid-ta' }))).status).toBe(404)
    expect((await reports.GET(apiRequest(`${base}/reports?clientId=client-b`, { as: 'uid-ta' }))).status).toBe(404)
  })

  it('404 writing about another therapist\'s client — nothing stored', async () => {
    const m = await metrics.POST(
      apiRequest(`${base}/metrics`, { method: 'POST', body: { clientId: 'client-b', metricType: 'MOOD_SCORE', value: 5 }, as: 'uid-ta' })
    )
    const n = await notes.POST(apiRequest(`${base}/notes`, { method: 'POST', body: { clientId: 'client-b', content: 'x' }, as: 'uid-ta' }))
    const r = await reports.POST(
      apiRequest(`${base}/reports`, {
        method: 'POST',
        body: { clientId: 'client-b', periodStart: '2026-01-01', periodEnd: '2026-12-31', summary: 's' },
        as: 'uid-ta',
      })
    )
    expect([m.status, n.status, r.status]).toEqual([404, 404, 404])
    expect(table('progressMetric')).toHaveLength(3)
    expect(table('progressNote')).toHaveLength(2)
    expect(table('progressReport')).toHaveLength(2)
  })

  it('own client: writes succeed and are attributed to the caller, not a spoofed body therapistId', async () => {
    const res = await metrics.POST(
      apiRequest(`${base}/metrics`, {
        method: 'POST',
        body: { clientId: 'client-a', therapistId: 'therapist-b', metricType: 'MOOD_SCORE', value: 6, sessionId: 's-a' },
        as: 'uid-ta',
      })
    )
    expect(res.status).toBe(201)
    expect((await res.json()).metric.therapistId).toBe('therapist-a')
  })

  it('404 linking a metric to another therapist\'s session', async () => {
    const res = await metrics.POST(
      apiRequest(`${base}/metrics`, {
        method: 'POST',
        body: { clientId: 'client-a', metricType: 'MOOD_SCORE', value: 6, sessionId: 's-shared' },
        as: 'uid-ta',
      })
    )
    expect(res.status).toBe(404)
  })

  it('404 attaching a note to another therapist\'s report', async () => {
    const res = await notes.POST(
      apiRequest(`${base}/notes`, { method: 'POST', body: { clientId: 'client-a', content: 'x', reportId: 'pr-b' }, as: 'uid-ta' })
    )
    expect(res.status).toBe(404)
  })

  it('404 (not 403) editing or deleting another therapist\'s metric — unchanged', async () => {
    expect((await byId('PATCH', 'm-b', 'uid-ta', { value: 10 })).status).toBe(404)
    expect((await byId('DELETE', 'm-b', 'uid-ta')).status).toBe(404)
    expect(table('progressMetric').find((m) => m.id === 'm-b')!.value).toBe(3)
  })

  it('own metric can be edited and deleted', async () => {
    expect((await byId('PATCH', 'm-a', 'uid-ta', { value: 9 })).status).toBe(200)
    expect((await byId('DELETE', 'm-a', 'uid-ta')).status).toBe(200)
  })

  it('403 for a client (therapist-only)', async () => {
    expect((await metrics.GET(apiRequest(`${base}/metrics?clientId=client-a`, { as: 'uid-ca' }))).status).toBe(403)
  })
})
