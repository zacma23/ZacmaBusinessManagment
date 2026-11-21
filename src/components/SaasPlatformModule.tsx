import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Check,
  Copy,
  CreditCard,
  Edit3,
  ExternalLink,
  Plus,
  Receipt,
  Search,
  Sparkles,
  Store,
  Users,
  X,
} from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import {
  approveSaasInvoicePayment,
  computePlanCyclePrice,
  formatIsoDatePlusDays,
  provisionNewTenantWorkspace,
  SAAS_INDUSTRY_BLUEPRINTS,
  saveSaasPlan,
  submitTenantUpgradePayment,
  updateSaasInquiryStatus,
  updateTenantSubscriptionByAdmin,
} from '../lib/saasService';
import type {
  SaasInvoice,
  SaasPaymentMethod,
  SaasPlan,
  SaasSalesInquiry,
  SaasTenantStatus,
  SaasTenantSubscription,
} from '../types';

interface SaasPlatformModuleProps {
  mode: 'saas_platform_console' | 'tenant_billing';
  onOpenStorefront: () => void;
}

const PAYMENT_METHOD_LABELS: Record<SaasPaymentMethod, string> = {
  trial: '14-Day Free Trial',
  telebirr: 'Telebirr Mobile Money',
  cbe_bank: 'Commercial Bank of Ethiopia (CBE)',
  chapa_card: 'Chapa / Local & Intl Card',
  stripe_card: 'Stripe International Card',
  invoice: 'Corporate Invoice / Bank Wire',
};

const STATUS_LABELS: Record<SaasTenantStatus, { label: string; tone: string }> = {
  trial: { label: 'Free Trial', tone: 'text-blue-700' },
  active: { label: 'Active', tone: 'text-emerald-700' },
  past_due: { label: 'Past Due', tone: 'text-amber-700' },
  suspended: { label: 'Suspended', tone: 'text-red-700' },
  cancelled: { label: 'Cancelled', tone: 'text-slate-500' },
};

