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
  Sparkles,
  Users,
  GraduationCap,
  AtSign,
  Layers,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { safeFetchJson } from '../lib/apiClient';
import { usePortal } from '../context/PortalContext';
import {
  canManageOrg,
  deleteMessageTemplate,
  mergeTemplateVariables,
  saveMessageTemplate,
  seedStarterMessageTemplates,
  sendAndLogCommunication,
  sendDirectCommunication,
} from '../lib/zacmaService';
import type { Lead, LeadStatus, MessageTemplate, NavSection } from '../types';

interface Props {
  activeSection: NavSection;
  initialDraft?: {
    channel?: 'email' | 'sms' | 'both';
    subject?: string;
    body?: string;
    smsBody?: string;
    businessUnitId?: string;
    directEmail?: string;
    directPhone?: string;
    directName?: string;
  } | null;
  onNavigate: (section: NavSection) => void;
}

const MERGE_TAGS = [
  '{{full_name}}',
  '{{business_name}}',
  '{{lead_ref}}',
  '{{course_name}}',
  '{{course_fee}}',
  '{{email}}',
  '{{phone}}',
  '{{form_title}}',
];

const AI_PROMPT_PRESETS = [
  {
    label: 'Admission Welcome (8,500 ETB)',
    prompt:
      'Write a warm admission welcome message confirming receipt of their course application, stating the approved 8,500 ETB tuition fee, and explaining that admissions will confirm class schedules shortly.',
  },
  {
    label: 'Pending Tuition Reminder',
    prompt:
      'Write a polite payment reminder asking pending students to complete their 8,500 ETB course tuition to secure their seat in the upcoming training batch.',
  },
  {
    label: 'New Training Batch Start',
    prompt:
      'Announce that registration is now open for the upcoming training batch across our technology courses at 8,500 ETB per course and invite interested leads to confirm their seat.',
  },
  {
    label: 'Amharic Course Follow-Up',
    prompt:
      'Write a friendly follow-up in Amharic checking if the prospective student has questions about their preferred course, schedule, or 8,500 ETB fee.',
    language: 'am' as const,
  },
];

