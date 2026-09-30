'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Clock,
  FileText,
  ListFilter,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Video,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import SessionReportView from '@/components/report/SessionReportView';
import type { ReportStats } from '@/lib/report/stats';
import { progressFetch } from '@/lib/progressApi';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { useSessionActions } from '@/components/practice/useSessionActions';
import {
  Avatar,
  Card,
  Drawer,
  Dropdown,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Menu,
  MiniBars,
  PageHeader,
  ProgressRing,
  SearchInput,
  SectionTitle,
  StatCard,
  StatusPill,
  Tag,
  cx,
  toast,
} from '@/components/practice/ui';
import {
  SESSION_KIND,
  STATE_META,
  TONES,
  byStartAsc,
  fmtDayTime,
  fmtListDate,
  fmtRelative,
  fmtSessionNo,
  fullName,
  sessionClientId,
  sessionDuration,
  sessionNumbers,
  sessionState,
  weeklyCounts,
  type PracticeSession,
  type SessionState,
} from '@/lib/practice';

type Tab = 'all' | 'upcoming' | 'past' | 'active';
type Sort = 'recent' | 'oldest' | 'client';
type Range = 'month' | '30d' | 'all';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'active', label: 'Active' },
];

const STATUS_FILTERS: SessionState[] = ['upcoming', 'live', 'completed', 'notes-pending', 'missed', 'cancelled'];
const PAGE = 10;

interface ReportData {
  content: string;
  model?: string | null;
  editedByTherapist?: boolean;
  generatedAt?: string;
}

const inTab = (tab: Tab, st: SessionState) =>
  tab === 'all' ||
  (tab === 'upcoming' && st === 'upcoming') ||
  (tab === 'active' && st === 'live') ||
  (tab === 'past' && (st === 'completed' || st === 'notes-pending' || st === 'missed' || st === 'cancelled'));

