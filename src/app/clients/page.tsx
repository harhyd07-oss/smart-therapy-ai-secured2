'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  Download,
  FileText,
  LayoutGrid,
  List,
  ListFilter,
  Mail,
  MessageCircle,
  Play,
  Plus,
  TrendingUp,
  User,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import {
  Avatar,
  Card,
  Dropdown,
  EmptyState,
  ErrorBanner,
  IconBubble,
  LoadingBlock,
  Menu,
  MiniBars,
  PageHeader,
  ProgressRing,
  SearchInput,
  StatCard,
  Tag,
  cx,
  toast,
  type MenuItem,
} from '@/components/practice/ui';
import { AddClientDialog, BookSessionDialog, StartSessionDialog } from '@/components/practice/dialogs';
import { whatsAppLink } from '@/lib/phone';
import {
  CLIENT_STATUS_META,
  SESSION_KIND,
  TONES,
  byStartAsc,
  clientStatus,
  countdown,
  downloadFile,
  fmtDate,
  fmtDayTime,
  fmtSessionNo,
  fullName,
  isSameDay,
  newClientsSince,
  nextSessionFor,
  sessionDuration,
  sessionNumbers,
  sessionRoomUrl,
  sessionState,
  toCsv,
  weeklyCounts,
  type ClientStatus,
  type PracticeClient,
  type PracticeSession,
} from '@/lib/practice';

type Tab = 'all' | 'active' | 'upcoming' | 'attention';
type Sort = 'next' | 'name' | 'last' | 'sessions';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All Clients' },
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'attention', label: 'Needs Attention' },
];

const PAGE_SIZE = 8;

interface Row {
  c: PracticeClient;
  status: ClientStatus;
  next?: PracticeSession;
}

const inTab = (tab: Tab, status: ClientStatus) =>
  tab === 'all' ||
  (tab === 'active' && status !== 'follow-up') ||
  (tab === 'upcoming' && status === 'upcoming') ||
  (tab === 'attention' && status === 'follow-up');

