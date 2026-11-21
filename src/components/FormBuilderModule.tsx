import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Plus,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  Eye,
  QrCode,
  Globe,
  ExternalLink,
  Check,
  Loader2,
  Save,
  Smartphone,
  Monitor,
  GripVertical,
  X,
  FileSpreadsheet,
  SlidersHorizontal,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { auth } from '../lib/firebase';
import { usePortal } from '../context/PortalContext';
import {
  canManageForms,
  deleteDynamicForm,
  formatTimestamp,
  saveDynamicForm,
  slugify,
} from '../lib/zacmaService';
import { PublicFormView } from './PublicFormView';
import type {
  DynamicForm,
  FormField,
  FormFieldType,
  FormSubmission,
  NavSection,
} from '../types';

interface Props {
  activeSection: NavSection;
  initialBusinessUnitId?: string;
  initialAiPrompt?: string;
  onNavigate: (section: NavSection) => void;
}

const FIELD_TYPES: Array<{ value: FormFieldType; label: string }> = [
  { value: 'short_text', label: 'Short Text' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone Number' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'multi_select', label: 'Multiple Selection' },
  { value: 'radio', label: 'Radio Buttons' },
  { value: 'checkboxes', label: 'Checkboxes' },
  { value: 'file_upload', label: 'File Upload' },
  { value: 'image_upload', label: 'Image Upload' },
  { value: 'address', label: 'Address' },
  { value: 'url', label: 'URL' },
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'section_heading', label: 'Section Heading' },
  { value: 'conditional', label: 'Conditional Field' },
];

