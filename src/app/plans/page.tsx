'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Clock, Crown, Headset, Loader2, Mail, Sparkles, Sprout, User, Users } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuthStore } from '@/store/useAuthStore';
import { useTherapistGuard } from '@/hooks/usePracticeData';
import { Card, DsDialog, ErrorBanner, IconBubble, LoadingBlock, PageHeader, Pill, cx, toast } from '@/components/practice/ui';
import { ALL_MODULE_IDS, MODULE_CATEGORIES, resolveAllowedModuleIds } from '@/lib/modules';
import { fmtDate } from '@/lib/practice';
import { authFetch } from '@/lib/progressApi';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  durationMonths: number;
  toolQuota: number | null;
}
interface Current {
  planName: string;
  priceMonthly: number;
  toolQuota: number | null;
  status: string;
  months: number;
  startedAt: string;
  currentPeriodEnd: string;
  renewed: boolean;
  renewalCount: number;
  moduleAccess: string[];
}
interface Pending {
  id: string;
  planName: string;
  months: number;
  modules: string[];
}

const MONTH_OPTIONS = [1, 3, 6, 12];
const PLAN_ICONS = [User, Crown, Users];

const STEPS = [
  { title: 'Select a plan', body: 'Choose the plan that fits your needs.' },
  { title: 'Send request', body: 'Submit a request for the selected plan.' },
  { title: 'Admin approval', body: 'Our team reviews and approves your request.' },
];

const quotaLabel = (q: number | null) => (q == null ? 'All therapy tools' : `${q} therapy tools`);

const planFeatures = (p: Plan) => [
  p.toolQuota == null ? 'Every therapy tool, including new ones' : `Any ${p.toolQuota} therapy tools you choose`,
  'Unlimited clients & sessions',
  'Session notes & AI session reports',
  'Progress tracking with PDF/CSV export',
  p.durationMonths > 1 ? `${p.durationMonths}-month default term` : 'Flexible terms from 1 to 12 months',
];

const CheckDot = () => (
  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--ds-green-soft)', color: 'var(--ds-green)' }}>
    <Check className="h-3 w-3" strokeWidth={3} />
  </span>
);

