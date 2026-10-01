'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, Leaf, Loader2, Monitor, Moon, Quote, Save, Settings, SlidersHorizontal, Sun, Trash2, User, Users } from 'lucide-react';
import { sendPasswordResetEmail, deleteUser } from 'firebase/auth';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useTheme } from '@/components/ThemeProvider';
import { useAuthStore } from '@/store/useAuthStore';
import { auth } from '@/lib/firebase';
import { Card, Field, IconBubble, PageHeader, Pill, cx, toast } from '@/components/practice/ui';
import { initials } from '@/lib/practice';
import { authFetch } from '@/lib/progressApi';

const SPECIALITIES = ['SLD', 'ADHD', 'Anxiety', 'Depression', 'ID', 'Autism', 'Dyslexia', 'Trauma', 'General'];
const QUALIFICATIONS = ['BA/BSc', 'MA/MSc', 'M.Phil', 'Ph.D', 'MD', 'DM'];
const EXPERIENCES = ['0-2 years', '3-5 years', '5-10 years', '10+ years', '15+ years'];
const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];
const BIO_MAX = 200;

// Practice preferences have no schema column yet, so they live in this browser.
interface Prefs {
  mode: 'online' | 'in-person';
  email: boolean;
  inApp: boolean;
}
const DEFAULT_PREFS: Prefs = { mode: 'online', email: true, inApp: false };

const dobInput = (d?: string | null) => (d ? new Date(d).toISOString().split('T')[0] : '');

function CardHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-5 flex items-center gap-4">
      <IconBubble size={52}>{icon}</IconBubble>
      <div>
        <h2 className="ds-title text-[22px] leading-tight">{title}</h2>
        <p className="ds-muted text-[13px]">{subtitle}</p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { uid, role, profile, email, clearAuth, setRoleAndProfile } = useAuthStore();
  const { theme, toggle: toggleTheme } = useTheme();
  const router = useRouter();
  const isTherapist = role === 'THERAPIST';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [qualification, setQualification] = useState('');
  const [experience, setExperience] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  const [pwSending, setPwSending] = useState(false);
  const [pwMessage, setPwMessage] = useState('');

  const [showDanger, setShowDanger] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const prefsKey = `staad-prefs-${uid ?? 'anon'}`;

  useEffect(() => {
    if (!uid) router.push('/auth');
  }, [uid, router]);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.firstName || '');
    setLastName(profile.lastName || '');
    setQualification(profile.qualification || '');
    setExperience(profile.experience || '');
    setSpecialties(profile.specialty || []);
    setBio(profile.bio || '');
    setDateOfBirth(dobInput(profile.dateOfBirth));
    setGender(profile.gender || '');
  }, [profile]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefsKey);
      setPrefs(raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS);
    } catch {}
  }, [prefsKey]);

  const updatePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(prefsKey, JSON.stringify(next));
    } catch {}
  };

  const snapshot = (v: {
    firstName: string;
    lastName: string;
    qualification: string;
    experience: string;
    specialties: string[];
    bio: string;
    dateOfBirth: string;
    gender: string;
  }) =>
    JSON.stringify(
      isTherapist
        ? [v.firstName, v.lastName, v.qualification, v.experience, v.specialties, v.bio]
        : [v.firstName, v.lastName, v.dateOfBirth, v.gender]
    );
  const initialSnapshot = useMemo(
    () =>
      profile
        ? snapshot({
            firstName: profile.firstName || '',
            lastName: profile.lastName || '',
            qualification: profile.qualification || '',
            experience: profile.experience || '',
            specialties: profile.specialty || [],
            bio: profile.bio || '',
            dateOfBirth: dobInput(profile.dateOfBirth),
            gender: profile.gender || '',
          })
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile, isTherapist]
  );
  const dirty = !!profile && initialSnapshot !== snapshot({ firstName, lastName, qualification, experience, specialties, bio, dateOfBirth, gender });

  const toggleSpecialty = (spec: string) =>
    setSpecialties((prev) => (prev.includes(spec) ? prev.filter((s) => s !== spec) : [...prev, spec]));

  const handleSave = async () => {
    if (!uid || !role) return;
    if (!firstName.trim()) {
      toast('First name is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { firstName: firstName.trim(), lastName: lastName.trim() };
      if (isTherapist) Object.assign(body, { qualification, experience, specialty: specialties, bio });
      else Object.assign(body, { dateOfBirth: dateOfBirth || undefined, gender });
      const res = await authFetch('/api/users/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your profile.');
      // Keep the sidebar / header in sync without a reload.
      setRoleAndProfile(role, { ...profile, ...data.profile });
      toast('Profile saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save your profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!email) return;
    setPwMessage('');
    setPwSending(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setPwMessage(`Reset link sent to ${email}`);
      toast('Password reset email sent');
    } catch {
      setPwMessage('Could not send reset email. Please try again.');
    }
    setPwSending(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || !uid) return;
    setDeleteError('');
    setDeleting(true);
    try {
      // Capture the ID token BEFORE deleting the Firebase user: afterwards there
      // is no signed-in user to mint one, but this token still verifies, so the
      // server can purge this account's data — and only this account's.
      const current = auth.currentUser;
      const token = current ? await current.getIdToken() : null;
      // Remove the Firebase Auth user first; this can require a recent login.
      if (current) await deleteUser(current);
      // Then purge all relational data for this user (identity from the token).
      if (token) {
        await fetch('/api/users/profile', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        });
      }
      clearAuth();
      router.push('/auth');
    } catch (err: any) {
      setDeleteError(
        err?.code === 'auth/requires-recent-login'
          ? 'For security, please log out and log back in, then try again.'
          : 'Could not delete account. Please try again.'
      );
      setDeleting(false);
    }
  };

  const roleLabel = role === 'ADMIN' ? 'Admin' : isTherapist ? 'Therapist' : 'Client';
  const tagline = isTherapist
    ? specialties.length
      ? `Specialising in ${specialties.slice(0, 3).join(', ')}`
      : 'Dedicated to inclusive, evidence-based care.'
    : 'Your calm space for growth.';

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <PageHeader
          title="Profile"
          subtitle="Manage your account settings and therapeutic identity."
          actions={
            <>
              {dirty && <span className="ds-muted text-[13px]">Unsaved changes</span>}
              <button className="ds-btn ds-btn-lg ds-btn-clay" onClick={handleSave} disabled={saving || !profile}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
              </button>
            </>
          }
        />

        {/* Identity */}
        <Card className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <div
              className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full text-[30px]"
              style={{ background: 'var(--ds-clay-soft)', color: 'var(--ds-clay-ink)', fontFamily: "'DM Serif Display', serif" }}
            >
              {initials(firstName, lastName)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="ds-title text-[28px] leading-tight">{`${firstName} ${lastName}`.trim() || 'Your name'}</p>
                <Pill tone="green">{roleLabel}</Pill>
              </div>
              <p className="ds-muted mt-1.5 flex items-center gap-2 text-[14px]">
                <Leaf className="h-4 w-4 shrink-0" style={{ color: 'var(--ds-green)' }} /> {tagline}
              </p>
            </div>
          </div>
          <div className="hidden h-16 w-px md:block" style={{ background: 'var(--ds-border)' }} />
          <div className="flex flex-1 items-start gap-3">
            <Quote className="h-8 w-8 shrink-0" style={{ color: 'var(--ds-faint)' }} />
            <div>
              <p className="ds-title text-[19px] italic">Small steps, meaningful change.</p>
              <p className="ds-muted text-[14px]">Better support. Brighter tomorrows.</p>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          {/* Personal information */}
          <Card className="p-6">
            <CardHeading
              icon={<User className="h-6 w-6" />}
              title="Personal Information"
              subtitle={isTherapist ? 'Tell us about your professional background and therapeutic approach.' : 'Your personal details.'}
            />
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="First Name" htmlFor="pf-first">
                  <input id="pf-first" className="ds-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </Field>
                <Field label="Last Name" htmlFor="pf-last">
                  <input id="pf-last" className="ds-input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </Field>
              </div>

              {isTherapist ? (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Qualification" htmlFor="pf-qual">
                      <select id="pf-qual" className="ds-input" value={qualification} onChange={(e) => setQualification(e.target.value)}>
                        <option value="">Select qualification</option>
                        {QUALIFICATIONS.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Experience" htmlFor="pf-exp">
                      <select id="pf-exp" className="ds-input" value={experience} onChange={(e) => setExperience(e.target.value)}>
                        <option value="">Select experience</option>
                        {EXPERIENCES.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div>
                    <p className="ds-label">Specialties</p>
                    <div className="flex flex-wrap gap-2">
                      {SPECIALITIES.map((spec) => {
                        const on = specialties.includes(spec);
                        return (
                          <button
                            key={spec}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleSpecialty(spec)}
                            className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors"
                            style={on ? { background: 'var(--ds-clay)', color: '#fff' } : { background: 'var(--ds-surface-2)', color: 'var(--ds-ink)', border: '1px solid var(--ds-border)' }}
                          >
                            {spec}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="ds-label" htmlFor="pf-bio">
                      Bio <span className="ds-muted font-normal">({BIO_MAX - bio.length} chars remaining)</span>
                    </label>
                    <textarea
                      id="pf-bio"
                      className="ds-input resize-y"
                      rows={4}
                      value={bio}
                      maxLength={BIO_MAX}
                      onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                      placeholder="Tell us about your therapeutic approach…"
                    />
                    <p className="ds-faint mt-1 text-right text-[12px]">
                      {bio.length}/{BIO_MAX}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="Date of Birth" htmlFor="pf-dob">
                      <input id="pf-dob" type="date" className="ds-input" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                    </Field>
                    <Field label="Gender" htmlFor="pf-gender">
                      <select id="pf-gender" className="ds-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                        <option value="">Select gender</option>
                        {GENDERS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div>
                    <p className="ds-label">Conditions</p>
                    <div className="flex flex-wrap gap-2">
                      {(profile?.diagnosis ?? []).length === 0 ? (
                        <span className="ds-muted text-[13px]">No conditions recorded</span>
                      ) : (
                        (profile?.diagnosis as string[]).map((d) => (
                          <Pill key={d} tone="clay">
                            {d}
                          </Pill>
                        ))
                      )}
                    </div>
                    <p className="ds-faint mt-1.5 text-[12px]">Set by your therapist.</p>
                  </div>
                </>
              )}
            </div>
          </Card>

          <div className="space-y-6">
            {/* Account */}
            <Card className="p-6">
              <CardHeading icon={<Settings className="h-6 w-6" />} title="Account" subtitle="Manage your login details and preferences." />
              <div className="space-y-5">
                <Field label="Email" htmlFor="pf-email">
                  <input id="pf-email" className="ds-input" value={email || ''} readOnly />
                </Field>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-semibold">Theme</p>
                    <p className="ds-muted text-[12.5px]">Switch between light and dark mode</p>
                  </div>
                  <button
                    className="ds-icon-btn"
                    style={{ width: 48, height: 44, background: 'var(--ds-surface-2)', border: '1px solid var(--ds-border)' }}
                    onClick={toggleTheme}
                    aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                  >
                    {theme === 'light' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold">Password</p>
                    <p className="ds-muted text-[12.5px]">Change your account password</p>
                    {pwMessage && (
                      <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--ds-green)' }}>
                        {pwMessage}
                      </p>
                    )}
                  </div>
                  <button className="ds-btn ds-btn-clay-outline" onClick={handleChangePassword} disabled={pwSending || !email}>
                    {pwSending && <Loader2 className="animate-spin" />} Change password
                  </button>
                </div>
              </div>
            </Card>

            {isTherapist && (
              <Card className="p-6">
                <CardHeading
                  icon={<SlidersHorizontal className="h-6 w-6" />}
                  title="Practice Preferences"
                  subtitle="Set your default preferences for a smoother experience."
                />
                <div className="space-y-5">
                  <div>
                    <p className="ds-label">Preferred session mode</p>
                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          { key: 'online', label: 'Online (Video)', icon: Monitor },
                          { key: 'in-person', label: 'In-person', icon: Users },
                        ] as const
                      ).map((o) => {
                        const on = prefs.mode === o.key;
                        return (
                          <button
                            key={o.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() => updatePrefs({ mode: o.key })}
                            className={cx('flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors')}
                            style={
                              on
                                ? { background: 'var(--ds-green-soft)', border: '1px solid var(--ds-green)', color: 'var(--ds-ink)' }
                                : { background: 'var(--ds-surface)', border: '1px solid var(--ds-border-strong)', color: 'var(--ds-ink)' }
                            }
                          >
                            <o.icon className="h-4 w-4" /> {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="ds-label">Preferred communication</p>
                    <div className="flex flex-wrap gap-5 text-[14px]">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={prefs.email} onChange={(e) => updatePrefs({ email: e.target.checked })} style={{ accentColor: 'var(--ds-forest)', width: 17, height: 17 }} />
                        Email
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={prefs.inApp} onChange={(e) => updatePrefs({ inApp: e.target.checked })} style={{ accentColor: 'var(--ds-forest)', width: 17, height: 17 }} />
                        In-app notifications
                      </label>
                    </div>
                  </div>
                  <p className="ds-faint text-[12px]">Preferences save automatically in this browser.</p>
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Danger zone */}
        <div className="rounded-[18px]" style={{ background: 'var(--ds-red-soft)', border: '1px solid color-mix(in srgb, var(--ds-red) 35%, transparent)' }}>
          <button className="flex w-full items-center gap-4 p-5 text-left" onClick={() => setShowDanger((v) => !v)} aria-expanded={showDanger}>
            <IconBubble tone="red" size={52}>
              <AlertTriangle className="h-6 w-6" />
            </IconBubble>
            <div className="flex-1">
              <p className="ds-title text-[20px]">Danger Zone</p>
              <p className="ds-muted text-[13.5px]">These actions are permanent and cannot be undone.</p>
            </div>
            <ChevronDown className={cx('h-5 w-5 transition-transform', showDanger && 'rotate-180')} style={{ color: 'var(--ds-muted)' }} />
          </button>
          {showDanger && (
            <div className="space-y-3 px-5 pb-5">
              <p className="text-[14px]">
                <strong>Delete account</strong> — permanently removes your profile, sessions, notes and invites. Type <strong>DELETE</strong> to confirm.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  className="ds-input"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder='Type "DELETE" to confirm'
                  aria-label="Type DELETE to confirm account deletion"
                />
                <button className="ds-btn ds-btn-danger" onClick={handleDeleteAccount} disabled={deleteConfirm !== 'DELETE' || deleting}>
                  {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  {deleting ? 'Deleting…' : 'Delete account'}
                </button>
              </div>
              {deleteError && (
                <p className="text-[13px] font-medium" style={{ color: 'var(--ds-red)' }} role="alert">
                  {deleteError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
