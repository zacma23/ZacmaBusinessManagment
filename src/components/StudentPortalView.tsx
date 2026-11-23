import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  Calendar,
  Check,
  Clock,
  CreditCard,
  ExternalLink,
  GraduationCap,
  KeyRound,
  LogOut,
  MapPin,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { usePortal } from '../context/PortalContext';
import { db } from '../lib/firebase';
import { validatePasswordStrength } from '../lib/authService';
import { formatTimestamp } from '../lib/zacmaService';
import { SupportChatWidget } from './SupportChatWidget';

export function StudentPortalView() {
  const {
    user,
    profile,
    organization,
    currentMember,
    studentRegistrations,
    courses,
    loginActivity,
    changeCurrentUserPassword,
    logout,
  } = usePortal();

  const [tab, setTab] = useState<'registrations' | 'courses' | 'account'>('registrations');

  // Profile edit state (allowed fields only: displayName, phone)
  const [displayName, setDisplayName] = useState(
    currentMember?.displayName || profile?.displayName || user?.displayName || ''
  );
  const [phone, setPhone] = useState(currentMember?.phone || profile?.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwStatus, setPwStatus] = useState<{ text: string; isError?: boolean } | null>(null);

  const isPasswordAccount =
    profile?.authProvider === 'username_password' ||
    user?.providerData?.some((p) => p.providerId === 'password');

  const pwStrength = validatePasswordStrength(newPassword);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !displayName.trim()) return;
    setSavingProfile(true);
    setProfileNotice(null);
    try {
      await updateDoc(doc(db, `users/${user.uid}`), {
        displayName: displayName.trim().slice(0, 120),
        phone: phone.trim().slice(0, 60),
        updatedAt: serverTimestamp(),
      });
      if (organization) {
        await updateDoc(doc(db, `organizations/${organization.id}/members/${user.uid}`), {
          displayName: displayName.trim().slice(0, 120),
          phone: phone.trim().slice(0, 60),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      setProfileNotice('Your profile details have been updated.');
    } catch (err: unknown) {
      setProfileNotice(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwStrength.valid) {
      setPwStatus({ text: pwStrength.message, isError: true });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwStatus({ text: 'New password and confirmation do not match.', isError: true });
      return;
    }
    setSavingPw(true);
    setPwStatus(null);
    try {
      await changeCurrentUserPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwStatus({ text: 'Password updated successfully.', isError: false });
    } catch (err: unknown) {
      setPwStatus({
        text: err instanceof Error ? err.message : 'Could not update password.',
        isError: true,
      });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-lg text-white font-display font-bold text-base flex items-center justify-center shrink-0"
              style={{ backgroundColor: organization?.primaryColor || '#1D4ED8' }}
            >
              {(organization?.name || 'Z').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-sm sm:text-base text-slate-900 truncate">
                {organization?.name || 'Zacma Training Institute'} · Student Portal
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {currentMember?.displayName || profile?.displayName || user?.email}
                {profile?.username ? ` (@${profile.username})` : ''}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
          <button
            type="button"
            onClick={() => setTab('registrations')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'registrations'
                ? 'bg-blue-700 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            <span>My Enrollments ({studentRegistrations.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('courses')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'courses'
                ? 'bg-blue-700 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Course Catalog ({courses.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('account')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'account'
                ? 'bg-blue-700 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Profile &amp; Security</span>
          </button>
        </div>

        {/* Tab 1: My Registrations */}
        {tab === 'registrations' && (
          <div className="space-y-4">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                My Course Registrations &amp; Progress
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                View your enrollment status, assigned training schedule, payment status, and
                certificates.
              </p>
            </div>

            {studentRegistrations.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
                <GraduationCap className="w-10 h-10 text-slate-300 mx-auto" />
                <h2 className="font-display text-base font-bold text-slate-900">
                  No Course Enrollments Linked Yet
                </h2>
                <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                  Browse our Course Catalog or chat with the ZACMA AI Assistant in the bottom-right
                  corner to register for a program. Your registrations will appear here
                  automatically.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('courses')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Explore Courses</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {studentRegistrations.map((reg) => (
                  <div
                    key={reg.id}
                    className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-mono text-slate-500">{reg.leadRef}</div>
                        <h3 className="font-display text-base font-bold text-slate-900 mt-0.5">
                          {reg.preferredCourse}
                        </h3>
                      </div>
                      <span className="px-2.5 py-1 rounded-md bg-blue-50 text-blue-800 text-[11px] font-semibold capitalize">
                        {reg.registrationStatus.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Schedule</span>
                        </div>
                        <div className="font-medium text-slate-900">
                          {reg.classSchedule || reg.preferredSchedule || 'To be confirmed'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>Delivery / Location</span>
                        </div>
                        <div className="font-medium text-slate-900">
                          {reg.trainingLocation || reg.deliveryMethod || 'Campus / Online'}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>Payment Status</span>
                        </div>
                        <div
                          className={`font-semibold capitalize ${
                            reg.paymentStatus === 'paid'
                              ? 'text-emerald-700'
                              : reg.paymentStatus === 'partial'
                                ? 'text-amber-700'
                                : 'text-slate-800'
                          }`}
                        >
                          {reg.paymentStatus}
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="flex items-center gap-1.5 text-slate-500 mb-1">
                          <Award className="w-3.5 h-3.5" />
                          <span>Certificate</span>
                        </div>
                        <div className="font-semibold text-slate-800 capitalize">
                          {reg.certificateStatus.replace('_', ' ')}
                        </div>
                      </div>
                    </div>

                    {reg.documentUploadFormUrl && (
                      <a
                        href={reg.documentUploadFormUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline"
                      >
                        <span>Upload Required Documents</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Course Catalog */}
        {tab === 'courses' && (
          <div className="space-y-4">
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                Available Training Programs
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Administrator-approved courses and tuition fees for{' '}
                {organization?.name || 'Zacma Training Institute'}.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {courses.map((c) => (
                <div
                  key={c.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <h3 className="font-display text-sm font-bold text-slate-900">{c.title}</h3>
                      {c.approvedFee && (
                        <span className="text-xs font-mono font-bold text-blue-700 shrink-0">
                          {c.approvedFee}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                      {c.description || 'Hands-on professional training program.'}
                    </p>
                  </div>
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{c.deliveryMethods?.join(' · ') || 'Online · In-Person'}</span>
                    <span>{c.duration || 'Scheduled batch'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Profile & Security */}
        {tab === 'account' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Profile Details */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-blue-700" />
                <h2 className="font-display text-base font-bold text-slate-900">
                  My Profile Details
                </h2>
              </div>
              {profileNotice && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  {profileNotice}
                </div>
              )}
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+251 9XX XXX XXX"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div>
                    <div className="text-slate-500">Username</div>
                    <div className="font-mono font-semibold text-slate-800 mt-0.5">
                      {profile?.username ? `@${profile.username}` : 'Google Account'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Account Role</div>
                    <div className="font-semibold text-slate-800 mt-0.5">Student / Customer</div>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{savingProfile ? 'Saving…' : 'Save Profile'}</span>
                </button>
              </form>
            </div>

            {/* Password Security */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-blue-700" />
                <h2 className="font-display text-base font-bold text-slate-900">
                  Password &amp; Sign-In Security
                </h2>
              </div>

              {isPasswordAccount ? (
                <form onSubmit={handlePasswordChange} className="space-y-3.5">
                  {pwStatus && (
                    <div
                      className={`p-3 rounded-lg text-xs border ${
                        pwStatus.isError
                          ? 'bg-red-50 border-red-200 text-red-700'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                    >
                      {pwStatus.text}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Current Password
                    </label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                    <div className="mt-1.5 text-[11px] text-slate-500">{pwStrength.message}</div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingPw || !pwStrength.valid}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{savingPw ? 'Updating…' : 'Update Password'}</span>
                  </button>
                </form>
              ) : (
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                  You signed in using <strong>Google Authentication</strong> ({user?.email}). Your
                  password and 2-step verification are managed securely through your Google Account.
                </div>
              )}

              {/* Own Login History */}
              {loginActivity.length > 0 && (
                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Recent Sign-In Activity</span>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {loginActivity.slice(0, 8).map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-md"
                      >
                        <span className="capitalize font-medium text-slate-800">
                          {ev.eventType.replace('_', ' ')} ({ev.authMethod === 'google' ? 'Google' : 'Username'})
                        </span>
                        <span className="font-mono text-slate-500">
                          {formatTimestamp(ev.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 24/7 AI Student Assistant Widget */}
      <SupportChatWidget organizationId={organization?.id || 'zacma-hq'} isPortalContext />
    </div>
  );
}
