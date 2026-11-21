import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  Globe,
  Layers,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import {
  computePlanCyclePrice,
  DEFAULT_SAAS_PLANS,
  fetchPublicSaasPlans,
  provisionNewTenantWorkspace,
  SAAS_INDUSTRY_BLUEPRINTS,
  submitPublicSaasInquiry,
} from '../lib/saasService';
import type { SaasPlan } from '../types';

interface SaasStorefrontProps {
  onOpenPortal: () => void;
  onTenantProvisioned?: (organizationId: string) => void;
  isSignedIn?: boolean;
  userDisplayName?: string;
  userEmail?: string;
}

const HERO_IMG = '/src/assets/images/saas_hero_workspace_1795283696786.jpg';
const SHOWCASE_IMG = '/src/assets/images/saas_industry_showcase_1795283700318.jpg';

export function SaasStorefront({
  onOpenPortal,
  onTenantProvisioned,
  isSignedIn = false,
  userDisplayName,
  userEmail,
}: SaasStorefrontProps) {
  const [plans, setPlans] = useState<SaasPlan[]>(
    DEFAULT_SAAS_PLANS.map((p) => ({ ...p, updatedAt: null }))
  );
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [currency, setCurrency] = useState<'ETB' | 'USD'>('ETB');
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [showcaseImgFailed, setShowcaseImgFailed] = useState(false);

  // Instant Workspace Provisioning Modal
  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SaasPlan>(plans[1] || plans[0]);
  const [companyName, setCompanyName] = useState('');
  const [industryId, setIndustryId] = useState(SAAS_INDUSTRY_BLUEPRINTS[0].id);
  const [brandColor, setBrandColor] = useState('#1D4ED8');
  const [billingPhone, setBillingPhone] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Enterprise / Sales Inquiry Form
  const [inqCompany, setInqCompany] = useState('');
  const [inqContact, setInqContact] = useState('');
  const [inqEmail, setInqEmail] = useState('');
  const [inqPhone, setInqPhone] = useState('');
  const [inqIndustry, setInqIndustry] = useState(SAAS_INDUSTRY_BLUEPRINTS[0].label);
  const [inqBranches, setInqBranches] = useState('2–5 Branches');
  const [inqPlan, setInqPlan] = useState('Growth');
  const [inqMessage, setInqMessage] = useState('');
  const [inqSubmitting, setInqSubmitting] = useState(false);
  const [inqError, setInqError] = useState<string | null>(null);
  const [inqSuccessRef, setInqSuccessRef] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicSaasPlans().then((loaded) => {
      if (!active || loaded.length === 0) return;
      setPlans(loaded);
      const rec = loaded.find((p) => p.isRecommended) || loaded[0];
      setSelectedPlan(rec);
    });
    return () => {
      active = false;
    };
  }, []);

  const openLaunchWithPlan = (plan: SaasPlan, presetIndustryId?: string) => {
    setSelectedPlan(plan);
    if (presetIndustryId) {
      setIndustryId(presetIndustryId);
      const bp = SAAS_INDUSTRY_BLUEPRINTS.find((b) => b.id === presetIndustryId);
      if (bp) setBrandColor(bp.brandColor);
    }
    setLaunchError(null);
    setLaunchModalOpen(true);
  };

  const handleLaunchWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (companyName.trim().length < 2) {
      setLaunchError('Please enter your business or organization name.');
      return;
    }

    setLaunching(true);
    setLaunchError(null);
    try {
      let currentUser = auth.currentUser;
      if (!currentUser) {
        const cred = await signInWithPopup(auth, googleProvider);
        currentUser = cred.user;
      }

      if (!currentUser || !currentUser.emailVerified) {
        throw new Error('A verified Google account is required to provision your workspace.');
      }

      const result = await provisionNewTenantWorkspace({
        companyName: companyName.trim(),
        industryId,
        primaryColor: brandColor,
        billingPhone: billingPhone.trim(),
        plan: selectedPlan,
        billingCycle,
        currency,
        ownerUid: currentUser.uid,
        ownerName: currentUser.displayName || currentUser.email || 'Business Owner',
        ownerEmail: currentUser.email || '',
        ownerPhotoURL: currentUser.photoURL || '',
        initialStatus: 'trial',
        paymentMethod: 'trial',
        switchUserProfileToNewOrg: true,
      });

      setLaunchModalOpen(false);
      if (onTenantProvisioned) {
        onTenantProvisioned(result.organizationId);
      } else {
        onOpenPortal();
      }
    } catch (err: unknown) {
      setLaunchError(
        err instanceof Error ? err.message : 'Unable to launch workspace right now. Please try again.'
      );
    } finally {
      setLaunching(false);
    }
  };

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inqCompany.trim().length < 2 || inqContact.trim().length < 2) {
      setInqError('Please enter both your company name and contact name.');
      return;
    }
    if (!inqEmail.trim() && !inqPhone.trim()) {
      setInqError('Please provide an email address or phone number so our team can reach you.');
      return;
    }

    setInqSubmitting(true);
    setInqError(null);
    try {
      const refId = await submitPublicSaasInquiry({
        companyName: inqCompany,
        contactName: inqContact,
        email: inqEmail,
        phone: inqPhone,
        industry: inqIndustry,
        branchCount: inqBranches,
        interestedPlan: inqPlan,
        message: inqMessage,
      });
      setInqSuccessRef(refId);
      setInqCompany('');
      setInqContact('');
      setInqEmail('');
      setInqPhone('');
      setInqMessage('');
    } catch (err: unknown) {
      setInqError(
        err instanceof Error ? err.message : 'Could not submit inquiry. Please try again.'
      );
    } finally {
      setInqSubmitting(false);
    }
  };

  const recommendedPlan = plans.find((p) => p.isRecommended) || plans[0];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="font-display font-bold text-lg tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Zacma Cloud
          </button>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#platform"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Platform
            </a>
            <a
              href="#industries"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Industries
            </a>
            <a
              href="#pricing"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Pricing
            </a>
            <a
              href="#contact"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Contact
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={onOpenPortal}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isSignedIn ? 'Open Portal' : 'Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section — Balanced 2-Column Split */}
      <section className="max-w-7xl mx-auto px-6 pt-14 pb-16 lg:pt-20 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-xs font-semibold text-blue-700 mb-3">
              Multi-Tenant Business Software · Addis Ababa &amp; Global
            </p>
            <h1
              className="font-display font-bold tracking-tight text-slate-900 leading-[1.1] mb-5 text-balance"
              style={{ fontSize: 'clamp(2.25rem, 3.8vw, 3.4rem)' }}
            >
              Run Every Branch, Form, Lead, and Client Message in One Branded Portal
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-8">
              Built for training academies, clinics, real estate agencies, consultancies, and
              multi-branch companies. Launch your own isolated workspace with AI-built public forms,
              CRM pipelines, bilingual SMS &amp; Email campaigns, and 24/7 AI customer support.
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-10">
              <button
                type="button"
                onClick={() => openLaunchWithPlan(recommendedPlan)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Start 14-Day Free Trial</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#pricing"
                className="text-sm font-semibold text-slate-700 hover:text-blue-700 transition-colors whitespace-nowrap shrink-0"
              >
                Compare Plans &amp; Quotas
              </a>
            </div>

            <div className="grid grid-cols-3 gap-6 pt-6 border-t border-slate-200 max-w-lg">
              <div>
                <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">2 min</div>
                <div className="text-xs text-slate-500 mt-0.5">Workspace setup</div>
              </div>
              <div>
                <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">100%</div>
                <div className="text-xs text-slate-500 mt-0.5">Tenant data isolation</div>
              </div>
              <div>
                <div className="font-mono text-xl font-bold text-slate-900 tabular-nums">EN / አማ</div>
                <div className="text-xs text-slate-500 mt-0.5">Bilingual AI &amp; SMS</div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[300px] lg:min-h-[420px] rounded-xl overflow-hidden border border-slate-200 bg-slate-900 relative">
              {!heroImgFailed ? (
                <img
                  src={HERO_IMG}
                  alt="Modern multi-branch business operations workspace powered by Zacma Cloud"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-10 text-center text-white">
                  <Building2 className="w-10 h-10 text-blue-400 mb-3" />
                  <p className="font-display font-semibold text-lg">Zacma Cloud Multi-Tenant Portal</p>
                  <p className="text-xs text-slate-300 mt-1 max-w-sm">
                    Isolated workspaces, AI forms, CRM pipelines, and bilingual SMS/Email delivery.
                  </p>
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent p-6 text-white">
                <p className="text-xs text-slate-200">
                  Trusted architecture running Zacma Technology Training Institute &amp; multi-branch client tenants
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Capabilities — Editorial Numbered Bento Grid */}
      <section id="platform" className="bg-slate-50 border-y border-slate-200 py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold text-blue-700 mb-2">Included in Your Workspace</p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance">
              Five integrated modules replacing disconnected spreadsheets and chat threads
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-7 flex flex-col justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900 mb-2">
                  01. Multi-Branch &amp; Business Unit Control
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  Manage one headquarters or dozens of independent branches under a single login.
                  Assign branch managers, upload custom logos, pick brand colors, and review
                  per-branch conversion metrics side by side.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-5 border-t border-slate-100 text-xs text-slate-600">
                <div className="flex items-start gap-2">
                  <Layers className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                  <span>Role-based staff permissions per branch</span>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                  <span>Strict organization isolation &amp; immutable audit logs</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-7">
              <h3 className="font-display text-lg font-bold text-slate-900 mb-2">
                02. AI Form Builder &amp; Public QR Links
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed mb-5">
                Describe any registration, booking, or intake form in plain English. Generate
                validated fields, conditional logic, shareable public URLs, and printable QR codes
                instantly.
              </p>
              <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 font-mono">
                /forms/your-branch/client-registration
              </div>
            </div>

            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-7">
              <h3 className="font-display text-lg font-bold text-slate-900 mb-2">
                03. Centralized CRM &amp; Pipeline
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Every form submission automatically creates a CRM lead with duplicate detection,
                Kanban stage tracking, follow-up reminders, staff assignment, and CSV reporting.
              </p>
            </div>

            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-7">
              <h3 className="font-display text-lg font-bold text-slate-900 mb-2">
                04. Bilingual Email &amp; SMS Outreach
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Draft personalized English or Amharic messages with AI, verify exact GSM-7 or
                Unicode SMS segments, and dispatch via Resend, Twilio, or AfroMessage Ethiopia.
              </p>
            </div>

            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-7">
              <h3 className="font-display text-lg font-bold text-slate-900 mb-2">
                05. 24/7 AI Customer Support Widget
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Answer customer inquiries around the clock using your approved services, prices, and
                FAQs—capturing qualified leads and escalating complex requests to human staff.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Industry Blueprints */}
      <section id="industries" className="max-w-7xl mx-auto px-6 py-16 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch mb-10">
          <div className="lg:col-span-7 flex flex-col justify-center">
            <p className="text-xs font-semibold text-blue-700 mb-2">Tailored Onboarding</p>
            <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 mb-3 text-balance">
              Pre-configured blueprints for service and multi-branch businesses
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed max-w-xl">
              Select your business category to pre-populate your starter branch structure, service
              catalog, and AI customer assistant instructions on day one.
            </p>
          </div>
          <div className="lg:col-span-5">
            <div className="h-52 lg:h-full rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
              {!showcaseImgFailed ? (
                <img
                  src={SHOWCASE_IMG}
                  alt="Business owners collaborating in their workspace"
                  referrerPolicy="no-referrer"
                  onError={() => setShowcaseImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400">
                  <Users className="w-8 h-8" />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {SAAS_INDUSTRY_BLUEPRINTS.map((bp) => (
            <div
              key={bp.id}
              className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between hover:border-slate-300 transition-colors"
            >
              <div>
                <div className="text-xs text-slate-500 mb-1.5">{bp.category}</div>
                <h3 className="font-display text-base font-bold text-slate-900 mb-2">{bp.label}</h3>
                <p className="text-xs text-slate-600 leading-relaxed mb-4">{bp.description}</p>
                <div className="text-xs text-slate-500 mb-5">
                  {bp.services.join(' · ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => openLaunchWithPlan(recommendedPlan, bp.id)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 transition-colors cursor-pointer"
              >
                <span>Launch with this blueprint</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Commercial SaaS Pricing Section */}
      <section id="pricing" className="bg-slate-50 border-y border-slate-200 py-16 lg:py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold text-blue-700 mb-2">Transparent SaaS Pricing</p>
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 text-balance">
                Simple plans with predictable quotas in ETB or USD
              </h2>
              <p className="text-sm text-slate-600 mt-2">
                Every new business starts with a full-featured 14-day free trial. Pay locally via
                Telebirr or Commercial Bank of Ethiopia, or internationally by card or invoice.
              </p>
            </div>

            {/* Interactive Billing Cycle & Currency Segmented Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center p-1 bg-slate-200/80 rounded-lg">
                <button
                  type="button"
                  onClick={() => setBillingCycle('monthly')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    billingCycle === 'monthly'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('annual')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    billingCycle === 'annual'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Annual (Save 20%)
                </button>
              </div>

              <div className="inline-flex items-center p-1 bg-slate-200/80 rounded-lg">
                <button
                  type="button"
                  onClick={() => setCurrency('ETB')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    currency === 'ETB'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ETB
                </button>
                <button
                  type="button"
                  onClick={() => setCurrency('USD')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    currency === 'USD'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  USD
                </button>
              </div>
            </div>
          </div>

          {/* Plan Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-14">
            {plans.map((plan) => {
              const price = computePlanCyclePrice(plan, billingCycle);
              const displayPrice =
                currency === 'ETB'
                  ? `${price.monthlyEquivalentEtb.toLocaleString()} ETB`
                  : `$${price.monthlyEquivalentUsd.toLocaleString()}`;
              const annualTotal =
                currency === 'ETB'
                  ? `${price.etb.toLocaleString()} ETB billed annually`
                  : `$${price.usd.toLocaleString()} billed annually`;

              return (
                <div
                  key={plan.id}
                  className={`rounded-xl p-7 flex flex-col justify-between bg-white border ${
                    plan.isRecommended
                      ? 'border-blue-700 ring-1 ring-blue-700'
                      : 'border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-display text-xl font-bold text-slate-900">{plan.name}</h3>
                      {plan.isRecommended && (
                        <span className="text-xs font-semibold text-blue-700">Most Popular</span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-slate-500 mb-4">{plan.audience}</p>

                    <div className="mb-2">
                      <span className="font-mono text-3xl font-bold text-slate-900 tabular-nums">
                        {displayPrice}
                      </span>
                      <span className="text-xs text-slate-500 ml-1.5">/ month</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-5 h-4">
                      {billingCycle === 'annual' ? annualTotal : 'Billed monthly · Cancel anytime'}
                    </p>

                    <p className="text-xs text-slate-600 leading-relaxed pb-5 mb-5 border-b border-slate-100">
                      {plan.tagline}
                    </p>

                    <ul className="space-y-2.5 mb-8">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2.5 text-xs text-slate-700">
                          <Check className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() => openLaunchWithPlan(plan)}
                    className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      plan.isRecommended
                        ? 'bg-blue-700 hover:bg-blue-800 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    Start 14-Day Trial on {plan.name}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Concrete Quota Comparison Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="font-display text-base font-bold text-slate-900">
                Plan Limits &amp; Capability Comparison
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-6 font-semibold">Capability / Limit</th>
                    {plans.map((p) => (
                      <th key={p.id} className="py-3 px-6 font-semibold text-right">
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <tr>
                    <td className="py-3 px-6 font-medium">Business Units / Branches</td>
                    {plans.map((p) => (
                      <td key={p.id} className="py-3 px-6 text-right font-mono tabular-nums">
                        {p.maxBusinessUnits.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-6 font-medium">AI &amp; Custom Public Forms</td>
                    {plans.map((p) => (
                      <td key={p.id} className="py-3 px-6 text-right font-mono tabular-nums">
                        {p.maxForms.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-6 font-medium">CRM Lead Capacity</td>
                    {plans.map((p) => (
                      <td key={p.id} className="py-3 px-6 text-right font-mono tabular-nums">
                        {p.maxLeads.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-6 font-medium">Team Staff Seats (RBAC)</td>
                    {plans.map((p) => (
                      <td key={p.id} className="py-3 px-6 text-right font-mono tabular-nums">
                        {p.maxStaffSeats.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-6 font-medium">Bilingual AI Email &amp; SMS Writer</td>
                    {plans.map((p) => (
                      <td key={p.id} className="py-3 px-6 text-right">
                        {p.includesSmsEmailAi ? 'Included' : 'Not included'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-6 font-medium">24/7 AI Customer Support Widget</td>
                    {plans.map((p) => (
                      <td key={p.id} className="py-3 px-6 text-right">
                        {p.includesAiSupport ? 'Included' : 'Upgrade to Growth'}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-3 px-6 font-medium">White-Label Workspace Branding</td>
                    {plans.map((p) => (
                      <td key={p.id} className="py-3 px-6 text-right">
                        {p.includesWhiteLabel ? 'Included' : 'Enterprise only'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Guided Enterprise Demo & Local Payment Inquiry Section */}
      <section id="contact" className="max-w-7xl mx-auto px-6 py-16 lg:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5">
            <p className="text-xs font-semibold text-blue-700 mb-2">Guided Onboarding &amp; Sales</p>
            <h2 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 mb-4 text-balance">
              Need custom onboarding, Telebirr invoicing, or a live walkthrough?
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">
              Our implementation team helps Ethiopian and international business owners migrate
              existing spreadsheets, configure AfroMessage/Twilio SMS senders, and train branch staff.
            </p>
            <div className="space-y-3 text-xs text-slate-600 border-t border-slate-200 pt-5">
              <div className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-blue-700 shrink-0" />
                <span>Dedicated isolated database namespace per subscribing company</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-blue-700 shrink-0" />
                <span>Local Telebirr, CBE Bank Transfer, Chapa &amp; international billing</span>
              </div>
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-4 h-4 text-blue-700 shrink-0" />
                <span>Direct WhatsApp, phone, and portal onboarding support</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-7">
            {inqSuccessRef ? (
              <div className="py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-6 h-6" />
                </div>
                <h3 className="font-display text-lg font-bold text-slate-900 mb-2">
                  Onboarding Inquiry Received
                </h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto mb-4">
                  Thank you! Our SaaS onboarding team will reach out shortly with your workspace setup
                  and invoice options. Reference ID:{' '}
                  <span className="font-mono font-semibold text-slate-900">{inqSuccessRef}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setInqSuccessRef(null)}
                  className="px-4 py-2 border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Submit Another Inquiry
                </button>
              </div>
            ) : (
              <form onSubmit={handleInquirySubmit} className="space-y-4">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Request a SaaS Demo or Enterprise Quote
                </h3>
                {inqError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {inqError}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Business / Company Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={inqCompany}
                      onChange={(e) => setInqCompany(e.target.value)}
                      placeholder="e.g., Abyssinia Medical Group"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Your Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={inqContact}
                      onChange={(e) => setInqContact(e.target.value)}
                      placeholder="e.g., Dawit Bekele"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Work Email
                    </label>
                    <input
                      type="email"
                      value={inqEmail}
                      onChange={(e) => setInqEmail(e.target.value)}
                      placeholder="owner@company.com"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Phone / WhatsApp
                    </label>
                    <input
                      type="tel"
                      value={inqPhone}
                      onChange={(e) => setInqPhone(e.target.value)}
                      placeholder="+251 9XX XXX XXX"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Industry</label>
                    <select
                      value={inqIndustry}
                      onChange={(e) => setInqIndustry(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {SAAS_INDUSTRY_BLUEPRINTS.map((bp) => (
                        <option key={bp.id} value={bp.label}>
                          {bp.label}
                        </option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Branches</label>
                    <select
                      value={inqBranches}
                      onChange={(e) => setInqBranches(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="1 Branch">1 Branch</option>
                      <option value="2–5 Branches">2–5 Branches</option>
                      <option value="6–20 Branches">6–20 Branches</option>
                      <option value="20+ Branches">20+ Branches</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Target Plan
                    </label>
                    <select
                      value={inqPlan}
                      onChange={(e) => setInqPlan(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tell us about your operations (optional)
                  </label>
                  <textarea
                    rows={3}
                    value={inqMessage}
                    onChange={(e) => setInqMessage(e.target.value)}
                    placeholder="Share your goals, SMS/Email volume, or onboarding timeline…"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={inqSubmitting}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    {inqSubmitting ? 'Submitting…' : 'Request Guided Demo'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="font-display font-bold text-slate-900">Zacma Cloud</div>
          <div>Multi-Tenant SaaS Platform by Zacma Technology · All rights reserved</div>
          <button
            type="button"
            onClick={onOpenPortal}
            className="text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
          >
            {isSignedIn ? 'Return to Workspace' : 'Existing Customer Sign In'}
          </button>
        </div>
      </footer>

      {/* Self-Serve Workspace Provisioning Modal */}
      {launchModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Launch Your Business Workspace
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  14-day free trial on <span className="font-semibold text-slate-800">{selectedPlan.name}</span> · No credit card required
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLaunchModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLaunchWorkspace} className="p-6 space-y-4">
              {launchError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {launchError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Company / Business Name *
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g., Horizon Academy or EthioCare Clinic"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Business Category
                  </label>
                  <select
                    value={industryId}
                    onChange={(e) => {
                      setIndustryId(e.target.value);
                      const bp = SAAS_INDUSTRY_BLUEPRINTS.find((b) => b.id === e.target.value);
                      if (bp) setBrandColor(bp.brandColor);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                    Subscription Tier
                  </label>
                  <select
                    value={selectedPlan.id}
                    onChange={(e) => {
                      const next = plans.find((p) => p.id === e.target.value);
                      if (next) setSelectedPlan(next);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.monthlyPriceEtb.toLocaleString()} ETB / ${p.monthlyPriceUsd})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Business Phone (for billing &amp; SMS)
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      value={billingPhone}
                      onChange={(e) => setBillingPhone(e.target.value)}
                      placeholder="+251 9XX XXX XXX"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Brand Primary Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="w-10 h-9 rounded border border-slate-300 cursor-pointer"
                    />
                    <span className="font-mono text-xs text-slate-600">{brandColor}</span>
                  </div>
                </div>
              </div>

              {isSignedIn && userEmail && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
                  Provisioning as workspace owner:{' '}
                  <span className="font-semibold text-slate-900">
                    {userDisplayName || userEmail}
                  </span>{' '}
                  ({userEmail})
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setLaunchModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={launching}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {isSignedIn ? <Sparkles className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  <span>
                    {launching
                      ? 'Provisioning Workspace…'
                      : isSignedIn
                        ? 'Launch Workspace Now'
                        : 'Continue with Google & Launch'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
