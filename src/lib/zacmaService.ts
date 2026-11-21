import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  writeBatch,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import type {
  BusinessUnit,
  DynamicForm,
  FormField,
  Lead,
  LeadActivity,
  LeadPriority,
  LeadStatus,
  MessageTemplate,
  Organization,
  OrganizationMember,
  PublicFormProjection,
  UserRole,
  CommunicationRecord,
  IntegrationConfig,
  DuplicateMatchMode,
} from '../types';

export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'zekimuluken@gmail.com';
export const DEFAULT_ORG_ID = 'zacma-hq';

export function slugify(input: string, maxLen = 60): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return base.length >= 2 ? base : `item-${Date.now().toString(36)}`;
}

export function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function generateLeadRef(): string {
  const year = new Date().getFullYear();
  const code = Math.random().toString(36).slice(2, 6).toUpperCase();
  const num = Math.floor(100 + Math.random() * 900);
  return `ZCM-${year}-${code}${num}`;
}

export function clampStr(val: string | undefined | null, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

export function clampList(arr: string[] | undefined | null, maxItems: number, itemMaxLen = 120): string[] {
  if (!Array.isArray(arr)) return [];
  const deduped = Array.from(new Set(arr.map((x) => clampStr(String(x), itemMaxLen)).filter(Boolean)));
  return deduped.slice(0, maxItems);
}

export function formatTimestamp(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
  }
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    return (ts as { toDate: () => Date }).toDate().toLocaleString();
  }
  return '—';
}

export function timestampToMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function mergeTemplateVariables(
  template: string,
  lead: Pick<Lead, 'fullName' | 'email' | 'phone' | 'leadRef' | 'businessUnitName' | 'formTitle'> & {
    courseName?: string;
    courseFee?: string;
    responses?: Record<string, unknown>;
  }
): string {
  const inferredCourse =
    lead.courseName ||
    (typeof lead.responses?.preferredCourse === 'string' ? lead.responses.preferredCourse : '') ||
    (typeof lead.responses?.interestedCourse === 'string' ? lead.responses.interestedCourse : '') ||
    'Training Program';
  const inferredFee = lead.courseFee || '8,500 ETB';

  return template
    .replace(/\{\{\s*full_name\s*\}\}/gi, lead.fullName || 'Valued Client')
    .replace(/\{\{\s*business_name\s*\}\}/gi, lead.businessUnitName || 'Zacma Technology Training Institute')
    .replace(/\{\{\s*lead_ref\s*\}\}/gi, lead.leadRef || '')
    .replace(/\{\{\s*email\s*\}\}/gi, lead.email || '')
    .replace(/\{\{\s*phone\s*\}\}/gi, lead.phone || '')
    .replace(/\{\{\s*form_title\s*\}\}/gi, lead.formTitle || '')
    .replace(/\{\{\s*course_name\s*\}\}/gi, inferredCourse)
    .replace(/\{\{\s*course_fee\s*\}\}/gi, inferredFee);
}

export function detectDuplicateLeads(
  leads: Lead[],
  mode: DuplicateMatchMode
): Map<string, string[]> {
  const duplicates = new Map<string, string[]>();
  const normalizeEmail = (e: string) => e.trim().toLowerCase();
  const normalizePhone = (p: string) => p.replace(/[^0-9+]/g, '');

  for (let i = 0; i < leads.length; i++) {
    const a = leads[i];
    const emailA = normalizeEmail(a.email);
    const phoneA = normalizePhone(a.phone);
    const matches: string[] = [];

    for (let j = 0; j < leads.length; j++) {
      if (i === j) continue;
      const b = leads[j];
      const emailB = normalizeEmail(b.email);
      const phoneB = normalizePhone(b.phone);

      const emailMatch = Boolean(emailA && emailB && emailA === emailB);
      const phoneMatch = Boolean(phoneA.length >= 6 && phoneB.length >= 6 && phoneA === phoneB);

      let isDup = false;
      if (mode === 'email_or_phone') isDup = emailMatch || phoneMatch;
      else if (mode === 'email_only') isDup = emailMatch;
      else if (mode === 'phone_only') isDup = phoneMatch;
      else if (mode === 'email_and_phone') isDup = emailMatch && phoneMatch;

      if (isDup) {
        matches.push(b.leadRef);
      }
    }

    if (matches.length > 0) {
      duplicates.set(a.id, matches);
    }
  }
  return duplicates;
}

