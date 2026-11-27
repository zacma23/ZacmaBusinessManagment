import React, { useMemo, useState } from 'react';
import { Sparkles, X, Send, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';
import { auth } from '../lib/firebase';
import { safeFetchJson } from '../lib/apiClient';
import { usePortal } from '../context/PortalContext';
import type { LeadFilterPreset, LeadStatus, NavSection } from '../types';

interface SuggestedAction {
  type: 'create_form' | 'filter_leads' | 'draft_communication' | 'open_business_units';
  label: string;
  requiresConfirmation: boolean;
  businessUnitId?: string;
  leadStatus?: string;
  unassignedOnly?: boolean;
  formPrompt?: string;
  channel?: 'email' | 'sms';
  draftSubject?: string;
  draftBody?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  suggestedAction?: SuggestedAction | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onExecuteAction: (
    section: NavSection,
    preset?: {
      businessUnitId?: string;
      aiPrompt?: string;
      leadFilter?: LeadFilterPreset;
      commDraft?: { channel?: 'email' | 'sms'; subject?: string; body?: string; businessUnitId?: string };
    }
  ) => void;
}

const SAMPLE_PROMPTS = [
  'Which business unit has the highest conversion rate?',
  'Show unassigned leads that need attention',
  'Create a student registration form with conditional scholarship questions',
  'Draft a warm follow-up email for new leads',
];

export function AiAssistantDrawer({ open, onClose, onExecuteAction }: Props) {
  const { effectiveRole, effectiveCrmAccess, businessUnits, forms, leads, submissions } = usePortal();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hello! I am the Zacma AI Assistant. Ask me to analyze authorized business performance, surface unassigned leads, draft personalized follow-ups, or kick off a new AI-generated form.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Build strictly permission-scoped context snapshot from user's already-authorized Firestore data
  const authorizedContext = useMemo(() => {
    const unitStats = businessUnits.map((bu) => {
      const buLeads = effectiveCrmAccess ? leads.filter((l) => l.businessUnitId === bu.id) : [];
      const converted = buLeads.filter((l) => l.status === 'converted').length;
      return {
        id: bu.id,
        name: bu.name,
        category: bu.category,
        status: bu.status,
        formCount: forms.filter((f) => f.businessUnitId === bu.id).length,
        leadCount: buLeads.length,
        newLeads: buLeads.filter((l) => l.status === 'new').length,
        convertedLeads: converted,
        conversionRatePercent: buLeads.length > 0 ? Math.round((converted / buLeads.length) * 100) : 0,
      };
    });

    return {
      role: effectiveRole,
      crmAccess: effectiveCrmAccess,
      totalBusinessUnits: businessUnits.length,
      totalForms: forms.length,
      totalSubmissions: submissions.length,
      businessUnits: unitStats,
      leadSummary: effectiveCrmAccess
        ? {
            total: leads.length,
            new: leads.filter((l) => l.status === 'new').length,
            contacted: leads.filter((l) => l.status === 'contacted').length,
            interested: leads.filter((l) => l.status === 'interested').length,
            converted: leads.filter((l) => l.status === 'converted').length,
            lost: leads.filter((l) => l.status === 'lost').length,
            unassigned: leads.filter((l) => !l.assignedStaffId && l.status !== 'archived').length,
            recentLeads: leads.slice(0, 12).map((l) => ({
              ref: l.leadRef,
              name: l.fullName,
              businessUnit: l.businessUnitName,
              status: l.status,
              priority: l.priority,
              assigned: l.assignedStaffName || 'Unassigned',
              followUpDate: l.followUpDate || '',
            })),
          }
        : { restricted: true },
    };
  }, [effectiveRole, effectiveCrmAccess, businessUnits, forms, leads, submissions]);

  if (!open) return null;

  const sendMessage = async (textOverride?: string) => {
    const queryText = (textOverride ?? input).trim();
    if (!queryText || loading) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: queryText,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await safeFetchJson<{
        reply?: string;
        suggestedAction?: SuggestedAction | null;
        error?: string;
      }>('/api/ai/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: queryText,
          userRole: effectiveRole,
          contextSummary: authorizedContext,
          history: nextHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok || !res.data) {
        throw new Error(res.errorMessage || 'Assistant unavailable.');
      }
      const data = res.data;

      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: data.reply || 'Done.',
          suggestedAction: data.suggestedAction || null,
        },
      ]);
    } catch (err: unknown) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: err instanceof Error ? err.message : 'Unable to reach Zacma AI Assistant.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = (action: SuggestedAction) => {
    if (action.type === 'create_form') {
      onExecuteAction('ai_form_generator', {
        businessUnitId: action.businessUnitId,
        aiPrompt: action.formPrompt,
      });
      onClose();
    } else if (action.type === 'filter_leads') {
      onExecuteAction('all_leads', {
        leadFilter: {
          businessUnitId: action.businessUnitId,
          status: (action.leadStatus as LeadStatus | 'all') || 'all',
          assignment: action.unassignedOnly ? 'unassigned' : 'all',
        },
      });
      onClose();
    } else if (action.type === 'draft_communication') {
      onExecuteAction('communication_center', {
        commDraft: {
          channel: action.channel || 'email',
          subject: action.draftSubject,
          body: action.draftBody,
          businessUnitId: action.businessUnitId,
        },
      });
      onClose();
    } else if (action.type === 'open_business_units') {
      onExecuteAction('business_units');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex justify-end">
      <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl border-l border-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900">Zacma AI Assistant</h2>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                <span>Scoped to {effectiveRole.replace('_', ' ')}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[90%] rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-100 text-slate-800 border border-slate-200'
                }`}
              >
                {msg.content}
              </div>

              {msg.suggestedAction && (
                <div className="mt-2 max-w-[90%] p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs space-y-2">
                  <div className="font-semibold text-blue-950">
                    {msg.suggestedAction.requiresConfirmation
                      ? 'Action Confirmation Required'
                      : 'Suggested Workspace Action'}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleConfirmAction(msg.suggestedAction!)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-lg cursor-pointer"
                  >
                    <span>{msg.suggestedAction.label}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
              <span>Analyzing authorized records…</span>
            </div>
          )}
        </div>

        {/* Quick Prompts */}
        <div className="px-4 py-2 border-t border-slate-100 flex gap-1.5 overflow-x-auto">
          {SAMPLE_PROMPTS.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => sendMessage(p)}
              className="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-blue-50 text-slate-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          className="p-4 border-t border-slate-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about leads, conversions, or forms…"
            className="flex-1 px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
