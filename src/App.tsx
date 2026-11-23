/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Building2,
  Users,
  BarChart3,
  Sparkles,
  Wrench,
  Globe,
  Inbox,
  PieChart,
  Contact,
  Kanban,
  CalendarClock,
  Send,
  FileCode2,
  TrendingUp,
  ShieldCheck,
  Bell,
  LogOut,
  Menu,
  X,
  Bot,
  BookOpen,
  HelpCircle,
  Headphones,
  Store,
  CreditCard,
  ChevronsUpDown,
  AlertTriangle,
  Clock,
  Crown,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PortalProvider, usePortal } from './context/PortalContext';
import { AuthGate } from './components/AuthGate';
import { PublicFormView } from './components/PublicFormView';
import { SaasStorefront } from './components/SaasStorefront';
import { SaasPlatformModule } from './components/SaasPlatformModule';
import { DashboardAndReportsModule } from './components/DashboardAndReportsModule';
import { BusinessUnitsModule } from './components/BusinessUnitsModule';
import { StaffAccessModule } from './components/StaffAccessModule';
import { FormBuilderModule } from './components/FormBuilderModule';
import { CrmModule } from './components/CrmModule';
import { CommunicationsModule } from './components/CommunicationsModule';
import { IntegrationsSecurityModule } from './components/IntegrationsSecurityModule';
import { AiAssistantDrawer } from './components/AiAssistantDrawer';
import { AiSupportAdminModule } from './components/AiSupportAdminModule';
import { SupportChatWidget } from './components/SupportChatWidget';
import { StudentPortalView } from './components/StudentPortalView';
import { canManageForms, canManageOrg } from './lib/zacmaService';
import { SYSTEM_OWNER_NAME } from './lib/firebase';
import type { LeadFilterPreset, NavSection } from './types';

function parsePublicFormRoute(): { businessUnitSlug: string; formSlug: string } | null {
  const match = window.location.pathname.match(/^\/forms\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i);
  if (match) {
    return { businessUnitSlug: match[1].toLowerCase(), formSlug: match[2].toLowerCase() };
  }
  return null;
}

function isStorefrontPath(): boolean {
  return /^\/(pricing|saas|plans)\/?$/i.test(window.location.pathname);
}

interface NavGroup {
  title: string;
  items: Array<{
    id: NavSection;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }>;
}

const SECTION_BREADCRUMBS: Record<NavSection, [string, string]> = {
  business_overview: ['Business Management', 'Business Overview'],
  business_units: ['Business Management', 'Business Units'],
  business_staff: ['Business Management', 'User Management & RBAC'],
  business_reports: ['Business Management', 'Business Reports'],
  ai_form_generator: ['Form Management', 'AI Form Generator'],
  form_builder: ['Form Management', 'Form Builder'],
  published_forms: ['Form Management', 'Published Forms'],
  form_submissions: ['Form Management', 'Form Submissions'],
  form_analytics: ['Form Management', 'Form Analytics'],
  crm_dashboard: ['CRM', 'CRM Dashboard'],
  all_leads: ['CRM', 'All Leads'],
  lead_pipeline: ['CRM', 'Lead Pipeline'],
  follow_ups: ['CRM', 'Follow-ups'],
  communication_center: ['CRM', 'Communication Center'],
  message_templates: ['CRM', 'Message Templates'],
  crm_reports: ['CRM', 'CRM Reports'],
  ai_support_overview: ['AI Customer Support', 'AI Support Control'],
  ai_support_courses: ['AI Customer Support', 'Course Catalog (18+)'],
  ai_support_knowledge: ['AI Customer Support', 'Support Knowledge & FAQs'],
  ai_support_inbox: ['AI Customer Support', 'Support Inbox & Registrations'],
  integrations_security: ['Governance', 'Integrations & Security'],
  saas_platform_console: ['SaaS Platform', 'Platform SaaS Console'],
  tenant_billing: ['SaaS Platform', 'Billing & Subscription'],
};