export function FormBuilderModule({
  activeSection,
  initialBusinessUnitId,
  initialAiPrompt,
  onNavigate,
}: Props) {
  const { user, organization, effectiveRole, businessUnits, forms, submissions } = usePortal();
  const canEdit = canManageForms(effectiveRole);

  // Selected business unit and active form being built/edited
  const [selectedBuId, setSelectedBuId] = useState(
    initialBusinessUnitId || businessUnits[0]?.id || ''
  );
  const [editingForm, setEditingForm] = useState<DynamicForm | null>(null);
  const [aiPrompt, setAiPrompt] = useState(initialAiPrompt || '');
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Form editor state
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState(
    'Thank you for your submission. Our team will contact you shortly.'
  );
  const [submissionLimit, setSubmissionLimit] = useState(0);
  const [brandColor, setBrandColor] = useState('#1D4ED8');
  const [isPublished, setIsPublished] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [fields, setFields] = useState<FormField[]>([]);
  const [selectedFieldIdx, setSelectedFieldIdx] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // Preview, QR, Submissions inspection
  const [previewMode, setPreviewMode] = useState<'off' | 'desktop' | 'mobile'>('off');
  const [qrForm, setQrForm] = useState<DynamicForm | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<FormSubmission | null>(null);
  const [subFilterBu, setSubFilterBu] = useState('all');

  useEffect(() => {
    if (initialBusinessUnitId) setSelectedBuId(initialBusinessUnitId);
    else if (!selectedBuId && businessUnits[0]) setSelectedBuId(businessUnits[0].id);
  }, [initialBusinessUnitId, businessUnits, selectedBuId]);

  useEffect(() => {
    if (initialAiPrompt) setAiPrompt(initialAiPrompt);
  }, [initialAiPrompt]);

  const selectedBu = useMemo(
    () => businessUnits.find((b) => b.id === selectedBuId) || businessUnits[0] || null,
    [businessUnits, selectedBuId]
  );

  const loadFormIntoEditor = (form: DynamicForm) => {
    setEditingForm(form);
    setSelectedBuId(form.businessUnitId);
    setTitle(form.title);
    setSlug(form.slug);
    setDescription(form.description);
    setConfirmationMessage(form.confirmationMessage);
    setSubmissionLimit(form.submissionLimit || 0);
    setBrandColor(form.brandColor || '#1D4ED8');
    setIsPublished(form.isPublished);
    setIsActive(form.isActive);
    setFields(form.fields || []);
    setAiPrompt(form.aiPrompt || '');
    setSelectedFieldIdx(form.fields?.length ? 0 : null);
    setSaveFeedback(null);
    onNavigate('form_builder');
  };

  const startBlankForm = () => {
    setEditingForm(null);
    setTitle('New Registration Form');
    setSlug('new-registration-form');
    setDescription('');
    setConfirmationMessage('Thank you for your submission. Our team will contact you shortly.');
    setSubmissionLimit(0);
    setBrandColor(selectedBu?.brandColor || '#1D4ED8');
    setIsPublished(false);
    setIsActive(true);
    setFields([
      {
        id: 'full_name',
        type: 'short_text',
        label: 'Full Name',
        placeholder: 'Enter your full name',
        required: true,
        section: 'Contact Information',
      },
      {
        id: 'email_address',
        type: 'email',
        label: 'Email Address',
        placeholder: 'you@example.com',
        required: true,
        section: 'Contact Information',
      },
      {
        id: 'phone_number',
        type: 'phone',
        label: 'Phone Number',
        placeholder: '+1 (555) 000-0000',
        required: true,
        section: 'Contact Information',
      },
    ]);
    setSelectedFieldIdx(0);
    setSaveFeedback(null);
    onNavigate('form_builder');
  };

  const handleGenerateWithAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBu) {
      setAiError('Please create and select a Business Unit first.');
      return;
    }
    if (aiPrompt.trim().length < 10) {
      setAiError('Describe the form you need in at least 10 characters.');
      return;
    }

    setGenerating(true);
    setAiError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const resp = await fetch('/api/ai/generate-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: aiPrompt,
          businessUnitName: selectedBu.name,
          businessUnitCategory: selectedBu.category,
          services: selectedBu.services,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'AI generation failed.');
      }

      setEditingForm(null);
      setTitle(data.title);
      setSlug(data.slug || slugify(data.title));
      setDescription(data.description || '');
      setConfirmationMessage(data.confirmationMessage || 'Thank you for your submission.');
      setBrandColor(selectedBu.brandColor || '#1D4ED8');
      setFields(data.fields || []);
      setIsPublished(false);
      setIsActive(true);
      setSelectedFieldIdx(data.fields?.length ? 0 : null);
      setSaveFeedback('AI generated a validated form schema. Review fields below, then Save or Publish.');
      onNavigate('form_builder');
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate form.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveForm = async (publishNow?: boolean) => {
    if (!organization || !user || !selectedBu) return;
    if (!title.trim() || fields.length === 0) {
      setSaveFeedback('Form title and at least one field are required.');
      return;
    }

    const nextPublished = publishNow !== undefined ? publishNow : isPublished;
    setSaving(true);
    setSaveFeedback(null);
    try {
      const result = await saveDynamicForm({
        organizationId: organization.id,
        businessUnit: selectedBu,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        existing: editingForm,
        form: {
          title,
          slug: slug || slugify(title),
          description,
          fields,
          isPublished: nextPublished,
          isActive,
          submissionLimit,
          confirmationMessage,
          brandColor,
          logoUrl: selectedBu.logoUrl || '',
          aiPrompt,
        },
        actorId: user.uid,
        actorName: user.displayName || user.email || 'Admin',
      });
      setIsPublished(nextPublished);
      setSaveFeedback(
        nextPublished
          ? `Published! Public URL: /forms/${selectedBu.slug}/${slug || slugify(title)}`
          : `Form saved (${result.id}).`
      );
    } catch (err: unknown) {
      setSaveFeedback(err instanceof Error ? err.message : 'Failed to save form.');
    } finally {
      setSaving(false);
    }
  };

  const addField = (type: FormFieldType = 'short_text') => {
    const label = FIELD_TYPES.find((t) => t.value === type)?.label || 'New Field';
    const newField: FormField = {
      id: `field_${Date.now().toString(36)}`,
      type,
      label,
      placeholder: '',
      helperText: '',
      required: type !== 'section_heading',
      section: 'General Information',
      options: ['dropdown', 'multi_select', 'radio', 'checkboxes'].includes(type)
        ? ['Option 1', 'Option 2', 'Option 3']
        : [],
    };
    setFields((prev) => {
      const next = [...prev, newField];
      setSelectedFieldIdx(next.length - 1);
      return next;
    });
  };

  const duplicateField = (idx: number) => {
    const src = fields[idx];
    const copy: FormField = {
      ...src,
      id: `${src.id}_copy_${Date.now().toString(36).slice(-3)}`,
      label: `${src.label} (Copy)`,
      options: src.options ? [...src.options] : [],
    };
    setFields((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setSelectedFieldIdx(idx + 1);
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
    setSelectedFieldIdx(null);
  };

  const moveField = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return;
    setFields((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setSelectedFieldIdx(to);
  };

  const updateSelectedField = (patch: Partial<FormField>) => {
    if (selectedFieldIdx === null) return;
    setFields((prev) =>
      prev.map((f, i) => (i === selectedFieldIdx ? { ...f, ...patch } : f))
    );
  };

  const getPublicUrl = (form: DynamicForm) => {
    return `${window.location.origin}/forms/${form.businessUnitSlug}/${form.slug}`;
  };

  const copyPublicUrl = (form: DynamicForm) => {
    navigator.clipboard.writeText(getPublicUrl(form));
    setCopiedId(form.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleFormActive = async (form: DynamicForm) => {
    if (!organization || !user) return;
    const bu = businessUnits.find((b) => b.id === form.businessUnitId);
    if (!bu) return;
    await saveDynamicForm({
      organizationId: organization.id,
      businessUnit: bu,
      ownerId: organization.ownerId,
      authorizedUserIds: organization.authorizedUserIds,
      existing: form,
      form: {
        title: form.title,
        slug: form.slug,
        description: form.description,
        fields: form.fields,
        isPublished: form.isPublished,
        isActive: !form.isActive,
        submissionLimit: form.submissionLimit,
        confirmationMessage: form.confirmationMessage,
        brandColor: form.brandColor,
        logoUrl: form.logoUrl,
        aiPrompt: form.aiPrompt,
      },
      actorId: user.uid,
      actorName: user.displayName || user.email || 'Admin',
    });
  };

  const submissionCountsByForm = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      map.set(s.formId, (map.get(s.formId) || 0) + 1);
    }
    return map;
  }, [submissions]);

  // ===========================================================================
  // VIEW 1: AI FORM GENERATOR
  // ===========================================================================
  if (activeSection === 'ai_form_generator') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">
              AI Form Generator
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Describe any registration, inquiry, booking, or application form in plain language.
              Gemini AI builds a validated JSON schema ready to edit and publish.
            </p>
          </div>
          <button
            type="button"
            onClick={startBlankForm}
            disabled={businessUnits.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg disabled:opacity-50 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Start Blank Form
          </button>
        </div>

        {businessUnits.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <p className="text-sm text-slate-600 mb-4">
              Create at least one Business Unit before generating forms.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('business_units')}
              className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              Go to Business Units
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
            <form onSubmit={handleGenerateWithAi} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Target Business Unit *
                  </label>
                  <select
                    value={selectedBuId}
                    onChange={(e) => setSelectedBuId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {businessUnits.map((bu) => (
                      <option key={bu.id} value={bu.id}>
                        {bu.name} ({bu.category})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end text-xs text-slate-500 pb-2">
                  Supports all 18 enterprise field types, logical sections, validation rules, and conditional logic.
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Natural Language Form Instructions *
                </label>
                <textarea
                  rows={5}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Example: Generate a professional student registration form for an English language training institute. Include full name, phone number, email, gender, educational background, preferred course, study schedule, registration date, profile photo, and a conditional scholarship details field if they select Yes for financial aid."
                  className="w-full px-4 py-3 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              {/* Prompt Starters */}
              <div className="flex flex-wrap gap-2">
                {[
                  'Student registration form with full name, phone, email, preferred course, study schedule, profile photo, and conditional scholarship question',
                  'Visa & immigration eligibility assessment form with passport nationality, destination country, visa type, travel date, CV file upload, and consultation preference',
                  'Digital marketing project inquiry form with company name, website URL, monthly budget range, target channels checkboxes, and launch timeline',
                ].map((sample, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAiPrompt(sample)}
                    className="text-left text-xs px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-800 text-slate-700 rounded-lg transition-colors cursor-pointer"
                  >
                    Use sample #{i + 1}
                  </button>
                ))}
              </div>

              {aiError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {aiError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={generating || !canEdit}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating Structured Form…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate Form with Gemini AI
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Existing Forms Quick Access */}
        {forms.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="font-display text-base font-bold text-slate-900 mb-4">
              Recent Forms ({forms.length})
            </h2>
            <div className="divide-y divide-slate-100">
              {forms.slice(0, 6).map((f) => (
                <div key={f.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{f.title}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>{f.businessUnitName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{f.fields.length} fields</span>
                      <span aria-hidden="true">·</span>
                      <span className={f.isPublished ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                        {f.isPublished ? 'Published' : 'Draft'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => loadFormIntoEditor(f)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded-lg cursor-pointer"
                  >
                    Open in Builder
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // VIEW 2: VISUAL FORM BUILDER (DRAG-AND-DROP + VALIDATION + PREVIEW)
  // ===========================================================================
  if (activeSection === 'form_builder') {
    if (previewMode !== 'off' && selectedBu) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">
              Live Form Preview ({previewMode === 'mobile' ? 'Mobile 390px' : 'Desktop'})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreviewMode('desktop')}
                className={`p-2 rounded-lg cursor-pointer ${previewMode === 'desktop' ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('mobile')}
                className={`p-2 rounded-lg cursor-pointer ${previewMode === 'mobile' ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}
              >
                <Smartphone className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('off')}
                className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
              >
                Exit Preview
              </button>
            </div>
          </div>
          <div className={previewMode === 'mobile' ? 'max-w-[400px] mx-auto border-4 border-slate-800 rounded-3xl overflow-hidden shadow-lg' : ''}>
            <PublicFormView
              businessUnitSlug={selectedBu.slug}
              formSlug={slug || slugify(title || 'preview')}
              previewForm={{
                publicSlugKey: `${selectedBu.slug}__${slug || 'preview'}`,
                organizationId: organization?.id || '',
                businessUnitId: selectedBu.id,
                businessUnitSlug: selectedBu.slug,
                businessUnitName: selectedBu.name,
                formId: editingForm?.id || 'preview',
                formSlug: slug || 'preview',
                title: title || 'Untitled Form',
                description,
                fields,
                isPublished: true,
                isActive: true,
                submissionLimit,
                confirmationMessage,
                brandColor,
                logoUrl: selectedBu.logoUrl || '',
                orgOwnerId: organization?.ownerId || '',
                updatedAt: new Date().toISOString(),
              }}
              onExitPreview={() => setPreviewMode('off')}
            />
          </div>
        </div>
      );
    }

    const activeField = selectedFieldIdx !== null ? fields[selectedFieldIdx] : null;

    return (
      <div className="space-y-5">
        {/* Builder Top Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedBuId}
              onChange={(e) => setSelectedBuId(e.target.value)}
              className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
            >
              {businessUnits.map((bu) => (
                <option key={bu.id} value={bu.id}>
                  {bu.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onNavigate('ai_form_generator')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI Generate
            </button>
            <button
              type="button"
              onClick={startBlankForm}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Blank
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPreviewMode('desktop')}
              disabled={fields.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg disabled:opacity-50 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              type="button"
              disabled={saving || !canEdit || !selectedBu}
              onClick={() => handleSaveForm(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Save Draft
            </button>
            <button
              type="button"
              disabled={saving || !canEdit || !selectedBu}
              onClick={() => handleSaveForm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg disabled:opacity-50 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Publish Live Form'}
            </button>
          </div>
        </div>

        {saveFeedback && (
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center justify-between gap-3">
            <span>{saveFeedback}</span>
            <button
              type="button"
              onClick={() => onNavigate('published_forms')}
              className="font-semibold underline whitespace-nowrap cursor-pointer"
            >
              View Published Forms
            </button>
          </div>
        )}

        {/* 3-Column Builder Workspace */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Left: Form Metadata & Add Field Palette */}
          <div className="xl:col-span-3 bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <h3 className="font-display text-sm font-bold text-slate-900">Form Settings</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Form Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!editingForm) setSlug(slugify(e.target.value));
                }}
                placeholder="Form title"
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Public URL Slug</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Brand Color</label>
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="w-full h-8 p-0.5 border border-slate-300 rounded-lg cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Max Submissions</label>
                <input
                  type="number"
                  min={0}
                  value={submissionLimit}
                  onChange={(e) => setSubmissionLimit(Number(e.target.value) || 0)}
                  title="0 means unlimited"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Confirmation Message
              </label>
              <textarea
                rows={2}
                value={confirmationMessage}
                onChange={(e) => setConfirmationMessage(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div className="pt-3 border-t border-slate-200">
              <h4 className="text-xs font-semibold text-slate-700 mb-2">Add Field Type</h4>
              <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
                {FIELD_TYPES.map((ft) => (
                  <button
                    key={ft.value}
                    type="button"
                    onClick={() => addField(ft.value)}
                    className="text-left px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 hover:bg-blue-50 hover:text-blue-800 border border-slate-200 rounded-lg transition-colors truncate cursor-pointer"
                  >
                    + {ft.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Center: Drag-and-Drop Field Canvas */}
          <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-sm font-bold text-slate-900">
                Form Structure ({fields.length} fields)
              </h3>
              <span className="text-xs text-slate-400">Drag or use arrows to reorder</span>
            </div>

            {fields.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-slate-200 rounded-lg">
                <p className="text-sm text-slate-500 mb-3">
                  No fields yet. Use Gemini AI Generator or click any field type on the left.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('ai_form_generator')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-blue-700 text-white rounded-lg cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Generate with AI
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {fields.map((field, idx) => (
                  <div
                    key={field.id}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== idx) {
                        moveField(dragIndex, idx);
                      }
                      setDragIndex(null);
                    }}
                    onClick={() => setSelectedFieldIdx(idx)}
                    className={`p-3.5 rounded-lg border transition-colors cursor-pointer ${
                      selectedFieldIdx === idx
                        ? 'border-blue-600 bg-blue-50/40'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical className="w-4 h-4 text-slate-400 shrink-0 cursor-grab" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {field.label}
                            {field.required && <span className="text-red-600 ml-1">*</span>}
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                            <span className="font-mono">{field.type}</span>
                            {field.conditionalOnFieldId && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-blue-700">
                                  if {field.conditionalOnFieldId} = {field.conditionalEqualsValue}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveField(idx, idx - 1);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer"
                          title="Move up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveField(idx, idx + 1);
                          }}
                          className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer"
                          title="Move down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateField(idx);
                          }}
                          className="p-1 text-slate-400 hover:text-blue-700 cursor-pointer"
                          title="Duplicate field"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeField(idx);
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                          title="Delete field"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Field Properties & Conditional Logic Inspector */}
          <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <SlidersHorizontal className="w-4 h-4 text-blue-700" />
              <h3 className="font-display text-sm font-bold text-slate-900">Field Inspector</h3>
            </div>
            {!activeField ? (
              <p className="text-xs text-slate-500">
                Select any field in the center canvas to configure its label, type, validation,
                options, and conditional logic.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Field Label</label>
                  <input
                    type="text"
                    value={activeField.label}
                    onChange={(e) => updateSelectedField({ label: e.target.value })}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Field Type</label>
                    <select
                      value={activeField.type}
                      onChange={(e) =>
                        updateSelectedField({ type: e.target.value as FormFieldType })
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      {FIELD_TYPES.map((ft) => (
                        <option key={ft.value} value={ft.value}>
                          {ft.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Field ID</label>
                    <input
                      type="text"
                      value={activeField.id}
                      onChange={(e) =>
                        updateSelectedField({
                          id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Placeholder</label>
                    <input
                      type="text"
                      value={activeField.placeholder || ''}
                      onChange={(e) => updateSelectedField({ placeholder: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Helper Text</label>
                    <input
                      type="text"
                      value={activeField.helperText || ''}
                      onChange={(e) => updateSelectedField({ helperText: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                {activeField.type !== 'section_heading' && (
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={activeField.required}
                      onChange={(e) => updateSelectedField({ required: e.target.checked })}
                      className="rounded border-slate-300 text-blue-700"
                    />
                    Required field
                  </label>
                )}

                {['dropdown', 'multi_select', 'radio', 'checkboxes'].includes(activeField.type) && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Options (one per line)
                    </label>
                    <textarea
                      rows={4}
                      value={(activeField.options || []).join('\n')}
                      onChange={(e) =>
                        updateSelectedField({
                          options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                        })
                      }
                      className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                )}

                {/* Conditional Logic */}
                <div className="pt-3 border-t border-slate-200 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-800">Conditional Visibility</div>
                  <select
                    value={activeField.conditionalOnFieldId || ''}
                    onChange={(e) =>
                      updateSelectedField({ conditionalOnFieldId: e.target.value || undefined })
                    }
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Always visible</option>
                    {fields
                      .filter((f) => f.id !== activeField.id && f.type !== 'section_heading')
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          Show only when "{f.label}" equals…
                        </option>
                      ))}
                  </select>
                  {activeField.conditionalOnFieldId && (
                    <input
                      type="text"
                      value={activeField.conditionalEqualsValue || ''}
                      onChange={(e) =>
                        updateSelectedField({ conditionalEqualsValue: e.target.value })
                      }
                      placeholder="Trigger value (e.g., Yes)"
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // VIEW 3: PUBLISHED FORMS (PUBLIC URLS + QR CODE + ACTIVATE/DEACTIVATE)
  // ===========================================================================
  if (activeSection === 'published_forms') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Published Forms</h1>
            <p className="text-sm text-slate-600 mt-1">
              Share public registration URLs, download QR codes, toggle availability, and inspect
              live submissions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('ai_form_generator')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium rounded-lg cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            Generate New Form
          </button>
        </div>

        {forms.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <p className="text-sm text-slate-600 mb-4">
              No forms created yet. Use the AI Form Generator to build and publish your first form.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('ai_form_generator')}
              className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              Open AI Form Generator
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Form &amp; Business Unit</th>
                    <th className="py-3 px-4">Public Route</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Submissions</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {forms.map((form) => {
                    const subCount = submissionCountsByForm.get(form.id) || 0;
                    const publicUrl = getPublicUrl(form);
                    return (
                      <tr key={form.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{form.title}</div>
                          <div className="text-xs text-slate-500">
                            {form.businessUnitName} · {form.fields.length} fields
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {form.isPublished ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-slate-600 truncate max-w-[220px]">
                                /forms/{form.businessUnitSlug}/{form.slug}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyPublicUrl(form)}
                                className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                              >
                                {copiedId === form.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" /> Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" /> Copy
                                  </>
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Draft (Not Published)</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <span
                            className={
                              form.isPublished && form.isActive
                                ? 'text-emerald-700 font-medium'
                                : 'text-amber-700 font-medium'
                            }
                          >
                            {!form.isPublished ? 'Draft' : form.isActive ? 'Live & Accepting' : 'Paused'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-semibold">
                          {subCount}
                          {form.submissionLimit > 0 && (
                            <span className="text-slate-400 font-normal"> / {form.submissionLimit}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            {form.isPublished && (
                              <>
                                <a
                                  href={publicUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 text-slate-500 hover:text-blue-700 rounded-lg"
                                  title="Open public form in new tab"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                                <button
                                  type="button"
                                  onClick={() => setQrForm(form)}
                                  className="p-1.5 text-slate-500 hover:text-blue-700 rounded-lg cursor-pointer"
                                  title="Show QR code"
                                >
                                  <QrCode className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => toggleFormActive(form)}
                                  className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 cursor-pointer"
                                >
                                  {form.isActive ? 'Pause' : 'Activate'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => loadFormIntoEditor(form)}
                                  className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    organization &&
                                    user &&
                                    deleteDynamicForm({
                                      organizationId: organization.id,
                                      form,
                                      ownerId: organization.ownerId,
                                      authorizedUserIds: organization.authorizedUserIds,
                                      actorId: user.uid,
                                      actorName: user.displayName || user.email || 'Admin',
                                    })
                                  }
                                  className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                                  title="Delete form"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* QR Code Share Modal */}
        {qrForm && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-sm w-full p-6 text-center shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Public Form QR Code
                </h3>
                <button
                  type="button"
                  onClick={() => setQrForm(null)}
                  className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="inline-block p-4 bg-white border border-slate-200 rounded-xl mb-4">
                <QRCodeSVG value={getPublicUrl(qrForm)} size={200} level="M" />
              </div>
              <div className="text-sm font-semibold text-slate-900 mb-1">{qrForm.title}</div>
              <div className="text-xs text-slate-500 font-mono break-all mb-5">
                {getPublicUrl(qrForm)}
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => copyPublicUrl(qrForm)}
                  className="px-4 py-2 text-xs font-medium bg-blue-700 text-white rounded-lg cursor-pointer"
                >
                  {copiedId === qrForm.id ? 'Link Copied' : 'Copy Public URL'}
                </button>
                <a
                  href={getPublicUrl(qrForm)}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 text-xs font-medium border border-slate-300 text-slate-700 rounded-lg"
                >
                  Open Form
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // VIEW 4: FORM SUBMISSIONS
  // ===========================================================================
  if (activeSection === 'form_submissions') {
    const filteredSubs =
      subFilterBu === 'all'
        ? submissions
        : submissions.filter((s) => s.businessUnitId === subFilterBu);

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Form Submissions</h1>
            <p className="text-sm text-slate-600 mt-1">
              Every verified submission automatically creates a linked lead record in the CRM.
            </p>
          </div>
          <select
            value={subFilterBu}
            onChange={(e) => setSubFilterBu(e.target.value)}
            className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white"
          >
            <option value="all">All Business Units</option>
            {businessUnits.map((bu) => (
              <option key={bu.id} value={bu.id}>
                {bu.name}
              </option>
            ))}
          </select>
        </div>

        {filteredSubs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600">
              No form submissions recorded yet. Publish a form and share its public URL to start
              capturing responses.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">Lead Ref</th>
                    <th className="py-3 px-4">Visitor</th>
                    <th className="py-3 px-4">Form &amp; Business Unit</th>
                    <th className="py-3 px-4">Submitted</th>
                    <th className="py-3 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredSubs.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-blue-700">
                        {sub.leadRef}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{sub.submitterName}</div>
                        <div className="text-xs text-slate-500">
                          {sub.submitterEmail || '—'} · {sub.submitterPhone || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-900">{sub.formTitle}</div>
                        <div className="text-xs text-slate-500">{sub.businessUnitName}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 font-mono tabular-nums">
                        {formatTimestamp(sub.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedSubmission(sub)}
                          className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                        >
                          Inspect Answers
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedSubmission && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full max-h-[85vh] overflow-y-auto p-6 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    {selectedSubmission.formTitle}
                  </h3>
                  <div className="text-xs text-slate-500 font-mono">
                    {selectedSubmission.leadRef} · {formatTimestamp(selectedSubmission.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSubmission(null)}
                  className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                {Object.entries(selectedSubmission.responses || {}).map(([k, v]) => (
                  <div key={k} className="pb-2.5 border-b border-slate-100">
                    <div className="text-xs font-semibold text-slate-500">{k}</div>
                    <div className="text-sm text-slate-900 mt-0.5 break-words">
                      {Array.isArray(v) ? v.join(', ') : String(v ?? '—')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // VIEW 5: FORM ANALYTICS
  // ===========================================================================
  const chartData = forms.map((f) => ({
    name: f.title.length > 22 ? `${f.title.slice(0, 22)}…` : f.title,
    submissions: submissionCountsByForm.get(f.id) || 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Form Analytics</h1>
        <p className="text-sm text-slate-600 mt-1">
          Submission volume and engagement across published business-unit forms.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Total Forms</div>
          <div className="text-2xl font-display font-bold font-mono tabular-nums text-slate-900 mt-1">
            {forms.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Live Published Forms</div>
          <div className="text-2xl font-display font-bold font-mono tabular-nums text-blue-700 mt-1">
            {forms.filter((f) => f.isPublished && f.isActive).length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Total Verified Submissions</div>
          <div className="text-2xl font-display font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {submissions.length}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="font-display text-base font-bold text-slate-900 mb-4">
          Submissions by Form
        </h2>
        {chartData.length === 0 ? (
          <p className="text-sm text-slate-500 py-10 text-center">
            No form analytics available yet.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="submissions" fill="#1D4ED8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