export function SaasPlatformModule({ mode, onOpenStorefront }: SaasPlatformModuleProps) {
  const {
    user,
    organization,
    isPlatformOwner,
    businessUnits,
    forms,
    leads,
    members,
    saasPlans,
    currentTenantSubscription,
    allTenantSubscriptions,
    saasInvoices,
    saasSalesInquiries,
    switchOrganization,
  } = usePortal();

  const [consoleTab, setConsoleTab] = useState<'tenants' | 'plans' | 'invoices' | 'inquiries'>(
    'tenants'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SaasTenantStatus>('all');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Provision Client Modal (Platform Owner)
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provCompany, setProvCompany] = useState('');
  const [provIndustry, setProvIndustry] = useState(SAAS_INDUSTRY_BLUEPRINTS[0].id);
  const [provPhone, setProvPhone] = useState('');
  const [provPlanId, setProvPlanId] = useState(saasPlans[1]?.id || saasPlans[0]?.id || 'plan_growth');
  const [provCycle, setProvCycle] = useState<'monthly' | 'annual'>('monthly');
  const [provStatus, setProvStatus] = useState<SaasTenantStatus>('active');
  const [provPaymentMethod, setProvPaymentMethod] = useState<SaasPaymentMethod>('telebirr');
  const [provPaymentRef, setProvPaymentRef] = useState('');
  const [provNotes, setProvNotes] = useState('');
  const [provSwitchNow, setProvSwitchNow] = useState(false);
  const [provSubmitting, setProvSubmitting] = useState(false);

  // Edit Tenant Modal (Platform Owner)
  const [editingTenant, setEditingTenant] = useState<SaasTenantSubscription | null>(null);
  const [editPlanId, setEditPlanId] = useState('');
  const [editStatus, setEditStatus] = useState<SaasTenantStatus>('active');
  const [editCycle, setEditCycle] = useState<'monthly' | 'annual'>('monthly');
  const [editCurrency, setEditCurrency] = useState<'ETB' | 'USD'>('ETB');
  const [editPayMethod, setEditPayMethod] = useState<SaasPaymentMethod>('telebirr');
  const [editPayRef, setEditPayRef] = useState('');
  const [editPeriodEnd, setEditPeriodEnd] = useState('');
  const [editAdminNotes, setEditAdminNotes] = useState('');
  const [savingTenant, setSavingTenant] = useState(false);

  // Plan Editor Modal (Platform Owner)
  const [editingPlan, setEditingPlan] = useState<Omit<SaasPlan, 'updatedAt'> | null>(null);
  const [planFeaturesText, setPlanFeaturesText] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  // Tenant Billing Upgrade Form (Tenant Owner)
  const [upgradePlanId, setUpgradePlanId] = useState(
    currentTenantSubscription?.planId || saasPlans[1]?.id || 'plan_growth'
  );
  const [upgradeCycle, setUpgradeCycle] = useState<'monthly' | 'annual'>(
    currentTenantSubscription?.billingCycle || 'monthly'
  );
  const [upgradeCurrency, setUpgradeCurrency] = useState<'ETB' | 'USD'>(
    currentTenantSubscription?.currency || 'ETB'
  );
  const [upgradeMethod, setUpgradeMethod] = useState<Exclude<SaasPaymentMethod, 'trial'>>('telebirr');
  const [upgradeRef, setUpgradeRef] = useState('');
  const [upgradePhone, setUpgradePhone] = useState(currentTenantSubscription?.billingPhone || '');
  const [upgradeNotes, setUpgradeNotes] = useState('');
  const [submittingUpgrade, setSubmittingUpgrade] = useState(false);

  const storefrontUrl = `${window.location.origin}/pricing`;

  const copyStorefrontLink = async () => {
    try {
      await navigator.clipboard.writeText(storefrontUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setBannerMessage(`Share this SaaS Storefront link: ${storefrontUrl}`);
    }
  };

  // Platform KPIs
  const platformStats = useMemo(() => {
    const payingTenants = allTenantSubscriptions.filter((t) => t.status === 'active');
    const trialTenants = allTenantSubscriptions.filter((t) => t.status === 'trial');
    const mrrEtb = payingTenants.reduce((acc, t) => acc + (t.mrrEtb || 0), 0);
    const mrrUsd = payingTenants.reduce((acc, t) => acc + (t.mrrUsd || 0), 0);
    const pendingInvoices = saasInvoices.filter((i) => i.status === 'pending_verification').length;
    const newInquiries = saasSalesInquiries.filter((i) => i.status === 'new').length;
    return {
      totalTenants: allTenantSubscriptions.length,
      payingCount: payingTenants.length,
      trialCount: trialTenants.length,
      mrrEtb,
      mrrUsd,
      pendingInvoices,
      newInquiries,
    };
  }, [allTenantSubscriptions, saasInvoices, saasSalesInquiries]);

  const filteredTenants = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allTenantSubscriptions.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.organizationName.toLowerCase().includes(q) ||
        t.ownerEmail.toLowerCase().includes(q) ||
        t.industry.toLowerCase().includes(q) ||
        t.planName.toLowerCase().includes(q)
      );
    });
  }, [allTenantSubscriptions, searchTerm, statusFilter]);

  const openEditTenant = (tenant: SaasTenantSubscription) => {
    setEditingTenant(tenant);
    setEditPlanId(tenant.requestedPlanId || tenant.planId);
    setEditStatus(tenant.status);
    setEditCycle(tenant.billingCycle);
    setEditCurrency(tenant.currency);
    setEditPayMethod(tenant.paymentMethod);
    setEditPayRef(tenant.paymentReference);
    setEditPeriodEnd(tenant.currentPeriodEnd || formatIsoDatePlusDays(30));
    setEditAdminNotes(tenant.adminNotes);
  };

  const handleSaveTenantEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    setSavingTenant(true);
    setErrorMessage(null);
    try {
      const targetPlan = saasPlans.find((p) => p.id === editPlanId);
      await updateTenantSubscriptionByAdmin({
        organizationId: editingTenant.organizationId,
        plan: targetPlan,
        status: editStatus,
        billingCycle: editCycle,
        currency: editCurrency,
        paymentMethod: editPayMethod,
        paymentReference: editPayRef,
        trialEndsAt: editStatus === 'trial' ? editPeriodEnd : editingTenant.trialEndsAt,
        currentPeriodEnd: editPeriodEnd,
        adminNotes: editAdminNotes,
        currentSub: editingTenant,
      });
      setBannerMessage(`Updated subscription for ${editingTenant.organizationName}.`);
      setEditingTenant(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update tenant subscription.');
    } finally {
      setSavingTenant(false);
    }
  };

  const handleProvisionClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || provCompany.trim().length < 2) return;
    const plan = saasPlans.find((p) => p.id === provPlanId) || saasPlans[0];
    if (!plan) return;

    setProvSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await provisionNewTenantWorkspace({
        companyName: provCompany.trim(),
        industryId: provIndustry,
        billingPhone: provPhone.trim(),
        plan,
        billingCycle: provCycle,
        currency: 'ETB',
        ownerUid: user.uid,
        ownerName: user.displayName || user.email || 'Platform Admin',
        ownerEmail: user.email || '',
        ownerPhotoURL: user.photoURL || '',
        initialStatus: provStatus,
        paymentMethod: provPaymentMethod,
        paymentReference: provPaymentRef.trim(),
        switchUserProfileToNewOrg: provSwitchNow,
        adminNotes: provNotes.trim(),
      });
      setBannerMessage(
        `Provisioned tenant "${provCompany.trim()}" (${res.organizationId}) on ${plan.name} plan.`
      );
      setProvisionOpen(false);
      setProvCompany('');
      setProvPhone('');
      setProvPaymentRef('');
      setProvNotes('');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not provision client tenant.');
    } finally {
      setProvSubmitting(false);
    }
  };

  const openPlanEditor = (plan?: SaasPlan) => {
    if (plan) {
      setEditingPlan({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        audience: plan.audience,
        tagline: plan.tagline,
        monthlyPriceEtb: plan.monthlyPriceEtb,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        annualDiscountPercent: plan.annualDiscountPercent,
        maxBusinessUnits: plan.maxBusinessUnits,
        maxForms: plan.maxForms,
        maxLeads: plan.maxLeads,
        maxStaffSeats: plan.maxStaffSeats,
        includesAiSupport: plan.includesAiSupport,
        includesSmsEmailAi: plan.includesSmsEmailAi,
        includesWhiteLabel: plan.includesWhiteLabel,
        features: plan.features,
        isRecommended: plan.isRecommended,
        isActive: plan.isActive,
        sortOrder: plan.sortOrder,
      });
      setPlanFeaturesText(plan.features.join('\n'));
    } else {
      setEditingPlan({
        id: '',
        code: 'custom',
        name: '',
        audience: 'For custom business teams',
        tagline: '',
        monthlyPriceEtb: 12000,
        monthlyPriceUsd: 99,
        annualDiscountPercent: 20,
        maxBusinessUnits: 25,
        maxForms: 250,
        maxLeads: 50000,
        maxStaffSeats: 50,
        includesAiSupport: true,
        includesSmsEmailAi: true,
        includesWhiteLabel: false,
        features: [],
        isRecommended: false,
        isActive: true,
        sortOrder: saasPlans.length + 1,
      });
      setPlanFeaturesText('');
    }
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan || editingPlan.name.trim().length < 2) return;
    setSavingPlan(true);
    setErrorMessage(null);
    try {
      await saveSaasPlan({
        ...editingPlan,
        features: planFeaturesText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      setBannerMessage(`Saved SaaS plan "${editingPlan.name}". Public storefront updated live.`);
      setEditingPlan(null);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save SaaS plan.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleApproveInvoice = async (invoice: SaasInvoice) => {
    const tenant = allTenantSubscriptions.find((t) => t.organizationId === invoice.organizationId);
    const plan = saasPlans.find((p) => p.id === invoice.planId) || saasPlans[0];
    if (!tenant || !plan) {
      setErrorMessage('Matching tenant or plan record not found for this invoice.');
      return;
    }
    setErrorMessage(null);
    try {
      await approveSaasInvoicePayment({ invoice, tenant, plan });
      setBannerMessage(
        `Approved invoice ${invoice.invoiceNumber} — ${tenant.organizationName} is now Active on ${plan.name}.`
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to approve invoice.');
    }
  };

  const handleSubmitUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTenantSubscription) return;
    const plan = saasPlans.find((p) => p.id === upgradePlanId);
    if (!plan) return;
    if (!upgradeRef.trim()) {
      setErrorMessage('Please enter your Telebirr, CBE transfer, or payment transaction reference.');
      return;
    }

    setSubmittingUpgrade(true);
    setErrorMessage(null);
    try {
      const invNum = await submitTenantUpgradePayment({
        tenant: currentTenantSubscription,
        targetPlan: plan,
        billingCycle: upgradeCycle,
        currency: upgradeCurrency,
        paymentMethod: upgradeMethod,
        paymentReference: upgradeRef.trim(),
        billingPhone: upgradePhone.trim(),
        notes: upgradeNotes.trim(),
      });
      setBannerMessage(
        `Payment submitted for verification! Invoice ${invNum} recorded for ${plan.name} (${upgradeCycle}).`
      );
      setUpgradeRef('');
      setUpgradeNotes('');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to submit upgrade request.');
    } finally {
      setSubmittingUpgrade(false);
    }
  };

  // =========================================================================
  // VIEW B: TENANT BILLING & SUBSCRIPTION (FOR ANY BUSINESS OWNER)
  // =========================================================================
  if (mode === 'tenant_billing' || !isPlatformOwner) {
    const sub = currentTenantSubscription;
    const activePlan = saasPlans.find((p) => p.id === sub?.planId) || saasPlans[1] || saasPlans[0];
    const selectedUpgradePlan = saasPlans.find((p) => p.id === upgradePlanId) || activePlan;
    const upgradePricing = selectedUpgradePlan
      ? computePlanCyclePrice(selectedUpgradePlan, upgradeCycle)
      : { etb: 0, usd: 0, monthlyEquivalentEtb: 0, monthlyEquivalentUsd: 0 };

    const tenantInvoices = saasInvoices.filter(
      (i) => i.organizationId === (organization?.id || '')
    );

    const quotaItems = [
      {
        label: 'Business Units / Branches',
        used: businessUnits.length,
        limit: sub?.maxBusinessUnits || activePlan?.maxBusinessUnits || 10,
      },
      {
        label: 'Active & Draft Forms',
        used: forms.length,
        limit: sub?.maxForms || activePlan?.maxForms || 100,
      },
      {
        label: 'CRM Leads Stored',
        used: leads.length,
        limit: sub?.maxLeads || activePlan?.maxLeads || 15000,
      },
      {
        label: 'Team Staff Seats',
        used: members.length,
        limit: sub?.maxStaffSeats || activePlan?.maxStaffSeats || 25,
      },
    ];

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">
              Subscription &amp; Billing
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Manage your SaaS plan limits, renewal cycle, and payment receipts for{' '}
              <span className="font-semibold text-slate-900">{organization?.name}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenStorefront}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Store className="w-3.5 h-3.5" />
            <span>View All SaaS Plans</span>
          </button>
        </div>

        {bannerMessage && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3">
            <span>{bannerMessage}</span>
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {errorMessage && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-3">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Current Plan & Live Quota Strip */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-2">
                <span>Current Subscription Tier</span>
                <span className={`font-semibold ${STATUS_LABELS[sub?.status || 'trial'].tone}`}>
                  {STATUS_LABELS[sub?.status || 'trial'].label}
                </span>
              </div>
              <h2 className="font-display text-2xl font-bold text-slate-900">
                {sub?.planName || activePlan?.name || 'Growth'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {sub?.industry || 'Multi-Business Organization'} ·{' '}
                {sub?.billingCycle === 'annual' ? 'Annual billing' : 'Monthly billing'}
              </p>

              <div className="mt-5 pt-5 border-t border-slate-100 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Current Period / Trial Ends</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {sub?.currentPeriodEnd || sub?.trialEndsAt || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Payment Method</span>
                  <span className="font-medium text-slate-800">
                    {PAYMENT_METHOD_LABELS[sub?.paymentMethod || 'trial']}
                  </span>
                </div>
                {sub?.requestedPlanId && (
                  <div className="flex items-center justify-between text-amber-700 pt-1">
                    <span>Pending Upgrade Request</span>
                    <span className="font-semibold">
                      {saasPlans.find((p) => p.id === sub.requestedPlanId)?.name ||
                        sub.requestedPlanId}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="font-display text-base font-bold text-slate-900 mb-4">
              Live Workspace Usage &amp; Quotas
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {quotaItems.map((item) => {
                const pct = Math.min(100, Math.round((item.used / Math.max(1, item.limit)) * 100));
                const barColor =
                  pct >= 90 ? 'bg-red-600' : pct >= 75 ? 'bg-amber-500' : 'bg-blue-700';
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{item.label}</span>
                      <span className="font-mono text-slate-900 tabular-nums">
                        {item.used.toLocaleString()} / {item.limit.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {pct}% utilized
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Upgrade / Renew Plan Submission */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Upgrade or Renew Subscription
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose your plan and submit your Telebirr, CBE Bank Transfer, or Card reference for
                verification.
              </p>
            </div>
            <div className="font-mono text-sm font-bold text-blue-700 tabular-nums">
              Due:{' '}
              {upgradeCurrency === 'ETB'
                ? `${upgradePricing.etb.toLocaleString()} ETB`
                : `$${upgradePricing.usd.toLocaleString()}`}{' '}
              ({upgradeCycle})
            </div>
          </div>

          <form onSubmit={handleSubmitUpgrade} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Select Plan</label>
                <select
                  value={upgradePlanId}
                  onChange={(e) => setUpgradePlanId(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {saasPlans
                    .filter((p) => p.isActive)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.monthlyPriceEtb.toLocaleString()} ETB/mo)
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Billing Cycle
                </label>
                <select
                  value={upgradeCycle}
                  onChange={(e) => setUpgradeCycle(e.target.value as 'monthly' | 'annual')}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual (20% Off)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Currency</label>
                <select
                  value={upgradeCurrency}
                  onChange={(e) => setUpgradeCurrency(e.target.value as 'ETB' | 'USD')}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ETB">ETB (Ethiopian Birr)</option>
                  <option value="USD">USD (US Dollar)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Payment Channel
                </label>
                <select
                  value={upgradeMethod}
                  onChange={(e) =>
                    setUpgradeMethod(e.target.value as Exclude<SaasPaymentMethod, 'trial'>)
                  }
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="telebirr">Telebirr Mobile Money</option>
                  <option value="cbe_bank">Commercial Bank of Ethiopia (CBE)</option>
                  <option value="chapa_card">Chapa / Card Payment</option>
                  <option value="stripe_card">International Card</option>
                  <option value="invoice">Corporate Bank Invoice</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Transaction / Receipt Reference *
                </label>
                <input
                  type="text"
                  required
                  value={upgradeRef}
                  onChange={(e) => setUpgradeRef(e.target.value)}
                  placeholder="e.g., TELEBIRR-TX984312 or CBE-FT26..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Billing Contact Phone
                </label>
                <input
                  type="tel"
                  value={upgradePhone}
                  onChange={(e) => setUpgradePhone(e.target.value)}
                  placeholder="+251 9XX XXX XXX"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  value={upgradeNotes}
                  onChange={(e) => setUpgradeNotes(e.target.value)}
                  placeholder="e.g., Paid for Addis HQ + 3 branches"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submittingUpgrade || !sub}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>{submittingUpgrade ? 'Submitting…' : 'Submit Payment & Request Activation'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Invoice History */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-slate-900">
              Billing &amp; Invoice History
            </h3>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {tenantInvoices.length} records
            </span>
          </div>
          {tenantInvoices.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No invoices submitted yet. Submit a payment above to upgrade from your trial or renew
              your plan.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-6 font-semibold">Invoice #</th>
                    <th className="py-3 px-6 font-semibold">Plan</th>
                    <th className="py-3 px-6 font-semibold">Method &amp; Reference</th>
                    <th className="py-3 px-6 font-semibold text-right">Amount</th>
                    <th className="py-3 px-6 font-semibold">Issued</th>
                    <th className="py-3 px-6 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenantInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-6 font-mono font-semibold text-slate-900">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-6 text-slate-700">
                        {inv.planName} · {inv.billingCycle}
                      </td>
                      <td className="py-3 px-6 text-slate-600">
                        {PAYMENT_METHOD_LABELS[inv.paymentMethod]} ·{' '}
                        <span className="font-mono text-slate-800">{inv.paymentReference}</span>
                      </td>
                      <td className="py-3 px-6 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {inv.amountEtb.toLocaleString()} ETB / ${inv.amountUsd}
                      </td>
                      <td className="py-3 px-6 font-mono text-slate-500 tabular-nums">
                        {inv.issuedAt}
                      </td>
                      <td className="py-3 px-6 font-semibold capitalize">
                        <span
                          className={
                            inv.status === 'paid'
                              ? 'text-emerald-700'
                              : inv.status === 'void'
                                ? 'text-slate-400'
                                : 'text-amber-700'
                          }
                        >
                          {inv.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW A: PLATFORM OWNER SAAS RESELLER CONSOLE
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Header + Public Storefront Sales Share Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            SaaS Platform Control Tower
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Sell Zacma Cloud subscriptions to other business owners, manage client tenants, set
            pricing tiers, and verify billing payments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={copyStorefrontLink}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedUrl ? 'Storefront Link Copied' : 'Copy Sales Link (/pricing)'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenStorefront}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Public Storefront</span>
          </button>
          <button
            type="button"
            onClick={() => setProvisionOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Provision Client Business</span>
          </button>
        </div>
      </div>

      {bannerMessage && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3">
          <span>{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-emerald-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-3">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4-Column Tabular KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Total Tenant Businesses</div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {platformStats.totalTenants}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {platformStats.payingCount} active · {platformStats.trialCount} on trial
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Active Recurring MRR</div>
          <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums mt-1">
            {platformStats.mrrEtb.toLocaleString()} ETB
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums mt-1">
            ≈ ${platformStats.mrrUsd.toLocaleString()} USD / month
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Pending Payment Approvals</div>
          <div className="font-mono text-2xl font-bold text-amber-700 tabular-nums mt-1">
            {platformStats.pendingInvoices}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Telebirr, CBE &amp; invoice verifications
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">New SaaS Buyer Inquiries</div>
          <div className="font-mono text-2xl font-bold text-blue-700 tabular-nums mt-1">
            {platformStats.newInquiries}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {saasSalesInquiries.length} total storefront leads
          </div>
        </div>
      </div>

      {/* Console Sub-Navigation Segmented Control */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(
          [
            { id: 'tenants', label: `Client Tenants (${allTenantSubscriptions.length})` },
            { id: 'plans', label: `Plans & Pricing (${saasPlans.length})` },
            { id: 'invoices', label: `Invoices (${saasInvoices.length})` },
            { id: 'inquiries', label: `Buyer Inquiries (${saasSalesInquiries.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setConsoleTab(tab.id)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              consoleTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: CLIENT TENANTS DIRECTORY */}
      {consoleTab === 'tenants' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search company, owner email, or industry…"
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | SaasTenantStatus)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="trial">Free Trial</option>
                <option value="active">Active Paying</option>
                <option value="past_due">Past Due</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 px-5 font-semibold">Client Business</th>
                  <th className="py-3 px-5 font-semibold">Owner &amp; Contact</th>
                  <th className="py-3 px-5 font-semibold">Plan &amp; Quotas</th>
                  <th className="py-3 px-5 font-semibold text-right">MRR</th>
                  <th className="py-3 px-5 font-semibold">Status</th>
                  <th className="py-3 px-5 font-semibold">Period End</th>
                  <th className="py-3 px-5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-500">
                      No matching client tenants found. Share your <span className="font-mono">/pricing</span> link or click{' '}
                      <span className="font-semibold">Provision Client Business</span>.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => (
                    <tr key={tenant.organizationId} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-slate-900">{tenant.organizationName}</div>
                        <div className="text-[11px] text-slate-500">
                          {tenant.industry} · <span className="font-mono">{tenant.organizationSlug}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="text-slate-800 font-medium">{tenant.ownerName}</div>
                        <div className="text-[11px] text-slate-500">
                          {tenant.ownerEmail}
                          {tenant.billingPhone ? ` · ${tenant.billingPhone}` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-slate-900">{tenant.planName}</div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          {tenant.maxBusinessUnits} BU · {tenant.maxForms} Forms · {tenant.maxStaffSeats} Seats
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">
                          {tenant.mrrEtb.toLocaleString()} ETB
                        </div>
                        <div className="text-[11px] text-slate-500">${tenant.mrrUsd}/mo</div>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className={`font-semibold ${STATUS_LABELS[tenant.status].tone}`}>
                          {STATUS_LABELS[tenant.status].label}
                        </span>
                        {tenant.requestedPlanId && (
                          <div className="text-[11px] text-amber-700">Upgrade pending</div>
                        )}
                      </td>
                      <td className="py-3.5 px-5 font-mono text-slate-600 tabular-nums">
                        {tenant.currentPeriodEnd || tenant.trialEndsAt || '—'}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditTenant(tenant)}
                            className="px-2.5 py-1.5 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-md font-medium whitespace-nowrap cursor-pointer"
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            onClick={() => void switchOrganization(tenant.organizationId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-medium whitespace-nowrap cursor-pointer"
                          >
                            <span>Open</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: PLANS & PRICING MANAGER */}
      {consoleTab === 'plans' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-600">
              Changes made here update the public <span className="font-mono">/pricing</span>{' '}
              storefront and tenant upgrade options in real time.
            </p>
            <button
              type="button"
              onClick={() => openPlanEditor()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Plan Tier</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {saasPlans.map((plan) => (
              <div
                key={plan.id}
                className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="font-display text-lg font-bold text-slate-900">{plan.name}</h3>
                    <span className="text-xs text-slate-500">
                      {plan.isActive ? 'Published' : 'Hidden'}
                      {plan.isRecommended ? ' · Recommended' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-4">{plan.audience}</p>
                  <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">
                    {plan.monthlyPriceEtb.toLocaleString()} ETB
                    <span className="text-xs font-normal text-slate-500 ml-1">/ mo</span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono tabular-nums mb-4">
                    ${plan.monthlyPriceUsd} USD/mo · {plan.annualDiscountPercent}% annual discount
                  </div>
                  <div className="grid grid-cols-2 gap-2 py-3 border-y border-slate-100 text-xs mb-4 font-mono tabular-nums">
                    <div>BUs: {plan.maxBusinessUnits}</div>
                    <div>Forms: {plan.maxForms}</div>
                    <div>Leads: {plan.maxLeads.toLocaleString()}</div>
                    <div>Seats: {plan.maxStaffSeats}</div>
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-600 mb-5">
                    {plan.features.slice(0, 5).map((f) => (
                      <li key={f} className="flex items-start gap-1.5">
                        <Check className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => openPlanEditor(plan)}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Tier &amp; Quotas</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: INVOICES & PAYMENT VERIFICATION */}
      {consoleTab === 'invoices' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {saasInvoices.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              <Receipt className="w-7 h-7 text-slate-300 mx-auto mb-2" />
              No tenant invoices submitted yet. When client business owners submit Telebirr, CBE, or
              card references from Billing &amp; Plan, they appear here for one-click activation.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-5 font-semibold">Invoice #</th>
                    <th className="py-3 px-5 font-semibold">Tenant Business</th>
                    <th className="py-3 px-5 font-semibold">Plan &amp; Cycle</th>
                    <th className="py-3 px-5 font-semibold">Payment Ref</th>
                    <th className="py-3 px-5 font-semibold text-right">Amount</th>
                    <th className="py-3 px-5 font-semibold">Status</th>
                    <th className="py-3 px-5 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {saasInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-5 font-mono font-semibold text-slate-900">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3.5 px-5 font-medium text-slate-900">
                        {inv.organizationName}
                      </td>
                      <td className="py-3.5 px-5 text-slate-700">
                        {inv.planName} · {inv.billingCycle}
                      </td>
                      <td className="py-3.5 px-5 text-slate-600">
                        <div>{PAYMENT_METHOD_LABELS[inv.paymentMethod]}</div>
                        <div className="font-mono text-[11px] text-slate-800">
                          {inv.paymentReference}
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {inv.amountEtb.toLocaleString()} ETB
                        <div className="text-[11px] font-normal text-slate-500">
                          ${inv.amountUsd}
                        </div>
                      </td>
                      <td className="py-3.5 px-5 font-semibold capitalize">
                        <span
                          className={
                            inv.status === 'paid'
                              ? 'text-emerald-700'
                              : inv.status === 'void'
                                ? 'text-slate-400'
                                : 'text-amber-700'
                          }
                        >
                          {inv.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        {inv.status === 'pending_verification' ? (
                          <button
                            type="button"
                            onClick={() => void handleApproveInvoice(inv)}
                            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer"
                          >
                            Approve &amp; Activate
                          </button>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">
                            {inv.paidAt || 'Completed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SAAS BUYER INQUIRIES */}
      {consoleTab === 'inquiries' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {saasSalesInquiries.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              <Users className="w-7 h-7 text-slate-300 mx-auto mb-2" />
              No inbound SaaS buyer inquiries yet. Share your public{' '}
              <span className="font-mono">/pricing</span> link to capture demo and enterprise quote
              requests.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-5 font-semibold">Company</th>
                    <th className="py-3 px-5 font-semibold">Contact</th>
                    <th className="py-3 px-5 font-semibold">Target Plan &amp; Size</th>
                    <th className="py-3 px-5 font-semibold">Notes</th>
                    <th className="py-3 px-5 font-semibold">Status</th>
                    <th className="py-3 px-5 font-semibold text-right">Convert</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {saasSalesInquiries.map((inq) => (
                    <tr key={inq.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-5">
                        <div className="font-semibold text-slate-900">{inq.companyName}</div>
                        <div className="text-[11px] text-slate-500">{inq.industry}</div>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="text-slate-800 font-medium">{inq.contactName}</div>
                        <div className="text-[11px] text-slate-500">
                          {inq.email}
                          {inq.phone ? ` · ${inq.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-slate-700">
                        <div className="font-medium">{inq.interestedPlan}</div>
                        <div className="text-[11px] text-slate-500">{inq.branchCount}</div>
                      </td>
                      <td className="py-3.5 px-5 text-slate-600 max-w-xs truncate">
                        {inq.message || '—'}
                      </td>
                      <td className="py-3.5 px-5">
                        <select
                          value={inq.status}
                          onChange={(e) =>
                            void updateSaasInquiryStatus(
                              inq.id,
                              e.target.value as SaasSalesInquiry['status']
                            )
                          }
                          className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white"
                        >
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="converted">Converted</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setProvCompany(inq.companyName);
                            setProvPhone(inq.phone);
                            setProvNotes(`Converted from storefront inquiry by ${inq.contactName} (${inq.email}).`);
                            setProvisionOpen(true);
                          }}
                          className="px-2.5 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-md font-semibold whitespace-nowrap cursor-pointer"
                        >
                          Provision Tenant
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: PROVISION CLIENT BUSINESS */}
      {provisionOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-700" />
                <h3 className="font-display text-base font-bold text-slate-900">
                  Provision New Client Tenant
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProvisionOpen(false)}
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleProvisionClient} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Client Company Name *
                </label>
                <input
                  type="text"
                  required
                  value={provCompany}
                  onChange={(e) => setProvCompany(e.target.value)}
                  placeholder="e.g., Selam Diagnostics Center"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Industry Blueprint
                  </label>
                  <select
                    value={provIndustry}
                    onChange={(e) => setProvIndustry(e.target.value)}
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
                    Subscription Plan
                  </label>
                  <select
                    value={provPlanId}
                    onChange={(e) => setProvPlanId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {saasPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.monthlyPriceEtb.toLocaleString()} ETB/mo)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={provStatus}
                    onChange={(e) => setProvStatus(e.target.value as SaasTenantStatus)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="active">Active (Paid)</option>
                    <option value="trial">14-Day Trial</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cycle</label>
                  <select
                    value={provCycle}
                    onChange={(e) => setProvCycle(e.target.value as 'monthly' | 'annual')}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Payment</label>
                  <select
                    value={provPaymentMethod}
                    onChange={(e) => setProvPaymentMethod(e.target.value as SaasPaymentMethod)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="telebirr">Telebirr</option>
                    <option value="cbe_bank">CBE Bank</option>
                    <option value="chapa_card">Chapa / Card</option>
                    <option value="invoice">Invoice</option>
                    <option value="trial">Trial</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Client Phone
                  </label>
                  <input
                    type="tel"
                    value={provPhone}
                    onChange={(e) => setProvPhone(e.target.value)}
                    placeholder="+251 9XX XXX XXX"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Receipt Ref
                  </label>
                  <input
                    type="text"
                    value={provPaymentRef}
                    onChange={(e) => setProvPaymentRef(e.target.value)}
                    placeholder="Optional receipt ID"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Onboarding Notes
                </label>
                <textarea
                  rows={2}
                  value={provNotes}
                  onChange={(e) => setProvNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={provSwitchNow}
                  onChange={(e) => setProvSwitchNow(e.target.checked)}
                />
                <span>Switch into the new client workspace immediately after provisioning</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setProvisionOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={provSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{provSubmitting ? 'Provisioning…' : 'Create Tenant Workspace'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: MANAGE TENANT SUBSCRIPTION */}
      {editingTenant && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900">
                Manage Subscription — {editingTenant.organizationName}
              </h3>
              <button
                type="button"
                onClick={() => setEditingTenant(null)}
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveTenantEdit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Plan Tier</label>
                  <select
                    value={editPlanId}
                    onChange={(e) => setEditPlanId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {saasPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.monthlyPriceEtb.toLocaleString()} ETB)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Subscription Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as SaasTenantStatus)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="trial">Free Trial</option>
                    <option value="active">Active (Paying)</option>
                    <option value="past_due">Past Due</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cycle</label>
                  <select
                    value={editCycle}
                    onChange={(e) => setEditCycle(e.target.value as 'monthly' | 'annual')}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Currency</label>
                  <select
                    value={editCurrency}
                    onChange={(e) => setEditCurrency(e.target.value as 'ETB' | 'USD')}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ETB">ETB</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Period Ends
                  </label>
                  <input
                    type="date"
                    value={editPeriodEnd}
                    onChange={(e) => setEditPeriodEnd(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={editPayMethod}
                    onChange={(e) => setEditPayMethod(e.target.value as SaasPaymentMethod)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Reference
                  </label>
                  <input
                    type="text"
                    value={editPayRef}
                    onChange={(e) => setEditPayRef(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Admin Notes</label>
                <textarea
                  rows={2}
                  value={editAdminNotes}
                  onChange={(e) => setEditAdminNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTenant(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTenant}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingTenant ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT OR CREATE SAAS PLAN */}
      {editingPlan && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full shadow-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingPlan.id ? `Edit Plan: ${editingPlan.name}` : 'Create New SaaS Plan'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPlan(null)}
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSavePlan} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Plan Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingPlan.name}
                    onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Target Audience
                  </label>
                  <input
                    type="text"
                    value={editingPlan.audience}
                    onChange={(e) => setEditingPlan({ ...editingPlan, audience: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tagline</label>
                <input
                  type="text"
                  value={editingPlan.tagline}
                  onChange={(e) => setEditingPlan({ ...editingPlan, tagline: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Monthly Price (ETB)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editingPlan.monthlyPriceEtb}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, monthlyPriceEtb: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Monthly Price (USD)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editingPlan.monthlyPriceUsd}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, monthlyPriceUsd: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Annual Discount (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={editingPlan.annualDiscountPercent}
                    onChange={(e) =>
                      setEditingPlan({
                        ...editingPlan,
                        annualDiscountPercent: Number(e.target.value),
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Max BUs</label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.maxBusinessUnits}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, maxBusinessUnits: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Max Forms</label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.maxForms}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, maxForms: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Max Leads</label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.maxLeads}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, maxLeads: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Max Seats</label>
                  <input
                    type="number"
                    min={1}
                    value={editingPlan.maxStaffSeats}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, maxStaffSeats: Number(e.target.value) })
                    }
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Included Features (one per line)
                </label>
                <textarea
                  rows={4}
                  value={planFeaturesText}
                  onChange={(e) => setPlanFeaturesText(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.includesAiSupport}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, includesAiSupport: e.target.checked })
                    }
                  />
                  <span>AI Customer Support</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.includesSmsEmailAi}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, includesSmsEmailAi: e.target.checked })
                    }
                  />
                  <span>AI SMS/Email Writer</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.includesWhiteLabel}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, includesWhiteLabel: e.target.checked })
                    }
                  />
                  <span>White-Label</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.isRecommended}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, isRecommended: e.target.checked })
                    }
                  />
                  <span>Recommended</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingPlan.isActive}
                    onChange={(e) =>
                      setEditingPlan({ ...editingPlan, isActive: e.target.checked })
                    }
                  />
                  <span>Published on Storefront</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPlan}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingPlan ? 'Saving…' : 'Save Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
