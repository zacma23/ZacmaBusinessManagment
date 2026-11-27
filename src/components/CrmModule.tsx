import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Download,
  PhoneCall,
  Calendar,
  Archive,
  RotateCcw,
  Trash2,
  X,
  AlertTriangle,
  Paperclip,
  MessageSquare,
  Clock,
  CheckCircle2,
  Kanban,
  Table2,
  ArrowRight,
} from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import {
  addLeadActivityOnly,
  canManageOrg,
  createManualLead,
  deleteLeadRecord,
  exportToCsv,
  fetchLeadDetailsHistory,
  formatTimestamp,
  updateLeadAndLog,
} from '../lib/zacmaService';
import { getHighlightSegments } from '../lib/searchIndex';
import type {
  CommunicationRecord,
  Lead,
  LeadActivity,
  LeadFilterPreset,
  LeadPriority,
  LeadStatus,
  NavSection,
} from '../types';

interface Props {
  activeSection: NavSection;
  filterPreset?: LeadFilterPreset;
  onNavigate: (section: NavSection, preset?: { leadFilter?: LeadFilterPreset }) => void;
}

const PIPELINE_STAGES: Array<{ key: LeadStatus; label: string; color: string }> = [
  { key: 'new', label: 'New', color: 'text-blue-700' },
  { key: 'contacted', label: 'Contacted', color: 'text-amber-700' },
  { key: 'interested', label: 'Interested', color: 'text-indigo-700' },
  { key: 'converted', label: 'Converted', color: 'text-emerald-700' },
  { key: 'lost', label: 'Lost', color: 'text-red-700' },
];

const ALL_STATUSES: Array<{ key: LeadStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All Statuses' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'converted', label: 'Converted' },
  { key: 'lost', label: 'Lost' },
  { key: 'archived', label: 'Archived' },
];

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  const segments = getHighlightSegments(text, query);
  return (
    <>
      {segments.map((seg, idx) =>
        seg.match ? (
          <mark
            key={idx}
            className="bg-amber-100 text-slate-900 rounded-xs px-0.5 font-semibold"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        )
      )}
    </>
  );
}