export default function ClientsPage() {
  useTherapistGuard();
  const { role, profile, sessions, bookings, clients, invites, loading, error, refresh } = usePracticeData();
  const router = useRouter();
  const now = useNow();

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('next');
  const [conditions, setConditions] = useState<string[]>([]);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [book, setBook] = useState<{ open: boolean; clientId?: string }>({ open: false });
  const [start, setStart] = useState<{ open: boolean; clientId?: string }>({ open: false });

  useEffect(() => setPage(1), [tab, search, sort, conditions]);

  const numbers = useMemo(() => sessionNumbers(sessions), [sessions]);

  const rows: Row[] = useMemo(
    () => clients.map((c) => ({ c, status: clientStatus(c, sessions, bookings, now), next: nextSessionFor(c.id, sessions, now) })),
    [clients, sessions, bookings, now]
  );

  const counts: Record<Tab, number> = {
    all: rows.length,
    active: rows.filter((r) => inTab('active', r.status)).length,
    upcoming: rows.filter((r) => inTab('upcoming', r.status)).length,
    attention: rows.filter((r) => inTab('attention', r.status)).length,
  };

  const allConditions = useMemo(
    () => Array.from(new Set(clients.flatMap((c) => c.diagnosis))).sort((a, b) => a.localeCompare(b)),
    [clients]
  );

  const q = search.trim().toLowerCase();
  const nextT = (r: Row) => (r.next ? new Date(r.next.scheduledAt).getTime() : Infinity);
  const lastT = (r: Row) => (r.c.lastSession ? new Date(r.c.lastSession).getTime() : -Infinity);
  const filtered = rows
    .filter((r) => inTab(tab, r.status))
    .filter((r) => !q || [fullName(r.c), r.c.user?.email ?? '', ...r.c.diagnosis].some((v) => v.toLowerCase().includes(q)))
    .filter((r) => conditions.length === 0 || r.c.diagnosis.some((d) => conditions.includes(d)))
    .sort((a, b) => {
      if (sort === 'name') return fullName(a.c).localeCompare(fullName(b.c));
      if (sort === 'last') return lastT(b) - lastT(a);
      if (sort === 'sessions') return (b.c.sessionCount ?? 0) - (a.c.sessionCount ?? 0);
      return nextT(a) - nextT(b) || fullName(a.c).localeCompare(fullName(b.c));
    });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Stats
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newThisMonth = newClientsSince(clients, sessions, monthStart);
  const upcomingSessions = sessions.filter((s) => sessionState(s, now, sessionDuration(s, bookings)) === 'upcoming').length;
  const completed = sessions.filter((s) => s.status === 'COMPLETED');
  const pendingNotes = completed.filter((s) => sessionState(s, now) === 'notes-pending').length;
  const documentedRate = completed.length ? (completed.length - pendingNotes) / completed.length : 1;

  const nextUp = sessions
    .filter((s) => {
      const st = sessionState(s, now, sessionDuration(s, bookings));
      return st === 'upcoming' || st === 'live';
    })
    .sort(byStartAsc)[0];

  const pendingInvites = invites.filter((i) => i.status === 'PENDING');

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.c.id));
  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      pageRows.forEach((r) => (pageAllSelected ? next.delete(r.c.id) : next.add(r.c.id)));
      return next;
    });

  const exportSelected = () => {
    const chosen = rows.filter((r) => selected.has(r.c.id));
    const csv = toCsv([
      ['Name', 'Email', 'Conditions', 'Sessions', 'Last session', 'Next session', 'Status'],
      ...chosen.map((r) => [
        fullName(r.c),
        r.c.user?.email ?? '',
        r.c.diagnosis.join('; '),
        r.c.sessionCount ?? 0,
        r.c.lastSession ? fmtDate(r.c.lastSession) : '',
        r.next ? fmtDayTime(r.next.scheduledAt, now) : '',
        CLIENT_STATUS_META[r.status].label,
      ]),
    ]);
    downloadFile('staad-clients.csv', csv, 'text/csv');
    toast(`Exported ${chosen.length} client${chosen.length === 1 ? '' : 's'}`);
  };

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast('Could not copy to clipboard.', 'error');
    }
  };

  const clientMenu = (r: Row): MenuItem[] => [
    { label: 'View progress', icon: User, onClick: () => router.push(`/clients/${r.c.id}/progress`) },
    {
      label: r.next?.status === 'ACTIVE' ? 'Join live session' : 'Start session now',
      icon: Play,
      onClick: () => (r.next?.status === 'ACTIVE' ? router.push(sessionRoomUrl(r.next.id)) : setStart({ open: true, clientId: r.c.id })),
    },
    { label: 'Book a session', icon: CalendarPlus, onClick: () => setBook({ open: true, clientId: r.c.id }) },
    { label: 'View sessions', icon: ClipboardList, onClick: () => router.push(`/sessions?clientId=${r.c.id}`) },
    { label: 'Copy email', icon: Mail, onClick: () => copyText(r.c.user?.email ?? '', 'Email'), hidden: !r.c.user?.email },
  ];

  const StatusText = ({ status }: { status: ClientStatus }) => {
    const meta = CLIENT_STATUS_META[status];
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: TONES[meta.tone].fg }}>
        <span className="h-2 w-2 rounded-full" style={{ background: TONES[meta.tone].fg }} />
        {meta.label}
      </span>
    );
  };

  const NextText = ({ r }: { r: Row }) =>
    r.next ? (
      <span style={{ color: isSameDay(new Date(r.next.scheduledAt), now) ? 'var(--ds-clay-ink)' : 'var(--ds-ink)' }}>
        {r.next.status === 'ACTIVE' ? 'Live now' : fmtDayTime(r.next.scheduledAt, now)}
      </span>
    ) : (
      <span className="ds-faint">—</span>
    );

  const nextCountdown = nextUp ? countdown(nextUp.scheduledAt, now) : null;

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Clients"
          subtitle="The people you support, all in one place."
          actions={
            <>
              <SearchInput value={search} onChange={setSearch} placeholder="Search by name, email or condition…" className="w-full sm:w-[340px]" />
              <button className="ds-btn ds-btn-lg ds-btn-clay" onClick={() => setAddOpen(true)}>
                <Plus /> Add Client
              </button>
            </>
          }
        />

        {error && <ErrorBanner message={error} onRetry={refresh} />}

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          <StatCard
            icon={Users}
            label="Total Clients"
            value={clients.length}
            hint={
              <span className="inline-flex items-center gap-1" style={{ color: newThisMonth ? 'var(--ds-green)' : undefined }}>
                {newThisMonth ? <TrendingUp className="h-3.5 w-3.5" /> : null}
                {newThisMonth ? `+${newThisMonth} this month` : 'No new clients this month'}
              </span>
            }
            visual={<MiniBars values={weeklyCounts(sessions, 6, now)} label="Sessions per week over the last 6 weeks" />}
          />
          <StatCard
            icon={User}
            label="Active Clients"
            value={counts.active}
            hint="Seen recently or booked"
            onClick={() => setTab('active')}
            visual={
              <ProgressRing value={clients.length ? counts.active / clients.length : 0} label="Share of clients who are active">
                {clients.length ? Math.round((counts.active / clients.length) * 100) : 0}%
              </ProgressRing>
            }
          />
          <StatCard
            icon={CalendarDays}
            label="Upcoming Sessions"
            value={upcomingSessions}
            hint="Booked ahead"
            onClick={() => router.push('/schedule')}
            visual={<CalendarDays className="h-9 w-9 shrink-0" style={{ color: 'var(--ds-clay)' }} aria-hidden />}
          />
          <StatCard
            icon={FileText}
            label="Pending Notes"
            value={pendingNotes}
            hint="Sessions without notes"
            onClick={() => router.push('/sessions?view=notes-pending')}
            visual={
              <ProgressRing value={documentedRate} color="var(--ds-clay)" label="Share of completed sessions with notes">
                {Math.round(documentedRate * 100)}%
              </ProgressRing>
            }
          />
        </div>

        {/* Next session banner */}
        {nextUp && (
          <Card className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Avatar first={nextUp.client?.firstName} last={nextUp.client?.lastName} size={76} />
              <div className="min-w-0">
                <Link
                  href="/schedule"
                  className="ds-chip mb-2 uppercase tracking-wide"
                  style={{ background: 'var(--ds-forest-soft)', color: 'var(--ds-forest)' }}
                >
                  Next session <ChevronRight className="h-3 w-3" />
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="ds-title truncate text-[26px] leading-tight">{fullName(nextUp.client)}</p>
                  {nextUp.client?.diagnosis?.[0] && <Tag label={nextUp.client.diagnosis[0]} />}
                </div>
                <p className="ds-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4" /> {fmtDayTime(nextUp.scheduledAt, now)}
                  </span>
                  <span aria-hidden>•</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Video className="h-4 w-4" /> {SESSION_KIND}
                  </span>
                  {numbers.get(nextUp.id) && (
                    <>
                      <span aria-hidden>•</span>
                      <span>{fmtSessionNo(numbers.get(nextUp.id))}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl px-5 py-3" style={{ background: 'var(--ds-surface-2)' }}>
              <Clock className="h-7 w-7" style={{ color: 'var(--ds-ink)' }} />
              <div>
                <p className="ds-muted text-[12.5px]">{nextUp.status === 'ACTIVE' ? 'Status' : nextCountdown ? 'Starts in' : 'Starting'}</p>
                <p className="ds-title text-[26px] leading-none">
                  {nextUp.status === 'ACTIVE' ? 'Live now' : nextCountdown ? `${nextCountdown.value} ${nextCountdown.unit}` : 'Now'}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button className="ds-btn ds-btn-lg ds-btn-outline" onClick={() => nextUp.client && router.push(`/clients/${nextUp.client.id}/progress`)}>
                View Client
              </button>
              <button className="ds-btn ds-btn-lg ds-btn-clay" onClick={() => router.push(sessionRoomUrl(nextUp.id))}>
                {nextUp.status === 'ACTIVE' ? 'Join Session' : 'Start Session'}
              </button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {/* Tabs + controls */}
            <div className="flex flex-col gap-3 border-b lg:flex-row lg:items-end lg:justify-between" style={{ borderColor: 'var(--ds-border)' }}>
              <div role="tablist" aria-label="Filter clients" className="flex gap-6 overflow-x-auto">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    className={cx('ds-underline-tab', tab === t.key && 'is-active')}
                    onClick={() => setTab(t.key)}
                  >
                    {t.label} ({counts[t.key]})
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <label htmlFor="client-sort" className="ds-muted text-[13px]">
                  Sort by
                </label>
                <select
                  id="client-sort"
                  className="ds-input"
                  style={{ width: 'auto', paddingTop: '0.5rem', paddingBottom: '0.5rem' }}
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="next">Next Session</option>
                  <option value="name">Name (A–Z)</option>
                  <option value="last">Last Session</option>
                  <option value="sessions">Most Sessions</option>
                </select>
                <Dropdown
                  width={240}
                  trigger={({ open, toggle }) => (
                    <button className="ds-btn ds-btn-outline" aria-expanded={open} onClick={toggle}>
                      <ListFilter /> Filter{conditions.length ? ` (${conditions.length})` : ''}
                    </button>
                  )}
                >
                  {() => (
                    <div className="p-1.5">
                      <p className="ds-muted px-1 pb-2 text-[12px] font-semibold uppercase tracking-wide">Condition</p>
                      {allConditions.length === 0 ? (
                        <p className="ds-muted px-1 pb-1 text-[13px]">No conditions recorded yet.</p>
                      ) : (
                        allConditions.map((cond) => (
                          <label key={cond} className="ds-menu-item cursor-pointer">
                            <input
                              type="checkbox"
                              checked={conditions.includes(cond)}
                              onChange={() =>
                                setConditions((prev) => (prev.includes(cond) ? prev.filter((c) => c !== cond) : [...prev, cond]))
                              }
                              style={{ accentColor: 'var(--ds-clay)' }}
                            />
                            {cond}
                          </label>
                        ))
                      )}
                      {conditions.length > 0 && (
                        <button className="ds-btn ds-btn-sm ds-btn-ghost mt-1 w-full" onClick={() => setConditions([])}>
                          Clear filter
                        </button>
                      )}
                    </div>
                  )}
                </Dropdown>
                <div className="flex rounded-xl p-0.5" style={{ border: '1px solid var(--ds-border-strong)', background: 'var(--ds-surface)' }}>
                  {(['list', 'grid'] as const).map((v) => {
                    const Icon = v === 'list' ? List : LayoutGrid;
                    return (
                      <button
                        key={v}
                        className="ds-icon-btn"
                        aria-label={v === 'list' ? 'List view' : 'Grid view'}
                        aria-pressed={view === v}
                        onClick={() => setView(v)}
                        style={view === v ? { background: 'var(--ds-clay-soft)', color: 'var(--ds-clay-ink)' } : undefined}
                      >
                        <Icon className="h-[18px] w-[18px]" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5" style={{ background: 'var(--ds-forest-soft)' }}>
                <span className="text-[13.5px] font-semibold" style={{ color: 'var(--ds-forest)' }}>
                  {selected.size} selected
                </span>
                <button className="ds-btn ds-btn-sm ds-btn-primary" onClick={exportSelected}>
                  <Download /> Export CSV
                </button>
                <button className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setSelected(new Set())}>
                  Clear selection
                </button>
              </div>
            )}

            {loading ? (
              <LoadingBlock label="Loading clients…" />
            ) : clients.length === 0 ? (
              <Card>
                <EmptyState
                  icon={
                    <IconBubble size={72}>
                      <UserPlus className="h-8 w-8" />
                    </IconBubble>
                  }
                  title="No clients yet"
                  body="Invite your first client. Once they sign up with your link, they'll appear here with their sessions."
                >
                  <button className="ds-btn ds-btn-clay" onClick={() => setAddOpen(true)}>
                    <Plus /> Add Client
                  </button>
                </EmptyState>
              </Card>
            ) : filtered.length === 0 ? (
              <Card>
                <EmptyState compact title="No clients match" body="Try a different search, tab or filter.">
                  <button
                    className="ds-btn ds-btn-outline"
                    onClick={() => {
                      setSearch('');
                      setConditions([]);
                      setTab('all');
                    }}
                  >
                    Clear filters
                  </button>
                </EmptyState>
              </Card>
            ) : view === 'list' ? (
              <div className="space-y-2">
                <div
                  className="ds-muted hidden grid-cols-[24px_minmax(0,2.3fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_132px] items-center gap-4 px-4 py-1 text-[12.5px] font-medium lg:grid"
                >
                  <input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select all clients on this page" style={{ accentColor: 'var(--ds-clay)' }} />
                  <span>Client</span>
                  <span>Last Session</span>
                  <span>Next Session</span>
                  <span>Status</span>
                  <span className="pr-10 text-right">Actions</span>
                </div>
                {pageRows.map((r) => (
                  <div
                    key={r.c.id}
                    className="ds-card ds-card-hover grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[24px_minmax(0,2.3fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_132px]"
                    style={{ boxShadow: 'none' }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.c.id)}
                      onChange={() => toggleSelected(r.c.id)}
                      aria-label={`Select ${fullName(r.c)}`}
                      style={{ accentColor: 'var(--ds-clay)' }}
                    />
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar first={r.c.firstName} last={r.c.lastName} size={44} />
                      <div className="min-w-0">
                        <p className="truncate text-[14.5px] font-semibold">{fullName(r.c)}</p>
                        <p className="ds-muted truncate text-[12.5px]">{r.c.user?.email ?? 'No email'}</p>
                      </div>
                      <div className="ml-auto hidden flex-wrap justify-end gap-1 sm:flex">
                        {r.c.diagnosis.slice(0, 2).map((d) => (
                          <Tag key={d} label={d} />
                        ))}
                      </div>
                    </div>
                    <div className="hidden text-[13px] lg:block">
                      <p className="ds-faint text-[11.5px]">Last Session</p>
                      <p>{r.c.lastSession ? fmtDate(r.c.lastSession) : '—'}</p>
                    </div>
                    <div className="hidden text-[13.5px] font-medium lg:block">
                      <NextText r={r} />
                    </div>
                    <div className="hidden lg:block">
                      <StatusText status={r.status} />
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/clients/${r.c.id}/progress`} className="ds-btn ds-btn-sm ds-btn-outline">
                        View
                      </Link>
                      <Menu items={clientMenu(r)} label={`More actions for ${fullName(r.c)}`} />
                    </div>
                    <div className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1 pl-10 text-[12.5px] lg:hidden">
                      <StatusText status={r.status} />
                      <span className="ds-muted">Next: <NextText r={r} /></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {pageRows.map((r) => (
                  <Card key={r.c.id} className="ds-card-hover flex flex-col p-5">
                    <div className="flex items-start gap-3">
                      <Avatar first={r.c.firstName} last={r.c.lastName} size={48} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{fullName(r.c)}</p>
                        <p className="ds-muted truncate text-[12.5px]">{r.c.user?.email ?? 'No email'}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={selected.has(r.c.id)}
                        onChange={() => toggleSelected(r.c.id)}
                        aria-label={`Select ${fullName(r.c)}`}
                        style={{ accentColor: 'var(--ds-clay)' }}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {r.c.diagnosis.map((d) => (
                        <Tag key={d} label={d} />
                      ))}
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
                      <div>
                        <dt className="ds-faint">Last session</dt>
                        <dd>{r.c.lastSession ? fmtDate(r.c.lastSession) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="ds-faint">Next session</dt>
                        <dd className="font-medium">
                          <NextText r={r} />
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3">
                      <StatusText status={r.status} />
                    </div>
                    <div className="mt-auto flex items-center gap-2 pt-4">
                      <Link href={`/clients/${r.c.id}/progress`} className="ds-btn ds-btn-sm ds-btn-outline flex-1">
                        View
                      </Link>
                      <button className="ds-btn ds-btn-sm ds-btn-clay flex-1" onClick={() => setBook({ open: true, clientId: r.c.id })}>
                        <CalendarPlus /> Book
                      </button>
                      <Menu items={clientMenu(r)} label={`More actions for ${fullName(r.c)}`} />
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {!loading && filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="ds-muted text-[13.5px]">
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} client
                  {filtered.length === 1 ? '' : 's'}
                </p>
                <nav className="flex items-center gap-1" aria-label="Pagination">
                  <button className="ds-icon-btn" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      aria-current={p === currentPage ? 'page' : undefined}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-[13.5px] font-semibold"
                      style={p === currentPage ? { background: 'var(--ds-clay)', color: '#fff' } : { color: 'var(--ds-muted)' }}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    className="ds-icon-btn"
                    disabled={currentPage === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </nav>
              </div>
            )}
          </div>

          {/* Side column */}
          <div className="space-y-4">
            <Card className="p-6 text-center">
              <UserPlus className="mx-auto h-9 w-9" style={{ color: 'var(--ds-clay)' }} />
              <p className="ds-title mt-3 text-[22px]">Add a New Client</p>
              <p className="ds-muted mt-1 text-[13.5px]">Start supporting a new client on their mental health journey.</p>
              <button className="ds-btn ds-btn-lg ds-btn-clay mt-4 w-full" onClick={() => setAddOpen(true)}>
                <Plus /> Add Client
              </button>
            </Card>

            {pendingInvites.length > 0 && (
              <Card className="p-5">
                <p className="ds-title text-[19px]">Pending invites ({pendingInvites.length})</p>
                <p className="ds-muted mt-0.5 text-[12.5px]">Waiting for these clients to sign up.</p>
                <ul className="mt-3 space-y-2">
                  {pendingInvites.map((inv) => {
                    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/auth?invite=${inv.token}`;
                    return (
                      <li key={inv.id} className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: 'var(--ds-surface-2)' }}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold">{fullName(inv)}</p>
                          <p className="ds-faint text-[11.5px]">Invited {fmtDate(inv.createdAt)}</p>
                        </div>
                        <button className="ds-icon-btn" onClick={() => copyText(link, 'Invite link')} aria-label={`Copy invite link for ${fullName(inv)}`}>
                          <Copy className="h-4 w-4" />
                        </button>
                        <a
                          className="ds-icon-btn"
                          href={whatsAppLink(`You're invited to a STAAD therapy session. Sign up here: ${link}`, inv.phoneNumber)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Share invite for ${fullName(inv)} on WhatsApp`}
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>
        </div>
      </div>

      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
      <BookSessionDialog
        open={book.open}
        onOpenChange={(open) => setBook((b) => ({ ...b, open }))}
        clients={clients}
        defaultClientId={book.clientId}
        onBooked={refresh}
        onAddClient={() => {
          setBook({ open: false });
          setAddOpen(true);
        }}
      />
      <StartSessionDialog
        open={start.open}
        onOpenChange={(open) => setStart((s) => ({ ...s, open }))}
        clients={clients}
        sessions={sessions}
        defaultClientId={start.clientId}
      />
    </DashboardLayout>
  );
}
