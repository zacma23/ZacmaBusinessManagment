import React, { useState } from 'react';
import { ShieldCheck, Layers, Sparkles, Users, Lock, LogOut } from 'lucide-react';
import { usePortal } from '../context/PortalContext';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, authLoading, organization, isSuperAdmin, signInWithGoogle, logout } = usePortal();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <div className="flex items-center gap-3 mb-12">
              <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center font-display font-bold text-xl text-white">
                Z
              </div>
              <span className="font-display font-bold text-xl tracking-tight text-white">
                Zacma Technology
              </span>
            </div>

            <h1 className="font-display text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight mb-5 max-w-lg text-balance">
              Multi-Business Operations, AI Forms, and Enterprise CRM in One Portal
            </h1>
            <p className="text-slate-300 text-base leading-relaxed max-w-lg mb-10">
              Launch unlimited business units, generate validated registration and inquiry forms
              from natural language, capture leads automatically via public URLs, and manage every
              pipeline stage with role-based governance.
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
                  <span>Centralized CRM</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Automatic lead extraction, duplicate checks, Kanban pipeline, and communications.
                </p>
              </div>
              <div className="border-t border-slate-700/80 pt-4">
                <div className="flex items-center gap-2 text-red-400 text-sm font-semibold mb-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Enforced RBAC</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Organization isolation, role tiers, audit trails, and Firebase Security Rules.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-slate-800 text-xs text-slate-400">
            Zacma SaaS Portal · Enterprise Administration Console
          </div>
        </div>

        {/* Right Sign-In Panel */}
        <div className="lg:w-1/2 flex items-center justify-center p-8 lg:p-16 bg-white">
          <div className="w-full max-w-md">
            <p className="text-xs font-medium text-blue-700 mb-2">Workspace Authentication</p>
            <h2 className="font-display text-2xl font-bold text-slate-900 mb-2">
              Sign in to Zacma Portal
            </h2>
            <p className="text-sm text-slate-600 mb-8">
              Authenticate with your authorized Google workspace account to access business units,
              AI forms, and CRM records.
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

            <div className="mt-8 pt-6 border-t border-slate-200 text-xs text-slate-500 space-y-1.5">
              <p>Public form links operate without login at <span className="font-mono text-slate-700">/forms/&#123;business&#125;/&#123;form&#125;</span>.</p>
              <p>Administrative actions are recorded in the immutable organization audit log.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed in, but awaiting organization membership approval (non-bootstrap user with no org access)
  if (!organization && !isSuperAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
            Account Awaiting Organization Access
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            Signed in as <span className="font-medium text-slate-900">{user.email}</span>. Ask your
            Zacma Super Admin to assign your role and business unit membership in{' '}
            <span className="font-medium">Business Staff</span> using your UID:
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 mb-6 select-all break-all">
            {user.uid}
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-medium transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
