import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Download, ArrowUpRight, Plus, Sparkles, CalendarClock } from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import { exportToCsv, formatTimestamp, timestampToMillis } from '../lib/zacmaService';
import type { LeadFilterPreset, LeadStatus, NavSection } from '../types';

interface Props {
  activeSection: NavSection;
  initialBusinessUnitId?: string;
  onNavigate: (section: NavSection, preset?: { businessUnitId?: string; leadFilter?: LeadFilterPreset }) => void;
}

export function DashboardAndReportsModule({
  activeSection,
  initialBusinessUnitId,
  onNavigate,
}: Props) {
  const { businessUnits, forms, submissions, leads, auditLogs, effectiveCrmAccess } = usePortal();

  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [buFilter, setBuFilter] = useState(initialBusinessUnitId || 'all');
  const [formFilter, setFormFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');

  const cutoffMs = useMemo(() => {
    if (dateRange === 'all') return 0;
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return Date.now() - days * 86_400_000;
  }, [dateRange]);

  const scopedLeads = useMemo(() => {
    return leads.filter((l) => {
      if (buFilter !== 'all' && l.businessUnitId !== buFilter) return false;
      if (formFilter !== 'all' && l.formId !== formFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (cutoffMs > 0 && timestampToMillis(l.createdAt) < cutoffMs) return false;
      return true;
    });
  }, [leads, buFilter, formFilter, statusFilter, cutoffMs]);

  const scopedSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (buFilter !== 'all' && s.businessUnitId !== buFilter) return false;
      if (formFilter !== 'all' && s.formId !== formFilter) return false;
      if (cutoffMs > 0 && timestampToMillis(s.createdAt) < cutoffMs) return false;
      return true;
    });
  }, [submissions, buFilter, formFilter, cutoffMs]);

  const kpis = useMemo(() => {
    const totalBus = businessUnits.length;
    const activeBus = businessUnits.filter((b) => b.status === 'active').length;
    const publishedForms = forms.filter((f) => f.isPublished && f.isActive).length;
    const totalSubmissions = scopedSubmissions.length;
    const totalLeads = scopedLeads.length;
    const newLeads = scopedLeads.filter((l) => l.status === 'new').length;
    const contactedLeads = scopedLeads.filter((l) => l.status === 'contacted').length;
    const interestedLeads = scopedLeads.filter((l) => l.status === 'interested').length;
    const convertedLeads = scopedLeads.filter((l) => l.status === 'converted').length;
    const lostLeads = scopedLeads.filter((l) => l.status === 'lost').length;
    const unassignedLeads = scopedLeads.filter((l) => !l.assignedStaffId && l.status !== 'archived').length;
    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';

    return {
      totalBus,
      activeBus,
      publishedForms,
      totalSubmissions,
      totalLeads,
      newLeads,
      contactedLeads,
      interestedLeads,
      convertedLeads,
      lostLeads,
      unassignedLeads,
      conversionRate,
    };
  }, [businessUnits, forms, scopedSubmissions, scopedLeads]);

  // Lead Acquisition Trend by Day
  const trendData = useMemo(() => {
    const buckets = new Map<string, { date: string; leads: number; converted: number }>();
    for (const l of scopedLeads) {
      const ms = timestampToMillis(l.createdAt);
      const day = ms ? new Date(ms).toISOString().slice(0, 10) : 'Today';
      const cur = buckets.get(day) || { date: day, leads: 0, converted: 0 };
      cur.leads += 1;
      if (l.status === 'converted') cur.converted += 1;
      buckets.set(day, cur);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [scopedLeads]);

  // Business Unit Performance Comparison
  const unitComparison = useMemo(() => {
    return businessUnits.map((bu) => {
      const unitLeads = scopedLeads.filter((l) => l.businessUnitId === bu.id);
      const converted = unitLeads.filter((l) => l.status === 'converted').length;
      const unitForms = forms.filter((f) => f.businessUnitId === bu.id);
      return {
        id: bu.id,
        name: bu.name.length > 20 ? `${bu.name.slice(0, 20)}…` : bu.name,
        fullName: bu.name,
        category: bu.category,
        forms: unitForms.length,
        leads: unitLeads.length,
        converted,
        rate: unitLeads.length > 0 ? Math.round((converted / unitLeads.length) * 100) : 0,
      };
    });
  }, [businessUnits, scopedLeads, forms]);

  const upcomingFollowUps = useMemo(() => {
    return leads
      .filter((l) => Boolean(l.followUpDate) && l.status !== 'archived')
      .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))
      .slice(0, 6);
  }, [leads]);

  const handleExportReport = () => {
    exportToCsv(
      `zacma-${activeSection}-${new Date().toISOString().slice(0, 10)}.csv`,
      unitComparison.map((u) => ({
        BusinessUnit: u.fullName,
        Category: u.category,
        Forms: u.forms,
        TotalLeads: u.leads,
        ConvertedLeads: u.converted,
        ConversionRatePercent: u.rate,
      }))
    );
  };

  const titleMap: Record<string, { title: string; subtitle: string }> = {
    business_overview: {
      title: 'Centralized Business & CRM Overview',
      subtitle: 'Real-time operational telemetry across all Zacma business units, published forms, and lead conversions. Click any metric to drill down.',
    },
    business_reports: {
      title: 'Business Performance Reports',
      subtitle: 'Compare business-unit acquisition velocity, form utilization, and conversion efficiency.',
    },
    crm_reports: {
      title: 'CRM Conversion & Funnel Reports',
      subtitle: 'Analyze pipeline conversion performance, stage velocity, and unassigned lead backlog.',
    },
  };

  const heading = titleMap[activeSection] || titleMap.business_overview;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">{heading.title}</h1>
          <p className="text-sm text-slate-600 mt-1">{heading.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeSection === 'business_overview' ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('business_units')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Business Unit
              </button>
              <button
                type="button"
                onClick={() => onNavigate('ai_form_generator')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Form Generator
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleExportReport}
              disabled={unitComparison.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Report CSV
            </button>
          )}
        </div>
      </div>

      {/* Filters Row */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['7d', '30d', '90d', 'all'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDateRange(r)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                dateRange === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {r === 'all' ? 'All Time' : `Last ${r}`}
            </button>
          ))}
        </div>

        <select
          value={buFilter}
          onChange={(e) => setBuFilter(e.target.value)}
          className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Business Units</option>
          {businessUnits.map((bu) => (
            <option key={bu.id} value={bu.id}>
              {bu.name}
            </option>
          ))}
        </select>

        <select
          value={formFilter}
          onChange={(e) => setFormFilter(e.target.value)}
          className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
        >
          <option value="all">All Forms</option>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </select>

        {effectiveCrmAccess && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LeadStatus | 'all')}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Lead Statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="interested">Interested</option>
            <option value="converted">Converted</option>
            <option value="lost">Lost</option>
          </select>
        )}
      </div>

      {/* Click-to-Filter Live KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5">
        <button
          type="button"
          onClick={() => onNavigate('business_units')}
          className="bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-4 text-left transition-colors cursor-pointer"
        >
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>Business Units</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-2xl font-display font-bold font-mono tabular-nums text-slate-900 mt-1">
            {kpis.totalBus}
          </div>
          <div className="text-[11px] text-emerald-700 mt-0.5">{kpis.activeBus} active</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('published_forms')}
          className="bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-4 text-left transition-colors cursor-pointer"
        >
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>Published Forms</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-2xl font-display font-bold font-mono tabular-nums text-blue-700 mt-1">
            {kpis.publishedForms}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{forms.length} total forms</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('form_submissions')}
          className="bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-4 text-left transition-colors cursor-pointer"
        >
          <div className="text-xs text-slate-500 flex items-center justify-between">
            <span>Submissions</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="text-2xl font-display font-bold font-mono tabular-nums text-slate-900 mt-1">
            {kpis.totalSubmissions}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Verified entries</div>
        </button>

        {effectiveCrmAccess && (
          <>
            <button
              type="button"
              onClick={() =>
                onNavigate('all_leads', {
                  leadFilter: { businessUnitId: buFilter === 'all' ? undefined : buFilter, status: 'new' },
                })
              }
              className="bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-4 text-left transition-colors cursor-pointer"
            >
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>New Leads</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="text-2xl font-display font-bold font-mono tabular-nums text-blue-700 mt-1">
                {kpis.newLeads}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{kpis.totalLeads} total leads</div>
            </button>

            <button
              type="button"
              onClick={() =>
                onNavigate('all_leads', {
                  leadFilter: { assignment: 'unassigned' },
                })
              }
              className="bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-4 text-left transition-colors cursor-pointer"
            >
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Unassigned</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="text-2xl font-display font-bold font-mono tabular-nums text-red-600 mt-1">
                {kpis.unassignedLeads}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Needs owner</div>
            </button>

            <button
              type="button"
              onClick={() =>
                onNavigate('all_leads', {
                  leadFilter: { status: 'converted' },
                })
              }
              className="bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-4 text-left transition-colors cursor-pointer"
            >
              <div className="text-xs text-slate-500 flex items-center justify-between">
                <span>Conversion Rate</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="text-2xl font-display font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {kpis.conversionRate}%
              </div>
              <div className="text-[11px] text-emerald-700 mt-0.5">{kpis.convertedLeads} converted</div>
            </button>
          </>
        )}
      </div>

      {/* Secondary Pipeline Breakdown Strip */}
      {effectiveCrmAccess && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          {[
            { label: 'New', count: kpis.newLeads, status: 'new' as LeadStatus },
            { label: 'Contacted', count: kpis.contactedLeads, status: 'contacted' as LeadStatus },
            { label: 'Interested', count: kpis.interestedLeads, status: 'interested' as LeadStatus },
            { label: 'Converted', count: kpis.convertedLeads, status: 'converted' as LeadStatus },
            { label: 'Lost', count: kpis.lostLeads, status: 'lost' as LeadStatus },
          ].map((stage) => (
            <button
              key={stage.status}
              type="button"
              onClick={() => onNavigate('all_leads', { leadFilter: { status: stage.status } })}
              className="text-left sm:pl-4 first:pl-0 pt-2 sm:pt-0 hover:opacity-80 cursor-pointer"
            >
              <div className="text-xs text-slate-500">{stage.label}</div>
              <div className="text-lg font-display font-bold font-mono tabular-nums text-slate-900">
                {stage.count}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Visual Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-display text-base font-bold text-slate-900 mb-4">
            Lead Acquisition &amp; Conversion Trend
          </h2>
          {trendData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-sm text-slate-400">
              Submit or add leads to populate acquisition trend data.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="leads" stroke="#1D4ED8" fill="#DBEAFE" name="Total Leads" />
                  <Area type="monotone" dataKey="converted" stroke="#16A34A" fill="#DCFCE7" name="Converted" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="font-display text-base font-bold text-slate-900 mb-4">
            Business Unit Performance Comparison
          </h2>
          {unitComparison.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-sm text-slate-400">
              Create business units to compare unit-level performance.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={unitComparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="leads" fill="#1D4ED8" name="Leads" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="converted" fill="#DC2626" name="Converted" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Bottom 3-Column Operational Feed (Submissions, Follow-Ups, Activities) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-bold text-slate-900">Recent Submissions</h3>
            <button
              type="button"
              onClick={() => onNavigate('form_submissions')}
              className="text-xs text-blue-700 hover:underline cursor-pointer"
            >
              View all
            </button>
          </div>
          {scopedSubmissions.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No submissions in range.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {scopedSubmissions.slice(0, 5).map((s) => (
                <div key={s.id} className="py-2.5 text-xs">
                  <div className="font-semibold text-slate-900 truncate">{s.submitterName}</div>
                  <div className="text-slate-500 truncate">
                    {s.formTitle} · {s.businessUnitName}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 text-blue-700" />
              Upcoming Follow-Ups
            </h3>
            {effectiveCrmAccess && (
              <button
                type="button"
                onClick={() => onNavigate('follow_ups')}
                className="text-xs text-blue-700 hover:underline cursor-pointer"
              >
                Schedule
              </button>
            )}
          </div>
          {upcomingFollowUps.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No follow-ups scheduled.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {upcomingFollowUps.map((l) => (
                <div key={l.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{l.fullName}</div>
                    <div className="text-slate-500 truncate">{l.businessUnitName}</div>
                  </div>
                  <span className="font-mono text-blue-700 shrink-0">{l.followUpDate}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm font-bold text-slate-900">Recent Portal Activity</h3>
            <button
              type="button"
              onClick={() => onNavigate('integrations_security')}
              className="text-xs text-blue-700 hover:underline cursor-pointer"
            >
              Audit Log
            </button>
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No activity logged yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="py-2.5 text-xs">
                  <div className="font-medium text-slate-900">{log.summary}</div>
                  <div className="text-slate-400 mt-0.5">
                    {log.actorName} · {formatTimestamp(log.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
