import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Upload,
  ArrowLeft,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { fetchPublicFormBySlug, submitPublicForm } from '../lib/zacmaService';
import type { FormField, PublicFormProjection } from '../types';

interface Props {
  businessUnitSlug: string;
  formSlug: string;
  previewForm?: PublicFormProjection | null;
  onExitPreview?: () => void;
}

export function PublicFormView({
  businessUnitSlug,
  formSlug,
  previewForm = null,
  onExitPreview,
}: Props) {
  const [formDoc, setFormDoc] = useState<PublicFormProjection | null>(previewForm);
  const [loading, setLoading] = useState(!previewForm);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [websiteTrap, setWebsiteTrap] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ leadRef: string; message: string } | null>(null);

  useEffect(() => {
    if (previewForm) {
      setFormDoc(previewForm);
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    fetchPublicFormBySlug(businessUnitSlug, formSlug)
      .then((docData) => {
        if (mounted) {
          setFormDoc(docData);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setFormDoc(null);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [businessUnitSlug, formSlug, previewForm]);

  const isFieldVisible = (field: FormField): boolean => {
    if (!field.conditionalOnFieldId) return true;
    const targetVal = values[field.conditionalOnFieldId];
    if (Array.isArray(targetVal)) {
      return targetVal.includes(field.conditionalEqualsValue || '');
    }
    return String(targetVal ?? '').toLowerCase() === String(field.conditionalEqualsValue ?? '').toLowerCase();
  };

  const setFieldValue = (fieldId: string, val: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: val }));
    setErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const copy = { ...prev };
      delete copy[fieldId];
      return copy;
    });
  };

  const handleFileChange = (fieldId: string, file: File | null, isImage: boolean) => {
    if (!file) return;
    if (isImage && !file.type.startsWith('image/')) {
      setErrors((prev) => ({ ...prev, [fieldId]: 'Please select a valid image file.' }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, [fieldId]: 'File size must not exceed 5 MB.' }));
      return;
    }
    setFieldValue(fieldId, `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`);
  };

  const validateForm = (): boolean => {
    if (!formDoc) return false;
    const nextErrors: Record<string, string> = {};

    for (const field of formDoc.fields) {
      if (field.type === 'section_heading' || !isFieldVisible(field)) continue;
      const raw = values[field.id];
      const strVal = typeof raw === 'string' ? raw.trim() : '';
      const arrVal = Array.isArray(raw) ? raw : [];

      if (field.required) {
        if (field.type === 'checkboxes' || field.type === 'multi_select') {
          if (arrVal.length === 0) nextErrors[field.id] = `${field.label} requires at least one selection.`;
        } else if (!strVal) {
          nextErrors[field.id] = `${field.label} is required.`;
        }
      }

      if (strVal) {
        if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
          nextErrors[field.id] = 'Please enter a valid email address.';
        }
        if (field.type === 'url' && !/^https?:\/\/.+/i.test(strVal)) {
          nextErrors[field.id] = 'Please enter a valid URL starting with http:// or https://.';
        }
        if (field.validation?.minLength && strVal.length < field.validation.minLength) {
          nextErrors[field.id] = `Minimum ${field.validation.minLength} characters required.`;
        }
        if (field.validation?.maxLength && strVal.length > field.validation.maxLength) {
          nextErrors[field.id] = `Maximum ${field.validation.maxLength} characters allowed.`;
        }
        if (field.type === 'number') {
          const num = Number(strVal);
          if (Number.isNaN(num)) {
            nextErrors[field.id] = 'Please enter a valid number.';
          } else {
            if (field.validation?.min !== undefined && num < field.validation.min) {
              nextErrors[field.id] = `Value must be at least ${field.validation.min}.`;
            }
            if (field.validation?.max !== undefined && num > field.validation.max) {
              nextErrors[field.id] = `Value must not exceed ${field.validation.max}.`;
            }
          }
        }
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDoc) return;
    if (!validateForm()) return;

    if (previewForm) {
      setConfirmation({
        leadRef: 'ZCM-PREVIEW-MODE',
        message: formDoc.confirmationMessage || 'Form validation passed in live preview mode.',
      });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const sanitizedResponses: Record<string, unknown> = {};
      for (const f of formDoc.fields) {
        if (f.type === 'section_heading' || !isFieldVisible(f)) continue;
        if (values[f.id] !== undefined) {
          sanitizedResponses[f.id] = values[f.id];
        }
      }

      const result = await submitPublicForm({
        publicForm: formDoc,
        responses: sanitizedResponses,
        websiteTrap,
      });

      setConfirmation({
        leadRef: result.leadRef,
        message:
          formDoc.confirmationMessage ||
          'Thank you for your submission. Our team will review your request shortly.',
      });
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to submit form. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-slate-600 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-blue-700" />
          <span>Loading form…</span>
        </div>
      </div>
    );
  }

  if (!formDoc || (!previewForm && (!formDoc.isPublished || !formDoc.isActive))) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
            Form Unavailable
          </h1>
          <p className="text-sm text-slate-600">
            This form is either no longer active, unpublished, or the link is invalid. Please contact
            the issuing Zacma business unit for an updated link.
          </p>
        </div>
      </div>
    );
  }

  const accent = formDoc.brandColor || '#1D4ED8';

  if (confirmation) {
    return (
      <div className={`${previewForm ? 'py-6' : 'min-h-screen py-12'} bg-slate-50 px-4 flex items-center justify-center`}>
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-4" />
          <h2 className="font-display text-2xl font-bold text-slate-900 mb-2">
            Submission Received
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">{confirmation.message}</p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg py-3 px-4 mb-6">
            <div className="text-xs text-slate-500">Reference Number</div>
            <div className="font-mono text-base font-bold text-slate-900 mt-0.5">
              {confirmation.leadRef}
            </div>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setValues({});
                setConfirmation(null);
              }}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg cursor-pointer"
              style={{ backgroundColor: accent }}
            >
              Submit Another Response
            </button>
            {onExitPreview && (
              <button
                type="button"
                onClick={onExitPreview}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
              >
                Close Preview
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${previewForm ? 'py-4' : 'min-h-screen py-10'} bg-slate-50 px-4`}>
      <div className="max-w-2xl mx-auto">
        {onExitPreview && (
          <button
            type="button"
            onClick={onExitPreview}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 mb-4 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Return to Form Builder
          </button>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {/* Branded Header Banner */}
          <div className="p-6 sm:p-8 border-b border-slate-200" style={{ borderTop: `4px solid ${accent}` }}>
            <div className="flex items-center gap-3.5 mb-4">
              {formDoc.logoUrl ? (
                <img
                  src={formDoc.logoUrl}
                  alt={formDoc.businessUnitName}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-lg object-cover border border-slate-200 bg-white"
                />
              ) : (
                <div
                  className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-display font-bold text-base"
                  style={{ backgroundColor: accent }}
                >
                  {formDoc.businessUnitName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-xs font-semibold text-slate-500">
                  {formDoc.businessUnitName}
                </div>
                <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                  {formDoc.title}
                </h1>
              </div>
            </div>
            {formDoc.description && (
              <p className="text-sm text-slate-600 leading-relaxed">{formDoc.description}</p>
            )}
          </div>

          {/* Dynamic Fields Form */}
          <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5" noValidate>
            {/* Hidden Honeypot Anti-Spam Field */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="zacma_hp_website">Website</label>
              <input
                id="zacma_hp_website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={websiteTrap}
                onChange={(e) => setWebsiteTrap(e.target.value)}
              />
            </div>

            {submitError && (
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {submitError}
              </div>
            )}

            {formDoc.fields.map((field) => {
              if (!isFieldVisible(field)) return null;

              if (field.type === 'section_heading') {
                return (
                  <div key={field.id} className="pt-4 pb-1 border-b border-slate-200">
                    <h2 className="font-display text-base font-bold text-slate-900">
                      {field.label}
                    </h2>
                    {field.helperText && (
                      <p className="text-xs text-slate-500 mt-0.5">{field.helperText}</p>
                    )}
                  </div>
                );
              }

              const val = values[field.id];
              const errMsg = errors[field.id];

              return (
                <div key={field.id}>
                  <label className="block text-sm font-medium text-slate-800 mb-1.5">
                    {field.label}
                    {field.required && <span className="text-red-600 ml-1">*</span>}
                  </label>

                  {(field.type === 'short_text' ||
                    field.type === 'conditional' ||
                    field.type === 'email' ||
                    field.type === 'phone' ||
                    field.type === 'number' ||
                    field.type === 'date' ||
                    field.type === 'time' ||
                    field.type === 'url') && (
                    <input
                      type={
                        field.type === 'short_text' || field.type === 'conditional'
                          ? 'text'
                          : field.type === 'phone'
                            ? 'tel'
                            : field.type
                      }
                      value={String(val ?? '')}
                      onChange={(e) => setFieldValue(field.id, e.target.value)}
                      placeholder={field.placeholder || ''}
                      className={`w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                        errMsg ? 'border-red-400 bg-red-50/30' : 'border-slate-300'
                      }`}
                    />
                  )}

                  {(field.type === 'long_text' || field.type === 'address') && (
                    <textarea
                      rows={field.type === 'address' ? 2 : 4}
                      value={String(val ?? '')}
                      onChange={(e) => setFieldValue(field.id, e.target.value)}
                      placeholder={field.placeholder || ''}
                      className={`w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 ${
                        errMsg ? 'border-red-400 bg-red-50/30' : 'border-slate-300'
                      }`}
                    />
                  )}

                  {field.type === 'dropdown' && (
                    <select
                      value={String(val ?? '')}
                      onChange={(e) => setFieldValue(field.id, e.target.value)}
                      className={`w-full px-3.5 py-2.5 text-sm border rounded-lg bg-white focus:outline-none ${
                        errMsg ? 'border-red-400' : 'border-slate-300'
                      }`}
                    >
                      <option value="">Select an option…</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'yes_no' && (
                    <div className="flex items-center gap-3">
                      {['Yes', 'No'].map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setFieldValue(field.id, opt)}
                          className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${
                            val === opt
                              ? 'text-white border-transparent'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                          style={val === opt ? { backgroundColor: accent } : undefined}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}

                  {field.type === 'radio' && (
                    <div className="space-y-2 pt-1">
                      {(field.options || []).map((opt) => (
                        <label key={opt} className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                          <input
                            type="radio"
                            name={field.id}
                            checked={val === opt}
                            onChange={() => setFieldValue(field.id, opt)}
                            className="border-slate-300 text-blue-700"
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {(field.type === 'checkboxes' || field.type === 'multi_select') && (
                    <div className="space-y-2 pt-1">
                      {(field.options || []).map((opt) => {
                        const arr = Array.isArray(val) ? (val as string[]) : [];
                        const checked = arr.includes(opt);
                        return (
                          <label key={opt} className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked ? arr.filter((x) => x !== opt) : [...arr, opt];
                                setFieldValue(field.id, next);
                              }}
                              className="rounded border-slate-300 text-blue-700"
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {(field.type === 'file_upload' || field.type === 'image_upload') && (
                    <label className="flex items-center justify-between gap-3 px-4 py-3 border border-dashed border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                      <div className="flex items-center gap-2.5 text-xs text-slate-600">
                        <Upload className="w-4 h-4 text-slate-400" />
                        <span>
                          {val
                            ? String(val)
                            : field.type === 'image_upload'
                              ? 'Upload image (JPG, PNG, WebP — max 5 MB)'
                              : 'Upload document (PDF, DOCX, JPG — max 5 MB)'}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-blue-700">Choose file</span>
                      <input
                        type="file"
                        accept={field.type === 'image_upload' ? 'image/*' : undefined}
                        onChange={(e) =>
                          handleFileChange(
                            field.id,
                            e.target.files?.[0] || null,
                            field.type === 'image_upload'
                          )
                        }
                        className="hidden"
                      />
                    </label>
                  )}

                  {field.helperText && !errMsg && (
                    <p className="text-xs text-slate-500 mt-1">{field.helperText}</p>
                  )}
                  {errMsg && <p className="text-xs text-red-600 mt-1">{errMsg}</p>}
                </div>
              );
            })}

            <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Secured by Zacma Portal</span>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2.5 text-sm font-semibold text-white rounded-lg disabled:opacity-60 transition-opacity cursor-pointer"
                style={{ backgroundColor: accent }}
              >
                {submitting ? 'Submitting…' : 'Submit Form'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
