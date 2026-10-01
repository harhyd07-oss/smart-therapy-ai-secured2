'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, CheckCircle2, ChevronRight, CircleHelp, Info, LifeBuoy, Loader2, Mail, RefreshCw, Send, Settings } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuthStore } from '@/store/useAuthStore';
import { Card, Field, PageHeader, toast } from '@/components/practice/ui';
import { authFetch } from '@/lib/progressApi';

const CATEGORIES = ['Technical Issue', 'Billing', 'Account', 'Feedback', 'Other'];
const SUPPORT_EMAIL = 'om.cofounder@staad.in';

export default function HelpPage() {
  const { uid, role, profile, email } = useAuthStore();
  const router = useRouter();

  const [category, setCategory] = useState('Technical Issue');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sentRef, setSentRef] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) router.push('/auth');
  }, [uid, router]);

  // Deep link from Plans → "Contact Support" (?category=Billing).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('category');
    if (c && CATEGORIES.includes(c)) setCategory(c);
  }, []);

  const fullName = profile ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() : '';
  const scheduleHref = role === 'CLIENT' ? '/my-sessions' : role === 'ADMIN' ? '/admin' : '/schedule';

  const handleSubmit = async () => {
    setError('');
    if (!subject.trim() || !message.trim()) {
      setError('Please add a subject and describe your issue.');
      return;
    }
    setSending(true);
    try {
      const res = await authFetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subject: subject.trim(), message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
      } else {
        setSentRef(data.ref || 'Submitted');
        setSubject('');
        setMessage('');
        setCategory('Technical Issue');
        toast('Ticket submitted');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const tips = [
    {
      icon: CalendarDays,
      title: 'Check your session schedule',
      body: 'For session-related issues, please confirm the date, time and client details.',
      onClick: () => router.push(scheduleHref),
    },
    {
      icon: RefreshCw,
      title: 'Try a quick refresh',
      body: "If something isn't working as expected, try refreshing your browser or logging in again.",
      onClick: () => window.location.reload(),
    },
    {
      icon: Settings,
      title: 'Review your account settings',
      body: 'For profile, notification or access issues, check your account settings.',
      onClick: () => router.push('/profile'),
    },
  ];

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <PageHeader
          icon={<LifeBuoy className="h-8 w-8" />}
          title="Help & Support"
          subtitle="Raise a ticket and our team will get back to you over email."
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* Ticket form */}
          <Card className="p-6 sm:p-7">
            {sentRef ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 className="h-14 w-14" style={{ color: 'var(--ds-green)' }} />
                <h2 className="ds-title mt-4 text-[28px]">Ticket submitted!</h2>
                <p className="ds-muted mt-2 max-w-sm text-[14px]">
                  Thanks for reaching out. Your reference is <strong style={{ color: 'var(--ds-ink)' }}>{sentRef}</strong>. We&apos;ll reply to{' '}
                  <strong style={{ color: 'var(--ds-ink)' }}>{email}</strong>.
                </p>
                <button className="ds-btn ds-btn-clay mt-6" onClick={() => setSentRef(null)}>
                  Raise another ticket
                </button>
              </div>
            ) : (
              <>
                <h2 className="ds-title text-[28px]">Raise a ticket</h2>
                <p className="ds-muted mb-6 text-[14.5px]">Describe your question or problem in detail.</p>
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Name" htmlFor="t-name">
                      <input id="t-name" className="ds-input" value={fullName} readOnly />
                    </Field>
                    <Field label="Email" htmlFor="t-email">
                      <input id="t-email" className="ds-input" value={email || ''} readOnly />
                    </Field>
                  </div>
                  <Field label="Category" htmlFor="t-cat">
                    <select id="t-cat" className="ds-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Subject" htmlFor="t-subject">
                    <input
                      id="t-subject"
                      className="ds-input"
                      value={subject}
                      maxLength={150}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Brief summary of your issue"
                    />
                  </Field>
                  <Field label="Message" htmlFor="t-message">
                    <textarea
                      id="t-message"
                      className="ds-input resize-y"
                      rows={6}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Tell us what's happening, what you expected, and any steps to reproduce…"
                    />
                  </Field>
                  {error && (
                    <p className="text-[13px] font-medium" style={{ color: 'var(--ds-red)' }} role="alert">
                      {error}
                    </p>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <p className="ds-muted flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-[13px]" style={{ background: 'var(--ds-surface-2)' }}>
                      <Info className="h-4 w-4 shrink-0" /> The more details you share, the faster we can help you.
                    </p>
                    <button className="ds-btn ds-btn-lg ds-btn-clay" onClick={handleSubmit} disabled={sending}>
                      {sending ? <Loader2 className="animate-spin" /> : <Send />}
                      {sending ? 'Sending…' : 'Submit Ticket'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </Card>

          <div className="space-y-6">
            <Card className="p-6">
              <h2 className="ds-title text-[24px]">Contact us directly</h2>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="mt-4 flex items-center gap-3 rounded-2xl p-3.5 transition-colors hover:bg-[var(--ds-clay-soft)]"
                style={{ background: 'var(--ds-surface-2)' }}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--ds-clay-soft)', color: 'var(--ds-clay-ink)' }}>
                  <Mail className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="ds-muted block text-[12.5px]">Email</span>
                  <span className="block truncate text-[15px] font-semibold" style={{ color: 'var(--ds-ink)' }}>
                    {SUPPORT_EMAIL}
                  </span>
                </span>
              </a>
              <p className="ds-muted mt-4 text-[13px]">
                We typically respond within 1–2 business days. Tickets you raise here are emailed directly to our support team.
              </p>
            </Card>

            <Card className="p-6">
              <h2 className="ds-title text-[24px]">Before you submit</h2>
              <p className="ds-muted text-[13px]">Here are a few quick things to check. They might help you find a solution faster.</p>
              <ul className="mt-4">
                {tips.map((t) => (
                  <li key={t.title} className="border-t first:border-t-0" style={{ borderColor: 'var(--ds-border)' }}>
                    <button onClick={t.onClick} className="flex w-full items-start gap-3 rounded-xl px-1 py-3.5 text-left transition-colors hover:bg-[var(--ds-surface-2)]">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--ds-surface-2)', color: 'var(--ds-ink)' }}>
                        <t.icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold" style={{ fontFamily: "'DM Serif Display', serif" }}>
                          {t.title}
                        </span>
                        <span className="ds-muted block text-[12.5px]">{t.body}</span>
                      </span>
                      <ChevronRight className="mt-3 h-4 w-4 shrink-0" style={{ color: 'var(--ds-muted)' }} />
                    </button>
                  </li>
                ))}
              </ul>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('STAAD support request')}`}
                className="mt-2 flex items-center gap-3 rounded-2xl p-4 transition-colors hover:bg-[var(--ds-clay-soft)]"
                style={{ background: 'var(--ds-surface-2)' }}
              >
                <CircleHelp className="h-7 w-7 shrink-0" style={{ color: 'var(--ds-ink)' }} />
                <span>
                  <span className="block text-[14px] font-semibold" style={{ color: 'var(--ds-ink)' }}>
                    Still need help?
                  </span>
                  <span className="ds-muted block text-[12.5px]">Email us and our team will be happy to assist you.</span>
                </span>
              </a>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
