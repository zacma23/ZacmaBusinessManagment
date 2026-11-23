import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Lock,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  UserCheck,
  Users,
} from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import {
  FIREBASE_CONSOLE_AUTH_DOMAINS_URL,
  FIREBASE_CONSOLE_SIGNIN_METHODS_URL,
  FIREBASE_PROJECT_ID,
  parseFirebaseAuthError,
  type ParsedAuthError,
} from '../lib/firebase';
import { requestPasswordReset, validatePasswordStrength } from '../lib/authService';
import {
  provisionNewTenantWorkspace,
  SAAS_INDUSTRY_BLUEPRINTS,
} from '../lib/saasService';

interface AuthGateProps {
  children: React.ReactNode;
  onOpenStorefront: () => void;
}

export function AuthGate({ children, onOpenStorefront }: AuthGateProps) {
  const {
    user,
    authLoading,
    profileLoading,
    profileError,
    retryProfileSync,
    profile,
    organization,
    isSuperAdmin,
    isSystemOwner,
    isStudent,
    mustChangePassword,
    accountBlockedReason,
    saasPlans,
    signInWithGoogle,
    signInWithUsername,
    changeCurrentUserPassword,
    logout,
  } = usePortal();

  // Auth UI state
  const [authTab, setAuthTab] = useState<'credentials' | 'google'>('credentials');
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  // Username & Password form
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [parsedError, setParsedError] = useState<ParsedAuthError | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  // Forgot Password state
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<{ message: string; isError?: boolean } | null>(
    null
  );

  // Mandatory first-login password change state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [changePwError, setChangePwError] = useState<string | null>(null);

  // Self-serve business owner workspace launch state
  const [companyName, setCompanyName] = useState('');
  const [industryId, setIndustryId] = useState(SAAS_INDUSTRY_BLUEPRINTS[0].id);
  const [selectedPlanId, setSelectedPlanId] = useState(
    saasPlans[1]?.id || saasPlans[0]?.id || 'plan_growth'
  );
  const [billingPhone, setBillingPhone] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCopyHostname = (host: string) => {
    void navigator.clipboard.writeText(host);
    setCopiedDomain(true);
    setTimeout(() => setCopiedDomain(false), 2000);
  };

  // Never redirect to login or onboarding while Firebase Auth is initializing OR
  // while the signed-in user's profile, roles, and organization are still loading.
  if (authLoading || (Boolean(user) && profileLoading)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-10 h-10 rounded-lg bg-blue-700 text-white font-display font-bold text-lg flex items-center justify-center">
            Z
          </div>
          <p className="text-sm font-semibold text-slate-800">
            {user ? 'Verifying your profile & workspace permissions…' : 'Restoring your Zacma session…'}
          </p>
          <p className="text-xs text-slate-500">
            Persistent session check in progress — please wait a moment.
          </p>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 1. UNAUTHENTICATED DUAL-METHOD LOGIN SCREEN
  // =========================================================================
  if (!user) {
    const handleGoogleSignIn = async () => {
      setSigningIn(true);
      setParsedError(null);
      try {
        await signInWithGoogle();
      } catch (err: unknown) {
        setParsedError(parseFirebaseAuthError(err));
      } finally {
        setSigningIn(false);
      }
    };

    const handleCredentialsSignIn = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!identifier.trim() || !password) {
        setParsedError({
          code: 'auth/missing-fields',
          message: 'Please enter both your username (or email) and password.',
          isUnauthorizedDomain: false,
          isPasswordProviderDisabled: false,
          currentHostname: window.location.hostname,
        });
        return;
      }
      setSigningIn(true);
      setParsedError(null);
      try {
        await signInWithUsername(identifier.trim(), password);
      } catch (err: unknown) {
        setParsedError(parseFirebaseAuthError(err));
      } finally {
        setSigningIn(false);
      }
    };

    const handleForgotSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!resetIdentifier.trim()) return;
      setResetLoading(true);
      setResetResult(null);
      try {
        const res = await requestPasswordReset(resetIdentifier.trim());
        setResetResult({ message: res.message, isError: false });
      } catch (err: unknown) {
        setResetResult({
          message: err instanceof Error ? err.message : 'Unable to send reset request.',
          isError: true,
        });
      } finally {
        setResetLoading(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
        {/* Left Brand & Architecture Panel */}
        <div className="lg:w-1/2 bg-slate-900 text-white p-8 sm:p-10 lg:p-16 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3 mb-12">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center font-display font-bold text-xl text-white">
                  Z
                </div>
                <span className="font-display font-bold text-xl tracking-tight text-white">
                  Zacma Cloud
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenStorefront}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-300 hover:text-white transition-colors cursor-pointer"
              >
                <Store className="w-3.5 h-3.5" />
                <span>SaaS Plans &amp; Pricing</span>
              </button>
            </div>

            <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight mb-5 max-w-lg text-balance">
              Multi-Business Operations, AI Forms, and Enterprise CRM in One Portal
            </h1>
            <p className="text-slate-300 text-base leading-relaxed max-w-lg mb-10">
              Secure multi-tenant workspace for administrators, staff, instructors, and students.
              Sign in with your Google account or administrator-issued username and password.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-xl">
              <div className="border-t border-slate-700/80 pt-4">
                <div className="flex items-center gap-2 text-blue-400 text-sm font-semibold mb-1.5">
                  <Layers className="w-4 h-4" />
                  <span>Multi-Business Control</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Independent branding, staff assignments, forms, and reports per business unit.
                </p>
              </div>
              <div className="border-t border-slate-700/80 pt-4">
                <div className="flex items-center gap-2 text-red-400 text-sm font-semibold mb-1.5">
                  <Sparkles className="w-4 h-4" />
                  <span>AI Form Generator</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Describe any form in plain language and publish with QR codes and conditional logic.
                </p>
              </div>
              <div className="border-t border-slate-700/80 pt-4">
                <div className="flex items-center gap-2 text-blue-400 text-sm font-semibold mb-1.5">
                  <Users className="w-4 h-4" />
                  <span>Centralized CRM &amp; SMS</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Automatic lead extraction, duplicate checks, Kanban pipeline, and bilingual SMS/Email.
                </p>
              </div>
              <div className="border-t border-slate-700/80 pt-4">
                <div className="flex items-center gap-2 text-red-400 text-sm font-semibold mb-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Role-Based SaaS Security</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Strict tenant isolation across Super Admins, Tenant Admins, Staff, and Student portals.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-slate-800 text-xs text-slate-400">
            Zacma SaaS Portal · Multi-Tenant Business &amp; Student Authentication
          </div>
        </div>

        {/* Right Dual-Method Sign-In Panel */}
        <div className="lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-16 bg-white">
          <div className="w-full max-w-md">
            <p className="text-xs font-medium text-blue-700 mb-1.5">Workspace Authentication</p>
            <h2 className="font-display text-2xl font-bold text-slate-900 mb-1.5">
              Sign in to Zacma Portal
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              Use your administrator-created username &amp; password or sign in with Google.
            </p>

            {/* Authentication Method Switcher */}
            {!showForgotPassword && (
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('credentials');
                    setParsedError(null);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    authTab === 'credentials'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Username &amp; Password
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('google');
                    setParsedError(null);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    authTab === 'google'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Google Login
                </button>
              </div>
            )}

            {/* Actionable Error & Domain Diagnostic Box */}
            {parsedError && (
              <div className="mb-5 p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-red-900">
                      {parsedError.isUnauthorizedDomain
                        ? 'Domain Not Yet Authorized in Firebase'
                        : parsedError.isPasswordProviderDisabled
                          ? 'Email/Password Sign-In Not Yet Enabled'
                          : 'Sign-In Error'}
                    </div>
                    <p className="mt-0.5 leading-relaxed">{parsedError.message}</p>
                  </div>
                </div>

                {parsedError.isUnauthorizedDomain && (
                  <div className="bg-white border border-red-200 rounded-lg p-3 space-y-2 text-slate-700">
                    <div className="text-[11px] font-semibold text-slate-900">
                      How to fix <span className="font-mono">auth/unauthorized-domain</span> in 20 seconds:
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
                      <code className="text-[11px] font-mono text-slate-900 truncate">
                        {parsedError.currentHostname}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopyHostname(parsedError.currentHostname)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 shrink-0 cursor-pointer"
                      >
                        {copiedDomain ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <ol className="list-decimal list-inside text-[11px] space-y-1 text-slate-600">
                      <li>Open Firebase Console for project <strong className="font-mono text-slate-800">{FIREBASE_PROJECT_ID}</strong>.</li>
                      <li>Go to <strong>Authentication → Settings → Authorized domains</strong>.</li>
                      <li>Click <strong>Add domain</strong>, paste the hostname above, and click <strong>Add</strong>.</li>
                    </ol>
                    <a
                      href={FIREBASE_CONSOLE_AUTH_DOMAINS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 hover:underline pt-0.5"
                    >
                      <span>Open Firebase Authorized Domains Settings</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {parsedError.isPasswordProviderDisabled && (
                  <div className="bg-white border border-red-200 rounded-lg p-3 space-y-1.5 text-slate-700">
                    <div className="text-[11px] font-semibold text-slate-900">
                      Enable Username &amp; Password Login in Firebase Console:
                    </div>
                    <ol className="list-decimal list-inside text-[11px] space-y-1 text-slate-600">
                      <li>Open <strong>Authentication → Sign-in method</strong> on <span className="font-mono">{FIREBASE_PROJECT_ID}</span>.</li>
                      <li>Click <strong>Add new provider → Email/Password</strong> and toggle <strong>Enable</strong>.</li>
                      <li>Save — Username &amp; Password sign-in works immediately with no redeployment.</li>
                    </ol>
                    <a
                      href={FIREBASE_CONSOLE_SIGNIN_METHODS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 hover:underline pt-0.5"
                    >
                      <span>Open Firebase Sign-In Methods</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Forgot Password Flow */}
            {showForgotPassword ? (
              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <KeyRound className="w-4 h-4 text-blue-700" />
                    <span>Reset Your Password</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Enter your username or registered email address. If your account has a recovery
                    email on file, we will send a Firebase password reset link.
                  </p>
                  <input
                    type="text"
                    required
                    value={resetIdentifier}
                    onChange={(e) => setResetIdentifier(e.target.value)}
                    placeholder="Username (e.g., abebe.k) or email"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {resetResult && (
                    <div
                      className={`p-3 rounded-lg text-xs border ${
                        resetResult.isError
                          ? 'bg-red-50 border-red-200 text-red-700'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                    >
                      {resetResult.message}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={resetLoading}
                      className="flex-1 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      {resetLoading ? 'Sending Reset Link…' : 'Send Password Reset'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(false);
                        setResetResult(null);
                      }}
                      className="px-3.5 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Back
                    </button>
                  </div>
                </div>
              </form>
            ) : authTab === 'credentials' ? (
              <div className="space-y-4">
                <form onSubmit={handleCredentialsSignIn} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Username or Email
                    </label>
                    <input
                      type="text"
                      autoComplete="username"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g., sara.admin or sara@zacma.com"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(true);
                          setResetIdentifier(identifier);
                          setParsedError(null);
                        }}
                        className="text-xs font-medium text-blue-700 hover:text-blue-900 cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full pl-3.5 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={signingIn}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    <Lock className="w-4 h-4" />
                    <span>{signingIn ? 'Verifying Credentials…' : 'Sign In'}</span>
                  </button>
                </form>

                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-slate-200" />
                  <span className="px-3 text-[11px] font-medium text-slate-400">or</span>
                  <div className="flex-grow border-t border-slate-200" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="w-full flex items-center justify-center gap-2.5 px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-60 text-slate-800 text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <UserCheck className="w-4 h-4 text-blue-700" />
                  <span>{signingIn ? 'Opening Google…' : 'Continue with Google'}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  <span>{signingIn ? 'Authenticating with Google…' : 'Continue with Google'}</span>
                </button>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Recommended for Super Admins, business owners starting a 14-day free trial, and
                  Google-invited team members.
                </p>
              </div>
            )}

            <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-bold text-slate-900 mb-1">
                Are you a business owner looking to subscribe?
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                Explore Starter, Growth, and Enterprise SaaS plans in ETB or USD and launch your own
                isolated multi-branch portal in 2 minutes.
              </p>
              <button
                type="button"
                onClick={onOpenStorefront}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 cursor-pointer"
              >
                <span>View SaaS Plans &amp; Start Free Trial</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-6 pt-5 border-t border-slate-200 text-xs text-slate-500 space-y-1">
              <p>
                Public forms:{' '}
                <span className="font-mono text-slate-700">/forms/&#123;business&#125;/&#123;form&#125;</span>
              </p>
              <p>
                SaaS storefront: <span className="font-mono text-slate-700">/pricing</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. SUSPENDED OR INACTIVE ACCOUNT GUARD
  // =========================================================================
  if (accountBlockedReason) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 mx-auto flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Account {accountBlockedReason === 'suspended' ? 'Suspended' : 'Deactivated'}
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Your Zacma account ({profile?.username ? `@${profile.username}` : user.email}) is
            currently <strong>{accountBlockedReason}</strong>. Please contact your organization
            administrator to reactivate access.
          </p>
          <button
            type="button"
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. FORCED PASSWORD CHANGE ON FIRST LOGIN
  // =========================================================================
  if (mustChangePassword) {
    const strength = validatePasswordStrength(newPw);

    const handleForceChange = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!strength.valid) {
        setChangePwError(strength.message);
        return;
      }
      if (newPw !== confirmPw) {
        setChangePwError('New password and confirmation do not match.');
        return;
      }
      setChangingPw(true);
      setChangePwError(null);
      try {
        await changeCurrentUserPassword(currentPw, newPw);
        setCurrentPw('');
        setNewPw('');
        setConfirmPw('');
      } catch (err: unknown) {
        setChangePwError(err instanceof Error ? err.message : 'Unable to update password.');
      } finally {
        setChangingPw(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 space-y-5 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-blue-700 text-white flex items-center justify-center">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h1 className="font-display text-lg font-bold text-slate-900">
                  Update Your Password
                </h1>
                <p className="text-xs text-slate-500">
                  Required before first workspace sign-in
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              className="text-xs font-medium text-slate-500 hover:text-red-600 cursor-pointer"
            >
              Sign Out
            </button>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Your administrator issued a temporary password for{' '}
            <strong className="text-slate-900">
              {profile?.username ? `@${profile.username}` : user.email}
            </strong>
            . Choose a strong personal password to protect your account.
          </p>

          {changePwError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {changePwError}
            </div>
          )}

          <form onSubmit={handleForceChange} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Temporary / Current Password *
              </label>
              <input
                type="password"
                required
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                New Strong Password *
              </label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  required
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                <span className={strength.checks.length ? 'text-emerald-700' : 'text-slate-400'}>
                  {strength.checks.length ? '✓' : '•'} 8+ characters
                </span>
                <span className={strength.checks.upper ? 'text-emerald-700' : 'text-slate-400'}>
                  {strength.checks.upper ? '✓' : '•'} Uppercase (A-Z)
                </span>
                <span className={strength.checks.lower ? 'text-emerald-700' : 'text-slate-400'}>
                  {strength.checks.lower ? '✓' : '•'} Lowercase (a-z)
                </span>
                <span className={strength.checks.number ? 'text-emerald-700' : 'text-slate-400'}>
                  {strength.checks.number ? '✓' : '•'} Number (0-9)
                </span>
                <span className={strength.checks.special ? 'text-emerald-700' : 'text-slate-400'}>
                  {strength.checks.special ? '✓' : '•'} Symbol (!@#$%)
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Confirm New Password *
              </label>
              <input
                type="password"
                required
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={changingPw || !strength.valid}
              className="w-full px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              {changingPw ? 'Updating Password…' : 'Save New Password & Enter Portal'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3b. TRANSIENT DATABASE RECOVERY (NEVER AUTO-LOGOUT ON TEMPORARY DB FAILURE)
  // =========================================================================
  if (profileError && !profile && !isSystemOwner) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Workspace Sync Interrupted
          </h1>
          <p className="text-xs text-slate-600 leading-relaxed">{profileError}</p>
          <p className="text-xs text-slate-500">
            Signed in as <strong className="text-slate-800">{user.email}</strong> — your session is
            still active.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void retryProfileSync()}
              className="flex-1 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              Retry Connection
            </button>
            <button
              type="button"
              onClick={logout}
              className="px-4 py-2.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 4. SIGNED IN WITH NO ORGANIZATION ACCESS YET (SELF-SERVE TRIAL OR INVITE)
  // =========================================================================
  if (!organization && !isSuperAdmin && !isSystemOwner && !isStudent) {
    const handleSelfServeLaunch = async (e: React.FormEvent) => {
      e.preventDefault();
      if (companyName.trim().length < 2) {
        setCreateError('Please enter your company or business name.');
        return;
      }
      const plan =
        saasPlans.find((p) => p.id === selectedPlanId) || saasPlans[1] || saasPlans[0];
      if (!plan) return;

      setCreatingWorkspace(true);
      setCreateError(null);
      try {
        await provisionNewTenantWorkspace({
          companyName: companyName.trim(),
          industryId,
          billingPhone: billingPhone.trim(),
          plan,
          billingCycle: 'monthly',
          currency: 'ETB',
          ownerUid: user.uid,
          ownerName: user.displayName || user.email || 'Business Owner',
          ownerEmail: user.email || '',
          ownerPhotoURL: user.photoURL || '',
          initialStatus: 'trial',
          paymentMethod: 'trial',
          switchUserProfileToNewOrg: true,
        });
      } catch (err: unknown) {
        setCreateError(
          err instanceof Error ? err.message : 'Unable to create your workspace right now.'
        );
      } finally {
        setCreatingWorkspace(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-4xl w-full space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Welcome, {user.displayName || user.email}
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Launch your own isolated Zacma Cloud business workspace or join an existing team.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenStorefront}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <Store className="w-3.5 h-3.5" />
                <span>Compare Plans</span>
              </button>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Path 1: Business Owner Self-Serve SaaS Trial */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-7">
              <div className="flex items-center gap-2 text-blue-700 text-xs font-semibold mb-2">
                <Building2 className="w-4 h-4" />
                <span>Option 1 · For Business Owners</span>
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mb-1">
                Launch Your Own Business Workspace
              </h2>
              <p className="text-xs text-slate-600 mb-5">
                Start a 14-day free trial with your own isolated branches, AI forms, CRM, SMS/Email
                center, and team roles.
              </p>

              {createError && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {createError}
                </div>
              )}

              <form onSubmit={handleSelfServeLaunch} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Business / Organization Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g., Selam Medical Center or Addis Academy"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Industry Blueprint
                    </label>
                    <select
                      value={industryId}
                      onChange={(e) => setIndustryId(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      {SAAS_INDUSTRY_BLUEPRINTS.map((bp) => (
                        <option key={bp.id} value={bp.id}>
                          {bp.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Trial Plan Tier
                    </label>
                    <select
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      {saasPlans
                        .filter((p) => p.isActive)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.monthlyPriceEtb.toLocaleString()} ETB / ${p.monthlyPriceUsd})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={billingPhone}
                    onChange={(e) => setBillingPhone(e.target.value)}
                    placeholder="+251 9XX XXX XXX"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={creatingWorkspace}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    {creatingWorkspace
                      ? 'Provisioning Your Workspace…'
                      : 'Start 14-Day Free Trial & Enter Portal'}
                  </span>
                </button>
              </form>
            </div>

            {/* Path 2: Join Existing Staff Team */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-7 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold mb-2">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Option 2 · For Invited Staff</span>
                </div>
                <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
                  Join an Existing Organization
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed mb-5">
                  If your employer already uses Zacma Cloud, share your User ID below with your
                  organization&apos;s administrator so they can assign your role in{' '}
                  <span className="font-semibold text-slate-800">User Management</span>.
                </p>

                <div className="text-[11px] font-medium text-slate-500 mb-1">Signed-in Email</div>
                <div className="text-xs font-medium text-slate-900 mb-4">{user.email}</div>

                <div className="text-[11px] font-medium text-slate-500 mb-1">Your User UID</div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs font-mono text-slate-700 select-all break-all">
                  {user.uid}
                </div>
              </div>

              <div className="pt-5 mt-6 border-t border-slate-100 text-[11px] text-slate-500">
                Once added by your administrator, refresh or sign in again to access your assigned
                workspace.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