function PortalWorkspace({ onOpenStorefront }: { onOpenStorefront: () => void }) {
  const {
    user,
    profile,
    organization,
    myOrganizations,
    currentTenantSubscription,
    effectiveRole,
    effectiveCrmAccess,
    effectivePermissions,
    isPlatformOwner,
    isSystemOwner,
    isStudent,
    profileError,
    syncWarning,
    dismissSyncWarning,
    retryProfileSync,
    subscriptionPolicy,
    sessionWarningSeconds,
    extendSession,
    notifications,
    markNotificationRead,
    switchOrganization,
    logout,
  } = usePortal();

  const [activeSection, setActiveSection] = useState<NavSection>('business_overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);

  // Cross-module contextual navigation presets
  const [selectedBuPreset, setSelectedBuPreset] = useState<string | undefined>(undefined);
  const [aiPromptPreset, setAiPromptPreset] = useState<string | undefined>(undefined);
  const [leadFilterPreset, setLeadFilterPreset] = useState<LeadFilterPreset | undefined>(undefined);
  const [commDraftPreset, setCommDraftPreset] = useState<{
    channel?: 'email' | 'sms' | 'both';
    subject?: string;
    body?: string;
    smsBody?: string;
    businessUnitId?: string;
    directEmail?: string;
    directPhone?: string;
    directName?: string;
  } | null>(null);

  const canManageFormsFlag = isSystemOwner || canManageForms(effectiveRole) || effectivePermissions.forms;
  const canManageOrgFlag = isSystemOwner || canManageOrg(effectiveRole) || effectivePermissions.userManagement;
  const canAccessComms = isSystemOwner || effectiveCrmAccess || effectivePermissions.communications;
  const canAccessAiSupport = isSystemOwner || canManageOrgFlag || effectiveCrmAccess || effectivePermissions.aiSupport;
  const canAccessBilling = isSystemOwner || canManageOrg(effectiveRole) || effectivePermissions.billing;
  const canAccessReports = isSystemOwner || effectivePermissions.reports || canManageOrgFlag;
  const canAccessSubmissions = isSystemOwner || effectiveCrmAccess || canManageFormsFlag;

  const isSectionAllowed = useMemo(() => {
    const allowed: Record<NavSection, boolean> = {
      business_overview: true,
      business_units: true,
      business_staff: canManageOrgFlag,
      business_reports: canAccessReports,
      ai_form_generator: canManageFormsFlag,
      form_builder: canManageFormsFlag,
      published_forms: true,
      form_submissions: canAccessSubmissions,
      form_analytics: true,
      crm_dashboard: isSystemOwner || effectiveCrmAccess,
      all_leads: isSystemOwner || effectiveCrmAccess,
      lead_pipeline: isSystemOwner || effectiveCrmAccess,
      follow_ups: isSystemOwner || effectiveCrmAccess,
      communication_center: canAccessComms,
      message_templates: canAccessComms,
      crm_reports: isSystemOwner || effectiveCrmAccess,
      ai_support_overview: canAccessAiSupport,
      ai_support_courses: canAccessAiSupport,
      ai_support_knowledge: canAccessAiSupport,
      ai_support_inbox: canAccessAiSupport,
      integrations_security: canManageOrgFlag,
      saas_platform_console: isSystemOwner || isPlatformOwner,
      tenant_billing: canAccessBilling,
    };
    return allowed;
  }, [
    isSystemOwner,
    isPlatformOwner,
    canManageOrgFlag,
    canAccessReports,
    canManageFormsFlag,
    canAccessSubmissions,
    effectiveCrmAccess,
    canAccessComms,
    canAccessAiSupport,
    canAccessBilling,
  ]);

  useEffect(() => {
    if (!isSectionAllowed[activeSection]) {
      setActiveSection('business_overview');
    }
  }, [activeSection, isSectionAllowed]);

  const navGroups: NavGroup[] = useMemo(
    () => [
      {
        title: 'Business Management',
        items: [
          { id: 'business_overview', label: 'Business Overview', icon: LayoutDashboard, visible: true },
          { id: 'business_units', label: 'Business Units', icon: Building2, visible: true },
          { id: 'business_staff', label: 'User Management', icon: Users, visible: canManageOrgFlag },
          {
            id: 'business_reports',
            label: 'Business Reports',
            icon: BarChart3,
            visible: effectivePermissions.reports || canManageOrgFlag,
          },
        ],
      },
      {
        title: 'Form Management',
        items: [
          { id: 'ai_form_generator', label: 'AI Form Generator', icon: Sparkles, visible: canManageFormsFlag },
          { id: 'form_builder', label: 'Form Builder', icon: Wrench, visible: canManageFormsFlag },
          { id: 'published_forms', label: 'Published Forms', icon: Globe, visible: true },
          {
            id: 'form_submissions',
            label: 'Form Submissions',
            icon: Inbox,
            visible: effectiveCrmAccess || canManageFormsFlag,
          },
          { id: 'form_analytics', label: 'Form Analytics', icon: PieChart, visible: true },
        ],
      },
      {
        title: 'CRM',
        items: [
          { id: 'crm_dashboard', label: 'CRM Dashboard', icon: LayoutDashboard, visible: effectiveCrmAccess },
          { id: 'all_leads', label: 'All Leads', icon: Contact, visible: effectiveCrmAccess },
          { id: 'lead_pipeline', label: 'Lead Pipeline', icon: Kanban, visible: effectiveCrmAccess },
          { id: 'follow_ups', label: 'Follow-ups', icon: CalendarClock, visible: effectiveCrmAccess },
          { id: 'communication_center', label: 'Communication Center', icon: Send, visible: canAccessComms },
          { id: 'message_templates', label: 'Message Templates', icon: FileCode2, visible: canAccessComms },
          { id: 'crm_reports', label: 'CRM Reports', icon: TrendingUp, visible: effectiveCrmAccess },
        ],
      },
      {
        title: 'AI Customer Support',
        items: [
          { id: 'ai_support_overview', label: 'AI Support Control', icon: Bot, visible: canAccessAiSupport },
          { id: 'ai_support_courses', label: 'Course Catalog (18+)', icon: BookOpen, visible: canAccessAiSupport },
          { id: 'ai_support_knowledge', label: 'Knowledge & FAQs', icon: HelpCircle, visible: canAccessAiSupport },
          { id: 'ai_support_inbox', label: 'Support Inbox & Regs', icon: Headphones, visible: canAccessAiSupport },
        ],
      },
      {
        title: 'SaaS Platform',
        items: [
          { id: 'saas_platform_console', label: 'Platform SaaS Console', icon: Store, visible: isPlatformOwner },
          { id: 'tenant_billing', label: 'Billing & Plan', icon: CreditCard, visible: canAccessBilling },
        ],
      },
      {
        title: 'Governance',
        items: [
          { id: 'integrations_security', label: 'Integrations & Security', icon: ShieldCheck, visible: canManageOrgFlag },
        ],
      },
    ],
    [
      canManageFormsFlag,
      canManageOrgFlag,
      effectiveCrmAccess,
      effectivePermissions.reports,
      canAccessComms,
      canAccessAiSupport,
      canAccessBilling,
      isPlatformOwner,
    ]
  );

  // Strictly route Student / Customer accounts to their isolated self-service portal
  if (isStudent) {
    return <StudentPortalView />;
  }

  const handleNavigate = (
    section: NavSection,
    preset?: {
      businessUnitId?: string;
      aiPrompt?: string;
      leadFilter?: LeadFilterPreset;
      commDraft?: {
        channel?: 'email' | 'sms' | 'both';
        subject?: string;
        body?: string;
        smsBody?: string;
        businessUnitId?: string;
        directEmail?: string;
        directPhone?: string;
        directName?: string;
      };
    }
  ) => {
    if (!isSectionAllowed[section]) {
      setActiveSection('business_overview');
      setMobileMenuOpen(false);
      return;
    }
    if (preset?.businessUnitId !== undefined) setSelectedBuPreset(preset.businessUnitId);
    if (preset?.aiPrompt !== undefined) setAiPromptPreset(preset.aiPrompt);
    if (preset?.leadFilter !== undefined) setLeadFilterPreset(preset.leadFilter);
    if (preset?.commDraft !== undefined) setCommDraftPreset(preset.commDraft);
    setActiveSection(section);
    setMobileMenuOpen(false);
  };

  const handleOrgSwitch = async (targetOrgId: string) => {
    if (!targetOrgId || targetOrgId === organization?.id) return;
    setSwitchingOrg(true);
    try {
      await switchOrganization(targetOrgId);
    } finally {
      setSwitchingOrg(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const [groupLabel, pageLabel] = SECTION_BREADCRUMBS[activeSection];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand Header */}
      <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-lg text-white font-display font-bold text-base flex items-center justify-center shrink-0"
            style={{ backgroundColor: organization?.primaryColor || '#1D4ED8' }}
          >
            {(organization?.name || 'Z').charAt(0).toUpperCase()}
          </div>
          <span className="font-display font-bold text-base tracking-tight text-slate-900 truncate">
            {organization?.name || 'Zacma Portal'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 text-slate-500 hover:text-slate-900"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Multi-Tenant Workspace Switcher */}
      {(myOrganizations.length > 1 || isPlatformOwner) && (
        <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50/70 shrink-0">
          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1 px-1">
            <span>Active Workspace</span>
            {currentTenantSubscription && (
              <span className="font-medium text-blue-700 truncate max-w-[110px]">
                {currentTenantSubscription.planName}
              </span>
            )}
          </div>
          <div className="relative">
            <select
              disabled={switchingOrg}
              value={organization?.id || ''}
              onChange={(e) => void handleOrgSwitch(e.target.value)}
              className="w-full appearance-none pl-2.5 pr-7 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
            >
              {myOrganizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
          </div>
        </div>
      )}

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((i) => i.visible);
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.title}>
              <div className="px-3 mb-1.5 text-[11px] font-semibold text-slate-400">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavigate(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-50 text-blue-800 font-semibold'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-700' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Quick link to Public SaaS Storefront */}
        <div className="pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onOpenStorefront}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg transition-colors cursor-pointer"
          >
            <Globe className="w-4 h-4 shrink-0 text-slate-400" />
            <span className="truncate">SaaS Storefront (/pricing)</span>
          </button>
        </div>
      </nav>

      {/* Account Footer */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/70 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-semibold text-slate-900 truncate">
                {isSystemOwner
                  ? profile?.displayName || SYSTEM_OWNER_NAME
                  : profile?.displayName || user?.displayName || user?.email}
              </span>
              {isSystemOwner && (
                <Crown
                  className="w-3.5 h-3.5 text-amber-600 shrink-0"
                  aria-label="Primary System Owner"
                />
              )}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {profile?.username ? `@${profile.username} · ` : ''}
              {isSystemOwner ? (
                <span className="font-semibold text-blue-700">Primary System Owner</span>
              ) : isPlatformOwner ? (
                'Platform Owner'
              ) : (
                <span className="capitalize">{effectiveRole.replace('_', ' ')}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 bg-white border-r border-slate-200 fixed inset-y-0 left-0 z-30">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-white h-full shadow-xl border-r border-slate-200">
            {renderSidebarContent()}
          </div>
          <div
            className="flex-1 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Header Bar (Clean SaaS Breadcrumb + Actions) */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">{groupLabel}</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-display font-semibold text-slate-900 truncate">
                {pageLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Notifications Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-600 text-white text-[10px] font-mono font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">
                      Notifications ({unreadCount} unread)
                    </span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-slate-400 hover:text-slate-900 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            if (!n.isRead) void markNotificationRead(n.id);
                            setNotifOpen(false);
                            if (n.entityType === 'lead' && effectiveCrmAccess) {
                              handleNavigate('all_leads');
                            } else if (n.entityType === 'followup') {
                              handleNavigate('ai_support_inbox');
                            }
                          }}
                          className={`w-full text-left px-4 py-3 text-xs hover:bg-slate-50 cursor-pointer ${
                            n.isRead ? 'opacity-60' : 'bg-blue-50/40'
                          }`}
                        >
                          <div className="font-semibold text-slate-900">{n.title}</div>
                          <div className="text-slate-600 mt-0.5">{n.message}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Zacma AI Assistant Button */}
            <button
              type="button"
              onClick={() => setAiDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Zacma AI</span>
            </button>
          </div>
        </header>

        {/* Session Inactivity Timeout Warning Banner */}
        {sessionWarningSeconds !== null && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                For your security, your session will automatically sign out in{' '}
                <strong className="font-mono">{sessionWarningSeconds}s</strong> due to inactivity.
              </span>
            </div>
            <button
              type="button"
              onClick={extendSession}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-md cursor-pointer"
            >
              Stay Signed In
            </button>
          </div>
        )}

        {/* Non-Blocking Profile Sync Recovery Banner (Never logs user out) */}
        {profileError && (
          <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{profileError} Your session remains active.</span>
            </div>
            <button
              type="button"
              disabled={retryingSync}
              onClick={async () => {
                setRetryingSync(true);
                try {
                  await retryProfileSync();
                } finally {
                  setRetryingSync(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold rounded-md cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${retryingSync ? 'animate-spin' : ''}`} />
              <span>{retryingSync ? 'Syncing…' : 'Retry Sync'}</span>
            </button>
          </div>
        )}

        {/* Non-Blocking Realtime Sync Warning */}
        {syncWarning && !profileError && (
          <div className="bg-slate-100 border-b border-slate-200 px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700">
            <span>{syncWarning}</span>
            <button
              type="button"
              onClick={dismissSyncWarning}
              className="text-slate-500 hover:text-slate-900 cursor-pointer"
              aria-label="Dismiss sync notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Non-Blocking Subscription Renewal Banner (Never locks tenants out of viewing existing data) */}
        {subscriptionPolicy.bannerMessage && (
          <div className="bg-red-50 border-b border-red-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-red-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{subscriptionPolicy.bannerMessage}</span>
            </div>
            {canAccessBilling && (
              <button
                type="button"
                onClick={() => handleNavigate('tenant_billing')}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-md shrink-0 cursor-pointer"
              >
                Manage Billing &amp; Renew
              </button>
            )}
          </div>
        )}

        {/* Active Module Viewport */}
        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {!isSectionAllowed[activeSection] ? (
            <div className="max-w-md mx-auto my-12 bg-white border border-slate-200 rounded-xl p-6 text-center space-y-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Access Restricted
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your current role does not have permission to open this module. Contact your
                workspace administrator if you need access.
              </p>
              <button
                type="button"
                onClick={() => setActiveSection('business_overview')}
                className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Return to Overview
              </button>
            </div>
          ) : (
            <>
          {(activeSection === 'business_overview' ||
            activeSection === 'business_reports' ||
            activeSection === 'crm_reports') && (
            <DashboardAndReportsModule
              activeSection={activeSection}
              initialBusinessUnitId={selectedBuPreset}
              onNavigate={handleNavigate}
            />
          )}

          {activeSection === 'business_units' && (
            <BusinessUnitsModule onNavigate={handleNavigate} />
          )}

          {activeSection === 'business_staff' && <StaffAccessModule />}

          {(activeSection === 'ai_form_generator' ||
            activeSection === 'form_builder' ||
            activeSection === 'published_forms' ||
            activeSection === 'form_submissions' ||
            activeSection === 'form_analytics') && (
            <FormBuilderModule
              activeSection={activeSection}
              initialBusinessUnitId={selectedBuPreset}
              initialAiPrompt={aiPromptPreset}
              onNavigate={(sec) => handleNavigate(sec)}
            />
          )}

          {(activeSection === 'crm_dashboard' ||
            activeSection === 'all_leads' ||
            activeSection === 'lead_pipeline' ||
            activeSection === 'follow_ups') && (
            <CrmModule
              activeSection={activeSection}
              filterPreset={leadFilterPreset}
              onNavigate={handleNavigate}
            />
          )}

          {(activeSection === 'communication_center' ||
            activeSection === 'message_templates') && (
            <CommunicationsModule
              activeSection={activeSection}
              initialDraft={commDraftPreset}
              onNavigate={(sec) => handleNavigate(sec)}
            />
          )}

          {(activeSection === 'ai_support_overview' ||
            activeSection === 'ai_support_courses' ||
            activeSection === 'ai_support_knowledge' ||
            activeSection === 'ai_support_inbox') && (
            <AiSupportAdminModule
              activeSection={activeSection}
              onNavigate={(sec) => handleNavigate(sec)}
              onMessageStudent={(reg) =>
                handleNavigate('communication_center', {
                  commDraft: {
                    channel: reg.email && reg.phone ? 'both' : reg.phone ? 'sms' : 'email',
                    directName: reg.fullName,
                    directEmail: reg.email,
                    directPhone: reg.phone,
                    subject: `${organization?.name || 'Zacma Training Institute'} — ${reg.preferredCourse} (${reg.leadRef})`,
                    body: `Dear ${reg.fullName},\n\nThank you for registering for ${reg.preferredCourse} at ${organization?.name || 'Zacma Technology Training Institute'} (Ref: ${reg.leadRef}). Tuition is 8,500 ETB. Please reply if you need assistance with your schedule or payment.\n\nWarm regards,\nAdmissions Team`,
                    smsBody: `Hi ${reg.fullName}, update from ${organization?.name || 'Zacma Training Institute'} on ${reg.preferredCourse} (Ref: ${reg.leadRef}). Tuition: 8,500 ETB.`,
                  },
                })
              }
            />
          )}

          {(activeSection === 'saas_platform_console' || activeSection === 'tenant_billing') && (
            <SaasPlatformModule mode={activeSection} onOpenStorefront={onOpenStorefront} />
          )}

          {activeSection === 'integrations_security' && <IntegrationsSecurityModule />}
            </>
          )}
        </main>
      </div>

      {/* Contextual Zacma AI Assistant Slide-Over */}
      <AiAssistantDrawer
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        onExecuteAction={handleNavigate}
      />

      {/* Section 8: Floating 24/7 AI Customer Support & Student Widget scoped to active tenant */}
      <SupportChatWidget
        organizationId={organization?.id || 'zacma-hq'}
        isPortalContext
      />
    </div>
  );
}

function PortalShell() {
  const { user } = usePortal();
  const [showStorefront, setShowStorefront] = useState<boolean>(() => isStorefrontPath());

  const openStorefront = () => {
    setShowStorefront(true);
    try {
      window.history.pushState({}, '', '/pricing');
    } catch {
      // Ignore history pushState restriction in sandboxed iframe
    }
  };

  const openPortal = () => {
    setShowStorefront(false);
    try {
      if (isStorefrontPath()) {
        window.history.pushState({}, '', '/');
      }
    } catch {
      // Ignore history pushState restriction
    }
  };

  if (showStorefront) {
    return (
      <SaasStorefront
        onOpenPortal={openPortal}
        onTenantProvisioned={() => openPortal()}
        isSignedIn={Boolean(user)}
        userDisplayName={user?.displayName || undefined}
        userEmail={user?.email || undefined}
      />
    );
  }

  return (
    <AuthGate onOpenStorefront={openStorefront}>
      <PortalWorkspace onOpenStorefront={openStorefront} />
    </AuthGate>
  );
}

export default function App() {
  const publicRoute = parsePublicFormRoute();

  if (publicRoute) {
    return (
      <ErrorBoundary>
        <PublicFormView
          businessUnitSlug={publicRoute.businessUnitSlug}
          formSlug={publicRoute.formSlug}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <PortalProvider>
        <PortalShell />
      </PortalProvider>
    </ErrorBoundary>
  );
}
