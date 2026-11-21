import React, { useMemo, useState } from 'react';
import {
  Bot,
  BookOpen,
  HelpCircle,
  Inbox,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  Send,
  Search,
  Sparkles,
  GraduationCap,
  X,
  Save,
  ExternalLink,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePortal } from '../context/PortalContext';
import { canManageOrg, formatTimestamp } from '../lib/zacmaService';
import {
  DEFAULT_APPROVED_COURSE_FEE,
  DEFAULT_SUPPORT_AI_INSTRUCTIONS,
  DEFAULT_SUPPORT_WELCOME_MESSAGE,
  INSTITUTE_18_COURSES,
  applyUniformFeeToAllCourses,
  assignSupportConversation,
  deleteSupportKnowledge,
  deleteTrainingCourse,
  saveSupportConfig,
  saveSupportKnowledge,
  saveTrainingCourse,
  seedEighteenInstituteCourses,
  sendHumanAgentReply,
  updateStudentRegistrationRecord,
  updateSupportConversationStatus,
} from '../lib/supportService';
import type {
  NavSection,
  StudentRegistration,
  SupportConversation,
  SupportKnowledgeCategory,
  SupportKnowledgeItem,
  TrainingCourse,
} from '../types';

interface Props {
  activeSection: Extract<
    NavSection,
    'ai_support_overview' | 'ai_support_courses' | 'ai_support_knowledge' | 'ai_support_inbox'
  >;
  onNavigate: (section: NavSection) => void;
  onMessageStudent?: (reg: StudentRegistration) => void;
}

const KNOWLEDGE_CATEGORIES: Array<{ value: SupportKnowledgeCategory; label: string }> = [
  { value: 'registration', label: 'Registration' },
  { value: 'payment', label: 'Payment Methods' },
  { value: 'schedule', label: 'Class Schedules' },
  { value: 'location', label: 'Training Locations' },
  { value: 'attendance', label: 'Attendance Procedures' },
  { value: 'certificates', label: 'Certificates' },
  { value: 'materials', label: 'Learning Materials' },
  { value: 'student_services', label: 'Student Services' },
  { value: 'general', label: 'General & Policies' },
];

const DELIVERY_OPTIONS = ['Online', 'In-Person', 'Weekend', 'Hybrid'];