export function CrmModule({ activeSection, filterPreset, onNavigate }: Props) {
  const {
    user,
    organization,
    effectiveRole,
    isSuperAdmin,
    businessUnits,
    forms,
    leads,
    leadSearchIndex,
    duplicateLeadMap,
    members,
  } = usePortal();

  const canDeleteLead = canManageOrg(effectiveRole);
  const canReassign = ['super_admin', 'org_admin', 'bu_manager'].includes(effectiveRole);

  // Filters
  const [search, setSearch] = useState(filterPreset?.search || '');
  const [buFilter, setBuFilter] = useState(filterPreset?.businessUnitId || 'all');
  const [formFilter, setFormFilter] = useState(filterPreset?.formId || 'all');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>(filterPreset?.status || 'all');
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'assigned' | 'unassigned'>(
    filterPreset?.assignment || 'all'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Detail Drawer & History
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [communications, setCommunications] = useState<CommunicationRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Detail Form controls
  const [noteInput, setNoteInput] = useState('');
  const [activityType, setActivityType] = useState<'note' | 'call' | 'meeting'>('call');
  const [activitySummary, setActivitySummary] = useState('');
  const [followUpInput, setFollowUpInput] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');

  // Manual Lead Modal
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    businessUnitId: businessUnits[0]?.id || '',
    fullName: '',
    email: '',
    phone: '',
    priority: 'medium' as LeadPriority,
    source: 'manual_entry',
    internalNotes: '',
  });
  const [savingManual, setSavingManual] = useState(false);
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);

  useEffect(() => {
    if (filterPreset) {
      if (filterPreset.businessUnitId !== undefined) setBuFilter(filterPreset.businessUnitId || 'all');
      if (filterPreset.formId !== undefined) setFormFilter(filterPreset.formId || 'all');
      if (filterPreset.status !== undefined) setStatusFilter(filterPreset.status);
      if (filterPreset.assignment !== undefined) setAssignmentFilter(filterPreset.assignment);
      if (filterPreset.search !== undefined) setSearch(filterPreset.search);
    }
  }, [filterPreset]);

  // Keep activeLead synced with live Firestore state
  useEffect(() => {
    if (!activeLead) return;
    const latest = leads.find((l) => l.id === activeLead.id);
    if (latest) {
      setActiveLead(latest);
      setNoteInput(latest.internalNotes || '');
      setFollowUpInput(latest.followUpDate || '');
    }
  }, [leads, activeLead?.id]);

  // Fetch activity & communication history when opening a lead
  const openLeadDrawer = async (lead: Lead) => {
    setActiveLead(lead);
    setNoteInput(lead.internalNotes || '');
    setFollowUpInput(lead.followUpDate || '');
    if (!organization || !user) return;
    setLoadingHistory(true);
    try {
      const history = await fetchLeadDetailsHistory(
        organization.id,
        lead.id,
        user.uid,
        isSuperAdmin
      );
      setActivities(history.activities);
      setCommunications(history.communications);
    } finally {
      setLoadingHistory(false);
    }
  };

  const refreshActiveLeadHistory = async (lead: Lead) => {
    if (!organization || !user) return;
    const history = await fetchLeadDetailsHistory(organization.id, lead.id, user.uid, isSuperAdmin);
    setActivities(history.activities);
    setCommunications(history.communications);
  };

  const filteredLeads = useMemo(() => {
    const baseLeads = search.trim() ? leadSearchIndex.search(search) : leads;
    return baseLeads.filter((l) => {
      if (buFilter !== 'all' && l.businessUnitId !== buFilter) return false;
      if (formFilter !== 'all' && l.formId !== formFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (assignmentFilter === 'assigned' && !l.assignedStaffId) return false;
      if (assignmentFilter === 'unassigned' && l.assignedStaffId) return false;
      return true;
    });
  }, [leads, leadSearchIndex, buFilter, formFilter, statusFilter, assignmentFilter, search]);

  const hasActiveLeadFilters =
    Boolean(search.trim()) ||
    buFilter !== 'all' ||
    formFilter !== 'all' ||
    statusFilter !== 'all' ||
    assignmentFilter !== 'all';

  const clearLeadFilters = () => {
    setSearch('');
    setBuFilter('all');
    setFormFilter('all');
    setStatusFilter('all');
    setAssignmentFilter('all');
  };

  const handleStageMove = async (lead: Lead, nextStatus: LeadStatus) => {
    if (!organization || !user || lead.status === nextStatus) return;
    await updateLeadAndLog({
      organizationId: organization.id,
      lead,
      updates: { status: nextStatus },
      activityType: nextStatus === 'archived' ? 'archive' : 'status_change',
      activitySummary: `Status changed from ${lead.status} to ${nextStatus}`,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Staff',
    });
    if (activeLead?.id === lead.id) {
      await refreshActiveLeadHistory(lead);
    }
  };

  const handlePriorityChange = async (lead: Lead, priority: LeadPriority) => {
    if (!organization || !user) return;
    await updateLeadAndLog({
      organizationId: organization.id,
      lead,
      updates: { priority },
      activityType: 'edit',
      activitySummary: `Priority updated to ${priority}`,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Staff',
    });
    if (activeLead?.id === lead.id) await refreshActiveLeadHistory(lead);
  };

  const handleAssignStaff = async (lead: Lead, staffUid: string) => {
    if (!organization || !user || !canReassign) return;
    const member = members.find((m) => m.userId === staffUid);
    await updateLeadAndLog({
      organizationId: organization.id,
      lead,
      updates: {
        assignedStaffId: staffUid,
        assignedStaffName: member?.displayName || '',
      },
      activityType: 'assignment',
      activitySummary: member
        ? `Assigned lead to ${member.displayName}`
        : 'Unassigned lead',
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Admin',
    });
    if (activeLead?.id === lead.id) await refreshActiveLeadHistory(lead);
  };

  const handleSaveNotesAndFollowup = async () => {
    if (!organization || !user || !activeLead) return;
    await updateLeadAndLog({
      organizationId: organization.id,
      lead: activeLead,
      updates: {
        internalNotes: noteInput,
        followUpDate: followUpInput,
      },
      activityType: followUpInput !== activeLead.followUpDate ? 'followup' : 'note',
      activitySummary:
        followUpInput !== activeLead.followUpDate
          ? `Follow-up scheduled for ${followUpInput || 'cleared'}`
          : 'Updated internal notes',
      activityDetails: noteInput.slice(0, 300),
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Staff',
    });
    await refreshActiveLeadHistory(activeLead);
  };

  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !user || !activeLead || !activitySummary.trim()) return;
    await addLeadActivityOnly({
      organizationId: organization.id,
      lead: activeLead,
      type: activityType,
      summary: activitySummary,
      details: `Logged ${activityType} by ${user.displayName || user.email}`,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Staff',
      updateLastContact: activityType === 'call' || activityType === 'meeting',
    });
    setActivitySummary('');
    await refreshActiveLeadHistory(activeLead);
  };

  const handleAddAttachment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !user || !activeLead || !attachmentName.trim() || !attachmentUrl.trim()) return;
    if (!/^https?:\/\//i.test(attachmentUrl.trim())) return;
    const nextAttachments = [
      ...(activeLead.attachments || []),
      {
        id: `att_${Date.now().toString(36)}`,
        name: attachmentName.trim(),
        url: attachmentUrl.trim(),
        uploadedAt: new Date().toISOString(),
      },
    ].slice(0, 20);
    await updateLeadAndLog({
      organizationId: organization.id,
      lead: activeLead,
      updates: { attachments: nextAttachments },
      activityType: 'edit',
      activitySummary: `Attached document: ${attachmentName.trim()}`,
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Staff',
    });
    setAttachmentName('');
    setAttachmentUrl('');
    await refreshActiveLeadHistory(activeLead);
  };

  const handleCreateManualLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !user) return;
    const bu = businessUnits.find((b) => b.id === (manualForm.businessUnitId || businessUnits[0]?.id));
    if (!bu || !manualForm.fullName.trim()) return;
    setSavingManual(true);
    try {
      await createManualLead({
        organizationId: organization.id,
        businessUnit: bu,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Staff',
        fullName: manualForm.fullName,
        email: manualForm.email,
        phone: manualForm.phone,
        priority: manualForm.priority,
        source: manualForm.source,
        internalNotes: manualForm.internalNotes,
      });
      setManualModalOpen(false);
      setManualForm({
        businessUnitId: businessUnits[0]?.id || '',
        fullName: '',
        email: '',
        phone: '',
        priority: 'medium',
        source: 'manual_entry',
        internalNotes: '',
      });
    } finally {
      setSavingManual(false);
    }
  };

  const handleExportSelected = () => {
    const target =
      selectedIds.length > 0
        ? filteredLeads.filter((l) => selectedIds.includes(l.id))
        : filteredLeads;
    exportToCsv(
      `zacma-leads-${new Date().toISOString().slice(0, 10)}.csv`,
      target.map((l) => ({
        LeadRef: l.leadRef,
        FullName: l.fullName,
        Email: l.email,
        Phone: l.phone,
        BusinessUnit: l.businessUnitName,
        Form: l.formTitle,
        Status: l.status,
        Priority: l.priority,
        AssignedTo: l.assignedStaffName || 'Unassigned',
        FollowUpDate: l.followUpDate || '',
        SubmittedAt: formatTimestamp(l.submittedAt),
      }))
    );
  };

  // ===========================================================================
  // VIEW A: CRM DASHBOARD
  // ===========================================================================
  if (activeSection === 'crm_dashboard') {
    const counts = {
      total: leads.length,
      new: leads.filter((l) => l.status === 'new').length,
      contacted: leads.filter((l) => l.status === 'contacted').length,
      interested: leads.filter((l) => l.status === 'interested').length,
      converted: leads.filter((l) => l.status === 'converted').length,
      lost: leads.filter((l) => l.status === 'lost').length,
      unassigned: leads.filter((l) => !l.assignedStaffId && l.status !== 'archived').length,
    };
    const convRate = counts.total > 0 ? ((counts.converted / counts.total) * 100).toFixed(1) : '0.0';

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">CRM Dashboard</h1>
            <p className="text-sm text-slate-600 mt-1">
              Click any metric card to inspect the matching filtered leads immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('lead_pipeline')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              <Kanban className="w-4 h-4" />
              Kanban Pipeline
            </button>
            <button
              type="button"
              onClick={() => onNavigate('all_leads')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer"
            >
              <Table2 className="w-4 h-4" />
              Open All Leads
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Leads', value: counts.total, filter: { status: 'all' as const }, tone: 'text-slate-900' },
            { label: 'New Leads', value: counts.new, filter: { status: 'new' as const }, tone: 'text-blue-700' },
            { label: 'Contacted', value: counts.contacted, filter: { status: 'contacted' as const }, tone: 'text-amber-700' },
            { label: 'Interested', value: counts.interested, filter: { status: 'interested' as const }, tone: 'text-indigo-700' },
            { label: 'Converted', value: counts.converted, filter: { status: 'converted' as const }, tone: 'text-emerald-700' },
            { label: 'Lost', value: counts.lost, filter: { status: 'lost' as const }, tone: 'text-red-600' },
            { label: 'Unassigned', value: counts.unassigned, filter: { assignment: 'unassigned' as const }, tone: 'text-red-700' },
            { label: 'Conversion Rate', value: `${convRate}%`, filter: { status: 'converted' as const }, tone: 'text-emerald-700' },
          ].map((stat) => (
            <button
              key={stat.label}
              type="button"
              onClick={() => onNavigate('all_leads', { leadFilter: stat.filter })}
              className="bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-5 text-left transition-colors cursor-pointer"
            >
              <div className="text-xs text-slate-500">{stat.label}</div>
              <div className={`text-2xl font-display font-bold font-mono tabular-nums mt-1 ${stat.tone}`}>
                {stat.value}
              </div>
            </button>
          ))}
        </div>

        {/* Recent Unassigned Leads Action Queue */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">
              Recent Leads Queue
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('all_leads')}
              className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              Manage all leads <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {leads.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No leads yet. Leads arrive automatically when visitors submit published public forms.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {leads.slice(0, 8).map((l) => (
                <div
                  key={l.id}
                  onClick={() => openLeadDrawer(l)}
                  className="py-3 flex items-center justify-between gap-4 hover:bg-slate-50 px-2 rounded-lg cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {l.fullName}{' '}
                      <span className="font-mono text-xs text-slate-400 font-normal">
                        {l.leadRef}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {l.businessUnitName} · {l.formTitle} · {l.assignedStaffName || 'Unassigned'}
                    </div>
                  </div>
                  <div className="text-xs font-medium capitalize text-slate-700 shrink-0">
                    {l.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===========================================================================
  // VIEW B: FOLLOW-UPS MANAGER
  // ===========================================================================
  if (activeSection === 'follow_ups') {
    const today = new Date().toISOString().slice(0, 10);
    const allScheduled = leads.filter((l) => Boolean(l.followUpDate) && l.status !== 'archived');
    const searchPool = search.trim() ? leadSearchIndex.search(search) : allScheduled;
    const scheduled = searchPool
      .filter((l) => Boolean(l.followUpDate) && l.status !== 'archived')
      .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Follow-up Schedule</h1>
            <p className="text-sm text-slate-600 mt-1">
              Track overdue and upcoming follow-up calls, meetings, and reminders across authorized
              business units.
            </p>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by contact name or lead ref ID…"
              aria-label="Search follow-ups by contact name or lead reference ID"
              className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {scheduled.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600">
              {allScheduled.length === 0
                ? 'No follow-ups scheduled yet. Open any lead in All Leads or Pipeline to set a follow-up date.'
                : `No scheduled follow-ups match "${search.trim()}".`}
            </p>
            {search.trim() && allScheduled.length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mt-3 text-xs font-medium text-blue-700 hover:underline cursor-pointer"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {scheduled.map((lead) => {
              const isOverdue = lead.followUpDate < today;
              return (
                <div
                  key={lead.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        <HighlightedText text={lead.fullName} query={search} />
                      </span>
                      <span className="font-mono text-xs text-slate-400">
                        <HighlightedText text={lead.leadRef} query={search} />
                      </span>
                      {isOverdue && (
                        <span className="text-xs font-semibold text-red-600">Overdue</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {lead.businessUnitName} · Due <span className="font-mono font-medium text-slate-700">{lead.followUpDate}</span> · Assigned to {lead.assignedStaffName || 'Unassigned'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openLeadDrawer(lead)}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                    >
                      Open Lead
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!organization || !user) return;
                        await updateLeadAndLog({
                          organizationId: organization.id,
                          lead,
                          updates: {
                            followUpDate: '',
                            lastContactAt: new Date().toISOString(),
                          },
                          activityType: 'followup',
                          activitySummary: `Completed scheduled follow-up (${lead.followUpDate})`,
                          actorId: user.uid,
                          actorName: user.displayName || user.email || 'Staff',
                        });
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Mark Done
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // VIEW C: KANBAN LEAD PIPELINE OR ALL LEADS TABLE
  // ===========================================================================
  const isKanban = activeSection === 'lead_pipeline';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {isKanban ? 'Lead Pipeline (Kanban)' : 'Centralized CRM — All Leads'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {isKanban
              ? 'Drag and drop leads across stages with validated real-time database updates.'
              : 'Filter, assign, inspect activity timelines, detect duplicates, and export leads across all business units.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => onNavigate('all_leads')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                !isKanban ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => onNavigate('lead_pipeline')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                isKanban ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              Kanban
            </button>
          </div>
          <button
            type="button"
            onClick={handleExportSelected}
            disabled={filteredLeads.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 rounded-lg disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </button>
          <button
            type="button"
            disabled={businessUnits.length === 0}
            onClick={() => {
              setManualForm((prev) => ({
                ...prev,
                businessUnitId: prev.businessUnitId || businessUnits[0]?.id || '',
              }));
              setManualModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Lead
          </button>
        </div>
      </div>

      {/* Multi-Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contact name, ZCM lead ref ID, email, phone, or notes…"
              aria-label="Search leads by contact name, lead reference ID, email, phone, or notes"
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search query"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={buFilter}
            onChange={(e) => setBuFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
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
            className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
          >
            <option value="all">All Forms</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            {!isKanban && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as LeadStatus | 'all')}
                className="flex-1 px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <select
              value={assignmentFilter}
              onChange={(e) =>
                setAssignmentFilter(e.target.value as 'all' | 'assigned' | 'unassigned')
              }
              className="flex-1 px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">Any Owner</option>
              <option value="unassigned">Unassigned</option>
              <option value="assigned">Assigned</option>
            </select>
          </div>
        </div>
        {hasActiveLeadFilters && (
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 text-xs text-slate-500">
            <span>
              Showing <strong className="font-mono text-slate-900">{filteredLeads.length}</strong> of{' '}
              <span className="font-mono">{leads.length}</span> indexed leads
              {search.trim() ? ` matching "${search.trim()}"` : ''}
            </span>
            <button
              type="button"
              onClick={clearLeadFilters}
              className="text-blue-700 hover:underline font-medium cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Kanban Board View */}
      {isKanban ? (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 items-start">
          {PIPELINE_STAGES.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => l.status === stage.key);
            return (
              <div
                key={stage.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragLeadId) return;
                  const target = leads.find((l) => l.id === dragLeadId);
                  if (target) void handleStageMove(target, stage.key);
                  setDragLeadId(null);
                }}
                className="bg-slate-100/80 border border-slate-200 rounded-xl p-3 min-h-[420px]"
              >
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className={`text-xs font-bold ${stage.color}`}>{stage.label}</span>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {stageLeads.map((lead) => {
                    const dups = duplicateLeadMap.get(lead.id);
                    return (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => setDragLeadId(lead.id)}
                        onClick={() => openLeadDrawer(lead)}
                        className="bg-white border border-slate-200 hover:border-blue-400 rounded-lg p-3.5 cursor-pointer shadow-2xs transition-colors"
                      >
                        <div className="text-xs font-mono text-slate-400 mb-1 flex items-center justify-between">
                          <span>
                            <HighlightedText text={lead.leadRef} query={search} />
                          </span>
                          <span
                            className={`capitalize font-sans font-semibold ${
                              lead.priority === 'urgent'
                                ? 'text-red-600'
                                : lead.priority === 'high'
                                  ? 'text-amber-700'
                                  : 'text-slate-500'
                            }`}
                          >
                            {lead.priority}
                          </span>
                        </div>
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          <HighlightedText text={lead.fullName} query={search} />
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5">
                          {lead.businessUnitName}
                        </div>
                        {dups && (
                          <div className="mt-1.5 text-[11px] text-amber-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>Duplicate match ({dups.length})</span>
                          </div>
                        )}
                        <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                          <span className="truncate">{lead.assignedStaffName || 'Unassigned'}</span>
                          {lead.followUpDate && (
                            <span className="font-mono text-blue-700">{lead.followUpDate}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* High-Density Table View */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredLeads.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500 space-y-2">
              <p>No leads match the current search or filters.</p>
              {hasActiveLeadFilters && (
                <button
                  type="button"
                  onClick={clearLeadFilters}
                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                >
                  Clear search &amp; filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 w-8">
                      <input
                        type="checkbox"
                        checked={
                          filteredLeads.length > 0 && selectedIds.length === filteredLeads.length
                        }
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? filteredLeads.map((l) => l.id) : [])
                        }
                        className="rounded border-slate-300"
                      />
                    </th>
                    <th className="py-3 px-4">Lead &amp; Reference</th>
                    <th className="py-3 px-4">Business Unit &amp; Form</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Assigned To</th>
                    <th className="py-3 px-4">Submitted</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredLeads.map((lead) => {
                    const dups = duplicateLeadMap.get(lead.id);
                    return (
                      <tr key={lead.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(lead.id)}
                            onChange={(e) =>
                              setSelectedIds((prev) =>
                                e.target.checked
                                  ? [...prev, lead.id]
                                  : prev.filter((id) => id !== lead.id)
                              )
                            }
                            className="rounded border-slate-300"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => openLeadDrawer(lead)}
                            className="text-left group cursor-pointer"
                          >
                            <div className="font-semibold text-slate-900 group-hover:text-blue-700">
                              <HighlightedText text={lead.fullName} query={search} />
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-blue-700">
                                <HighlightedText text={lead.leadRef} query={search} />
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                <HighlightedText
                                  text={lead.email || lead.phone || 'No contact'}
                                  query={search}
                                />
                              </span>
                              {dups && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-700 font-medium">
                                    Possible duplicate ({dups.join(', ')})
                                  </span>
                                </>
                              )}
                            </div>
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-900 text-xs font-medium">
                            {lead.businessUnitName}
                          </div>
                          <div className="text-xs text-slate-500">{lead.formTitle}</div>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={lead.status}
                            onChange={(e) => handleStageMove(lead, e.target.value as LeadStatus)}
                            className="px-2 py-1 text-xs font-medium border border-slate-200 rounded-md bg-white capitalize"
                          >
                            {ALL_STATUSES.filter((s) => s.key !== 'all').map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4">
                          <select
                            value={lead.priority}
                            onChange={(e) =>
                              handlePriorityChange(lead, e.target.value as LeadPriority)
                            }
                            className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white capitalize"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                          </select>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          {canReassign ? (
                            <select
                              value={lead.assignedStaffId}
                              onChange={(e) => handleAssignStaff(lead, e.target.value)}
                              className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white max-w-[140px]"
                            >
                              <option value="">Unassigned</option>
                              {members.map((m) => (
                                <option key={m.userId} value={m.userId}>
                                  {m.displayName}
                                </option>
                              ))}
                            </select>
                          ) : (
                            lead.assignedStaffName || 'Unassigned'
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-500">
                          {formatTimestamp(lead.submittedAt)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => openLeadDrawer(lead)}
                            className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lead Detail Slide-Over Drawer */}
      {activeLead && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
          <div className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {activeLead.fullName}
                  </h2>
                  <span className="font-mono text-xs text-blue-700 font-semibold">
                    {activeLead.leadRef}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {activeLead.businessUnitName} · {activeLead.formTitle}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveLead(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 flex-1">
              {/* Duplicate Detection Banner (Non-destructive — preserves full submission history) */}
              {duplicateLeadMap.get(activeLead.id) && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Duplicate Match Detected: </span>
                    Shares email/phone with{' '}
                    <span className="font-mono font-semibold">
                      {duplicateLeadMap.get(activeLead.id)?.join(', ')}
                    </span>
                    . Both records and their submission histories are preserved intact.
                  </div>
                </div>
              )}

              {/* Contact & Quick Stage Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <div className="text-slate-400">Email</div>
                  <div className="font-medium text-slate-900 mt-0.5 break-all">
                    {activeLead.email || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Phone</div>
                  <div className="font-mono font-medium text-slate-900 mt-0.5">
                    {activeLead.phone || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Last Contact</div>
                  <div className="font-mono text-slate-700 mt-0.5">
                    {activeLead.lastContactAt ? formatTimestamp(activeLead.lastContactAt) : 'Not contacted'}
                  </div>
                </div>
              </div>

              {/* Status, Priority, Staff Assignment */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Lead Status</label>
                  <select
                    value={activeLead.status}
                    onChange={(e) => handleStageMove(activeLead, e.target.value as LeadStatus)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white capitalize"
                  >
                    {ALL_STATUSES.filter((s) => s.key !== 'all').map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                  <select
                    value={activeLead.priority}
                    onChange={(e) =>
                      handlePriorityChange(activeLead, e.target.value as LeadPriority)
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white capitalize"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Assigned Staff</label>
                  <select
                    disabled={!canReassign}
                    value={activeLead.assignedStaffId}
                    onChange={(e) => handleAssignStaff(activeLead, e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Submitted Form Responses */}
              {Object.keys(activeLead.responses || {}).length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-800 mb-2">
                    Submitted Form Responses
                  </h3>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {Object.entries(activeLead.responses).map(([key, value]) => (
                      <div key={key} className="px-3.5 py-2 flex justify-between gap-4 text-xs">
                        <span className="text-slate-500 font-medium">{key}</span>
                        <span className="text-slate-900 text-right break-words">
                          {Array.isArray(value) ? value.join(', ') : String(value ?? '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Internal Notes & Follow-up Scheduler */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Schedule Follow-Up Date
                    </label>
                    <input
                      type="date"
                      value={followUpInput}
                      onChange={(e) => setFollowUpInput(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleSaveNotesAndFollowup}
                      className="w-full px-4 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer"
                    >
                      Save Notes &amp; Follow-Up
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Internal CRM Notes
                  </label>
                  <textarea
                    rows={3}
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Record private qualification notes, objections, or next steps…"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Log Call / Meeting / Activity */}
              <form onSubmit={handleLogActivity} className="space-y-2.5 pt-2 border-t border-slate-200">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <PhoneCall className="w-3.5 h-3.5 text-blue-700" />
                  Record Call, Meeting, or Note
                </h3>
                <div className="flex gap-2">
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value as 'note' | 'call' | 'meeting')}
                    className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="call">Phone Call</option>
                    <option value="meeting">Meeting</option>
                    <option value="note">Note</option>
                  </select>
                  <input
                    type="text"
                    value={activitySummary}
                    onChange={(e) => setActivitySummary(e.target.value)}
                    placeholder="Summary (e.g., Called applicant, confirmed course start date)"
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
                  >
                    Log
                  </button>
                </div>
              </form>

              {/* Document Attachments */}
              <form onSubmit={handleAddAttachment} className="space-y-2 pt-2 border-t border-slate-200">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-blue-700" />
                  Relevant Documents ({activeLead.attachments?.length || 0})
                </h3>
                {(activeLead.attachments || []).map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between text-xs bg-slate-50 px-3 py-2 rounded-lg"
                  >
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 hover:underline font-medium truncate"
                    >
                      {att.name}
                    </a>
                    <span className="text-slate-400 font-mono text-[11px]">
                      {att.uploadedAt.slice(0, 10)}
                    </span>
                  </div>
                ))}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={attachmentName}
                    onChange={(e) => setAttachmentName(e.target.value)}
                    placeholder="Document title"
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    type="url"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    placeholder="https://… document link"
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-medium border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    Attach Link
                  </button>
                </div>
              </form>

              {/* Communication History & Activity Timeline */}
              <div className="pt-2 border-t border-slate-200 space-y-4">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-700" />
                  Complete Activity &amp; Communication Timeline
                </h3>
                {loadingHistory ? (
                  <p className="text-xs text-slate-400">Loading timeline…</p>
                ) : (
                  <div className="space-y-3">
                    {communications.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold text-slate-500">
                          Communications ({communications.length})
                        </div>
                        {communications.map((c) => (
                          <div
                            key={c.id}
                            className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg text-xs"
                          >
                            <div className="flex items-center justify-between font-medium text-slate-900">
                              <span className="flex items-center gap-1.5">
                                <MessageSquare className="w-3.5 h-3.5 text-blue-700" />
                                {c.channel.toUpperCase()} to {c.recipient}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500">
                                {c.deliveryStatus}
                              </span>
                            </div>
                            <p className="text-slate-600 mt-1">{c.body}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-2">
                      {activities.map((act) => (
                        <div
                          key={act.id}
                          className="p-3 border border-slate-200 rounded-lg text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">{act.summary}</span>
                            <span className="font-mono text-[11px] text-slate-400 shrink-0">
                              {formatTimestamp(act.createdAt)}
                            </span>
                          </div>
                          {act.details && <p className="text-slate-600 mt-1">{act.details}</p>}
                          <div className="text-[11px] text-slate-400 mt-1">
                            By {act.actorName} · {act.type}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Archive / Restore / Delete Footer */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    handleStageMove(
                      activeLead,
                      activeLead.status === 'archived' ? 'new' : 'archived'
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  {activeLead.status === 'archived' ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" /> Restore Lead
                    </>
                  ) : (
                    <>
                      <Archive className="w-3.5 h-3.5" /> Archive Lead
                    </>
                  )}
                </button>
                {canDeleteLead && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!organization || !user) return;
                      await deleteLeadRecord({
                        organizationId: organization.id,
                        lead: activeLead,
                        ownerId: organization.ownerId,
                        authorizedUserIds: organization.authorizedUserIds,
                        actorId: user.uid,
                        actorName: user.displayName || user.email || 'Admin',
                      });
                      setActiveLead(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Lead
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Manual Lead Modal */}
      {manualModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
              <h3 className="font-display text-base font-bold text-slate-900">
                Add Manual CRM Lead
              </h3>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateManualLead} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Business Unit *
                </label>
                <select
                  value={manualForm.businessUnitId}
                  onChange={(e) => setManualForm({ ...manualForm, businessUnitId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {businessUnits.map((bu) => (
                    <option key={bu.id} value={bu.id}>
                      {bu.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={manualForm.fullName}
                  onChange={(e) => setManualForm({ ...manualForm, fullName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={manualForm.email}
                    onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={manualForm.phone}
                    onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={manualForm.priority}
                    onChange={(e) =>
                      setManualForm({ ...manualForm, priority: e.target.value as LeadPriority })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Source</label>
                  <input
                    type="text"
                    value={manualForm.source}
                    onChange={(e) => setManualForm({ ...manualForm, source: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={manualForm.internalNotes}
                  onChange={(e) => setManualForm({ ...manualForm, internalNotes: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setManualModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingManual}
                  className="px-4 py-2 text-xs font-semibold bg-blue-700 text-white rounded-lg cursor-pointer"
                >
                  {savingManual ? 'Creating…' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