export function exportToCsv(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escapeCell = (val: unknown) => {
    const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Extract contact identity fields automatically from arbitrary dynamic form answers
export function extractLeadContact(
  fields: FormField[],
  responses: Record<string, unknown>
): { fullName: string; email: string; phone: string } {
  let fullName = '';
  let email = '';
  let phone = '';

  for (const field of fields) {
    const raw = responses[field.id];
    const strVal = typeof raw === 'string' ? raw.trim() : '';
    if (!strVal) continue;
    const labelLow = field.label.toLowerCase();
    const idLow = field.id.toLowerCase();

    if (!email && (field.type === 'email' || labelLow.includes('email') || idLow.includes('email'))) {
      email = strVal;
    } else if (!phone && (field.type === 'phone' || labelLow.includes('phone') || labelLow.includes('mobile') || idLow.includes('phone'))) {
      phone = strVal;
    } else if (
      !fullName &&
      field.type === 'short_text' &&
      (labelLow.includes('full name') || labelLow === 'name' || idLow.includes('full_name') || idLow === 'name' || labelLow.includes('student name') || labelLow.includes('applicant'))
    ) {
      fullName = strVal;
    }
  }

  if (!fullName) {
    const firstName = Object.entries(responses).find(([k]) => k.toLowerCase().includes('first_name'))?.[1];
    const lastName = Object.entries(responses).find(([k]) => k.toLowerCase().includes('last_name'))?.[1];
    if (typeof firstName === 'string') {
      fullName = `${firstName} ${typeof lastName === 'string' ? lastName : ''}`.trim();
    }
  }

  return {
    fullName: clampStr(fullName || email || 'Unnamed Visitor', 160),
    email: clampStr(email, 200),
    phone: clampStr(phone, 60),
  };
}

// Permission Helper Matrix (UI reflection; enforced identically in Firestore Rules)
export function canManageOrg(role: UserRole): boolean {
  return role === 'super_admin' || role === 'org_admin';
}

export function canManageBusinessUnits(role: UserRole): boolean {
  return role === 'super_admin' || role === 'org_admin';
}

export function canManageForms(role: UserRole): boolean {
  return role === 'super_admin' || role === 'org_admin' || role === 'bu_manager';
}

export function hasCrmAccess(role: UserRole, explicitCrmAccess: boolean): boolean {
  if (role === 'super_admin' || role === 'org_admin' || role === 'bu_manager' || role === 'staff') {
    return true;
  }
  return explicitCrmAccess;
}

// =============================================================================
// FIRESTORE MUTATION OPERATIONS
// =============================================================================

export async function logAuditEvent(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
}) {
  const id = generateId('audit');
  const path = `organizations/${params.organizationId}/auditLogs/${id}`;
  try {
    await setDoc(doc(db, path), {
      id,
      organizationId: params.organizationId,
      actorId: params.actorId,
      actorName: clampStr(params.actorName, 120),
      action: clampStr(params.action, 100),
      resourceType: clampStr(params.resourceType, 80),
      resourceId: clampStr(params.resourceId, 128),
      summary: clampStr(params.summary, 500),
      ownerId: params.ownerId,
      authorizedUserIds: clampList([...params.authorizedUserIds, params.ownerId, params.actorId], 100),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createOrUpdateBusinessUnit(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existing?: BusinessUnit | null;
  data: {
    name: string;
    description: string;
    category: string;
    services: string[];
    logoUrl: string;
    brandColor: string;
    contactEmail: string;
    phoneNumber: string;
    physicalAddress: string;
    website: string;
    assignedAdminIds: string[];
    assignedStaffIds: string[];
    status: 'active' | 'inactive';
  };
  actorId: string;
  actorName: string;
}): Promise<string> {
  const id = params.existing?.id || generateId('bu');
  const path = `organizations/${params.organizationId}/businessUnits/${id}`;
  const slug = params.existing?.slug || slugify(params.data.name, 70);
  const authUsers = clampList(
    [
      ...params.authorizedUserIds,
      params.ownerId,
      ...params.data.assignedAdminIds,
      ...params.data.assignedStaffIds,
    ],
    100
  );

  try {
    if (params.existing) {
      await updateDoc(doc(db, path), {
        name: clampStr(params.data.name, 140),
        slug,
        description: clampStr(params.data.description, 1500),
        category: clampStr(params.data.category, 100),
        services: clampList(params.data.services, 40, 100),
        logoUrl: clampStr(params.data.logoUrl, 250000),
        brandColor: clampStr(params.data.brandColor || '#1D4ED8', 20),
        contactEmail: clampStr(params.data.contactEmail, 200),
        phoneNumber: clampStr(params.data.phoneNumber, 50),
        physicalAddress: clampStr(params.data.physicalAddress, 300),
        website: clampStr(params.data.website, 300),
        assignedAdminIds: clampList(params.data.assignedAdminIds, 30),
        assignedStaffIds: clampList(params.data.assignedStaffIds, 60),
        status: params.data.status,
        authorizedUserIds: authUsers,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, path), {
        id,
        organizationId: params.organizationId,
        name: clampStr(params.data.name, 140),
        slug,
        description: clampStr(params.data.description, 1500),
        category: clampStr(params.data.category, 100),
        services: clampList(params.data.services, 40, 100),
        logoUrl: clampStr(params.data.logoUrl, 250000),
        brandColor: clampStr(params.data.brandColor || '#1D4ED8', 20),
        contactEmail: clampStr(params.data.contactEmail, 200),
        phoneNumber: clampStr(params.data.phoneNumber, 50),
        physicalAddress: clampStr(params.data.physicalAddress, 300),
        website: clampStr(params.data.website, 300),
        assignedAdminIds: clampList(params.data.assignedAdminIds, 30),
        assignedStaffIds: clampList(params.data.assignedStaffIds, 60),
        status: params.data.status,
        ownerId: params.ownerId,
        authorizedUserIds: authUsers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: authUsers,
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.existing ? 'business_unit.updated' : 'business_unit.created',
      resourceType: 'businessUnit',
      resourceId: id,
      summary: `${params.existing ? 'Updated' : 'Created'} business unit "${params.data.name}"`,
    });

    return id;
  } catch (error) {
    handleFirestoreError(error, params.existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function deleteBusinessUnitSafe(params: {
  organizationId: string;
  businessUnit: BusinessUnit;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
}) {
  const path = `organizations/${params.organizationId}/businessUnits/${params.businessUnit.id}`;
  try {
    await deleteDoc(doc(db, path));
    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'business_unit.deleted',
      resourceType: 'businessUnit',
      resourceId: params.businessUnit.id,
      summary: `Deleted business unit "${params.businessUnit.name}"`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveDynamicForm(params: {
  organizationId: string;
  businessUnit: BusinessUnit;
  ownerId: string;
  authorizedUserIds: string[];
  existing?: DynamicForm | null;
  form: {
    title: string;
    slug?: string;
    description: string;
    fields: FormField[];
    isPublished: boolean;
    isActive: boolean;
    submissionLimit: number;
    confirmationMessage: string;
    brandColor: string;
    logoUrl: string;
    aiPrompt: string;
  };
  actorId: string;
  actorName: string;
}): Promise<{ id: string; publicSlugKey: string }> {
  const id = params.existing?.id || generateId('form');
  const slug = slugify(params.form.slug || params.form.title, 70);
  const publicSlugKey = `${params.businessUnit.slug}__${slug}`.replace(/[^a-z0-9_-]/g, '').slice(0, 175);
  const formPath = `organizations/${params.organizationId}/businessUnits/${params.businessUnit.id}/forms/${id}`;
  const publicPath = `publicForms/${publicSlugKey}`;
  const authUsers = clampList([...params.authorizedUserIds, params.ownerId, ...params.businessUnit.authorizedUserIds], 100);

  try {
    const batch = writeBatch(db);
    if (params.existing) {
      batch.update(doc(db, formPath), {
        title: clampStr(params.form.title, 180),
        slug,
        publicSlugKey,
        businessUnitName: clampStr(params.businessUnit.name, 140),
        description: clampStr(params.form.description, 1500),
        fields: params.form.fields.slice(0, 80),
        isPublished: Boolean(params.form.isPublished),
        isActive: Boolean(params.form.isActive),
        submissionLimit: Math.max(0, Math.min(1000000, Number(params.form.submissionLimit) || 0)),
        confirmationMessage: clampStr(params.form.confirmationMessage, 1000),
        brandColor: clampStr(params.form.brandColor || params.businessUnit.brandColor || '#1D4ED8', 20),
        logoUrl: clampStr(params.form.logoUrl || params.businessUnit.logoUrl, 250000),
        aiPrompt: clampStr(params.form.aiPrompt, 2000),
        authorizedUserIds: authUsers,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, formPath), {
        id,
        organizationId: params.organizationId,
        businessUnitId: params.businessUnit.id,
        businessUnitSlug: params.businessUnit.slug,
        businessUnitName: clampStr(params.businessUnit.name, 140),
        title: clampStr(params.form.title, 180),
        slug,
        publicSlugKey,
        description: clampStr(params.form.description, 1500),
        fields: params.form.fields.slice(0, 80),
        isPublished: Boolean(params.form.isPublished),
        isActive: Boolean(params.form.isActive),
        submissionLimit: Math.max(0, Math.min(1000000, Number(params.form.submissionLimit) || 0)),
        submissionCount: 0,
        confirmationMessage: clampStr(
          params.form.confirmationMessage || 'Thank you! Your submission has been received.',
          1000
        ),
        brandColor: clampStr(params.form.brandColor || params.businessUnit.brandColor || '#1D4ED8', 20),
        logoUrl: clampStr(params.form.logoUrl || params.businessUnit.logoUrl, 250000),
        aiPrompt: clampStr(params.form.aiPrompt, 2000),
        ownerId: params.ownerId,
        authorizedUserIds: authUsers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Keep sanitized public projection synced when published
    if (params.form.isPublished) {
      batch.set(doc(db, publicPath), {
        publicSlugKey,
        organizationId: params.organizationId,
        businessUnitId: params.businessUnit.id,
        businessUnitSlug: params.businessUnit.slug,
        businessUnitName: clampStr(params.businessUnit.name, 140),
        formId: id,
        formSlug: slug,
        title: clampStr(params.form.title, 180),
        description: clampStr(params.form.description, 1500),
        fields: params.form.fields.slice(0, 80),
        isPublished: Boolean(params.form.isPublished),
        isActive: Boolean(params.form.isActive),
        submissionLimit: Math.max(0, Math.min(1000000, Number(params.form.submissionLimit) || 0)),
        confirmationMessage: clampStr(
          params.form.confirmationMessage || 'Thank you! Your submission has been received.',
          1000
        ),
        brandColor: clampStr(params.form.brandColor || params.businessUnit.brandColor || '#1D4ED8', 20),
        logoUrl: clampStr(params.form.logoUrl || params.businessUnit.logoUrl, 250000),
        orgOwnerId: params.ownerId,
        updatedAt: serverTimestamp(),
      });
    } else if (params.existing?.publicSlugKey) {
      batch.delete(doc(db, `publicForms/${params.existing.publicSlugKey}`));
    }

    await batch.commit();

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: authUsers,
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.form.isPublished ? 'form.published' : params.existing ? 'form.updated' : 'form.created',
      resourceType: 'form',
      resourceId: id,
      summary: `${params.form.isPublished ? 'Published' : 'Saved'} form "${params.form.title}" under ${params.businessUnit.name}`,
    });

    return { id, publicSlugKey };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, formPath);
  }
}

export async function deleteDynamicForm(params: {
  organizationId: string;
  form: DynamicForm;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
}) {
  const formPath = `organizations/${params.organizationId}/businessUnits/${params.form.businessUnitId}/forms/${params.form.id}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, formPath));
    if (params.form.publicSlugKey) {
      batch.delete(doc(db, `publicForms/${params.form.publicSlugKey}`));
    }
    await batch.commit();

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'form.deleted',
      resourceType: 'form',
      resourceId: params.form.id,
      summary: `Deleted form "${params.form.title}"`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, formPath);
  }
}

// Public Visitor Submission (NO Zacma account required — atomic submission + lead + activity + notification)
export async function submitPublicForm(params: {
  publicForm: PublicFormProjection;
  responses: Record<string, unknown>;
  websiteTrap: string;
}): Promise<{ leadRef: string; submissionId: string }> {
  // Step 1: Server-side rate-limit and honeypot check
  const checkResp = await fetch('/api/security/verify-submission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicSlugKey: params.publicForm.publicSlugKey,
      websiteTrap: params.websiteTrap,
    }),
  });
  const checkData = (await checkResp.json()) as { allowed?: boolean; reason?: string };
  if (!checkResp.ok || !checkData.allowed) {
    throw new Error(checkData.reason || 'Submission blocked by security checkpoint.');
  }

  const submissionId = generateId('sub');
  const leadId = generateId('lead');
  const activityId = generateId('act');
  const notifId = generateId('notif');
  const leadRef = generateLeadRef();

  const { fullName, email, phone } = extractLeadContact(params.publicForm.fields, params.responses);
  const orgId = params.publicForm.organizationId;
  const ownerId = params.publicForm.orgOwnerId;

  const submissionPath = `organizations/${orgId}/formSubmissions/${submissionId}`;
  const leadPath = `organizations/${orgId}/leads/${leadId}`;
  const activityPath = `organizations/${orgId}/leads/${leadId}/activities/${activityId}`;
  const notifPath = `organizations/${orgId}/notifications/${notifId}`;

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, submissionPath), {
      id: submissionId,
      organizationId: orgId,
      businessUnitId: params.publicForm.businessUnitId,
      businessUnitName: clampStr(params.publicForm.businessUnitName, 140),
      formId: params.publicForm.formId,
      formTitle: clampStr(params.publicForm.title, 180),
      publicSlugKey: params.publicForm.publicSlugKey,
      leadId,
      leadRef,
      responses: params.responses,
      submitterName: fullName,
      submitterEmail: email,
      submitterPhone: phone,
      source: 'public_form',
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, leadPath), {
      id: leadId,
      leadRef,
      organizationId: orgId,
      businessUnitId: params.publicForm.businessUnitId,
      businessUnitName: clampStr(params.publicForm.businessUnitName, 140),
      formId: params.publicForm.formId,
      formTitle: clampStr(params.publicForm.title, 180),
      submissionId,
      publicSlugKey: params.publicForm.publicSlugKey,
      fullName,
      email,
      phone,
      responses: params.responses,
      source: 'public_form',
      assignedStaffId: '',
      assignedStaffName: '',
      status: 'new',
      priority: 'medium',
      followUpDate: '',
      lastContactAt: '',
      internalNotes: '',
      attachments: [],
      ownerId,
      authorizedUserIds: [ownerId],
      submittedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, activityPath), {
      id: activityId,
      organizationId: orgId,
      leadId,
      type: 'submission',
      summary: `Public form submitted: ${params.publicForm.title}`,
      details: `Lead ${leadRef} automatically extracted from ${params.publicForm.businessUnitName} public form.`,
      actorId: 'public_visitor',
      actorName: fullName,
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, notifPath), {
      id: notifId,
      organizationId: orgId,
      recipientUserId: ownerId,
      title: `New Lead: ${fullName}`,
      message: `${params.publicForm.businessUnitName} received a submission on "${params.publicForm.title}" (${leadRef}).`,
      entityType: 'lead',
      entityId: leadId,
      isRead: false,
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { leadRef, submissionId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, leadPath);
  }
}

export async function fetchPublicFormBySlug(
  businessUnitSlug: string,
  formSlug: string
): Promise<PublicFormProjection | null> {
  const key = `${businessUnitSlug}__${formSlug}`.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const path = `publicForms/${key}`;
  try {
    const snap = await getDoc(doc(db, path));
    if (!snap.exists()) return null;
    return snap.data() as PublicFormProjection;
  } catch {
    return null;
  }
}

export async function createManualLead(params: {
  organizationId: string;
  businessUnit: BusinessUnit;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
  fullName: string;
  email: string;
  phone: string;
  priority: LeadPriority;
  source: string;
  internalNotes: string;
}): Promise<string> {
  const leadId = generateId('lead');
  const activityId = generateId('act');
  const leadRef = generateLeadRef();
  const authUsers = clampList([...params.authorizedUserIds, params.ownerId, params.actorId], 100);
  const leadPath = `organizations/${params.organizationId}/leads/${leadId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, leadPath), {
      id: leadId,
      leadRef,
      organizationId: params.organizationId,
      businessUnitId: params.businessUnit.id,
      businessUnitName: clampStr(params.businessUnit.name, 140),
      formId: '',
      formTitle: 'Manual Entry',
      submissionId: '',
      publicSlugKey: '',
      fullName: clampStr(params.fullName, 160),
      email: clampStr(params.email, 200),
      phone: clampStr(params.phone, 60),
      responses: {},
      source: clampStr(params.source || 'manual_entry', 80),
      assignedStaffId: params.actorId,
      assignedStaffName: clampStr(params.actorName, 120),
      status: 'new',
      priority: params.priority,
      followUpDate: '',
      lastContactAt: '',
      internalNotes: clampStr(params.internalNotes, 5000),
      attachments: [],
      ownerId: params.ownerId,
      authorizedUserIds: authUsers,
      submittedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, `organizations/${params.organizationId}/leads/${leadId}/activities/${activityId}`), {
      id: activityId,
      organizationId: params.organizationId,
      leadId,
      type: 'edit',
      summary: `Manual lead created (${leadRef})`,
      details: `Created by ${params.actorName} under ${params.businessUnit.name}.`,
      actorId: params.actorId,
      actorName: clampStr(params.actorName, 120),
      ownerId: params.ownerId,
      authorizedUserIds: authUsers,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return leadId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, leadPath);
  }
}

export async function updateLeadAndLog(params: {
  organizationId: string;
  lead: Lead;
  updates: Partial<
    Pick<
      Lead,
      | 'fullName'
      | 'email'
      | 'phone'
      | 'status'
      | 'priority'
      | 'assignedStaffId'
      | 'assignedStaffName'
      | 'followUpDate'
      | 'lastContactAt'
      | 'internalNotes'
      | 'attachments'
      | 'authorizedUserIds'
    >
  >;
  activityType: LeadActivity['type'];
  activitySummary: string;
  activityDetails?: string;
  actorId: string;
  actorName: string;
}) {
  const leadPath = `organizations/${params.organizationId}/leads/${params.lead.id}`;
  const activityId = generateId('act');
  const activityPath = `${leadPath}/activities/${activityId}`;
  const nextAuthorized = params.updates.assignedStaffId
    ? clampList([...params.lead.authorizedUserIds, params.updates.assignedStaffId], 100)
    : params.updates.authorizedUserIds;

  try {
    const batch = writeBatch(db);
    const payload: Record<string, unknown> = {
      ...params.updates,
      updatedAt: serverTimestamp(),
    };
    if (nextAuthorized) {
      payload.authorizedUserIds = nextAuthorized;
    }

    batch.update(doc(db, leadPath), payload);
    batch.set(doc(db, activityPath), {
      id: activityId,
      organizationId: params.organizationId,
      leadId: params.lead.id,
      type: params.activityType,
      summary: clampStr(params.activitySummary, 500),
      details: clampStr(params.activityDetails || '', 2000),
      actorId: params.actorId,
      actorName: clampStr(params.actorName, 120),
      ownerId: params.lead.ownerId,
      authorizedUserIds: nextAuthorized || params.lead.authorizedUserIds,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, leadPath);
  }
}

export async function addLeadActivityOnly(params: {
  organizationId: string;
  lead: Lead;
  type: LeadActivity['type'];
  summary: string;
  details: string;
  actorId: string;
  actorName: string;
  updateLastContact?: boolean;
}) {
  const leadPath = `organizations/${params.organizationId}/leads/${params.lead.id}`;
  const activityId = generateId('act');
  const activityPath = `${leadPath}/activities/${activityId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, activityPath), {
      id: activityId,
      organizationId: params.organizationId,
      leadId: params.lead.id,
      type: params.type,
      summary: clampStr(params.summary, 500),
      details: clampStr(params.details, 2000),
      actorId: params.actorId,
      actorName: clampStr(params.actorName, 120),
      ownerId: params.lead.ownerId,
      authorizedUserIds: params.lead.authorizedUserIds,
      createdAt: serverTimestamp(),
    });

    if (params.updateLastContact) {
      batch.update(doc(db, leadPath), {
        lastContactAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, activityPath);
  }
}

export async function deleteLeadRecord(params: {
  organizationId: string;
  lead: Lead;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
}) {
  const path = `organizations/${params.organizationId}/leads/${params.lead.id}`;
  try {
    await deleteDoc(doc(db, path));
    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'lead.deleted',
      resourceType: 'lead',
      resourceId: params.lead.id,
      summary: `Deleted lead ${params.lead.leadRef} (${params.lead.fullName})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function sendAndLogCommunication(params: {
  organizationId: string;
  lead: Lead;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  actorId: string;
  actorName: string;
}): Promise<CommunicationRecord['deliveryStatus']> {
  const recipient = params.channel === 'email' ? params.lead.email : params.lead.phone;
  if (!recipient) {
    throw new Error(`Lead ${params.lead.fullName} does not have a valid ${params.channel === 'email' ? 'email address' : 'phone number'}.`);
  }

  const personalizedSubject = mergeTemplateVariables(params.subject, params.lead);
  const personalizedBody = mergeTemplateVariables(params.body, params.lead);

  const token = await auth.currentUser?.getIdToken();
  const resp = await fetch('/api/communications/dispatch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      channel: params.channel,
      recipient,
      subject: personalizedSubject,
      body: personalizedBody,
    }),
  });

  const dispatchResult = (await resp.json()) as {
    deliveryStatus?: CommunicationRecord['deliveryStatus'];
    provider?: string;
    note?: string;
  };

  const deliveryStatus: CommunicationRecord['deliveryStatus'] =
    dispatchResult.deliveryStatus || 'queued_pending_provider_approval';
  const provider = dispatchResult.provider || (params.channel === 'email' ? 'resend_email' : 'twilio_sms');

  const commId = generateId('comm');
  const activityId = generateId('act');
  const leadPath = `organizations/${params.organizationId}/leads/${params.lead.id}`;
  const commPath = `${leadPath}/communications/${commId}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, commPath), {
      id: commId,
      organizationId: params.organizationId,
      businessUnitId: params.lead.businessUnitId,
      leadId: params.lead.id,
      leadName: clampStr(params.lead.fullName, 160),
      channel: params.channel,
      recipient: clampStr(recipient, 200),
      subject: clampStr(personalizedSubject, 250),
      body: clampStr(personalizedBody, 5000),
      deliveryStatus,
      provider: clampStr(provider, 60),
      senderId: params.actorId,
      senderName: clampStr(params.actorName, 120),
      ownerId: params.lead.ownerId,
      authorizedUserIds: params.lead.authorizedUserIds,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, `${leadPath}/activities/${activityId}`), {
      id: activityId,
      organizationId: params.organizationId,
      leadId: params.lead.id,
      type: 'communication',
      summary: `${params.channel.toUpperCase()} ${deliveryStatus === 'sent' ? 'sent' : 'logged'} to ${recipient}`,
      details: personalizedSubject ? `${personalizedSubject} — ${personalizedBody.slice(0, 280)}` : personalizedBody.slice(0, 280),
      actorId: params.actorId,
      actorName: clampStr(params.actorName, 120),
      ownerId: params.lead.ownerId,
      authorizedUserIds: params.lead.authorizedUserIds,
      createdAt: serverTimestamp(),
    });

    batch.update(doc(db, leadPath), {
      lastContactAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return deliveryStatus;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, commPath);
  }
}

export async function saveMessageTemplate(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existing?: MessageTemplate | null;
  data: {
    businessUnitId: string;
    name: string;
    channel: 'email' | 'sms';
    subject: string;
    body: string;
  };
}) {
  const id = params.existing?.id || generateId('tpl');
  const path = `organizations/${params.organizationId}/messageTemplates/${id}`;
  const authUsers = clampList([...params.authorizedUserIds, params.ownerId], 100);
  try {
    if (params.existing) {
      await updateDoc(doc(db, path), {
        businessUnitId: clampStr(params.data.businessUnitId, 128),
        name: clampStr(params.data.name, 140),
        channel: params.data.channel,
        subject: clampStr(params.data.subject, 250),
        body: clampStr(params.data.body, 5000),
        authorizedUserIds: authUsers,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, path), {
        id,
        organizationId: params.organizationId,
        businessUnitId: clampStr(params.data.businessUnitId, 128),
        name: clampStr(params.data.name, 140),
        channel: params.data.channel,
        subject: clampStr(params.data.subject, 250),
        body: clampStr(params.data.body, 5000),
        ownerId: params.ownerId,
        authorizedUserIds: authUsers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, params.existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function deleteMessageTemplate(organizationId: string, templateId: string) {
  const path = `organizations/${organizationId}/messageTemplates/${templateId}`;
  try {
    await deleteDoc(doc(db, path));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function sendDirectCommunication(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  channel: 'email' | 'sms';
  recipient: string;
  recipientName: string;
  subject: string;
  body: string;
  actorId: string;
  actorName: string;
}): Promise<{ deliveryStatus: CommunicationRecord['deliveryStatus']; provider: string; note?: string }> {
  const token = await auth.currentUser?.getIdToken();
  const resp = await fetch('/api/communications/dispatch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      channel: params.channel,
      recipient: params.recipient,
      subject: params.subject,
      body: params.body,
    }),
  });

  const data = (await resp.json()) as {
    deliveryStatus?: CommunicationRecord['deliveryStatus'];
    provider?: string;
    note?: string;
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Failed to dispatch communication.');
  }

  const deliveryStatus: CommunicationRecord['deliveryStatus'] =
    data.deliveryStatus || 'queued_pending_provider_approval';
  const provider = data.provider || (params.channel === 'email' ? 'resend_email' : 'twilio_sms');

  await logAuditEvent({
    organizationId: params.organizationId,
    ownerId: params.ownerId,
    authorizedUserIds: params.authorizedUserIds,
    actorId: params.actorId,
    actorName: params.actorName,
    action: `communication.direct_${params.channel}`,
    resourceType: 'communication',
    resourceId: clampStr(params.recipient, 128),
    summary: `Direct ${params.channel.toUpperCase()} (${deliveryStatus}) to ${params.recipientName || params.recipient} via ${provider}`,
  });

  return { deliveryStatus, provider, note: data.note };
}

export const ZACMA_STARTER_TEMPLATES: Array<{
  name: string;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
}> = [
  {
    name: 'Institute Admission Welcome (Email)',
    channel: 'email',
    subject: 'Welcome to {{business_name}} — {{course_name}} ({{lead_ref}})',
    body: 'Dear {{full_name}},\n\nThank you for applying for {{course_name}} at {{business_name}}.\n\nYour registration reference is {{lead_ref}}. Standard tuition for this program is {{course_fee}}.\n\nOur admission advisor will contact you shortly with your class schedule and payment confirmation instructions.\n\nWarm regards,\nAdmissions Office\n{{business_name}}',
  },
  {
    name: 'Registration Confirmation (SMS)',
    channel: 'sms',
    subject: '',
    body: 'Hi {{full_name}}, your {{course_name}} registration at {{business_name}} is received (Ref: {{lead_ref}}). Tuition: {{course_fee}}. Admissions will call you shortly.',
  },
  {
    name: 'Tuition Payment Reminder — 8,500 ETB (Email)',
    channel: 'email',
    subject: 'Tuition Payment Reminder: {{course_name}} ({{lead_ref}})',
    body: 'Dear {{full_name}},\n\nThis is a friendly reminder to complete your tuition payment of {{course_fee}} for {{course_name}} (Reference: {{lead_ref}}) to confirm your seat in the upcoming training batch.\n\nIf you have already completed payment, please reply with your receipt or contact our admissions desk.\n\nBest regards,\n{{business_name}}',
  },
  {
    name: 'Tuition Payment Reminder — 8,500 ETB (SMS)',
    channel: 'sms',
    subject: '',
    body: 'Reminder: Complete your {{course_fee}} tuition for {{course_name}} (Ref {{lead_ref}}) to confirm your seat at {{business_name}}.',
  },
  {
    name: 'Amharic Admission Welcome (SMS)',
    channel: 'sms',
    subject: '',
    body: 'ሰላም {{full_name}}፣ በ{{business_name}} ለ{{course_name}} ስለተመዘገቡ እናመሰግናለን። መለያ ቁጥር፦ {{lead_ref}}። የኮርስ ክፍያ፦ {{course_fee}}።',
  },
];

export async function seedStarterMessageTemplates(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existingTemplates: MessageTemplate[];
}): Promise<number> {
  const existingNames = new Set(params.existingTemplates.map((t) => t.name.trim().toLowerCase()));
  const missing = ZACMA_STARTER_TEMPLATES.filter(
    (tpl) => !existingNames.has(tpl.name.trim().toLowerCase())
  );
  if (missing.length === 0) return 0;

  const authUsers = clampList([...params.authorizedUserIds, params.ownerId], 100);
  try {
    const batch = writeBatch(db);
    for (const tpl of missing) {
      const id = generateId('tpl');
      batch.set(doc(db, `organizations/${params.organizationId}/messageTemplates/${id}`), {
        id,
        organizationId: params.organizationId,
        businessUnitId: '',
        name: clampStr(tpl.name, 140),
        channel: tpl.channel,
        subject: clampStr(tpl.subject, 250),
        body: clampStr(tpl.body, 5000),
        ownerId: params.ownerId,
        authorizedUserIds: authUsers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return missing.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `organizations/${params.organizationId}/messageTemplates`);
  }
}

export async function upsertOrganizationMember(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existing?: OrganizationMember | null;
  data: {
    userId?: string;
    email: string;
    displayName: string;
    role: UserRole;
    crmAccess: boolean;
    assignedBusinessUnitIds: string[];
    status: 'active' | 'inactive' | 'invited';
  };
  actorId: string;
  actorName: string;
}) {
  const userId = params.existing?.userId || clampStr(params.data.userId, 128) || generateId('member');
  const path = `organizations/${params.organizationId}/members/${userId}`;
  const authUsers = clampList([...params.authorizedUserIds, params.ownerId, userId], 100);
  try {
    if (params.existing) {
      await updateDoc(doc(db, path), {
        displayName: clampStr(params.data.displayName, 120),
        email: clampStr(params.data.email, 200),
        role: params.data.role,
        crmAccess: params.data.crmAccess,
        assignedBusinessUnitIds: clampList(params.data.assignedBusinessUnitIds, 50),
        status: params.data.status,
        authorizedUserIds: authUsers,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, path), {
        userId,
        organizationId: params.organizationId,
        email: clampStr(params.data.email, 200),
        displayName: clampStr(params.data.displayName, 120),
        role: params.data.role,
        crmAccess: params.data.crmAccess,
        assignedBusinessUnitIds: clampList(params.data.assignedBusinessUnitIds, 50),
        status: params.data.status,
        ownerId: params.ownerId,
        authorizedUserIds: authUsers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: authUsers,
      actorId: params.actorId,
      actorName: params.actorName,
      action: params.existing ? 'member.updated' : 'member.added',
      resourceType: 'member',
      resourceId: userId,
      summary: `${params.existing ? 'Updated' : 'Added'} ${params.data.displayName} (${params.data.role})`,
    });
  } catch (error) {
    handleFirestoreError(error, params.existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function updateIntegrationApproval(params: {
  organizationId: string;
  integration: IntegrationConfig;
  approvalStatus: IntegrationConfig['approvalStatus'];
  actorId: string;
  actorName: string;
}) {
  const path = `organizations/${params.organizationId}/integrations/${params.integration.id}`;
  try {
    await updateDoc(doc(db, path), {
      approvalStatus: params.approvalStatus,
      approvedBy: params.actorId,
      updatedAt: serverTimestamp(),
    });

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.integration.ownerId,
      authorizedUserIds: params.integration.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'integration.approval_updated',
      resourceType: 'integration',
      resourceId: params.integration.id,
      summary: `Set ${params.integration.displayName} status to ${params.approvalStatus}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateOrganizationSettings(params: {
  organization: Organization;
  updates: Partial<Pick<Organization, 'name' | 'primaryColor' | 'secondaryColor' | 'duplicateMatchMode'>>;
}) {
  const path = `organizations/${params.organization.id}`;
  try {
    await updateDoc(doc(db, path), {
      ...params.updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchLeadDetailsHistory(
  organizationId: string,
  leadId: string,
  userUid: string,
  isSuperAdmin: boolean
): Promise<{ activities: LeadActivity[]; communications: CommunicationRecord[] }> {
  const actCol = collection(db, `organizations/${organizationId}/leads/${leadId}/activities`);
  const commCol = collection(db, `organizations/${organizationId}/leads/${leadId}/communications`);
  try {
    const actQuery = isSuperAdmin
      ? actCol
      : query(actCol, where('authorizedUserIds', 'array-contains', userUid));
    const commQuery = isSuperAdmin
      ? commCol
      : query(commCol, where('authorizedUserIds', 'array-contains', userUid));

    const [actSnap, commSnap] = await Promise.all([getDocs(actQuery), getDocs(commQuery)]);
    const activities = actSnap.docs
      .map((d) => d.data() as LeadActivity)
      .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
    const communications = commSnap.docs
      .map((d) => d.data() as CommunicationRecord)
      .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));

    return { activities, communications };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `organizations/${organizationId}/leads/${leadId}`);
  }
}