export function AiSupportAdminModule({ activeSection, onNavigate, onMessageStudent }: Props) {
  const {
    user,
    organization,
    effectiveRole,
    members,
    businessUnits,
    forms,
    supportConfig,
    courses,
    knowledgeItems,
    supportConversations,
    studentRegistrations,
  } = usePortal();

  const isAdmin = canManageOrg(effectiveRole);
  const orgId = organization?.id || 'zacma-hq';
  const ownerId = organization?.ownerId || user?.uid || '';
  const authorizedUserIds = organization?.authorizedUserIds || (user ? [user.uid] : []);
  const actorId = user?.uid || '';
  const actorName = user?.displayName || user?.email || 'Administrator';

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // =========================================================================
  // VIEW 1: AI SUPPORT CONTROL & ANALYTICS STATE
  // =========================================================================
  const [cfgIsActive, setCfgIsActive] = useState<boolean>(supportConfig?.isActive ?? true);
  const [cfgName, setCfgName] = useState<string>(supportConfig?.assistantName || 'ZACMA AI ASSISTANT');
  const [cfgWelcome, setCfgWelcome] = useState<string>(
    supportConfig?.welcomeMessage || DEFAULT_SUPPORT_WELCOME_MESSAGE
  );
  const [cfgInstructions, setCfgInstructions] = useState<string>(
    supportConfig?.aiInstructions || DEFAULT_SUPPORT_AI_INSTRUCTIONS
  );
  const [cfgLanguages, setCfgLanguages] = useState<string[]>(
    supportConfig?.supportedLanguages || ['en', 'am']
  );
  const [cfgBuId, setCfgBuId] = useState<string>(supportConfig?.trainingInstituteBuId || '');
  const [cfgRegFormUrl, setCfgRegFormUrl] = useState<string>(
    supportConfig?.registrationFormUrl || ''
  );
  const [savingConfig, setSavingConfig] = useState(false);

  // Sync local config form when Firestore supportConfig loads
  React.useEffect(() => {
    if (!supportConfig) return;
    setCfgIsActive(supportConfig.isActive);
    setCfgName(supportConfig.assistantName || 'ZACMA AI ASSISTANT');
    setCfgWelcome(supportConfig.welcomeMessage || DEFAULT_SUPPORT_WELCOME_MESSAGE);
    setCfgInstructions(supportConfig.aiInstructions || DEFAULT_SUPPORT_AI_INSTRUCTIONS);
    setCfgLanguages(
      supportConfig.supportedLanguages?.length ? supportConfig.supportedLanguages : ['en', 'am']
    );
    setCfgBuId(supportConfig.trainingInstituteBuId || '');
    setCfgRegFormUrl(supportConfig.registrationFormUrl || '');
  }, [supportConfig]);

  // =========================================================================
  // VIEW 2: COURSES CATALOG STATE
  // =========================================================================
  const [courseSearch, setCourseSearch] = useState('');
  const [seedingCourses, setSeedingCourses] = useState(false);
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<TrainingCourse | null>(null);
  const [savingCourse, setSavingCourse] = useState(false);
  const [courseForm, setCourseForm] = useState({
    title: '',
    category: 'Data & Emerging Tech',
    description: '',
    learningObjectivesText: '',
    qualifications: '',
    duration: '',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'] as string[],
    schedules: '',
    availableBatches: '',
    certificateInfo: '',
    approvedFee: '',
    registrationProcedure: '',
    isActive: true,
  });

  // =========================================================================
  // VIEW 3: KNOWLEDGE BASE & FAQS STATE
  // =========================================================================
  const [faqCategoryFilter, setFaqCategoryFilter] = useState<string>('all');
  const [faqModalOpen, setFaqModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<SupportKnowledgeItem | null>(null);
  const [savingFaq, setSavingFaq] = useState(false);
  const [faqForm, setFaqForm] = useState({
    category: 'registration' as SupportKnowledgeCategory,
    question: '',
    answer: '',
    language: 'both' as 'en' | 'am' | 'both',
    isActive: true,
  });

  // =========================================================================
  // VIEW 4: INBOX & STUDENT REGISTRATIONS STATE
  // =========================================================================
  const [inboxTab, setInboxTab] = useState<'conversations' | 'registrations'>('conversations');
  const [convFilter, setConvFilter] = useState<'all' | 'escalated' | 'assigned' | 'unanswered' | 'resolved'>('all');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [agentReplyText, setAgentReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // Convert unanswered question directly into an FAQ
  const [convertingQuestion, setConvertingQuestion] = useState<{
    conv: SupportConversation;
    question: string;
  } | null>(null);
  const [quickFaqAnswer, setQuickFaqAnswer] = useState('');
  const [quickFaqCategory, setQuickFaqCategory] = useState<SupportKnowledgeCategory>('general');

  // Student registration editor
  const [regSearch, setRegSearch] = useState('');
  const [editingReg, setEditingReg] = useState<StudentRegistration | null>(null);
  const [savingReg, setSavingReg] = useState(false);
  const [regEditForm, setRegEditForm] = useState({
    registrationStatus: 'submitted' as StudentRegistration['registrationStatus'],
    batchName: '',
    classSchedule: '',
    trainingLocation: '',
    paymentStatus: 'pending' as StudentRegistration['paymentStatus'],
    certificateStatus: 'not_issued' as StudentRegistration['certificateStatus'],
  });

  // =========================================================================
  // COMPUTED METRICS & CHART DATA
  // =========================================================================
  const analytics = useMemo(() => {
    const escalatedCount = supportConversations.filter((c) => c.status === 'escalated').length;
    const leadsGenerated = supportConversations.filter((c) => Boolean(c.leadRef)).length;
    const unansweredTotal = supportConversations.reduce(
      (sum, c) => sum + (c.unansweredQuestions?.length || 0),
      0
    );

    const courseCounts = new Map<string, number>();
    for (const conv of supportConversations) {
      if (conv.interestedCourse) {
        courseCounts.set(
          conv.interestedCourse,
          (courseCounts.get(conv.interestedCourse) || 0) + 1
        );
      }
    }
    for (const reg of studentRegistrations) {
      if (reg.preferredCourse) {
        courseCounts.set(reg.preferredCourse, (courseCounts.get(reg.preferredCourse) || 0) + 1);
      }
    }

    const topCourses = Array.from(courseCounts.entries())
      .map(([name, inquiries]) => ({
        name: name.length > 22 ? `${name.slice(0, 20)}…` : name,
        inquiries,
      }))
      .sort((a, b) => b.inquiries - a.inquiries)
      .slice(0, 8);

    return {
      totalConversations: supportConversations.length,
      escalatedCount,
      leadsGenerated,
      registrationsCount: studentRegistrations.length,
      unansweredTotal,
      topCourses,
    };
  }, [supportConversations, studentRegistrations]);

  const publishedForms = useMemo(
    () => forms.filter((f) => f.isPublished && f.isActive),
    [forms]
  );

  const filteredCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [courses, courseSearch]);

  const filteredFaqs = useMemo(() => {
    if (faqCategoryFilter === 'all') return knowledgeItems;
    return knowledgeItems.filter((item) => item.category === faqCategoryFilter);
  }, [knowledgeItems, faqCategoryFilter]);

  const filteredConversations = useMemo(() => {
    return supportConversations.filter((c) => {
      if (convFilter === 'escalated') return c.status === 'escalated';
      if (convFilter === 'assigned') return c.status === 'assigned';
      if (convFilter === 'resolved') return c.status === 'resolved';
      if (convFilter === 'unanswered') return (c.unansweredQuestions?.length || 0) > 0;
      return true;
    });
  }, [supportConversations, convFilter]);

  const selectedConv = useMemo(() => {
    if (!selectedConvId) return filteredConversations[0] || null;
    return (
      filteredConversations.find((c) => c.id === selectedConvId) ||
      filteredConversations[0] ||
      null
    );
  }, [filteredConversations, selectedConvId]);

  const filteredRegistrations = useMemo(() => {
    const q = regSearch.trim().toLowerCase();
    if (!q) return studentRegistrations;
    return studentRegistrations.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        r.preferredCourse.toLowerCase().includes(q) ||
        r.leadRef.toLowerCase().includes(q)
    );
  }, [studentRegistrations, regSearch]);

  // =========================================================================
  // HANDLERS
  // =========================================================================

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingConfig(true);
    setBanner(null);
    try {
      const matchedBu = businessUnits.find((b) => b.id === cfgBuId);
      await saveSupportConfig({
        organizationId: orgId,
        orgOwnerId: ownerId,
        authorizedUserIds,
        actorId,
        actorName,
        existing: supportConfig,
        data: {
          isActive: cfgIsActive,
          assistantName: cfgName,
          welcomeMessage: cfgWelcome,
          aiInstructions: cfgInstructions,
          supportedLanguages: cfgLanguages,
          trainingInstituteBuId: cfgBuId,
          trainingInstituteName: matchedBu?.name || 'Zacma Technology Training Institute',
          registrationFormUrl: cfgRegFormUrl,
        },
      });
      setBanner({ type: 'success', text: 'ZACMA AI ASSISTANT configuration saved and published.' });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save configuration.',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSeedCourses = async () => {
    if (!isAdmin) return;
    setSeedingCourses(true);
    setBanner(null);
    try {
      const { createdCount, updatedFeeCount } = await seedEighteenInstituteCourses({
        organizationId: orgId,
        ownerId,
        authorizedUserIds,
        existingCourses: courses,
        actorId,
        actorName,
      });
      setBanner({
        type: 'success',
        text:
          createdCount > 0 || updatedFeeCount > 0
            ? `Synced institute courses (${createdCount} added, ${updatedFeeCount} fees updated to ${DEFAULT_APPROVED_COURSE_FEE}).`
            : `All ${INSTITUTE_18_COURSES.length} institute courses are already synced with ${DEFAULT_APPROVED_COURSE_FEE} pricing.`,
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to initialize course catalog.',
      });
    } finally {
      setSeedingCourses(false);
    }
  };

  const handleApplyStandardFeeAll = async () => {
    if (!isAdmin || courses.length === 0) return;
    setSeedingCourses(true);
    setBanner(null);
    try {
      const updated = await applyUniformFeeToAllCourses({
        organizationId: orgId,
        courses,
        fee: DEFAULT_APPROVED_COURSE_FEE,
        ownerId,
        authorizedUserIds,
        actorId,
        actorName,
      });
      setBanner({
        type: 'success',
        text:
          updated > 0
            ? `Updated approved course price to ${DEFAULT_APPROVED_COURSE_FEE} across ${updated} course(s).`
            : `All courses already have the approved fee set to ${DEFAULT_APPROVED_COURSE_FEE}.`,
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update course fees.',
      });
    } finally {
      setSeedingCourses(false);
    }
  };

  const openCourseModal = (course?: TrainingCourse) => {
    if (course) {
      setEditingCourse(course);
      setCourseForm({
        title: course.title,
        category: course.category,
        description: course.description,
        learningObjectivesText: course.learningObjectives.join('\n'),
        qualifications: course.qualifications,
        duration: course.duration,
        deliveryMethods: course.deliveryMethods.length ? course.deliveryMethods : ['Online'],
        schedules: course.schedules,
        availableBatches: course.availableBatches,
        certificateInfo: course.certificateInfo,
        approvedFee: course.approvedFee,
        registrationProcedure: course.registrationProcedure,
        isActive: course.isActive,
      });
    } else {
      setEditingCourse(null);
      setCourseForm({
        title: '',
        category: 'Data & Emerging Tech',
        description: '',
        learningObjectivesText: '',
        qualifications: '',
        duration: '',
        deliveryMethods: ['Online', 'In-Person', 'Weekend'],
        schedules: '',
        availableBatches: '',
        certificateInfo: '',
        approvedFee: '',
        registrationProcedure: '',
        isActive: true,
      });
    }
    setCourseModalOpen(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseForm.title.trim()) return;
    setSavingCourse(true);
    setBanner(null);
    try {
      const objectives = courseForm.learningObjectivesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      await saveTrainingCourse({
        organizationId: orgId,
        ownerId,
        authorizedUserIds,
        existing: editingCourse,
        data: {
          title: courseForm.title,
          category: courseForm.category,
          description: courseForm.description,
          learningObjectives: objectives,
          qualifications: courseForm.qualifications,
          duration: courseForm.duration,
          deliveryMethods: courseForm.deliveryMethods,
          schedules: courseForm.schedules,
          availableBatches: courseForm.availableBatches,
          certificateInfo: courseForm.certificateInfo,
          approvedFee: courseForm.approvedFee,
          registrationProcedure: courseForm.registrationProcedure,
          isActive: courseForm.isActive,
        },
        actorId,
        actorName,
      });
      setCourseModalOpen(false);
      setBanner({
        type: 'success',
        text: `Course "${courseForm.title}" saved and synced with ZACMA AI ASSISTANT.`,
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save course.',
      });
    } finally {
      setSavingCourse(false);
    }
  };

  const handleDeleteCourse = async (course: TrainingCourse) => {
    if (!isAdmin) return;
    setBanner(null);
    try {
      await deleteTrainingCourse({
        organizationId: orgId,
        course,
        ownerId,
        authorizedUserIds,
        actorId,
        actorName,
      });
      setBanner({ type: 'success', text: `Deleted course "${course.title}".` });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to delete course.',
      });
    }
  };

  const openFaqModal = (item?: SupportKnowledgeItem) => {
    if (item) {
      setEditingFaq(item);
      setFaqForm({
        category: item.category,
        question: item.question,
        answer: item.answer,
        language: item.language,
        isActive: item.isActive,
      });
    } else {
      setEditingFaq(null);
      setFaqForm({
        category: 'registration',
        question: '',
        answer: '',
        language: 'both',
        isActive: true,
      });
    }
    setFaqModalOpen(true);
  };

  const handleSaveFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faqForm.question.trim() || !faqForm.answer.trim()) return;
    setSavingFaq(true);
    setBanner(null);
    try {
      await saveSupportKnowledge({
        organizationId: orgId,
        ownerId,
        authorizedUserIds,
        existing: editingFaq,
        data: faqForm,
        actorId,
        actorName,
      });
      setFaqModalOpen(false);
      setBanner({ type: 'success', text: 'Knowledge base entry saved.' });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save FAQ.',
      });
    } finally {
      setSavingFaq(false);
    }
  };

  const handleConvertUnansweredToFaq = async () => {
    if (!convertingQuestion || !quickFaqAnswer.trim()) return;
    setSavingFaq(true);
    setBanner(null);
    try {
      await saveSupportKnowledge({
        organizationId: orgId,
        ownerId,
        authorizedUserIds,
        data: {
          category: quickFaqCategory,
          question: convertingQuestion.question,
          answer: quickFaqAnswer.trim(),
          language: 'both',
          isActive: true,
        },
        actorId,
        actorName,
      });
      const remaining = (convertingQuestion.conv.unansweredQuestions || []).filter(
        (q) => q !== convertingQuestion.question
      );
      await updateSupportConversationStatus({
        organizationId: orgId,
        conversation: convertingQuestion.conv,
        status: convertingQuestion.conv.status,
        unansweredQuestions: remaining,
      });
      setConvertingQuestion(null);
      setQuickFaqAnswer('');
      setBanner({
        type: 'success',
        text: 'Converted unanswered question into an active FAQ for ZACMA AI ASSISTANT.',
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to convert unanswered question.',
      });
    } finally {
      setSavingFaq(false);
    }
  };

  const handleSendAgentReply = async (markResolved: boolean) => {
    if (!selectedConv || !agentReplyText.trim()) return;
    setSendingReply(true);
    setBanner(null);
    try {
      await sendHumanAgentReply({
        organizationId: orgId,
        conversation: selectedConv,
        agentId: actorId,
        agentName: actorName,
        replyText: agentReplyText.trim(),
        markResolved,
      });
      setAgentReplyText('');
      setBanner({
        type: 'success',
        text: markResolved ? 'Reply sent and conversation marked resolved.' : 'Human agent reply recorded.',
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to send reply.',
      });
    } finally {
      setSendingReply(false);
    }
  };

  const openRegEditor = (reg: StudentRegistration) => {
    setEditingReg(reg);
    setRegEditForm({
      registrationStatus: reg.registrationStatus,
      batchName: reg.batchName,
      classSchedule: reg.classSchedule,
      trainingLocation: reg.trainingLocation,
      paymentStatus: reg.paymentStatus,
      certificateStatus: reg.certificateStatus,
    });
  };

  const handleSaveRegEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReg) return;
    setSavingReg(true);
    setBanner(null);
    try {
      await updateStudentRegistrationRecord({
        organizationId: orgId,
        registration: editingReg,
        updates: regEditForm,
      });
      setEditingReg(null);
      setBanner({
        type: 'success',
        text: `Updated registration record for ${editingReg.fullName}.`,
      });
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update registration.',
      });
    } finally {
      setSavingReg(false);
    }
  };

  return (
    <div className="space-y-6">
      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 1: AI SUPPORT CONTROL & ANALYTICS                                */}
      {/* ===================================================================== */}
      {activeSection === 'ai_support_overview' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                AI Support Control Center
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Configure 24/7 ZACMA AI ASSISTANT behavior, language support, and monitor student
                support performance.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('ai_support_courses')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Manage Courses ({courses.length})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('ai_support_inbox')}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                Open Support Inbox ({analytics.escalatedCount} escalated)
              </button>
            </div>
          </div>

          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Total Conversations', value: analytics.totalConversations, tone: 'text-slate-900' },
              { label: 'Escalated Queue', value: analytics.escalatedCount, tone: analytics.escalatedCount > 0 ? 'text-red-600' : 'text-slate-900' },
              { label: 'AI-Generated Leads', value: analytics.leadsGenerated, tone: 'text-blue-700' },
              { label: 'AI Registrations', value: analytics.registrationsCount, tone: 'text-emerald-700' },
              { label: 'Unanswered Questions', value: analytics.unansweredTotal, tone: analytics.unansweredTotal > 0 ? 'text-amber-700' : 'text-slate-900' },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">{kpi.label}</div>
                <div className={`font-mono text-2xl font-bold mt-1.5 tabular-nums ${kpi.tone}`}>
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Configuration Panel */}
            <form
              onSubmit={handleSaveConfig}
              className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <Bot className="w-5 h-5 text-blue-700" />
                  <div>
                    <h2 className="font-display font-bold text-base text-slate-900">
                      Assistant Configuration
                    </h2>
                    <p className="text-xs text-slate-500">
                      Live changes propagate immediately to the floating widget on public forms and
                      portal pages.
                    </p>
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cfgIsActive}
                    disabled={!isAdmin}
                    onChange={(e) => setCfgIsActive(e.target.checked)}
                    className="rounded border-slate-300 text-blue-700 w-4 h-4"
                  />
                  <span>{cfgIsActive ? 'Active (24/7)' : 'Deactivated'}</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Assistant Brand Name
                  </label>
                  <input
                    type="text"
                    value={cfgName}
                    disabled={!isAdmin}
                    onChange={(e) => setCfgName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Associated Training Institute Business Unit
                  </label>
                  <select
                    value={cfgBuId}
                    disabled={!isAdmin}
                    onChange={(e) => setCfgBuId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Default — Zacma Technology Training Institute</option>
                    {businessUnits.map((bu) => (
                      <option key={bu.id} value={bu.id}>
                        {bu.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-700">Welcome Message</label>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setCfgWelcome(DEFAULT_SUPPORT_WELCOME_MESSAGE)}
                      className="text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Restore official welcome message
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={cfgWelcome}
                  disabled={!isAdmin}
                  onChange={(e) => setCfgWelcome(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  AI System Instructions & Policies
                </label>
                <textarea
                  rows={3}
                  value={cfgInstructions}
                  disabled={!isAdmin}
                  onChange={(e) => setCfgInstructions(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Official Document Upload Form URL
                  </label>
                  <input
                    type="url"
                    value={cfgRegFormUrl}
                    disabled={!isAdmin}
                    onChange={(e) => setCfgRegFormUrl(e.target.value)}
                    placeholder="https://…/forms/business-unit/registration-form"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                  {publishedForms.length > 0 && isAdmin && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {publishedForms.slice(0, 3).map((pf) => {
                        const url = `${window.location.origin}/forms/${pf.businessUnitSlug}/${pf.slug}`;
                        return (
                          <button
                            key={pf.id}
                            type="button"
                            onClick={() => setCfgRegFormUrl(url)}
                            className="text-[11px] text-blue-700 hover:underline cursor-pointer"
                          >
                            Use "{pf.title}"
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Supported Languages
                  </label>
                  <div className="flex items-center gap-4 pt-1.5">
                    {[
                      { code: 'en', label: 'English' },
                      { code: 'am', label: 'Amharic (አማርኛ)' },
                    ].map((lang) => {
                      const checked = cfgLanguages.includes(lang.code);
                      return (
                        <label
                          key={lang.code}
                          className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!isAdmin}
                            onChange={() => {
                              setCfgLanguages((prev) =>
                                checked
                                  ? prev.filter((l) => l !== lang.code)
                                  : [...prev, lang.code]
                              );
                            }}
                            className="rounded border-slate-300 text-blue-700"
                          />
                          <span>{lang.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {isAdmin && (
                <div className="pt-2 border-t border-slate-100 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingConfig}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg disabled:opacity-60 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingConfig ? 'Saving…' : 'Save Assistant Configuration'}</span>
                  </button>
                </div>
              )}
            </form>

            {/* Analytics Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col">
              <h2 className="font-display font-bold text-base text-slate-900">
                Top Inquired Courses
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Live inquiry volume across AI chat conversations & registrations.
              </p>
              {analytics.topCourses.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-10 text-xs text-slate-400">
                  <Sparkles className="w-7 h-7 text-slate-300 mb-2" />
                  <p>No course inquiry metrics recorded yet.</p>
                  <p className="mt-1">
                    Try chatting with ZACMA AI ASSISTANT using the bottom-right widget.
                  </p>
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.topCourses} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={115} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="inquiries" fill="#1D4ED8" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 2: COURSE CATALOG (18+ INSTITUTE PROGRAMS)                       */}
      {/* ===================================================================== */}
      {activeSection === 'ai_support_courses' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Training Institute Course Catalog
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Manage official course details used by ZACMA AI ASSISTANT to answer prospective
                student inquiries.
              </p>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={seedingCourses}
                  onClick={() => void handleSeedCourses()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg disabled:opacity-60 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>
                    {seedingCourses
                      ? 'Syncing…'
                      : `Sync ${INSTITUTE_18_COURSES.length} Courses (${DEFAULT_APPROVED_COURSE_FEE})`}
                  </span>
                </button>
                {courses.length > 0 && (
                  <button
                    type="button"
                    disabled={seedingCourses}
                    onClick={() => void handleApplyStandardFeeAll()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-60 cursor-pointer"
                  >
                    <span>Set All to {DEFAULT_APPROVED_COURSE_FEE}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openCourseModal()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Course</span>
                </button>
              </div>
            )}
          </div>

          <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Administrator-Approved Pricing:</strong> All {INSTITUTE_18_COURSES.length}{' '}
              institute programs are configured at{' '}
              <strong className="font-mono">{DEFAULT_APPROVED_COURSE_FEE}</strong> each and are
              immediately searchable in both this catalog and the public{' '}
              <strong>ZACMA AI ASSISTANT</strong> widget. Edit any course to adjust its fee,
              duration, schedules, batches, or certificate policy.
            </span>
          </div>

          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              placeholder="Search courses by title or category…"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>

          {filteredCourses.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <GraduationCap className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="font-display font-bold text-slate-900">No courses configured yet</div>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Click "Initialize 18 Institute Courses" above to populate all Zacma Technology
                Training Institute programs, or add a custom course manually.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                      <th className="py-3 px-4">Course</th>
                      <th className="py-3 px-4">Delivery</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Approved Fee</th>
                      <th className="py-3 px-4">Status</th>
                      {isAdmin && <th className="py-3 px-4 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredCourses.map((course) => (
                      <tr key={course.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{course.title}</div>
                          <div className="text-[11px] text-slate-500">{course.category}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {course.deliveryMethods.join(', ') || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {course.duration || (
                            <span className="text-slate-400 italic">Not configured</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-800">
                          {course.approvedFee || (
                            <span className="font-sans text-slate-400 italic">Not configured</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[11px] font-semibold ${
                              course.isActive ? 'text-emerald-700' : 'text-slate-400'
                            }`}
                          >
                            {course.isActive ? 'Active' : 'Hidden'}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openCourseModal(course)}
                              className="p-1.5 text-slate-500 hover:text-blue-700 cursor-pointer"
                              title="Edit course"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteCourse(course)}
                              className="p-1.5 text-slate-500 hover:text-red-600 cursor-pointer"
                              title="Delete course"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 3: SUPPORT KNOWLEDGE & FAQS                                      */}
      {/* ===================================================================== */}
      {activeSection === 'ai_support_knowledge' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Support Knowledge Base & FAQs
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Publish verified answers for registration, payment instructions, campus locations,
                attendance, certificates, and student services.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => openFaqModal()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Knowledge Entry</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFaqCategoryFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                faqCategoryFilter === 'all'
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All ({knowledgeItems.length})
            </button>
            {KNOWLEDGE_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setFaqCategoryFilter(cat.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                  faqCategoryFilter === cat.value
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {filteredFaqs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <HelpCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="font-display font-bold text-slate-900">No FAQ entries yet</div>
              <p className="text-xs text-slate-500 mt-1">
                Add payment methods, campus addresses, certificate rules, and student support
                guidance so ZACMA AI ASSISTANT answers accurately in English and Amharic.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredFaqs.map((item) => (
                <div
                  key={item.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mb-2">
                      <span className="font-semibold uppercase tracking-wide text-blue-700">
                        {item.category.replace('_', ' ')}
                      </span>
                      <span>
                        {item.language === 'both'
                          ? 'EN / አማ'
                          : item.language === 'am'
                            ? 'አማርኛ'
                            : 'English'}{' '}
                        • {item.isActive ? 'Active' : 'Draft'}
                      </span>
                    </div>
                    <h3 className="font-display font-bold text-sm text-slate-900">
                      {item.question}
                    </h3>
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed whitespace-pre-wrap">
                      {item.answer}
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openFaqModal(item)}
                        className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void deleteSupportKnowledge({
                            organizationId: orgId,
                            item,
                            ownerId,
                            authorizedUserIds,
                            actorId,
                            actorName,
                          })
                        }
                        className="text-xs font-medium text-red-600 hover:underline cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* VIEW 4: SUPPORT INBOX, ESCALATIONS & STUDENT REGISTRATIONS            */}
      {/* ===================================================================== */}
      {activeSection === 'ai_support_inbox' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Support Inbox & Student Registrations
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Review AI conversations, resolve escalated human support tickets, convert unanswered
                questions to FAQs, and manage student enrollments.
              </p>
            </div>
            <div className="inline-flex bg-white border border-slate-200 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setInboxTab('conversations')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  inboxTab === 'conversations'
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Conversations ({supportConversations.length})
              </button>
              <button
                type="button"
                onClick={() => setInboxTab('registrations')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  inboxTab === 'registrations'
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Student Registrations ({studentRegistrations.length})
              </button>
            </div>
          </div>

          {inboxTab === 'conversations' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', 'All Conversations'],
                    ['escalated', 'Escalated to Human'],
                    ['assigned', 'Assigned to Agent'],
                    ['unanswered', 'Has Unanswered Questions'],
                    ['resolved', 'Resolved'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setConvFilter(key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                      convFilter === key
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {filteredConversations.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <div className="font-display font-bold text-slate-900">
                    No conversations match this filter
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    AI registrations, consented leads, and human escalations from ZACMA AI
                    ASSISTANT appear here in real time.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Conversation List */}
                  <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
                    {filteredConversations.map((conv) => {
                      const active = selectedConv?.id === conv.id;
                      return (
                        <button
                          key={conv.id}
                          type="button"
                          onClick={() => setSelectedConvId(conv.id)}
                          className={`w-full text-left p-4 transition-colors cursor-pointer ${
                            active ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-xs text-slate-900 truncate">
                              {conv.visitorName || 'Website Visitor'}
                            </span>
                            <span
                              className={`text-[10px] font-semibold uppercase ${
                                conv.status === 'escalated'
                                  ? 'text-red-600'
                                  : conv.status === 'resolved'
                                    ? 'text-emerald-700'
                                    : 'text-blue-700'
                              }`}
                            >
                              {conv.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1 truncate">
                            {conv.interestedCourse || conv.intent.replace('_', ' ')}
                            {conv.leadRef ? ` • ${conv.leadRef}` : ''}
                          </div>
                          {conv.unansweredQuestions?.length > 0 && (
                            <div className="text-[11px] text-amber-700 mt-1">
                              {conv.unansweredQuestions.length} unanswered question(s)
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Conversation Transcript & Human Agent Controls */}
                  {selectedConv && (
                    <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl flex flex-col max-h-[620px] overflow-hidden">
                      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-display font-bold text-sm text-slate-900">
                            {selectedConv.visitorName || 'Website Visitor'}
                          </div>
                          <div className="text-xs text-slate-500">
                            {[
                              selectedConv.visitorPhone,
                              selectedConv.visitorEmail,
                              selectedConv.interestedCourse,
                            ]
                              .filter(Boolean)
                              .join(' • ') || 'No contact details captured'}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <UserPlus className="w-3.5 h-3.5 text-slate-400" />
                            <select
                              value={selectedConv.assignedAgentId || ''}
                              onChange={(e) => {
                                const m = members.find((mem) => mem.userId === e.target.value);
                                void assignSupportConversation({
                                  organizationId: orgId,
                                  conversation: selectedConv,
                                  agentId: m?.userId || '',
                                  agentName: m?.displayName || '',
                                });
                              }}
                              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                            >
                              <option value="">Unassigned</option>
                              {members.map((m) => (
                                <option key={m.userId} value={m.userId}>
                                  {m.displayName} ({m.role.replace('_', ' ')})
                                </option>
                              ))}
                            </select>
                          </div>
                          {selectedConv.leadRef && (
                            <button
                              type="button"
                              onClick={() => onNavigate('all_leads')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-semibold text-blue-700 border border-blue-200 bg-blue-50 rounded-lg cursor-pointer"
                            >
                              <span>{selectedConv.leadRef}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Flagged Unanswered Questions Banner */}
                      {selectedConv.unansweredQuestions?.length > 0 && (
                        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 space-y-2">
                          <div className="text-xs font-semibold text-amber-900">
                            Unanswered Questions Flagged by AI
                          </div>
                          {selectedConv.unansweredQuestions.map((uq) => (
                            <div
                              key={uq}
                              className="flex items-center justify-between gap-2 text-xs text-amber-800"
                            >
                              <span>"{uq}"</span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConvertingQuestion({ conv: selectedConv, question: uq });
                                    setQuickFaqAnswer('');
                                  }}
                                  className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 font-semibold rounded-md hover:bg-amber-100 shrink-0 cursor-pointer"
                                >
                                  Add to FAQ
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Messages */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                        {selectedConv.messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex flex-col ${
                              msg.role === 'user' ? 'items-start' : 'items-end'
                            }`}
                          >
                            <div className="text-[10px] text-slate-400 mb-0.5 uppercase">
                              {msg.role === 'user'
                                ? selectedConv.visitorName || 'Visitor'
                                : msg.role === 'agent'
                                  ? 'Human Support Agent'
                                  : 'ZACMA AI ASSISTANT'}
                            </div>
                            <div
                              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs whitespace-pre-wrap ${
                                msg.role === 'user'
                                  ? 'bg-white border border-slate-200 text-slate-900'
                                  : msg.role === 'agent'
                                    ? 'bg-emerald-700 text-white'
                                    : 'bg-blue-700 text-white'
                              }`}
                            >
                              {msg.text}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Human Agent Reply Composer */}
                      <div className="p-3.5 bg-white border-t border-slate-200 space-y-2">
                        <textarea
                          rows={2}
                          value={agentReplyText}
                          onChange={(e) => setAgentReplyText(e.target.value)}
                          placeholder="Write a human support response to record on this thread…"
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">
                            Updated {formatTimestamp(selectedConv.updatedAt)}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={sendingReply || !agentReplyText.trim()}
                              onClick={() => void handleSendAgentReply(false)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg disabled:opacity-50 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Log Reply</span>
                            </button>
                            <button
                              type="button"
                              disabled={sendingReply || !agentReplyText.trim()}
                              onClick={() => void handleSendAgentReply(true)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Reply & Resolve</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STUDENT REGISTRATIONS SUB-TAB */}
          {inboxTab === 'registrations' && (
            <div className="space-y-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={regSearch}
                  onChange={(e) => setRegSearch(e.target.value)}
                  placeholder="Search by student name, phone, course, or lead ref…"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>

              {filteredRegistrations.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <GraduationCap className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <div className="font-display font-bold text-slate-900">
                    No student registrations recorded yet
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Completed conversational registrations from ZACMA AI ASSISTANT automatically
                    appear here and in the CRM Leads pipeline.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                          <th className="py-3 px-4">Student & Ref</th>
                          <th className="py-3 px-4">Course & Mode</th>
                          <th className="py-3 px-4">Batch & Schedule</th>
                          <th className="py-3 px-4">Registration</th>
                          <th className="py-3 px-4">Payment</th>
                          <th className="py-3 px-4">Certificate</th>
                          <th className="py-3 px-4 text-right">Manage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {filteredRegistrations.map((reg) => (
                          <tr key={reg.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-900">{reg.fullName}</div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                {reg.leadRef} • {reg.phone}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-800">{reg.preferredCourse}</div>
                              <div className="text-[11px] text-slate-500">{reg.deliveryMethod}</div>
                            </td>
                            <td className="py-3 px-4 text-slate-600">
                              <div>{reg.batchName || 'Unassigned batch'}</div>
                              <div className="text-[11px] text-slate-400">
                                {reg.classSchedule || reg.preferredSchedule}
                              </div>
                            </td>
                            <td className="py-3 px-4 capitalize font-medium text-blue-800">
                              {reg.registrationStatus.replace('_', ' ')}
                            </td>
                            <td className="py-3 px-4 capitalize text-slate-700">
                              {reg.paymentStatus}
                            </td>
                            <td className="py-3 px-4 capitalize text-slate-700">
                              {reg.certificateStatus.replace('_', ' ')}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {onMessageStudent && (
                                  <button
                                    type="button"
                                    onClick={() => onMessageStudent(reg)}
                                    className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-md cursor-pointer"
                                  >
                                    SMS / Email
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openRegEditor(reg)}
                                  className="px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-md cursor-pointer"
                                >
                                  Update
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CREATE / EDIT COURSE                                           */}
      {/* ===================================================================== */}
      {courseModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveCourse}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-slate-900">
                {editingCourse ? `Edit Course: ${editingCourse.title}` : 'Add Training Course'}
              </h3>
              <button
                type="button"
                onClick={() => setCourseModalOpen(false)}
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Course Title *</label>
                  <input
                    required
                    type="text"
                    value={courseForm.title}
                    onChange={(e) => setCourseForm((f) => ({ ...f, title: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={courseForm.category}
                    onChange={(e) => setCourseForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Course Description</label>
                <textarea
                  rows={2}
                  value={courseForm.description}
                  onChange={(e) => setCourseForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Learning Objectives (one per line)
                </label>
                <textarea
                  rows={3}
                  value={courseForm.learningObjectivesText}
                  onChange={(e) =>
                    setCourseForm((f) => ({ ...f, learningObjectivesText: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Administrator-Approved Fee (leave blank if unpublished)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 12,000 ETB or $250"
                    value={courseForm.approvedFee}
                    onChange={(e) => setCourseForm((f) => ({ ...f, approvedFee: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Course Duration (leave blank if unconfigured)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 12 Weeks"
                    value={courseForm.duration}
                    onChange={(e) => setCourseForm((f) => ({ ...f, duration: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1.5">
                  Training Delivery Methods
                </label>
                <div className="flex flex-wrap gap-4">
                  {DELIVERY_OPTIONS.map((opt) => {
                    const checked = courseForm.deliveryMethods.includes(opt);
                    return (
                      <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCourseForm((f) => ({
                              ...f,
                              deliveryMethods: checked
                                ? f.deliveryMethods.filter((m) => m !== opt)
                                : [...f.deliveryMethods, opt],
                            }))
                          }
                          className="rounded border-slate-300 text-blue-700"
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Available Schedules
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Mon-Fri Morning / Evening, Sat-Sun"
                    value={courseForm.schedules}
                    onChange={(e) => setCourseForm((f) => ({ ...f, schedules: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Available Training Batches
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Batch 14 — Starts Next Month"
                    value={courseForm.availableBatches}
                    onChange={(e) =>
                      setCourseForm((f) => ({ ...f, availableBatches: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Required Qualifications
                  </label>
                  <input
                    type="text"
                    value={courseForm.qualifications}
                    onChange={(e) =>
                      setCourseForm((f) => ({ ...f, qualifications: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Certificate Info (when configured)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Verified Certificate of Completion"
                    value={courseForm.certificateInfo}
                    onChange={(e) =>
                      setCourseForm((f) => ({ ...f, certificateInfo: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Registration Procedure
                </label>
                <textarea
                  rows={2}
                  value={courseForm.registrationProcedure}
                  onChange={(e) =>
                    setCourseForm((f) => ({ ...f, registrationProcedure: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={courseForm.isActive}
                  onChange={(e) => setCourseForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded border-slate-300 text-blue-700"
                />
                <span>Active (visible to ZACMA AI ASSISTANT and public visitors)</span>
              </label>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setCourseModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCourse}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                {savingCourse ? 'Saving…' : 'Save Course'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CREATE / EDIT FAQ                                              */}
      {/* ===================================================================== */}
      {faqModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveFaq}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-slate-900">
                {editingFaq ? 'Edit Knowledge Entry' : 'Add Knowledge / FAQ Entry'}
              </h3>
              <button
                type="button"
                onClick={() => setFaqModalOpen(false)}
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={faqForm.category}
                    onChange={(e) =>
                      setFaqForm((f) => ({
                        ...f,
                        category: e.target.value as SupportKnowledgeCategory,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {KNOWLEDGE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Language</label>
                  <select
                    value={faqForm.language}
                    onChange={(e) =>
                      setFaqForm((f) => ({
                        ...f,
                        language: e.target.value as 'en' | 'am' | 'both',
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="both">Both (English & Amharic)</option>
                    <option value="en">English</option>
                    <option value="am">Amharic (አማርኛ)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Question *</label>
                <input
                  required
                  type="text"
                  value={faqForm.question}
                  onChange={(e) => setFaqForm((f) => ({ ...f, question: e.target.value }))}
                  placeholder="e.g., What payment methods does Zacma Technology Training Institute accept?"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Administrator-Approved Answer *
                </label>
                <textarea
                  required
                  rows={4}
                  value={faqForm.answer}
                  onChange={(e) => setFaqForm((f) => ({ ...f, answer: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={faqForm.isActive}
                  onChange={(e) => setFaqForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded border-slate-300 text-blue-700"
                />
                <span>Active (used by ZACMA AI ASSISTANT)</span>
              </label>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setFaqModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingFaq}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                {savingFaq ? 'Saving…' : 'Save FAQ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CONVERT UNANSWERED QUESTION TO FAQ                             */}
      {/* ===================================================================== */}
      {convertingQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-slate-900">
                Convert Unanswered Question to FAQ
              </h3>
              <button
                type="button"
                onClick={() => setConvertingQuestion(null)}
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-[11px] font-semibold text-slate-500">Visitor Question</div>
                <div className="font-semibold text-slate-900 mt-1">
                  {convertingQuestion.question}
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={quickFaqCategory}
                  onChange={(e) =>
                    setQuickFaqCategory(e.target.value as SupportKnowledgeCategory)
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  {KNOWLEDGE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Official Answer *
                </label>
                <textarea
                  rows={4}
                  value={quickFaqAnswer}
                  onChange={(e) => setQuickFaqAnswer(e.target.value)}
                  placeholder="Provide the administrator-approved answer…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setConvertingQuestion(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingFaq || !quickFaqAnswer.trim()}
                onClick={() => void handleConvertUnansweredToFaq()}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                {savingFaq ? 'Publishing…' : 'Publish FAQ & Clear Flag'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: UPDATE STUDENT REGISTRATION RECORD                             */}
      {/* ===================================================================== */}
      {editingReg && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveRegEdit}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900">
                  Update Student Registration
                </h3>
                <div className="text-xs text-slate-500">
                  {editingReg.fullName} • {editingReg.preferredCourse} ({editingReg.leadRef})
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingReg(null)}
                className="text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Registration</label>
                  <select
                    value={regEditForm.registrationStatus}
                    onChange={(e) =>
                      setRegEditForm((f) => ({
                        ...f,
                        registrationStatus: e.target
                          .value as StudentRegistration['registrationStatus'],
                      }))
                    }
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="submitted">Submitted</option>
                    <option value="under_review">Under Review</option>
                    <option value="approved">Approved</option>
                    <option value="enrolled">Enrolled</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment</label>
                  <select
                    value={regEditForm.paymentStatus}
                    onChange={(e) =>
                      setRegEditForm((f) => ({
                        ...f,
                        paymentStatus: e.target.value as StudentRegistration['paymentStatus'],
                      }))
                    }
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="pending">Pending</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Certificate</label>
                  <select
                    value={regEditForm.certificateStatus}
                    onChange={(e) =>
                      setRegEditForm((f) => ({
                        ...f,
                        certificateStatus: e.target
                          .value as StudentRegistration['certificateStatus'],
                      }))
                    }
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="not_issued">Not Issued</option>
                    <option value="in_progress">In Progress</option>
                    <option value="issued">Issued</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assigned Batch</label>
                <input
                  type="text"
                  value={regEditForm.batchName}
                  onChange={(e) => setRegEditForm((f) => ({ ...f, batchName: e.target.value }))}
                  placeholder="e.g., AI Cohort 2026-Q2"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Class Schedule</label>
                <input
                  type="text"
                  value={regEditForm.classSchedule}
                  onChange={(e) =>
                    setRegEditForm((f) => ({ ...f, classSchedule: e.target.value }))
                  }
                  placeholder="e.g., Tue/Thu 6:00 PM – 8:30 PM"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Training Location / Room
                </label>
                <input
                  type="text"
                  value={regEditForm.trainingLocation}
                  onChange={(e) =>
                    setRegEditForm((f) => ({ ...f, trainingLocation: e.target.value }))
                  }
                  placeholder="e.g., Main Campus Lab 3 / Zoom Live"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setEditingReg(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingReg}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-60 cursor-pointer"
              >
                {savingReg ? 'Saving…' : 'Save Registration'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
