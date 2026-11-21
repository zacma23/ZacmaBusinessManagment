import React, { useState } from 'react';
import {
  ArrowRight,
  Building2,
  Layers,
  Lock,
  LogOut,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { usePortal } from '../context/PortalContext';
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
    organization,
    isSuperAdmin,
    saasPlans,
    signInWithGoogle,
    logout,
  } = usePortal();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Self-serve business owner workspace launch state
  const [companyName, setCompanyName] = useState('');
  const [industryId, setIndustryId] = useState(SAAS_INDUSTRY_BLUEPRINTS[0].id);
  const [selectedPlanId, setSelectedPlanId] = useState(
    saasPlans[1]?.id || saasPlans[0]?.id || 'plan_growth'
  );
  const [billingPhone, setBillingPhone] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-700 text-white font-display font-bold text-lg flex items-center justify-center">
            Z
          </div>
          <p className="text-sm font-medium text-slate-600">Loading Zacma SaaS Portal…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    const handleSignIn = async () => {
      setSigningIn(true);
      setError(null);
      try {
        await signInWithGoogle();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Sign-in was cancelled or failed.');
      } finally {
        setSigningIn(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
        {/* Left Brand & Architecture Panel */}
        <div className="lg:w-1/2 bg-slate-900 text-white p-10 lg:p-16 flex flex-col justify-between">
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
              Launch unlimited business units, generate validated registration and inquiry forms
              from natural language, capture leads automatically via public URLs, and run your own
              branded SaaS workspace.
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
                  <span>Multi-Tenant SaaS Ready</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Dedicated isolated workspace per subscribing business owner with role governance.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-slate-800 text-xs text-slate-400">
            Zacma SaaS Portal · Multi-Tenant Business Administration Console
          </div>
        </div>

        {/* Right Sign-In & SaaS Buyer Entry Panel */}
        <div className="lg:w-1/2 flex items-center justify-center p-8 lg:p-16 bg-white">
          <div className="w-full max-w-md">
            <p className="text-xs font-medium text-blue-700 mb-2">Workspace Authentication</p>
            <h2 className="font-display text-2xl font-bold text-slate-900 mb-2">
              Sign in to Zacma Portal
            </h2>
            <p className="text-sm text-slate-600 mb-8">
              Authenticate with your Google account to open your organization workspace or start a
              new 14-day free trial for your business.
            </p>

            {error && (
              <div className="mb-6 p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleSignIn}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{signingIn ? 'Authenticating…' : 'Continue with Google'}</span>
            </button>

            <div className="mt-6 p-5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-bold text-slate-900 mb-1">
                Are you a business owner looking to subscribe?
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-3.5">
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

            <div className="mt-8 pt-6 border-t border-slate-200 text-xs text-slate-500 space-y-1.5">
              <p>
                Public form links operate without login at{' '}
                <span className="font-mono text-slate-700">/forms/&#123;business&#125;/&#123;form&#125;</span>.
              </p>
              <p>
                Public SaaS storefront &amp; pricing is live at{' '}
                <span className="font-mono text-slate-700">/pricing</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed in, but no organization access yet — offer BOTH Self-Serve SaaS Trial Launch AND Join Existing Org
  if (!organization && !isSuperAdmin) {
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
                  organization&apos;s Super Admin so they can assign your role in{' '}
                  <span className="font-semibold text-slate-800">Business Staff</span>.
                </p>

                <div className="text-[11px] font-medium text-slate-500 mb-1">Signed-in Email</div>
                <div className="text-xs font-medium text-slate-900 mb-4">{user.email}</div>

                <div className="text-[11px] font-medium text-slate-500 mb-1">Your User UID</div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs font-mono text-slate-700 select-all break-all">
                  {user.uid}
                </div>
              </div>

              <div className="pt-5 mt-6 border-t border-slate-100 text-[11px] text-slate-500">
                Once added by your administrator, refresh or sign in again to access assigned
                business units.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