function computeSmsMetrics(text: string): {
  chars: number;
  segments: number;
  encoding: 'GSM-7' | 'Unicode (Amharic)';
  perSegment: number;
} {
  const chars = text.length;
  const hasNonGsm = /[^\x20-\x7E\r\n]/.test(text);
  const encoding = hasNonGsm ? 'Unicode (Amharic)' : 'GSM-7';
  const singleLimit = hasNonGsm ? 70 : 160;
  const multiLimit = hasNonGsm ? 67 : 153;
  const segments = chars === 0 ? 0 : chars <= singleLimit ? 1 : Math.ceil(chars / multiLimit);
  return { chars, segments, encoding, perSegment: chars <= singleLimit ? singleLimit : multiLimit };
}

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
    courses,
    studentRegistrations,
  } = usePortal();

  const canDeleteTemplate = canManageOrg(effectiveRole);

  // Audience & Channel Mode
  const [audienceSource, setAudienceSource] = useState<'leads' | 'registrations' | 'direct'>(
    initialDraft?.directEmail || initialDraft?.directPhone ? 'direct' : 'leads'
  );
  const [channel, setChannel] = useState<'email' | 'sms' | 'both'>(
    initialDraft?.channel || 'email'
  );

  // CRM Leads filters
  const [selectedBuIds, setSelectedBuIds] = useState<string[]>(
    initialDraft?.businessUnitId ? [initialDraft.businessUnitId] : []
  );
  const [formFilter, setFormFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [staffFilter, setStaffFilter] = useState('all');
  const [singleLeadId, setSingleLeadId] = useState('all');

  // Student Registrations filters
  const [regCourseFilter, setRegCourseFilter] = useState('all');
  const [regStatusFilter, setRegStatusFilter] = useState('all');
  const [regPaymentFilter, setRegPaymentFilter] = useState('all');

  // Direct Quick Send fields
  const [directName, setDirectName] = useState(initialDraft?.directName || '');
  const [directEmail, setDirectEmail] = useState(initialDraft?.directEmail || '');
  const [directPhone, setDirectPhone] = useState(initialDraft?.directPhone || '');

  // Message content (email + separate concise SMS when channel === 'both' or 'sms')
  const [subject, setSubject] = useState(
    initialDraft?.subject || 'Update from {{business_name}} ({{lead_ref}})'
  );
  const [emailBody, setEmailBody] = useState(
    initialDraft?.body ||
      'Hello {{full_name}},\n\nThank you for contacting {{business_name}} regarding {{course_name}} (Tuition: {{course_fee}}). Our admissions team will follow up with you shortly regarding reference {{lead_ref}}.\n\nWarm regards,\n{{business_name}}'
  );
  const [smsBody, setSmsBody] = useState(
    initialDraft?.smsBody ||
      'Hi {{full_name}}, thank you for contacting {{business_name}} regarding {{course_name}} ({{course_fee}}). Ref: {{lead_ref}}.'
  );

  // AI Prompt Writer state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLanguage, setAiLanguage] = useState<'en' | 'am'>('en');
  const [aiTone, setAiTone] = useState<'professional' | 'warm' | 'urgent' | 'followup'>('warm');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Dispatch state
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dispatchSummary, setDispatchSummary] = useState<{
    sent: number;
    queued: number;
    failed: number;
    note?: string;
  } | null>(null);

  // Template Modal & Starter pack state
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
  const [seedingTpls, setSeedingTpls] = useState(false);
  const [tplNotice, setTplNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!initialDraft) return;
    if (initialDraft.channel) setChannel(initialDraft.channel);
    if (initialDraft.subject) setSubject(initialDraft.subject);
    if (initialDraft.body) setEmailBody(initialDraft.body);
    if (initialDraft.smsBody) setSmsBody(initialDraft.smsBody);
    if (initialDraft.businessUnitId) setSelectedBuIds([initialDraft.businessUnitId]);
    if (initialDraft.directEmail || initialDraft.directPhone) {
      setAudienceSource('direct');
      if (initialDraft.directName) setDirectName(initialDraft.directName);
      if (initialDraft.directEmail) setDirectEmail(initialDraft.directEmail);
      if (initialDraft.directPhone) setDirectPhone(initialDraft.directPhone);
    }
  }, [initialDraft]);

  // Helper to resolve course fee from catalog
  const courseFeeByTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of courses) {
      map.set(c.title.toLowerCase(), c.approvedFee || '8,500 ETB');
    }
    return map;
  }, [courses]);

  // Matched CRM Lead recipients
  const matchingLeads = useMemo(() => {
    return leads.filter((l) => {
      if (l.status === 'archived') return false;
      if (singleLeadId !== 'all' && l.id !== singleLeadId) return false;
      if (selectedBuIds.length > 0 && !selectedBuIds.includes(l.businessUnitId)) return false;
      if (formFilter !== 'all' && l.formId !== formFilter) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (staffFilter !== 'all' && l.assignedStaffId !== staffFilter) return false;
      if (channel === 'email') return Boolean(l.email?.trim());
      if (channel === 'sms') return Boolean(l.phone?.trim());
      return Boolean(l.email?.trim() || l.phone?.trim());
    });
  }, [leads, singleLeadId, selectedBuIds, formFilter, statusFilter, staffFilter, channel]);

  // Matched Student Registration recipients
  const matchingRegistrations = useMemo(() => {
    return studentRegistrations.filter((r) => {
      if (regCourseFilter !== 'all' && r.preferredCourse !== regCourseFilter) return false;
      if (regStatusFilter !== 'all' && r.registrationStatus !== regStatusFilter) return false;
      if (regPaymentFilter !== 'all' && r.paymentStatus !== regPaymentFilter) return false;
      if (channel === 'email') return Boolean(r.email?.trim());
      if (channel === 'sms') return Boolean(r.phone?.trim());
      return Boolean(r.email?.trim() || r.phone?.trim());
    });
  }, [studentRegistrations, regCourseFilter, regStatusFilter, regPaymentFilter, channel]);

  const directValidCount = useMemo(() => {
    const hasEmail = Boolean(directEmail.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(directEmail.trim()));
    const hasPhone = Boolean(directPhone.replace(/[^0-9+]/g, '').length >= 7);
    if (channel === 'email') return hasEmail ? 1 : 0;
    if (channel === 'sms') return hasPhone ? 1 : 0;
    return hasEmail || hasPhone ? 1 : 0;
  }, [directEmail, directPhone, channel]);

  const recipientCount =
    audienceSource === 'leads'
      ? matchingLeads.length
      : audienceSource === 'registrations'
        ? matchingRegistrations.length
        : directValidCount;

  const emailProviderConfig = useMemo(
    () => integrations.find((i) => i.providerKey === 'resend_email') || null,
    [integrations]
  );
  const smsProviderConfig = useMemo(
    () => integrations.find((i) => i.providerKey === 'twilio_sms') || null,
    [integrations]
  );

  const previewTarget = useMemo(() => {
    if (audienceSource === 'direct') {
      return {
        fullName: directName.trim() || 'Prospective Student',
        email: directEmail.trim() || 'student@example.com',
        phone: directPhone.trim() || '+251911000000',
        leadRef: 'ZCM-2026-DIRECT',
        businessUnitName: businessUnits[0]?.name || 'Zacma Technology Training Institute',
        formTitle: 'Direct Notice',
        courseName: courses[0]?.title || 'Artificial Intelligence (AI)',
        courseFee: courses[0]?.approvedFee || '8,500 ETB',
      };
    }
    if (audienceSource === 'registrations' && matchingRegistrations[0]) {
      const r = matchingRegistrations[0];
      return {
        fullName: r.fullName,
        email: r.email,
        phone: r.phone,
        leadRef: r.leadRef,
        businessUnitName: 'Zacma Technology Training Institute',
        formTitle: `Registration — ${r.preferredCourse}`,
        courseName: r.preferredCourse,
        courseFee: courseFeeByTitle.get(r.preferredCourse.toLowerCase()) || '8,500 ETB',
      };
    }
    const lead = matchingLeads[0] || leads[0];
    if (lead) {
      return {
        ...lead,
        courseName:
          (typeof lead.responses?.preferredCourse === 'string' && lead.responses.preferredCourse) ||
          (typeof lead.responses?.interestedCourse === 'string' && lead.responses.interestedCourse) ||
          'Artificial Intelligence (AI)',
        courseFee: '8,500 ETB',
      };
    }
    return {
      fullName: 'Abebe Bikila',
      email: 'client@example.com',
      phone: '+251911000000',
      leadRef: 'ZCM-2026-DEMO',
      businessUnitName: businessUnits[0]?.name || 'Zacma Technology Training Institute',
      formTitle: forms[0]?.title || 'Inquiry Form',
      courseName: 'Artificial Intelligence (AI)',
      courseFee: '8,500 ETB',
    };
  }, [
    audienceSource,
    directName,
    directEmail,
    directPhone,
    matchingRegistrations,
    matchingLeads,
    leads,
    businessUnits,
    forms,
    courses,
    courseFeeByTitle,
  ]);

  const smsMetrics = useMemo(
    () => computeSmsMetrics(mergeTemplateVariables(smsBody, previewTarget)),
    [smsBody, previewTarget]
  );

  const toggleBuFilter = (buId: string) => {
    setSelectedBuIds((prev) =>
      prev.includes(buId) ? prev.filter((id) => id !== buId) : [...prev, buId]
    );
  };

  const applyTemplate = (tpl: MessageTemplate) => {
    setChannel(tpl.channel);
    if (tpl.channel === 'email') {
      setSubject(tpl.subject);
      setEmailBody(tpl.body);
    } else {
      setSmsBody(tpl.body);
    }
  };

  const handleAiDraftGenerate = async (promptOverride?: string, langOverride?: 'en' | 'am') => {
    const cleanPrompt = (promptOverride ?? aiPrompt).trim();
    const targetLang = langOverride ?? aiLanguage;
    if (!cleanPrompt || aiGenerating) return;
    if (promptOverride) setAiPrompt(promptOverride);
    if (langOverride) setAiLanguage(langOverride);

    setAiGenerating(true);
    setAiError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await safeFetchJson<{
        emailSubject?: string;
        emailBody?: string;
        smsBody?: string;
        error?: string;
      }>('/api/ai/compose-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: cleanPrompt,
          channel,
          language: targetLang,
          tone: aiTone,
          businessUnitName: previewTarget.businessUnitName,
          courseName: regCourseFilter !== 'all' ? regCourseFilter : '',
          courseFee: '8,500 ETB',
        }),
      });
      if (!res.ok || !res.data) {
        throw new Error(res.errorMessage || 'Failed to generate Email/SMS draft.');
      }
      const data = res.data;
      if (data.emailSubject) setSubject(data.emailSubject);
      if (data.emailBody) setEmailBody(data.emailBody);
      if (data.smsBody) setSmsBody(data.smsBody);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'AI draft generation failed.');
    } finally {
      setAiGenerating(false);
    }
  };

  const executeDispatch = async () => {
    if (!organization || !user || recipientCount === 0) return;
    setConfirmOpen(false);
    setSending(true);
    setDispatchSummary(null);

    let sent = 0;
    let queued = 0;
    let failed = 0;
    let lastNote: string | undefined;

    const actorId = user.uid;
    const actorName = user.displayName || user.email || 'Staff';

    const tally = (status: 'sent' | 'queued_pending_provider_approval' | 'failed') => {
      if (status === 'sent') sent += 1;
      else if (status === 'queued_pending_provider_approval') queued += 1;
      else failed += 1;
    };

    const channelsToSend: Array<'email' | 'sms'> =
      channel === 'both' ? ['email', 'sms'] : [channel];

    if (audienceSource === 'direct') {
      for (const ch of channelsToSend) {
        const dest = ch === 'email' ? directEmail.trim() : directPhone.trim();
        if (!dest) continue;
        try {
          const personalizedSubject = mergeTemplateVariables(subject, previewTarget);
          const personalizedBody = mergeTemplateVariables(
            ch === 'email' ? emailBody : smsBody,
            previewTarget
          );
          const res = await sendDirectCommunication({
            organizationId: organization.id,
            ownerId: organization.ownerId,
            authorizedUserIds: organization.authorizedUserIds,
            channel: ch,
            recipient: dest,
            recipientName: directName.trim() || dest,
            subject: personalizedSubject,
            body: personalizedBody,
            actorId,
            actorName,
          });
          tally(res.deliveryStatus);
          if (res.note) lastNote = res.note;
        } catch {
          failed += 1;
        }
      }
    } else if (audienceSource === 'registrations') {
      const leadById = new Map<string, Lead>(leads.map((l) => [l.id, l]));
      for (const reg of matchingRegistrations) {
        const linkedLead = leadById.get(reg.leadId);
        const courseFee = courseFeeByTitle.get(reg.preferredCourse.toLowerCase()) || '8,500 ETB';
        const mergeCtx = {
          fullName: reg.fullName,
          email: reg.email,
          phone: reg.phone,
          leadRef: reg.leadRef,
          businessUnitName: 'Zacma Technology Training Institute',
          formTitle: `Registration — ${reg.preferredCourse}`,
          courseName: reg.preferredCourse,
          courseFee,
        };

        for (const ch of channelsToSend) {
          const dest = ch === 'email' ? reg.email.trim() : reg.phone.trim();
          if (!dest) continue;
          const personalizedSubject = mergeTemplateVariables(subject, mergeCtx);
          const personalizedBody = mergeTemplateVariables(
            ch === 'email' ? emailBody : smsBody,
            mergeCtx
          );
          try {
            if (linkedLead) {
              const status = await sendAndLogCommunication({
                organizationId: organization.id,
                lead: linkedLead,
                channel: ch,
                subject: personalizedSubject,
                body: personalizedBody,
                actorId,
                actorName,
              });
              tally(status);
            } else {
              const res = await sendDirectCommunication({
                organizationId: organization.id,
                ownerId: organization.ownerId,
                authorizedUserIds: organization.authorizedUserIds,
                channel: ch,
                recipient: dest,
                recipientName: reg.fullName,
                subject: personalizedSubject,
                body: personalizedBody,
                actorId,
                actorName,
              });
              tally(res.deliveryStatus);
              if (res.note) lastNote = res.note;
            }
          } catch {
            failed += 1;
          }
        }
      }
    } else {
      for (const lead of matchingLeads) {
        for (const ch of channelsToSend) {
          const hasAddr = ch === 'email' ? Boolean(lead.email?.trim()) : Boolean(lead.phone?.trim());
          if (!hasAddr) continue;
          try {
            const status = await sendAndLogCommunication({
              organizationId: organization.id,
              lead,
              channel: ch,
              subject,
              body: ch === 'email' ? emailBody : smsBody,
              actorId,
              actorName,
            });
            tally(status);
          } catch {
            failed += 1;
          }
        }
      }
    }

    setDispatchSummary({ sent, queued, failed, note: lastNote });
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
        body: 'Hello {{full_name}}, thank you for contacting {{business_name}} regarding {{course_name}} ({{course_fee}}).',
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

  const handleSeedStarterTemplates = async () => {
    if (!organization) return;
    setSeedingTpls(true);
    setTplNotice(null);
    try {
      const added = await seedStarterMessageTemplates({
        organizationId: organization.id,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        existingTemplates: templates,
      });
      setTplNotice(
        added > 0
          ? `Added ${added} Zacma Email & SMS starter templates (English & Amharic).`
          : 'All Zacma starter templates are already loaded.'
      );
    } finally {
      setSeedingTpls(false);
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
              Create reusable Email and SMS templates in English or Amharic with dynamic lead and
              course personalization tags.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={seedingTpls}
              onClick={() => void handleSeedStarterTemplates()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{seedingTpls ? 'Loading…' : 'Load Zacma Starter Templates'}</span>
            </button>
            <button
              type="button"
              onClick={() => openTemplateModal()}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Template
            </button>
          </div>
        </div>

        {tplNotice && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between">
            <span>{tplNotice}</span>
            <button type="button" onClick={() => setTplNotice(null)} className="cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {templates.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-sm text-slate-600 mb-4">
              No message templates yet. Load our 5 ready-made Zacma admission Email &amp; SMS
              templates or build your own with{' '}
              <span className="font-mono">{'{{full_name}}'}</span> and{' '}
              <span className="font-mono">{'{{course_fee}}'}</span>.
            </p>
            <div className="flex items-center justify-center gap-2.5">
              <button
                type="button"
                disabled={seedingTpls}
                onClick={() => void handleSeedStarterTemplates()}
                className="px-4 py-2 bg-blue-50 text-blue-800 border border-blue-200 text-xs font-semibold rounded-lg cursor-pointer"
              >
                Load Starter Templates
              </button>
              <button
                type="button"
                onClick={() => openTemplateModal()}
                className="px-4 py-2 bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                Create Custom Template
              </button>
            </div>
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
  // VIEW 2: COMMUNICATION CENTER (INDIVIDUAL, STUDENT & BULK EMAIL + SMS)
  // ===========================================================================
  const showProviderBanner =
    (channel === 'email' && emailProviderConfig?.approvalStatus !== 'enabled') ||
    (channel === 'sms' && smsProviderConfig?.approvalStatus !== 'enabled') ||
    (channel === 'both' &&
      (emailProviderConfig?.approvalStatus !== 'enabled' ||
        smsProviderConfig?.approvalStatus !== 'enabled'));

  const canSendNow =
    !sending &&
    recipientCount > 0 &&
    (channel === 'email'
      ? Boolean(emailBody.trim())
      : channel === 'sms'
        ? Boolean(smsBody.trim())
        : Boolean(emailBody.trim() && smsBody.trim()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            SMS &amp; Email Communication Center
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Compose with AI in English or Amharic and dispatch personalized Email, SMS, or
            dual-channel notices to CRM leads, registered students, or direct recipients.
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
      {showProviderBanner && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Provider Credentials Governance:</span> Live outbound
              delivery activates automatically when server secrets are configured (
              <span className="font-mono">RESEND_API_KEY</span> for Email;{' '}
              <span className="font-mono">TWILIO_*</span> or{' '}
              <span className="font-mono">AFROMESSAGE_API_TOKEN</span> for SMS). Until configured,
              all messages are logged cleanly in CRM Communication History &amp; Audit Logs.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('integrations_security')}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-900 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            Provider Settings
          </button>
        </div>
      )}

      {dispatchSummary && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>
            Dispatch complete:{' '}
            <strong className="font-mono">{dispatchSummary.sent}</strong> live sent,{' '}
            <strong className="font-mono">{dispatchSummary.queued}</strong> logged &amp; queued
            pending provider keys,{' '}
            <strong className="font-mono">{dispatchSummary.failed}</strong> failed.
            {dispatchSummary.note ? ` ${dispatchSummary.note}` : ''}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Channel & Recipient Targeting Panel */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-display text-sm font-bold text-slate-900">1. Channel &amp; Audience</h2>

          {/* 3-Way Channel Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Delivery Channel
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'email', label: 'Email', Icon: Mail },
                  { id: 'sms', label: 'SMS', Icon: MessageSquare },
                  { id: 'both', label: 'Both', Icon: Layers },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setChannel(id)}
                  className={`flex items-center justify-center gap-1 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                    channel === id
                      ? 'bg-blue-700 text-white border-blue-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 3-Way Audience Source */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Recipient Source
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'leads', label: 'Leads', Icon: Users },
                  { id: 'registrations', label: 'Students', Icon: GraduationCap },
                  { id: 'direct', label: 'Direct', Icon: AtSign },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAudienceSource(id)}
                  className={`flex items-center justify-center gap-1 py-1.5 text-[11px] font-semibold rounded-lg border cursor-pointer ${
                    audienceSource === id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Audience Controls: CRM LEADS */}
          {audienceSource === 'leads' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Specific Lead or Bulk Segment
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
                  {businessUnits.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">
                        Business Units
                      </label>
                      <div className="space-y-1.5 max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                        {businessUnits.map((bu) => (
                          <label
                            key={bu.id}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                          >
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
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Source Form
                    </label>
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
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Lead Status
                      </label>
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
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Assigned Staff
                      </label>
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
            </>
          )}

          {/* Audience Controls: STUDENT REGISTRATIONS */}
          {audienceSource === 'registrations' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Training Course
                </label>
                <select
                  value={regCourseFilter}
                  onChange={(e) => setRegCourseFilter(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">All Courses ({courses.length})</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.title}>
                      {c.title} ({c.approvedFee || '8,500 ETB'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Enrollment Status
                  </label>
                  <select
                    value={regStatusFilter}
                    onChange={(e) => setRegStatusFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">All</option>
                    <option value="submitted">Submitted</option>
                    <option value="under_review">Under Review</option>
                    <option value="approved">Approved</option>
                    <option value="enrolled">Enrolled</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Payment Status
                  </label>
                  <select
                    value={regPaymentFilter}
                    onChange={(e) => setRegPaymentFilter(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Audience Controls: DIRECT QUICK SEND */}
          {audienceSource === 'direct' && (
            <div className="space-y-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={directName}
                  onChange={(e) => setDirectName(e.target.value)}
                  placeholder="e.g., Dawit Kebede"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              {(channel === 'email' || channel === 'both') && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Recipient Email Address
                  </label>
                  <input
                    type="email"
                    value={directEmail}
                    onChange={(e) => setDirectEmail(e.target.value)}
                    placeholder="student@example.com"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              )}
              {(channel === 'sms' || channel === 'both') && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Recipient Phone Number
                  </label>
                  <input
                    type="tel"
                    value={directPhone}
                    onChange={(e) => setDirectPhone(e.target.value)}
                    placeholder="+251911234567"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              )}
            </div>
          )}

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-xs text-slate-500">Matched Reachable Recipients</div>
            <div className="text-xl font-display font-bold font-mono tabular-nums text-blue-700 mt-0.5">
              {recipientCount}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {channel === 'both'
                ? 'Recipients with a valid email and/or phone number.'
                : `Only recipients with a valid ${channel === 'email' ? 'email address' : 'phone number'}.`}
            </div>
          </div>
        </div>

        {/* Right: AI Prompt Writer + Composer & Previews */}
        <div className="lg:col-span-8 space-y-5">
          {/* AI SMS & Email Prompt Writer */}
          <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-700" />
                <h2 className="font-display text-sm font-bold text-slate-900">
                  AI Email &amp; SMS Prompt Writer
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={aiLanguage}
                  onChange={(e) => setAiLanguage(e.target.value as 'en' | 'am')}
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="en">English</option>
                  <option value="am">Amharic (አማርኛ)</option>
                </select>
                <select
                  value={aiTone}
                  onChange={(e) =>
                    setAiTone(e.target.value as 'professional' | 'warm' | 'urgent' | 'followup')
                  }
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="warm">Warm Admissions</option>
                  <option value="professional">Formal Executive</option>
                  <option value="followup">Friendly Follow-Up</option>
                  <option value="urgent">Payment / Seat Reminder</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {AI_PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={aiGenerating}
                  onClick={() =>
                    void handleAiDraftGenerate(preset.prompt, preset.language || aiLanguage)
                  }
                  className="px-2.5 py-1 text-[11px] font-medium text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAiDraftGenerate();
                  }
                }}
                placeholder="Describe the Email/SMS to draft (e.g., Remind pending AI students of 8,500 ETB tuition)…"
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                disabled={aiGenerating || !aiPrompt.trim()}
                onClick={() => void handleAiDraftGenerate()}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
              >
                {aiGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Drafting…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate Draft
                  </>
                )}
              </button>
            </div>
            {aiError && <div className="text-xs text-red-600">{aiError}</div>}
          </div>

          {/* Message Editor Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-display text-sm font-bold text-slate-900">
                2. Compose Personalized{' '}
                {channel === 'both' ? 'EMAIL & SMS' : channel.toUpperCase()}
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

            {/* Email Section */}
            {(channel === 'email' || channel === 'both') && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Subject
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Welcome to {{business_name}} — {{course_name}}"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Content
                  </label>
                  <textarea
                    rows={5}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="text-[11px] text-slate-400 mr-1">Insert variable:</span>
                    {MERGE_TAGS.map((tag) => (
                      <button
                        key={`email-${tag}`}
                        type="button"
                        onClick={() => setEmailBody((prev) => `${prev} ${tag}`)}
                        className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 hover:bg-blue-50 text-slate-700 rounded cursor-pointer"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SMS Section with Live Segment Counter */}
            {(channel === 'sms' || channel === 'both') && (
              <div className={channel === 'both' ? 'pt-3 border-t border-slate-200 space-y-2' : 'space-y-2'}>
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs font-medium text-slate-700">SMS Content</label>
                  <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {smsMetrics.chars} chars · {smsMetrics.segments} segment
                    {smsMetrics.segments === 1 ? '' : 's'} ({smsMetrics.encoding})
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 mr-1">Insert variable:</span>
                  {MERGE_TAGS.map((tag) => (
                    <button
                      key={`sms-${tag}`}
                      type="button"
                      onClick={() => setSmsBody((prev) => `${prev} ${tag}`)}
                      className="px-2 py-0.5 text-[11px] font-mono bg-slate-100 hover:bg-blue-50 text-slate-700 rounded cursor-pointer"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Live Personalized Preview */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="text-[11px] font-semibold text-slate-500">
                Live Personalized Preview ({previewTarget.fullName})
              </div>
              {(channel === 'email' || channel === 'both') && (
                <div className="space-y-1">
                  {subject && (
                    <div className="text-xs font-semibold text-slate-900">
                      Email Subject: {mergeTemplateVariables(subject, previewTarget)}
                    </div>
                  )}
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">
                    {mergeTemplateVariables(emailBody, previewTarget)}
                  </p>
                </div>
              )}
              {(channel === 'sms' || channel === 'both') && (
                <div
                  className={
                    channel === 'both' ? 'pt-2 border-t border-slate-200 space-y-1' : 'space-y-1'
                  }
                >
                  <div className="text-[11px] font-semibold text-blue-700">SMS Preview</div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">
                    {mergeTemplateVariables(smsBody, previewTarget)}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={!canSendNow}
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
                    Send {channel === 'both' ? 'Email + SMS' : channel.toUpperCase()} to{' '}
                    {recipientCount} Recipient{recipientCount === 1 ? '' : 's'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Explicit Confirmation Modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-xl">
            <h3 className="font-display text-base font-bold text-slate-900 mb-2">
              Confirm {channel === 'both' ? 'Email & SMS' : channel.toUpperCase()} Dispatch
            </h3>
            <p className="text-sm text-slate-600 mb-5">
              This will personalize and dispatch via{' '}
              <strong>{channel === 'both' ? 'Email and SMS' : channel.toUpperCase()}</strong> to{' '}
              <strong className="font-mono text-slate-900">{recipientCount}</strong> recipient(s)
              and record every delivery in the portal logs. Proceed?
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
