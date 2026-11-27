import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  UserCheck,
  CheckCircle2,
  ExternalLink,
  RotateCcw,
  ShieldCheck,
  Headphones,
  Languages,
  AlertCircle,
  BookOpen,
  Search,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { safeFetchJson, safeJsonParse } from '../lib/apiClient';
import {
  DEFAULT_SUPPORT_WELCOME_MESSAGE,
  captureAiChatLeadOrEscalation,
  fetchPublicSupportBundle,
  fetchStudentOwnRegistrations,
  submitAiChatRegistration,
} from '../lib/supportService';
import { DEFAULT_ORG_ID, generateId } from '../lib/zacmaService';
import type {
  PublicSupportConfig,
  RegistrationDraft,
  StudentRegistration,
  SupportChatMessage,
  SupportConversation,
  SupportKnowledgeItem,
  TrainingCourse,
} from '../types';

interface Props {
  organizationId?: string;
  defaultFormUrl?: string;
  isPortalContext?: boolean;
}

interface SupportApiResponse {
  reply: string;
  detectedLanguage: 'en' | 'am' | 'other';
  intent: SupportConversation['intent'];
  interestedCourse: string;
  needsHumanEscalation: boolean;
  unansweredQuestion: string;
  suggestRegistrationFormLink: boolean;
  captureLeadSuggested: boolean;
  registrationDraft: RegistrationDraft | null;
}

const QUICK_PROMPTS_EN = [
  'What courses do you offer?',
  'I want to register for Artificial Intelligence',
  'What are the schedules and payment methods?',
  'Check my student registration status',
];

const QUICK_PROMPTS_AM = [
  'ምን ኮርሶች ይሰጣሉ?',
  'ለአርቴፊሻል ኢንተለጀንስ መመዝገብ እፈልጋለሁ',
  'የትምህርት ሰዓት እና የክፍያ ዘዴዎች ምንድን ናቸው?',
  'የተማሪ ምዝገባ ሁኔታዬን ማረጋገጥ እፈልጋለሁ',
];

