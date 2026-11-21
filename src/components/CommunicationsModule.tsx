import React, { useEffect, useMemo, useState } from 'react';
import {
  Send,
  Mail,
  MessageSquare,
  Plus,
  Trash2,
  Edit3,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  X,
} from 'lucide-react';
import { usePortal } from '../context/PortalContext';
import {
  canManageOrg,
  deleteMessageTemplate,
  mergeTemplateVariables,
  saveMessageTemplate,
  sendAndLogCommunication,
} from '../lib/zacmaService';
import type { LeadStatus, MessageTemplate, NavSection } from '../types';

interface Props {
  activeSection: NavSection;
  initialDraft?: {
    channel?: 'email' | 'sms';
    subject?: string;
    body?: string;
    businessUnitId?: string;
  } | null;
  onNavigate: (section: NavSection) => void;
}

const MERGE_TAGS = [
  '{{full_name}}',
  '{{business_name}}',
  '{{lead_ref}}',
  '{{email}}',
  '{{phone}}',
  '{{form_title}}',
];

export function CommunicationsModule({ activeSection, initialDraft, onNavigate }: Props) {
  const {
    user,
    organization,
    effectiveRole,
    businessUnits,
    forms,
    leads,
    members,
    templates,
    integrations,
  } = usePortal();

  const canDeleteTemplate = canManageOrg(effectiveRole);

  // Composer state
  const [channel, setChannel] = useState<'email' | 'sms'>(initialDraft?.channel || 'email');
  const [selectedBuIds, setSelectedBuIds] = useState<string[]>(
    initialDraft?.businessUnitId ? [initialDraft.businessUnitId] : []
  );
  const [formFilter, setFormFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [staffFilter, setStaffFilter] = useState('all');
  const [singleLeadId, setSingleLeadId] = useState('all');
  const [subject, setSubject] = useState(initialDraft?.subject || '');
  const [body, setBody] = useState(
    initialDraft?.body ||
      'Hello {{full_name}}, thank you for contacting {{business_name}}. Our team will contact you shortly regarding reference {{lead_ref}}.'
  );
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dispatchSummary, setDispatchSummary] = useState<{
    sent: number;
    queued: number;
    failed: number;
  } | null>(null);

  // Template Modal
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<MessageTemplate | null>(null);
  const [tplForm, setTplForm] = useState({
    businessUnitId: '',
    name: '',
    channel: 'email' as 'email' | 'sms',
    subject: '',
    body: '',
  });
  const [savingTpl, setSavingTpl] = useState(false);

  useEffect(() => {
    if (initialDraft) {
      if (initialDraft.channel) setChannel(initialDraft.channel);
      if (initialDraft.subject) setSubject(initialDraft.subject);
      if (initialDraft.body) setBody(initialDraft.body);
      if (initialDraft.businessUnitId) setSelectedBuIds([initialDraft.businessUnitId]);
    }
  }, [initialDraft]);

  const matchingRecipients = useMemo(() => {
    return leads.filter((l) => {
      if (l.status === 'archived') return false;
      if (singleLeadId !== 'all' && l.id !== singleLeadId) return false;
      if (selectedBuIds.length > 0 && !selectedBuIds.includes(l.businessUnitId)) return false;
      if (formFilter !== 'all' && l.formId !== formFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (staffFilter !== 'all' && l.assignedStaffId !== staffFilter) return false;
      return channel === 'email' ? Boolean(l.email?.trim()) : Boolean(l.phone?.trim());
    });
  }, [leads, singleLeadId, selectedBuIds, formFilter, statusFilter, staffFilter, channel]);

  const activeProviderConfig = useMemo(() => {
    const key = channel === 'email' ? 'resend_email' : 'twilio_sms';
    return integrations.find((i) => i.providerKey === key) || null;
  }, [integrations, channel]);

  const previewLead = matchingRecipients[0] || leads[0] || {
    fullName: 'Abebe Bikila',
    email: 'client@example.com',
    phone: '+251911000000',
    leadRef: 'ZCM-2026-DEMO',
    businessUnitName: businessUnits[0]?.name || 'Zacma Business Unit',
    formTitle: forms[0]?.title || 'Inquiry Form',
  };

  const toggleBuFilter = (buId: string) => {
    setSelectedBuIds((prev) =>
      prev.includes(buId) ? prev.filter((id) => id !== buId) : [...prev, buId]
    );
  };

  const applyTemplate = (tpl: MessageTemplate) => {
    setChannel(tpl.channel);
    setSubject(tpl.subject);
    setBody(tpl.body);
  };

  const executeDispatch = async () => {
    if (!organization || !user || matchingRecipients.length === 0) return;
    setConfirmOpen(false);
    setSending(true);
    setDispatchSummary(null);

    let sent = 0;
    let queued = 0;
    let failed = 0;

    for (const lead of matchingRecipients) {
      try {
        const status = await sendAndLogCommunication({
          organizationId: organization.id,
          lead,
          channel,
          subject,
          body,
          actorId: user.uid,
          actorName: user.displayName || user.email || 'Staff',
        });
        if (status === 'sent') sent += 1;
        else if (status === 'queued_pending_provider_approval') queued += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    setDispatchSummary({ sent, queued, failed });
    setSending(false);
  };

  const openTemplateModal = (tpl?: MessageTemplate) => {
    if (tpl) {
      setEditingTpl(tpl);
      setTplForm({
        businessUnitId: tpl.businessUnitId,
        name: tpl.name,
        channel: tpl.channel,
        subject: tpl.subject,
        body: tpl.body,
      });
    } else {
      setEditingTpl(null);
      setTplForm({
        businessUnitId: '',
        name: '',
        channel: 'email',
        subject: '',
        body: 'Hello {{full_name}}, thank you for contacting {{business_name}}.',
      });
    }
    setTplModalOpen(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !tplForm.name.trim() || !tplForm.body.trim()) return;
    setSavingTpl(true);
    try {
      await saveMessageTemplate({
        organizationId: organization.id,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        existing: editingTpl,
        data: tplForm,
      });
      setTplModalOpen(false);
    } finally {
      setSavingTpl(false);
    }
  };

  // ===========================================================================
  // VIEW 1: MESSAGE TEMPLATES
  // ===========================================================================
  if (activeSection === 'message_templates') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Message Templates</h1>
            <p className="text-sm text-slate-600 mt-1">
              Create reusable Email and SMS templates with automatic lead personalization variables.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openTemplateModal()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-sm text-slate-600 mb-4">
              No message templates yet. Build reusable follow-up scripts with{' '}
              <span className="font-mono">{'{{full_name}}'}</span> and{' '}
              <span className="font-mono">{'{{business_name}}'}</span> placeholders.
            </p>
            <button
              type="button"
              onClick={() => openTemplateModal()}
              className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              Create First Template
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((tpl) => {
              const buName =
                businessUnits.find((b) => b.id === tpl.businessUnitId)?.name || 'All Business Units';
              return (
                <div
                  key={tpl.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <h3 className="font-display text-base font-bold text-slate-900">
                          {tpl.name}
                        </h3>
                        <div className="text-xs text-slate-500 mt-0.5">
                          <span className="uppercase font-semibold text-blue-700">
                            {tpl.channel}
                          </span>{' '}
                          · {buName}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openTemplateModal(tpl)}
                          className="p-1.5 text-slate-500 hover:text-blue-700 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {canDeleteTemplate && organization && (
                          <button
                            type="button"
                            onClick={() => deleteMessageTemplate(organization.id, tpl.id)}
                            className="p-1.5 text-slate-500 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    {tpl.subject && (
                      <div className="text-xs font-semibold text-slate-700 mb-1">
                        Subject: {tpl.subject}
                      </div>
                    )}
                    <p className="text-xs text-slate-600 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-100 mt-2">
                      {tpl.body}
                    </p>
                  </div>
                  <div className="pt-4 mt-4 border-t border-slate-100 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        applyTemplate(tpl);
                        onNavigate('communication_center');
                      }}
                      className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      Use in Communication Center
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Template Modal */}
        {tplModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full p-6 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
                <h3 className="font-display text-base font-bold text-slate-900">
                  {editingTpl ? 'Edit Message Template' : 'New Message Template'}
                </h3>
                <button
                  type="button"
                  onClick={() => setTplModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleSaveTemplate} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Template Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={tplForm.name}
                      onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Channel</label>
                    <select
                      value={tplForm.channel}
                      onChange={(e) =>
                        setTplForm({ ...tplForm, channel: e.target.value as 'email' | 'sms' })
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="email">Email</option>
                      <option value="sms">SMS</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Business Unit Scope
                  </label>
                  <select
                    value={tplForm.businessUnitId}
                    onChange={(e) => setTplForm({ ...tplForm, businessUnitId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">All Business Units</option>
                    {businessUnits.map((bu) => (
                      <option key={bu.id} value={bu.id}>
                        {bu.name}
                      </option>
                    ))}
                  </select>
                </div>
                {tplForm.channel === 'email' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={tplForm.subject}
                      onChange={(e) => setTplForm({ ...tplForm, subject: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Message Body *
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={tplForm.body}
                    onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {MERGE_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setTplForm({ ...tplForm, body: `${tplForm.body} ${tag}` })}
                        className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 hover:bg-blue-50 text-slate-700 rounded cursor-pointer"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setTplModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingTpl}
                    className="px-4 py-2 text-xs font-semibold bg-blue-700 text-white rounded-lg cursor-pointer"
                  >
                    {savingTpl ? 'Saving…' : 'Save Template'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // VIEW 2: COMMUNICATION CENTER (INDIVIDUAL & BULK EMAIL / SMS)
  // ===========================================================================
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Communication Center
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Send personalized individual or bulk Email and SMS follow-ups segmented by business
            unit, form, lead status, or assigned staff.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('message_templates')}
          className="px-3.5 py-2 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 rounded-lg cursor-pointer"
        >
          Manage Templates ({templates.length})
        </button>
      </div>

      {/* API Approval Governance Banner */}
      {activeProviderConfig && activeProviderConfig.approvalStatus !== 'enabled' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">
                {activeProviderConfig.displayName} ({activeProviderConfig.approvalStatus.replace(/_/g, ' ')}):
              </span>{' '}
              Per Zacma API Approval Governance, messages will be logged in each lead's Communication
              History as queued until the Super Admin approves this provider and adds server
              credentials (<span className="font-mono">{activeProviderConfig.requiredCredentials.join(', ')}</span>).
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('integrations_security')}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-900 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            Review Provider Approval
          </button>
        </div>
      )}

      {dispatchSummary && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>
            Communication batch processed: <strong className="font-mono">{dispatchSummary.sent}</strong> live sent,{' '}
            <strong className="font-mono">{dispatchSummary.queued}</strong> logged &amp; queued pending provider credentials,{' '}
            <strong className="font-mono">{dispatchSummary.failed}</strong> failed. All records saved to lead timelines.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Recipient Targeting Panel */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-display text-sm font-bold text-slate-900">1. Target Recipients</h2>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Channel</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannel('email')}
                className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                  channel === 'email'
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                <Mail className="w-3.5 h-3.5" /> Email
              </button>
              <button
                type="button"
                onClick={() => setChannel('sms')}
                className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                  channel === 'sms'
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> SMS
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Specific Lead (Individual) or Bulk Filter
            </label>
            <select
              value={singleLeadId}
              onChange={(e) => setSingleLeadId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">Bulk Segment (use filters below)</option>
              {leads
                .filter((l) => l.status !== 'archived')
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.fullName} ({l.leadRef})
                  </option>
                ))}
            </select>
          </div>

          {singleLeadId === 'all' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Business Units (multi-select)
                </label>
                <div className="space-y-1.5 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                  {businessUnits.map((bu) => (
                    <label key={bu.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedBuIds.includes(bu.id)}
                        onChange={() => toggleBuFilter(bu.id)}
                        className="rounded border-slate-300 text-blue-700"
                      />
                      <span className="truncate">{bu.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Source Form</label>
                <select
                  value={formFilter}
                  onChange={(e) => setFormFilter(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">All Forms</option>
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Lead Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as LeadStatus | 'all')}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">All Statuses</option>
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="interested">Interested</option>
                    <option value="converted">Converted</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Assigned Staff</label>
                  <select
                    value={staffFilter}
                    onChange={(e) => setStaffFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">Any Staff</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-xs text-slate-500">Matched Reachable Recipients</div>
            <div className="text-xl font-display font-bold font-mono tabular-nums text-blue-700 mt-0.5">
              {matchingRecipients.length}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Only leads with a valid {channel === 'email' ? 'email address' : 'phone number'}.
            </div>
          </div>
        </div>

        {/* Right: Message Composer & Personalization Preview */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-display text-sm font-bold text-slate-900">
              2. Compose Personalized {channel.toUpperCase()}
            </h2>
            {templates.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  const found = templates.find((t) => t.id === e.target.value);
                  if (found) applyTemplate(found);
                }}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Load saved template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.channel.toUpperCase()}] {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {channel === 'email' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Thank you for contacting {{business_name}}"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Message Content
            </label>
            <textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[11px] text-slate-400 mr-1">Insert variable:</span>
              {MERGE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setBody((prev) => `${prev} ${tag}`)}
                  className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 hover:bg-blue-50 text-slate-700 rounded cursor-pointer"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Live Personalized Preview */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-500">
              Live Personalized Preview ({previewLead.fullName})
            </div>
            {channel === 'email' && subject && (
              <div className="text-xs font-semibold text-slate-900">
                Subject: {mergeTemplateVariables(subject, previewLead)}
              </div>
            )}
            <p className="text-xs text-slate-700 whitespace-pre-wrap">
              {mergeTemplateVariables(body, previewLead)}
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={sending || matchingRecipients.length === 0 || !body.trim()}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg cursor-pointer"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send to {matchingRecipients.length} Recipient{matchingRecipients.length === 1 ? '' : 's'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Explicit Confirmation Modal for Bulk / Individual Dispatch */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-xl">
            <h3 className="font-display text-base font-bold text-slate-900 mb-2">
              Confirm {channel.toUpperCase()} Dispatch
            </h3>
            <p className="text-sm text-slate-600 mb-5">
              This will personalize and log this {channel.toUpperCase()} message for{' '}
              <strong className="font-mono text-slate-900">{matchingRecipients.length}</strong>{' '}
              lead(s) and update each lead's communication timeline. Proceed?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDispatch}
                className="px-4 py-2 text-xs font-semibold bg-blue-700 text-white rounded-lg cursor-pointer"
              >
                Confirm &amp; Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
