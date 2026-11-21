/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PortalProvider, usePortal } from './context/PortalContext';
import { AuthGate } from './components/AuthGate';
import { PublicFormView } from './components/PublicFormView';
import { DashboardAndReportsModule } from './components/DashboardAndReportsModule';
import { BusinessUnitsModule } from './components/BusinessUnitsModule';
import { StaffAccessModule } from './components/StaffAccessModule';
import { FormBuilderModule } from './components/FormBuilderModule';
import { CrmModule } from './components/CrmModule';
import { CommunicationsModule } from './components/CommunicationsModule';
import { IntegrationsSecurityModule } from './components/IntegrationsSecurityModule';
import { AiAssistantDrawer } from './components/AiAssistantDrawer';
import { canManageForms, canManageOrg } from './lib/zacmaService';
import type { LeadFilterPreset, NavSection } from './types';

function parsePublicFormRoute(): { businessUnitSlug: string; formSlug: string } | null {
  const match = window.location.pathname.match(/^\/forms\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i);
  if (match) {
    return { businessUnitSlug: match[1].toLowerCase(), formSlug: match[2].toLowerCase() };
  }
  return null;
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
  business_staff: ['Business Management', 'Business Staff'],
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
  integrations_security: ['Governance', 'Integrations & Security'],
};

function PortalWorkspace() {
  const {
    user,
    organization,
    effectiveRole,
    effectiveCrmAccess,
    notifications,
    markNotificationRead,
    logout,
  } = usePortal();

  const [activeSection, setActiveSection] = useState<NavSection>('business_overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  // Cross-module contextual navigation presets
  const [selectedBuPreset, setSelectedBuPreset] = useState<string | undefined>(undefined);
  const [aiPromptPreset, setAiPromptPreset] = useState<string | undefined>(undefined);
  const [leadFilterPreset, setLeadFilterPreset] = useState<LeadFilterPreset | undefined>(undefined);
  const [commDraftPreset, setCommDraftPreset] = useState<{
    channel?: 'email' | 'sms';
    subject?: string;
    body?: string;
    businessUnitId?: string;
  } | null>(null);

  const canManageFormsFlag = canManageForms(effectiveRole);
  const canManageOrgFlag = canManageOrg(effectiveRole);

  const navGroups: NavGroup[] = useMemo(
    () => [
      {
        title: 'Business Management',
        items: [
          { id: 'business_overview', label: 'Business Overview', icon: LayoutDashboard, visible: true },
          { id: 'business_units', label: 'Business Units', icon: Building2, visible: true },
          { id: 'business_staff', label: 'Business Staff', icon: Users, visible: canManageOrgFlag },
          { id: 'business_reports', label: 'Business Reports', icon: BarChart3, visible: true },
        ],
      },
      {
        title: 'Form Management',
        items: [
          { id: 'ai_form_generator', label: 'AI Form Generator', icon: Sparkles, visible: canManageFormsFlag },
          { id: 'form_builder', label: 'Form Builder', icon: Wrench, visible: canManageFormsFlag },
          { id: 'published_forms', label: 'Published Forms', icon: Globe, visible: true },
          { id: 'form_submissions', label: 'Form Submissions', icon: Inbox, visible: effectiveCrmAccess || canManageFormsFlag },
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
          { id: 'communication_center', label: 'Communication Center', icon: Send, visible: effectiveCrmAccess },
          { id: 'message_templates', label: 'Message Templates', icon: FileCode2, visible: effectiveCrmAccess },
          { id: 'crm_reports', label: 'CRM Reports', icon: TrendingUp, visible: effectiveCrmAccess },
        ],
      },
      {
        title: 'Governance',
        items: [
          { id: 'integrations_security', label: 'Integrations & Security', icon: ShieldCheck, visible: canManageOrgFlag },
        ],
      },
    ],
    [canManageFormsFlag, canManageOrgFlag, effectiveCrmAccess]
  );

  const handleNavigate = (
    section: NavSection,
    preset?: {
      businessUnitId?: string;
      aiPrompt?: string;
      leadFilter?: LeadFilterPreset;
      commDraft?: { channel?: 'email' | 'sms'; subject?: string; body?: string; businessUnitId?: string };
    }
  ) => {
    if (preset?.businessUnitId !== undefined) setSelectedBuPreset(preset.businessUnitId);
    if (preset?.aiPrompt !== undefined) setAiPromptPreset(preset.aiPrompt);
    if (preset?.leadFilter !== undefined) setLeadFilterPreset(preset.leadFilter);
    if (preset?.commDraft !== undefined) setCommDraftPreset(preset.commDraft);
    setActiveSection(section);
    setMobileMenuOpen(false);
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const [groupLabel, pageLabel] = SECTION_BREADCRUMBS[activeSection];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand Header */}
      <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-blue-700 text-white font-display font-bold text-base flex items-center justify-center shrink-0">
            Z
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
      </nav>

      {/* Account Footer */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/70 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {user?.displayName || user?.email}
            </div>
            <div className="text-[11px] text-slate-500 capitalize">
              {effectiveRole.replace('_', ' ')}
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

        {/* Active Module Viewport */}
        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
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

          {activeSection === 'integrations_security' && <IntegrationsSecurityModule />}
        </main>
      </div>

      {/* Contextual Zacma AI Assistant Slide-Over */}
      <AiAssistantDrawer
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
        onExecuteAction={handleNavigate}
      />
    </div>
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
        <AuthGate>
          <PortalWorkspace />
        </AuthGate>
      </PortalProvider>
    </ErrorBoundary>
  );
}