export function SupportChatWidget({
  organizationId = DEFAULT_ORG_ID,
  defaultFormUrl = '',
  isPortalContext = false,
}: Props) {
  const storageKey = `zacma_ai_support_chat_${organizationId}`;

  const [open, setOpen] = useState(false);
  const [bundleLoading, setBundleLoading] = useState(true);
  const [config, setConfig] = useState<PublicSupportConfig | null>(null);
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [faqs, setFaqs] = useState<SupportKnowledgeItem[]>([]);
  const [studentRecords, setStudentRecords] = useState<StudentRegistration[]>([]);

  const [language, setLanguage] = useState<'en' | 'am'>('en');
  const [activeTab, setActiveTab] = useState<'chat' | 'courses'>('chat');
  const [courseFilter, setCourseFilter] = useState('');
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stateful conversational workflow tracking
  const [draft, setDraft] = useState<RegistrationDraft>({});
  const [showRegistrationReview, setShowRegistrationReview] = useState(false);
  const [submittingRegistration, setSubmittingRegistration] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const [lastIntent, setLastIntent] = useState<SupportConversation['intent']>('general');
  const [interestedCourse, setInterestedCourse] = useState('');
  const [unansweredQuestions, setUnansweredQuestions] = useState<string[]>([]);
  const [suggestFormLink, setSuggestFormLink] = useState(false);

  // Lead consent & Human escalation state
  const [showLeadPrompt, setShowLeadPrompt] = useState(false);
  const [leadCapturedRef, setLeadCapturedRef] = useState<string | null>(null);
  const [showEscalationBox, setShowEscalationBox] = useState(false);
  const [escalatedDone, setEscalatedDone] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [leadConsentChecked, setLeadConsentChecked] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load public support config, active courses, active FAQs, and (if signed in) verified student's own records
  useEffect(() => {
    let active = true;
    setBundleLoading(true);

    fetchPublicSupportBundle(organizationId)
      .then(async (bundle) => {
        if (!active) return;
        setConfig(bundle.config);
        setCourses(bundle.courses);
        setFaqs(bundle.faqs);

        const currentUser = auth.currentUser;
        if (currentUser && currentUser.emailVerified) {
          const ownRegs = await fetchStudentOwnRegistrations(organizationId, currentUser.uid);
          if (active) setStudentRecords(ownRegs);
        }

        // Restore session messages or seed official welcome message
        try {
          const saved = sessionStorage.getItem(storageKey);
          if (saved) {
            const parsed = safeJsonParse<SupportChatMessage[]>(saved, 'SupportChatWidget.sessionStorage');
            if (Array.isArray(parsed) && parsed.length > 0) {
              setMessages(parsed);
              setBundleLoading(false);
              return;
            }
          }
        } catch {
          // ignore storage errors
        }

        const welcomeText = bundle.config?.welcomeMessage || DEFAULT_SUPPORT_WELCOME_MESSAGE;
        setMessages([
          {
            id: generateId('welcome'),
            role: 'assistant',
            text: welcomeText,
            timestamp: new Date().toISOString(),
          },
        ]);
        setBundleLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setMessages([
          {
            id: generateId('welcome'),
            role: 'assistant',
            text: DEFAULT_SUPPORT_WELCOME_MESSAGE,
            timestamp: new Date().toISOString(),
          },
        ]);
        setBundleLoading(false);
      });

    return () => {
      active = false;
    };
  }, [organizationId, storageKey]);

  // Refresh latest approved courses, fees & FAQs whenever the widget is opened
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchPublicSupportBundle(organizationId)
      .then((bundle) => {
        if (!active) return;
        if (bundle.config) setConfig(bundle.config);
        setCourses(bundle.courses);
        setFaqs(bundle.faqs);
      })
      .catch(() => {
        // retain current catalog
      });
    return () => {
      active = false;
    };
  }, [open, organizationId]);

  // Persist messages to sessionStorage
  useEffect(() => {
    if (messages.length === 0) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-50)));
    } catch {
      // ignore storage quota errors
    }
  }, [messages, storageKey]);

  // Auto-scroll to newest message
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, showRegistrationReview, showEscalationBox, showLeadPrompt]);

  const effectiveFormUrl = useMemo(() => {
    return (config?.registrationFormUrl || defaultFormUrl || '').trim();
  }, [config?.registrationFormUrl, defaultFormUrl]);

  const filteredWidgetCourses = useMemo(() => {
    const q = courseFilter.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.approvedFee.toLowerCase().includes(q)
    );
  }, [courses, courseFilter]);

  // Hide widget on public pages if an administrator explicitly deactivated it
  if (!bundleLoading && config && !config.isActive && !isPortalContext) {
    return null;
  }

  const assistantTitle = config?.assistantName || 'ZACMA AI ASSISTANT';

  const resetConversation = () => {
    const welcomeText = config?.welcomeMessage || DEFAULT_SUPPORT_WELCOME_MESSAGE;
    const fresh: SupportChatMessage[] = [
      {
        id: generateId('welcome'),
        role: 'assistant',
        text: welcomeText,
        timestamp: new Date().toISOString(),
      },
    ];
    setMessages(fresh);
    setDraft({});
    setShowRegistrationReview(false);
    setSubmittedRef(null);
    setShowLeadPrompt(false);
    setLeadCapturedRef(null);
    setShowEscalationBox(false);
    setEscalatedDone(false);
    setUnansweredQuestions([]);
    setInterestedCourse('');
    setSuggestFormLink(false);
    setErrorMsg(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const cleanText = (textOverride ?? input).trim();
    if (!cleanText || sending) return;

    setErrorMsg(null);
    const userMsg: SupportChatMessage = {
      id: generateId('user'),
      role: 'user',
      text: cleanText,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!textOverride) setInput('');
    setSending(true);

    try {
      const currentUser = auth.currentUser;
      const idToken = currentUser ? await currentUser.getIdToken() : null;

      // Refresh verified student's own records when signed in
      let ownRecords = studentRecords;
      if (currentUser && currentUser.emailVerified && ownRecords.length === 0) {
        ownRecords = await fetchStudentOwnRegistrations(organizationId, currentUser.uid);
        setStudentRecords(ownRecords);
      }

      const coursePayload = courses.map((c) => ({
        title: c.title,
        category: c.category,
        description: c.description,
        learningObjectives: c.learningObjectives,
        qualifications: c.qualifications,
        duration: c.duration || null,
        deliveryMethods: c.deliveryMethods,
        schedules: c.schedules || null,
        availableBatches: c.availableBatches || null,
        certificateInfo: c.certificateInfo || null,
        approvedFee: c.approvedFee || null,
        registrationProcedure: c.registrationProcedure,
      }));

      const faqPayload = faqs.map((f) => ({
        category: f.category,
        question: f.question,
        answer: f.answer,
        language: f.language,
      }));

      const res = await safeFetchJson<SupportApiResponse & { error?: string }>(
        '/api/ai/support-chat',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            message: cleanText,
            preferredLanguage: language,
            aiInstructions: config?.aiInstructions || '',
            registrationFormUrl: effectiveFormUrl,
            courses: coursePayload,
            faqs: faqPayload,
            registrationDraft: draft,
            studentRegistrations: currentUser ? ownRecords : [],
            history: nextMessages.slice(-10).map((m) => ({ role: m.role, text: m.text })),
          }),
        }
      );

      if (!res.ok || !res.data) {
        throw new Error(
          res.errorMessage || 'Assistant is temporarily unavailable. Please try again.'
        );
      }
      const data = res.data;

      const aiMsg: SupportChatMessage = {
        id: generateId('ai'),
        role: 'assistant',
        text: data.reply,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, aiMsg]);

      if (data.detectedLanguage === 'am') setLanguage('am');
      if (data.intent) setLastIntent(data.intent);
      if (data.interestedCourse) setInterestedCourse(data.interestedCourse);
      if (data.suggestRegistrationFormLink) setSuggestFormLink(true);

      if (data.unansweredQuestion) {
        setUnansweredQuestions((prev) =>
          prev.includes(data.unansweredQuestion) ? prev : [...prev, data.unansweredQuestion]
        );
      }

      if (data.registrationDraft) {
        const merged: RegistrationDraft = {
          ...draft,
          ...Object.fromEntries(
            Object.entries(data.registrationDraft).filter(
              ([k, v]) => k === 'readyForConfirmation' || (typeof v === 'string' && v.trim() !== '')
            )
          ),
        };
        setDraft(merged);

        if (merged.fullName && !visitorName) setVisitorName(merged.fullName);
        if (merged.phone && !visitorPhone) setVisitorPhone(merged.phone);
        if (merged.email && !visitorEmail) setVisitorEmail(merged.email);

        if (merged.readyForConfirmation && !submittedRef) {
          setShowRegistrationReview(true);
        }
      }

      if (data.needsHumanEscalation && !escalatedDone) {
        setShowEscalationBox(true);
      } else if (data.captureLeadSuggested && !leadCapturedRef && !submittedRef) {
        setShowLeadPrompt(true);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleConfirmRegistration = async () => {
    if (!config) {
      setErrorMsg('AI Support configuration is not yet initialized by an administrator.');
      return;
    }
    if (!draft.fullName?.trim() || !draft.phone?.trim() || !draft.preferredCourse?.trim()) {
      setErrorMsg('Full name, phone number, and preferred course are required before submitting.');
      return;
    }

    setSubmittingRegistration(true);
    setErrorMsg(null);
    try {
      const result = await submitAiChatRegistration({
        config,
        draft,
        messages,
        language,
        unansweredQuestions,
        studentUid: auth.currentUser?.emailVerified ? auth.currentUser.uid : '',
        documentUploadFormUrl: effectiveFormUrl,
      });

      setSubmittedRef(result.leadRef);
      setLeadCapturedRef(result.leadRef);
      setShowRegistrationReview(false);
      setShowLeadPrompt(false);

      const confirmText =
        language === 'am'
          ? `ምዝገባዎ በተሳካ ሁኔታ ተመዝግቧል! የማጣቀሻ ቁጥርዎ ${result.leadRef} ነው። የማስረጃ ሰነዶችን በደህንነት ለመላክ እባክዎ ከታች ያለውን የምዝገባ ፎርም ሊንክ ይጠቀሙ።`
          : `Your registration for ${draft.preferredCourse} has been saved! Your reference number is ${result.leadRef}. Our admission officers will review your application shortly. Please use the secure registration form link below if you need to upload identification documents.`;

      setMessages((prev) => [
        ...prev,
        {
          id: generateId('sys'),
          role: 'assistant',
          text: confirmText,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to save registration right now. Please try again.'
      );
    } finally {
      setSubmittingRegistration(false);
    }
  };

  const handleSaveLeadOrEscalation = async (escalate: boolean) => {
    if (!config) {
      setErrorMsg('AI Support configuration is not initialized yet.');
      return;
    }
    if (!escalate && !visitorPhone.trim() && !visitorEmail.trim()) {
      setErrorMsg('Please enter a phone number or email address so admissions can reach you.');
      return;
    }

    setSubmittingAction(true);
    setErrorMsg(null);
    try {
      const result = await captureAiChatLeadOrEscalation({
        config,
        visitorName: visitorName.trim() || draft.fullName || 'Prospective Student',
        visitorPhone: visitorPhone.trim() || draft.phone || '',
        visitorEmail: visitorEmail.trim() || draft.email || '',
        interestedCourse: interestedCourse || draft.preferredCourse || '',
        intent: lastIntent,
        language,
        escalateToHuman: escalate,
        consentToLeadCapture: escalate ? leadConsentChecked : true,
        messages,
        unansweredQuestions,
        summary: `${escalate ? 'Human support escalation requested' : 'Prospective student inquiry'}${interestedCourse ? ` for ${interestedCourse}` : ''}.`,
        studentUid: auth.currentUser?.emailVerified ? auth.currentUser.uid : '',
      });

      if (result.leadRef) {
        setLeadCapturedRef(result.leadRef);
      }
      if (escalate) {
        setEscalatedDone(true);
        setShowEscalationBox(false);
        setMessages((prev) => [
          ...prev,
          {
            id: generateId('esc'),
            role: 'assistant',
            text:
              language === 'am'
                ? `ጥያቄዎ ወደ ሰው ድጋፍ ሰጪ ቡድናችን ተላልፏል።${result.leadRef ? ` የማጣቀሻ ቁጥር: ${result.leadRef}` : ''} በቅርቡ ያገኙዎታል።`
                : `Your conversation has been escalated to a Zacma human support officer.${result.leadRef ? ` Reference: ${result.leadRef}.` : ''} An advisor will review and follow up shortly.`,
            timestamp: new Date().toISOString(),
          },
        ]);
      } else {
        setShowLeadPrompt(false);
        setMessages((prev) => [
          ...prev,
          {
            id: generateId('leadok'),
            role: 'assistant',
            text: `Thank you! Your inquiry has been logged with Zacma Technology Training Institute Admissions (Reference: ${result.leadRef}).`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save request right now.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const quickPrompts = language === 'am' ? QUICK_PROMPTS_AM : QUICK_PROMPTS_EN;

  return (
    <>
      {/* Floating Launcher Button (Bottom-Right, compact & mobile-safe) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open ZACMA AI ASSISTANT"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2.5 px-4 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-xl shadow-lg border border-blue-800/40 transition-colors cursor-pointer"
        >
          <MessageSquare className="w-4 h-4 shrink-0" />
          <span className="text-xs font-semibold tracking-tight whitespace-nowrap">
            {assistantTitle}
          </span>
        </button>
      )}

      {/* Floating Chat Panel */}
      {open && (
        <div
          role="dialog"
          aria-label={assistantTitle}
          className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[400px] h-[min(640px,calc(100vh-2rem))] bg-white border border-slate-200 rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-blue-700 text-white flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <div className="font-display font-bold text-sm tracking-tight truncate">
                {assistantTitle}
              </div>
              <div className="text-[11px] text-blue-100 truncate">
                Zacma Technology Training Institute • 24/7 Support
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setLanguage((l) => (l === 'en' ? 'am' : 'en'))}
                title="Switch Language (English / Amharic)"
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-blue-800/80 hover:bg-blue-900 rounded-md cursor-pointer"
              >
                <Languages className="w-3.5 h-3.5" />
                <span>{language === 'en' ? 'EN' : 'አማ'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowEscalationBox((v) => !v)}
                title="Connect with Human Support"
                className="p-1.5 hover:bg-blue-800 rounded-md cursor-pointer"
              >
                <Headphones className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={resetConversation}
                title="Start New Conversation"
                className="p-1.5 hover:bg-blue-800 rounded-md cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close Chat"
                className="p-1.5 hover:bg-blue-800 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Inactive Notice (Admin Portal Preview Only) */}
          {config && !config.isActive && isPortalContext && (
            <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 flex items-center gap-2 shrink-0">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Widget is currently paused for public visitors (Admin preview mode).</span>
            </div>
          )}

          {/* Mode Tabs: Chat vs Courses & Fees Directory */}
          <div className="grid grid-cols-2 border-b border-slate-200 bg-white shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'chat'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{language === 'am' ? 'ውይይት' : 'AI Chat'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('courses')}
              className={`py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'courses'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>
                {language === 'am'
                  ? `ኮርሶች እና ዋጋ (${courses.length})`
                  : `Courses & Fees (${courses.length})`}
              </span>
            </button>
          </div>

          {activeTab === 'courses' ? (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
              <div className="p-3 bg-white border-b border-slate-200 shrink-0">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={courseFilter}
                    onChange={(e) => setCourseFilter(e.target.value)}
                    placeholder={
                      language === 'am'
                        ? 'ኮርስ ይፈልጉ…'
                        : 'Search courses (e.g., AI, DevOps, Graphics)…'
                    }
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {filteredWidgetCourses.map((course) => (
                  <div
                    key={course.id}
                    className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-display font-bold text-xs text-slate-900">
                          {course.title}
                        </div>
                        <div className="text-[10px] text-slate-500">{course.category}</div>
                      </div>
                      <div className="font-mono text-xs font-bold text-blue-700 whitespace-nowrap shrink-0 tabular-nums">
                        {course.approvedFee || 'Contact Admissions'}
                      </div>
                    </div>
                    {course.description && (
                      <p className="text-[11px] text-slate-600 leading-relaxed line-clamp-2">
                        {course.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[10px] text-slate-500 truncate">
                        {course.deliveryMethods.join(' • ')}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('chat');
                            void sendMessage(
                              `Tell me about the ${course.title} course and its fee.`
                            );
                          }}
                          className="px-2 py-1 text-[11px] font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('chat');
                            void sendMessage(`I want to register for ${course.title}.`);
                          }}
                          className="px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                        >
                          Register
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {filteredWidgetCourses.length === 0 && (
                  <div className="py-10 text-center text-xs text-slate-400">
                    No courses match "{courseFilter}".
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
          {/* Message Stream */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[86%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-700 text-white'
                      : msg.role === 'agent'
                        ? 'bg-emerald-50 border border-emerald-200 text-slate-900'
                        : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-500 px-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
                <span>{language === 'am' ? 'በመጻፍ ላይ…' : 'ZACMA AI ASSISTANT is typing…'}</span>
              </div>
            )}

            {/* Quick Starter Buttons on Fresh Chat */}
            {messages.length <= 1 && !sending && (
              <div className="pt-1 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500">
                  {language === 'am' ? 'ፈጣን ጥያቄዎች' : 'Quick topics'}
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      className="text-left px-3 py-2 text-xs text-slate-700 bg-white hover:bg-blue-50 hover:text-blue-800 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Secure Registration Form Link Notice (Never upload IDs in chat) */}
            {(suggestFormLink || submittedRef) && (
              <div className="p-3 bg-white border border-blue-200 rounded-lg space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Secure Document Upload Policy</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  For your privacy, never send ID cards, certificates, or private files in chat.
                  {effectiveFormUrl
                    ? ' Use the official registration form link below to upload documents securely.'
                    : ' An admission officer will share the official secure document upload form link.'}
                </p>
                {effectiveFormUrl && (
                  <a
                    href={effectiveFormUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                  >
                    <span>Open Official Registration Form</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}

            {/* Conversational Registration Review & Confirmation Card */}
            {showRegistrationReview && !submittedRef && (
              <div className="p-3.5 bg-white border border-blue-300 rounded-xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-900">
                    Confirm Your Course Registration
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRegistrationReview(false)}
                    className="text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    Edit in chat
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Review or correct your details below before submitting to Zacma admissions.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <input
                    type="text"
                    placeholder="Full Name *"
                    value={draft.fullName || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="tel"
                      placeholder="Phone Number *"
                      value={draft.phone || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                    <input
                      type="email"
                      placeholder="Email (optional)"
                      value={draft.email || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Address (City / Area)"
                    value={draft.address || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    placeholder="Preferred Course *"
                    value={draft.preferredCourse || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, preferredCourse: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Delivery (Online/In-Person/Weekend)"
                      value={draft.deliveryMethod || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, deliveryMethod: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      placeholder="Preferred Schedule"
                      value={draft.preferredSchedule || ''}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, preferredSchedule: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Preferred Payment Method"
                    value={draft.paymentMethod || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, paymentMethod: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  disabled={submittingRegistration}
                  onClick={() => void handleConfirmRegistration()}
                  className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg disabled:opacity-60 cursor-pointer"
                >
                  {submittingRegistration
                    ? 'Saving Registration…'
                    : 'Confirm & Submit Registration'}
                </button>
              </div>
            )}

            {/* Consented Lead Capture Prompt */}
            {showLeadPrompt && !leadCapturedRef && !submittedRef && !showRegistrationReview && (
              <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-900">
                    Request Admission Advisor Follow-Up
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLeadPrompt(false)}
                    className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Share your authorized contact details if you would like Zacma Admissions to follow
                  up regarding {interestedCourse || 'training programs'}.
                </p>
                <input
                  type="text"
                  placeholder="Your Full Name"
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={visitorPhone}
                    onChange={(e) => setVisitorPhone(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    type="email"
                    placeholder="Email Address"
                    value={visitorEmail}
                    onChange={(e) => setVisitorEmail(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <button
                  type="button"
                  disabled={submittingAction}
                  onClick={() => void handleSaveLeadOrEscalation(false)}
                  className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg disabled:opacity-60 cursor-pointer"
                >
                  {submittingAction ? 'Saving…' : 'Save Inquiry & Request Follow-Up'}
                </button>
              </div>
            )}

            {/* Human Support Escalation Card */}
            {showEscalationBox && (
              <div className="p-3.5 bg-white border border-red-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <UserCheck className="w-4 h-4 text-red-600" />
                    <span>Escalate to Human Support</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEscalationBox(false)}
                    className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-slate-600">
                  Transfer this conversation to a Zacma admission or student support advisor.
                </p>
                <input
                  type="text"
                  placeholder="Your Name"
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={visitorPhone}
                    onChange={(e) => setVisitorPhone(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    type="email"
                    placeholder="Email Address"
                    value={visitorEmail}
                    onChange={(e) => setVisitorEmail(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={leadConsentChecked}
                    onChange={(e) => setLeadConsentChecked(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700"
                  />
                  <span>Create a CRM follow-up record so an advisor can contact me</span>
                </label>
                <button
                  type="button"
                  disabled={submittingAction}
                  onClick={() => void handleSaveLeadOrEscalation(true)}
                  className="w-full py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg disabled:opacity-60 cursor-pointer"
                >
                  {submittingAction ? 'Escalating…' : 'Send to Human Support Officer'}
                </button>
              </div>
            )}

            {/* Confirmation Badge */}
            {submittedRef && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Registration Reference: <strong className="font-mono">{submittedRef}</strong>
                </span>
              </div>
            )}

            {errorMsg && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Composer Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                language === 'am'
                  ? 'ጥያቄዎን በአማርኛ ወይም በእንግሊዝኛ ይጻፉ…'
                  : 'Ask about courses, registration, schedules…'
              }
              disabled={sending}
              className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="p-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