export default function PlansPage() {
  useTherapistGuard();
  const { role, profile } = useAuthStore();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Request modal
  const [reqPlan, setReqPlan] = useState<Plan | null>(null);
  const [months, setMonths] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([fetch('/api/plans'), authFetch('/api/subscriptions')]);
      if (pRes.ok) setPlans((await pRes.json()).plans || []);
      if (sRes.ok) {
        const d = await sRes.json();
        setCurrent(d.current);
        setPending(d.pendingRequest);
      }
      setLoadError(pRes.ok && sRes.ok ? '' : 'Some plan details could not be loaded.');
    } catch {
      setLoadError('Could not reach the server. Please try again.');
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    if (role === 'THERAPIST') load();
  }, [role, load]);

  const openRequest = (p: Plan) => {
    setReqPlan(p);
    setMonths(p.durationMonths || 1);
    setSelected(new Set(current?.moduleAccess?.slice(0, p.toolQuota ?? undefined) ?? []));
    setError('');
  };

  const toggleTool = (id: string) => {
    if (!reqPlan) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (reqPlan.toolQuota == null || next.size < reqPlan.toolQuota) next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!reqPlan || !profile?.id) return;
    setError('');
    if (reqPlan.toolQuota != null && selected.size === 0) {
      setError('Please select at least one tool.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch('/api/subscriptions/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: reqPlan.id, months, modules: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not submit request.');
      } else {
        toast(`Request for ${reqPlan.name} sent — an admin will review it.`);
        setReqPlan(null);
        load();
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSubmitting(false);
  };

  const toolsAvailable = resolveAllowedModuleIds(profile).length;
  const toolPct = Math.round((toolsAvailable / ALL_MODULE_IDS.length) * 100);

  const included = current
    ? [quotaLabel(current.toolQuota), `${current.months}-month term`, `Started ${fmtDate(current.startedAt)}`, 'Session notes & AI reports']
    : ['Scheduling & live session rooms', 'Session notes & AI reports', 'Client invites & progress tracking', 'Email support'];

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <PageHeader title="Plans & Subscription" subtitle="View your current plan and request a subscription. An admin reviews every request." />

        {loadError && <ErrorBanner message={loadError} onRetry={load} />}

        {loading ? (
          <LoadingBlock label="Loading plans…" />
        ) : (
          <>
            {/* Current plan */}
            <Card className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex items-start gap-4">
                <div
                  className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: 'var(--ds-clay-soft)', color: 'var(--ds-clay-ink)' }}
                >
                  <Sprout className="h-9 w-9" />
                </div>
                <div className="min-w-0">
                  <p className="ds-muted text-[12px] font-semibold uppercase tracking-[0.12em]">Current plan</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="ds-title text-[32px] leading-none">{current ? current.planName : 'Free tier'}</p>
                    <Pill tone="green">{current?.renewed ? `Renewed ×${current.renewalCount}` : 'Current'}</Pill>
                  </div>
                  <p className="ds-muted mt-2 text-[13.5px]">
                    {current
                      ? `Renews or ends on ${fmtDate(current.currentPeriodEnd)}.`
                      : "You haven't taken a plan yet. Choose one below and send a request to unlock more tools."}
                  </p>
                </div>
              </div>
              <div className="lg:border-l lg:pl-6" style={{ borderColor: 'var(--ds-border)' }}>
                <p className="text-[14px] font-semibold">What&apos;s included</p>
                <ul className="mt-2.5 space-y-2">
                  {included.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[13.5px]">
                      <CheckDot /> {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lg:border-l lg:pl-6" style={{ borderColor: 'var(--ds-border)' }}>
                <div className="flex items-center justify-between">
                  <p className="ds-muted text-[12px] font-semibold uppercase tracking-[0.12em]">Tool access</p>
                  <p className="text-[15px] font-semibold">
                    {toolsAvailable} / {ALL_MODULE_IDS.length}
                  </p>
                </div>
                <div
                  className="mt-3 h-2.5 overflow-hidden rounded-full"
                  style={{ background: 'var(--ds-border)' }}
                  role="progressbar"
                  aria-valuenow={toolsAvailable}
                  aria-valuemin={0}
                  aria-valuemax={ALL_MODULE_IDS.length}
                  aria-label="Therapy tools available"
                >
                  <div className="h-full rounded-full" style={{ width: `${Math.max(toolPct, 3)}%`, background: 'var(--ds-green)' }} />
                </div>
                <p className="ds-muted mt-2 text-[12.5px]">
                  You can use {toolsAvailable} of {ALL_MODULE_IDS.length} therapy tools.
                </p>
                <Link href="/modules" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: 'var(--ds-clay-ink)' }}>
                  Browse modules <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </Card>

            {pending && (
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px]" style={{ background: 'var(--ds-amber-soft)' }} role="status">
                <Clock className="h-5 w-5 shrink-0" style={{ color: 'var(--ds-amber)' }} />
                <p>
                  Your request for the <strong>{pending.planName}</strong> plan ({pending.months} mo
                  {pending.modules.length ? `, ${pending.modules.length} tools` : ''}) is awaiting admin approval.
                </p>
              </div>
            )}

            {/* Available plans */}
            <div>
              <h2 className="ds-title text-[28px]">Available plans</h2>
              <p className="ds-muted text-[14px]">Choose a plan that fits your practice and send a request. An admin will review and approve it.</p>
              <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
                {plans.map((p, i) => {
                  const popular = plans.length >= 3 && i === 1;
                  const Icon = PLAN_ICONS[i % PLAN_ICONS.length];
                  const isCurrent = current?.planName === p.name;
                  return (
                    <div
                      key={p.id}
                      className="ds-card relative flex flex-col p-6"
                      style={popular ? { borderColor: 'var(--ds-green)', boxShadow: '0 0 0 1px var(--ds-green), var(--ds-shadow)' } : undefined}
                    >
                      {popular && (
                        <span className="ds-chip absolute -top-3 right-6" style={{ background: 'var(--ds-green-soft)', color: 'var(--ds-green)' }}>
                          <Sparkles className="h-3.5 w-3.5" /> Most Popular
                        </span>
                      )}
                      <div className="flex items-center gap-4">
                        <IconBubble tone={popular ? 'green' : 'clay'} size={60}>
                          <Icon className="h-7 w-7" />
                        </IconBubble>
                        <div>
                          <p className="ds-title text-[24px] leading-tight">{p.name}</p>
                          {isCurrent && <Pill tone="green">Your plan</Pill>}
                        </div>
                      </div>
                      <p className="mt-5">
                        <span className="ds-title text-[36px]">{p.priceMonthly > 0 ? `₹${p.priceMonthly.toLocaleString('en-IN')}` : 'Free'}</span>
                        {p.priceMonthly > 0 && <span className="ds-muted text-[15px]"> / month</span>}
                      </p>
                      {p.description && <p className="ds-muted mt-1 text-[13.5px]">{p.description}</p>}
                      <div className="my-4 h-px" style={{ background: 'var(--ds-border)' }} />
                      <ul className="space-y-2">
                        {planFeatures(p).map((f) => (
                          <li key={f} className="flex items-start gap-2 text-[13.5px]">
                            <CheckDot /> {f}
                          </li>
                        ))}
                      </ul>
                      <div className="flex-1" />
                      <button
                        className={cx('ds-btn ds-btn-lg mt-6 w-full', popular ? 'ds-btn-clay' : 'ds-btn-clay-outline')}
                        disabled={!!pending}
                        onClick={() => openRequest(p)}
                      >
                        {pending ? 'Request pending' : isCurrent ? 'Renew plan' : 'Request Plan'}
                      </button>
                    </div>
                  );
                })}
                {plans.length === 0 && (
                  <Card className="col-span-full p-6 text-[14px]">
                    <span className="ds-muted">No plans are available yet. Please check back later or contact support.</span>
                  </Card>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Card className="p-6">
                <h2 className="ds-title text-[22px]">How subscriptions work</h2>
                <p className="ds-muted text-[13.5px]">Getting access is simple and secure.</p>
                <ol className="mt-5 flex flex-col gap-4 md:flex-row md:items-center">
                  {STEPS.map((s, i) => (
                    <React.Fragment key={s.title}>
                      <li className="flex flex-1 items-center gap-3">
                        <span
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[18px]"
                          style={{
                            fontFamily: "'DM Serif Display', serif",
                            background: i === 0 ? 'var(--ds-green-soft)' : 'var(--ds-clay-soft)',
                            color: i === 0 ? 'var(--ds-green)' : 'var(--ds-clay-ink)',
                          }}
                        >
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-[14px] font-semibold">{s.title}</p>
                          <p className="ds-muted text-[12.5px]">{s.body}</p>
                        </div>
                      </li>
                      {i < STEPS.length - 1 && <ArrowRight className="hidden h-5 w-5 shrink-0 md:block" style={{ color: 'var(--ds-faint)' }} aria-hidden />}
                    </React.Fragment>
                  ))}
                </ol>
              </Card>
              <Card className="flex items-start gap-4 p-6">
                <IconBubble tone="green" size={56}>
                  <Headset className="h-6 w-6" />
                </IconBubble>
                <div>
                  <h2 className="ds-title text-[20px]">Need help choosing?</h2>
                  <p className="ds-muted mt-1 text-[13.5px]">Our team is here to help you find the right plan for your practice.</p>
                  <Link href="/help?category=Billing" className="ds-btn ds-btn-clay-outline mt-3">
                    <Mail /> Contact Support
                  </Link>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>

      <DsDialog
        open={!!reqPlan}
        onOpenChange={(o) => !o && setReqPlan(null)}
        wide
        title={`Request ${reqPlan?.name ?? ''}`}
        description={
          reqPlan?.toolQuota == null
            ? 'This plan unlocks every tool. Choose a term and send your request.'
            : `Pick up to ${reqPlan?.toolQuota} tools, choose a term, then send your request for admin approval.`
        }
        footer={
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => setReqPlan(null)}>
              Cancel
            </button>
            <button className="ds-btn ds-btn-clay" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />} Send request
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <p className="ds-label">Term</p>
            <div className="flex flex-wrap gap-2">
              {MONTH_OPTIONS.map((m) => (
                <button key={m} className={cx('ds-pill-tab', months === m && 'is-active')} aria-pressed={months === m} onClick={() => setMonths(m)}>
                  {m} month{m === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          </div>

          {reqPlan?.toolQuota != null && (
            <div>
              <div className="flex items-center justify-between">
                <p className="ds-label">Tools</p>
                <span className="text-[12.5px] font-semibold" style={{ color: selected.size >= reqPlan.toolQuota ? 'var(--ds-clay-ink)' : 'var(--ds-muted)' }}>
                  {selected.size} / {reqPlan.toolQuota} selected
                </span>
              </div>
              <div className="mt-2 space-y-4">
                {MODULE_CATEGORIES.map((cat) => (
                  <div key={cat.id}>
                    <p className="ds-muted mb-2 text-[12px] font-semibold uppercase tracking-wide">
                      {cat.emoji} {cat.name}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {cat.modules.map((m) => {
                        const checked = selected.has(m.id);
                        const full = !checked && selected.size >= (reqPlan.toolQuota ?? Infinity);
                        return (
                          <label
                            key={m.id}
                            className="flex items-center gap-2 rounded-xl p-2.5 text-[13.5px]"
                            style={{
                              background: checked ? 'var(--ds-clay-soft)' : 'var(--ds-surface-2)',
                              border: '1px solid var(--ds-border)',
                              cursor: full ? 'not-allowed' : 'pointer',
                              opacity: full ? 0.45 : 1,
                            }}
                          >
                            <input type="checkbox" checked={checked} disabled={full} onChange={() => toggleTool(m.id)} style={{ accentColor: 'var(--ds-clay)' }} />
                            {m.emoji} {m.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-[13px] font-medium" style={{ color: 'var(--ds-red)' }} role="alert">
              {error}
            </p>
          )}
        </div>
      </DsDialog>
    </DashboardLayout>
  );
}