function Donut({ parts, size = 132, stroke = 16, children }: { parts: { value: number; color: string }[]; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.value, 0);
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ds-border)" strokeWidth={stroke} />
        {total > 0 &&
          parts.map((p, i) => {
            const len = (c * p.value) / total;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export default function SessionsPage() {
  useTherapistGuard();
  const { role, profile, sessions, bookings, clients, loading, error, refresh } = usePracticeData();
  const now = useNow();
  const actions = useSessionActions(refresh);

  const [tab, setTab] = useState<Tab>('all');
  const [clientFilter, setClientFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [statuses, setStatuses] = useState<SessionState[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [range, setRange] = useState<Range>('month');

  // Report drawer
  const [reportFor, setReportFor] = useState<PracticeSession | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportStats, setReportStats] = useState<ReportStats | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingReport, setSavingReport] = useState(false);

  // Deep links: ?clientId= (from Clients) and ?view=notes-pending (from stat cards).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const cid = p.get('clientId');
    if (cid) setClientFilter(cid);
    if (p.get('view') === 'notes-pending') setStatuses(['notes-pending']);
  }, []);

  useEffect(() => setShown(PAGE), [tab, clientFilter, search, sort, statuses]);

  const numbers = useMemo(() => sessionNumbers(sessions), [sessions]);
  const durationOf = (s: PracticeSession) => sessionDuration(s, bookings);
  const stateOf = (s: PracticeSession) => sessionState(s, now, durationOf(s));

  const scoped = sessions.filter((s) => !clientFilter || sessionClientId(s) === clientFilter);
  const q = search.trim().toLowerCase();
  const filtered = scoped
    .filter((s) => inTab(tab, stateOf(s)))
    .filter((s) => statuses.length === 0 || statuses.includes(stateOf(s)))
    .filter((s) => !q || [fullName(s.client), ...(s.client?.diagnosis ?? []), STATE_META[stateOf(s)].label].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) =>
      sort === 'oldest' ? byStartAsc(a, b) : sort === 'client' ? fullName(a.client).localeCompare(fullName(b.client)) || byStartAsc(b, a) : byStartAsc(b, a)
    );
  const visible = filtered.slice(0, shown);

  // Stats (respect the client filter)
  const states = scoped.map(stateOf);
  const completedCount = states.filter((s) => s === 'completed' || s === 'notes-pending').length;
  const dueCount = states.filter((s) => s !== 'upcoming' && s !== 'live').length;
  const completionRate = dueCount ? completedCount / dueCount : 0;
  const upcomingCount = states.filter((s) => s === 'upcoming').length;
  const pendingCount = states.filter((s) => s === 'notes-pending').length;

  // Insights for the chosen range
  const rangeStart = range === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : range === '30d' ? new Date(now.getTime() - 30 * 86_400_000) : null;
  const inRange = scoped.filter((s) => !rangeStart || new Date(s.scheduledAt) >= rangeStart).map(stateOf);
  const insight = {
    completed: inRange.filter((s) => s === 'completed').length,
    upcoming: inRange.filter((s) => s === 'upcoming' || s === 'live').length,
    pending: inRange.filter((s) => s === 'notes-pending' || s === 'missed').length,
    cancelled: inRange.filter((s) => s === 'cancelled').length,
  };
  const insightTotal = insight.completed + insight.upcoming + insight.pending + insight.cancelled;

  const next = scoped.filter((s) => ['upcoming', 'live'].includes(stateOf(s))).sort(byStartAsc)[0];

  /* ---------- report drawer ---------- */

  const generateReport = async (sessionId: string) => {
    setGenerating(true);
    try {
      const d = await progressFetch('/api/session-report', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      setReport(d.report);
      setReportStats(d.stats ?? null);
      setEditing(false);
      refresh();
    } catch {
      toast('Could not generate the report. Please try again.', 'error');
    }
    setGenerating(false);
  };

  const openReport = async (s: PracticeSession) => {
    setReportFor(s);
    setEditing(false);
    setReport(null);
    setReportStats(null);
    setReportLoading(true);
    try {
      const res = await fetch(`/api/session-report?sessionId=${s.id}`);
      if (res.ok) {
        const d = await res.json();
        if (d.report) {
          setReport(d.report);
          setReportStats((d.stats as ReportStats) ?? null);
        } else {
          await generateReport(s.id); // none yet → generate on first view
        }
      }
    } catch {
      toast('Could not load the report.', 'error');
    }
    setReportLoading(false);
  };

  const saveReport = async () => {
    if (!reportFor) return;
    setSavingReport(true);
    try {
      const d = await progressFetch('/api/session-report', {
        method: 'PATCH',
        body: JSON.stringify({ sessionId: reportFor.id, content: draft }),
      });
      setReport(d.report);
      setEditing(false);
      toast('Report saved');
    } catch {
      toast('Could not save the report.', 'error');
    }
    setSavingReport(false);
  };

  const clientName = (id: string) => fullName(clients.find((c) => c.id === id));

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Sessions"
          subtitle={
            <>
              <span className="block text-[15px]" style={{ color: 'var(--ds-ink)' }}>
                {scoped.length} session{scoped.length === 1 ? '' : 's'}
                {clientFilter && ` with ${clientName(clientFilter) || 'this client'}`}
              </span>
              Track therapy sessions, notes and follow-ups.
            </>
          }
          actions={
            <select
              aria-label="Filter by client"
              className="ds-input"
              style={{ width: 260 }}
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          }
        />

        <div role="tablist" aria-label="Session views" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={cx('ds-pill-tab', tab === t.key && 'is-active')} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {error && <ErrorBanner message={error} onRetry={refresh} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          <StatCard
            icon={CalendarDays}
            tone="green"
            label="Total Sessions"
            value={scoped.length}
            hint="Across all clients"
            onClick={() => {
              setTab('all');
              setStatuses([]);
            }}
            visual={<MiniBars values={weeklyCounts(scoped, 6, now)} label="Sessions per week over the last 6 weeks" />}
          />
          <StatCard
            icon={CircleCheck}
            tone="green"
            label="Completed"
            value={completedCount}
            hint={`${Math.round(completionRate * 100)}% completion rate`}
            onClick={() => {
              setTab('past');
              setStatuses(['completed', 'notes-pending']);
            }}
            visual={
              <ProgressRing value={completionRate} label="Completion rate">
                {Math.round(completionRate * 100)}%
              </ProgressRing>
            }
          />
          <StatCard
            icon={Clock}
            label="Upcoming"
            value={upcomingCount}
            hint="Scheduled sessions"
            onClick={() => {
              setTab('upcoming');
              setStatuses([]);
            }}
            visual={<MiniBars values={weeklyCounts(scoped, 6, now)} color="var(--ds-clay)" label="Sessions per week" />}
          />
          <StatCard
            icon={FileText}
            tone="red"
            label="Notes Pending"
            value={pendingCount}
            hint={pendingCount ? 'Need your attention' : 'All documented'}
            highlight={pendingCount > 0}
            onClick={() => {
              setTab('all');
              setStatuses(['notes-pending']);
            }}
            visual={
              <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--ds-surface)', color: 'var(--ds-red)' }}>
                <ChevronRight className="h-4 w-4" />
              </span>
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          {/* List */}
          <Card className="min-w-0 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="ds-title text-[23px]">
                {statuses.length === 1 ? STATE_META[statuses[0]].label : 'All Sessions'} ({filtered.length})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput value={search} onChange={setSearch} placeholder="Search sessions or clients…" className="w-full sm:w-[240px]" />
                <label htmlFor="session-sort" className="ds-muted text-[13px]">
                  Sort by
                </label>
                <select id="session-sort" className="ds-input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="recent">Most Recent</option>
                  <option value="oldest">Oldest First</option>
                  <option value="client">Client (A–Z)</option>
                </select>
                <Dropdown
                  width={230}
                  trigger={({ open, toggle }) => (
                    <button
                      className="ds-icon-btn"
                      style={{ border: '1px solid var(--ds-border-strong)', width: 42, height: 42, ...(statuses.length ? { background: 'var(--ds-clay-soft)', color: 'var(--ds-clay-ink)' } : {}) }}
                      aria-label="Filter by status"
                      aria-expanded={open}
                      onClick={toggle}
                    >
                      <ListFilter className="h-[18px] w-[18px]" />
                    </button>
                  )}
                >
                  {() => (
                    <div className="p-1.5">
                      <p className="ds-muted px-1 pb-2 text-[12px] font-semibold uppercase tracking-wide">Status</p>
                      {STATUS_FILTERS.map((st) => (
                        <label key={st} className="ds-menu-item cursor-pointer">
                          <input
                            type="checkbox"
                            checked={statuses.includes(st)}
                            onChange={() => setStatuses((prev) => (prev.includes(st) ? prev.filter((x) => x !== st) : [...prev, st]))}
                            style={{ accentColor: 'var(--ds-clay)' }}
                          />
                          {STATE_META[st].label}
                        </label>
                      ))}
                      {statuses.length > 0 && (
                        <button className="ds-btn ds-btn-sm ds-btn-ghost mt-1 w-full" onClick={() => setStatuses([])}>
                          Clear filter
                        </button>
                      )}
                    </div>
                  )}
                </Dropdown>
              </div>
            </div>

            <div className="mt-4">
              {loading ? (
                <LoadingBlock label="Loading sessions…" />
              ) : filtered.length === 0 ? (
                <EmptyState
                  compact
                  title={sessions.length === 0 ? 'No sessions yet' : 'No sessions match'}
                  body={sessions.length === 0 ? 'Book a session from the Schedule page and it will appear here.' : 'Try a different tab, client or status filter.'}
                >
                  {sessions.length === 0 ? (
                    <Link href="/schedule" className="ds-btn ds-btn-clay">
                      Go to Schedule
                    </Link>
                  ) : (
                    <button
                      className="ds-btn ds-btn-outline"
                      onClick={() => {
                        setTab('all');
                        setStatuses([]);
                        setSearch('');
                        setClientFilter('');
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                </EmptyState>
              ) : (
                <ul className="space-y-2.5">
                  {visible.map((s) => {
                    const st = stateOf(s);
                    const actionsEl = (
                      <>
                        {s.status !== 'CANCELLED' && (
                          <button className="ds-btn ds-btn-sm ds-btn-outline" onClick={() => actions.openNotes(s)}>
                            {s.status === 'COMPLETED' ? 'View Notes' : 'Notes'}
                          </button>
                        )}
                        {s.status === 'COMPLETED' && (
                          <button className="ds-btn ds-btn-sm ds-btn-clay" onClick={() => openReport(s)}>
                            <Sparkles /> Report
                          </button>
                        )}
                        {(st === 'upcoming' || st === 'live') && (
                          <button className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => actions.enter(s)}>
                            <Play /> {st === 'live' ? 'Join' : 'Start'}
                          </button>
                        )}
                        {(st === 'missed' || st === 'cancelled') && (
                          <button className="ds-btn ds-btn-sm ds-btn-clay-outline" onClick={() => actions.openReschedule(s)}>
                            <CalendarClock /> Reschedule
                          </button>
                        )}
                      </>
                    );
                    return (
                      <li
                        key={s.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 py-3 sm:px-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.1fr)_150px_auto_auto]"
                        style={{ border: '1px solid var(--ds-border)' }}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar first={s.client?.firstName} last={s.client?.lastName} size={46} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-[15px] font-semibold">{fullName(s.client)}</p>
                              {s.client?.diagnosis?.[0] && <Tag label={s.client.diagnosis[0]} />}
                            </div>
                            <p className="ds-muted text-[12.5px]">{fmtListDate(s.scheduledAt)}</p>
                          </div>
                        </div>
                        <div className="ds-muted hidden min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[13px] md:flex">
                          <Video className="h-4 w-4 shrink-0" /> {SESSION_KIND}
                          {numbers.get(s.id) && (
                            <>
                              <span aria-hidden>|</span> {fmtSessionNo(numbers.get(s.id))}
                            </>
                          )}
                        </div>
                        <div className="hidden md:block">
                          <StatusPill state={st} />
                        </div>
                        <div className="hidden items-center justify-end gap-2 md:flex">{actionsEl}</div>
                        <Menu items={actions.menuFor(s, st, durationOf(s))} label={`More actions for ${fullName(s.client)}'s session`} />
                        <div className="col-span-2 flex flex-wrap items-center gap-2 md:hidden">
                          <StatusPill state={st} />
                          <span className="flex-1" />
                          {actionsEl}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {visible.length < filtered.length && (
                <div className="flex justify-center pt-4">
                  <button className="ds-btn ds-btn-outline" onClick={() => setShown((n) => n + PAGE)}>
                    Load more ({filtered.length - visible.length} remaining)
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* Side */}
          <div className="space-y-6">
            <Card className="p-5" style={{ background: 'linear-gradient(140deg, var(--ds-forest-soft) 0%, var(--ds-surface) 75%)' }}>
              <SectionTitle
                title="Next Session"
                action={
                  <Link href="/schedule" className="ds-btn ds-btn-sm ds-btn-ghost">
                    View Schedule <ChevronRight />
                  </Link>
                }
              />
              {next ? (
                <>
                  <div className="mt-4 flex items-center gap-4">
                    <Avatar first={next.client?.firstName} last={next.client?.lastName} size={64} />
                    <div className="min-w-0">
                      <p className="ds-title truncate text-[22px]">{fullName(next.client)}</p>
                      {next.client?.diagnosis?.[0] && <Tag label={next.client.diagnosis[0]} />}
                    </div>
                  </div>
                  <div className="ds-muted mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4" /> {fmtDayTime(next.scheduledAt, now)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-4 w-4" /> {stateOf(next) === 'live' ? 'Live now' : fmtRelative(next.scheduledAt, now, durationOf(next))}
                    </span>
                    {numbers.get(next.id) && (
                      <span className="inline-flex items-center gap-1.5">
                        <FileText className="h-4 w-4" /> {fmtSessionNo(numbers.get(next.id))}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button className="ds-btn ds-btn-outline" onClick={() => actions.viewClient(sessionClientId(next))}>
                      View Client
                    </button>
                    <button className="ds-btn ds-btn-primary" onClick={() => actions.enter(next)}>
                      <Play /> {stateOf(next) === 'live' ? 'Join' : 'Start Session'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="ds-muted mt-3 text-[13.5px]">No upcoming sessions. Book one from the Schedule page.</p>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="ds-title text-[22px]">Session Insights</h2>
                <select aria-label="Insights period" className="ds-input" style={{ width: 'auto', paddingTop: '0.45rem', paddingBottom: '0.45rem' }} value={range} onChange={(e) => setRange(e.target.value as Range)}>
                  <option value="month">This Month</option>
                  <option value="30d">Last 30 days</option>
                  <option value="all">All time</option>
                </select>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-6">
                <Donut
                  parts={[
                    { value: insight.completed, color: TONES.green.fg },
                    { value: insight.upcoming, color: TONES.amber.fg },
                    { value: insight.pending, color: TONES.red.fg },
                    { value: insight.cancelled, color: 'var(--ds-border-strong)' },
                  ]}
                >
                  <span className="ds-title text-[24px] leading-none">{insightTotal ? Math.round((insight.completed / insightTotal) * 100) : 0}%</span>
                  <span className="ds-muted mt-1 text-[11.5px]">Completed</span>
                </Donut>
                <ul className="min-w-[150px] flex-1 space-y-2.5 text-[13px]">
                  {[
                    { label: 'Completed', value: insight.completed, color: TONES.green.fg, filter: ['completed'] as SessionState[] },
                    { label: 'Upcoming', value: insight.upcoming, color: TONES.amber.fg, filter: ['upcoming', 'live'] as SessionState[] },
                    { label: 'Needs follow-up', value: insight.pending, color: TONES.red.fg, filter: ['notes-pending', 'missed'] as SessionState[] },
                    { label: 'Cancelled', value: insight.cancelled, color: 'var(--ds-border-strong)', filter: ['cancelled'] as SessionState[] },
                  ].map((row) => (
                    <li key={row.label}>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-[var(--ds-surface-2)]"
                        onClick={() => {
                          setTab('all');
                          setStatuses(row.filter);
                        }}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                        <span className="flex-1">{row.label}</span>
                        <span className="font-semibold">{row.value}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            <Link href="/schedule" className="ds-card ds-card-hover flex items-center gap-3 p-4">
              <ClipboardList className="h-5 w-5" style={{ color: 'var(--ds-clay)' }} />
              <span className="flex-1 text-[14px] font-medium">Book a new session</span>
              <ChevronRight className="h-4 w-4" style={{ color: 'var(--ds-muted)' }} />
            </Link>
          </div>
        </div>
      </div>

      {actions.dialogs}

      {/* Report drawer */}
      <Drawer
        open={!!reportFor}
        onClose={() => setReportFor(null)}
        title="Session report"
        subtitle={reportFor ? `${fullName(reportFor.client)} · ${fmtDayTime(reportFor.scheduledAt)}` : undefined}
        wide
      >
        {reportLoading || generating ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: 'var(--ds-clay)' }} />
            <p className="ds-muted text-[13.5px]">{generating ? 'Generating report…' : 'Loading…'}</p>
          </div>
        ) : !report ? (
          <EmptyState compact title="No report yet" body="Generate an AI draft from the session transcript and notes.">
            {reportFor && (
              <button className="ds-btn ds-btn-clay" onClick={() => generateReport(reportFor.id)}>
                <Sparkles /> Generate report
              </button>
            )}
          </EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="ds-muted text-[12px]">
                {report.editedByTherapist ? 'Edited by therapist' : 'AI-generated draft'}
                {report.model ? ` · ${report.model}` : ''}
              </span>
              {!editing && reportFor && (
                <div className="flex gap-2">
                  <button className="ds-btn ds-btn-sm ds-btn-outline" onClick={() => generateReport(reportFor.id)}>
                    <RefreshCw /> Regenerate
                  </button>
                  <button
                    className="ds-btn ds-btn-sm ds-btn-clay"
                    onClick={() => {
                      setDraft(report.content);
                      setEditing(true);
                    }}
                  >
                    <Pencil /> Edit
                  </button>
                </div>
              )}
            </div>
            {editing ? (
              <>
                <textarea
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  className="ds-input leading-relaxed"
                  style={{ minHeight: '60vh', resize: 'vertical' }}
                  aria-label="Report content"
                />
                <div className="flex justify-end gap-2">
                  <button className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                  <button className="ds-btn ds-btn-sm ds-btn-clay" onClick={saveReport} disabled={savingReport}>
                    {savingReport ? <Loader2 className="animate-spin" /> : <Save />} Save
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-2xl p-5" style={{ background: '#ffffff', border: '1px solid var(--ds-border)' }}>
                <SessionReportView
                  content={report.content}
                  stats={reportStats}
                  meta={{
                    clientName: fullName(reportFor?.client) || undefined,
                    dateLabel: new Date(report.generatedAt || reportFor?.scheduledAt || Date.now()).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }),
                    statusLabel: report.editedByTherapist ? 'Edited by therapist' : 'AI-generated draft',
                  }}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>
    </DashboardLayout>
  );
}
