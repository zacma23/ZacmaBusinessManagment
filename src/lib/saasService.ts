import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { clampStr, slugify } from './zacmaService';
import type {
  SaasInvoice,
  SaasPaymentMethod,
  SaasPlan,
  SaasSalesInquiry,
  SaasTenantStatus,
  SaasTenantSubscription,
} from '../types';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export interface IndustryBlueprint {
  id: string;
  label: string;
  defaultUnitName: string;
  category: string;
  brandColor: string;
  description: string;
  services: string[];
  welcomeMessage: string;
}

export const SAAS_INDUSTRY_BLUEPRINTS: IndustryBlueprint[] = [
  {
    id: 'training_education',
    label: 'Training Institute & Academy',
    defaultUnitName: 'Main Training Campus',
    category: 'Education & Training',
    brandColor: '#1D4ED8',
    description: 'Course admissions, student registration forms, tuition tracking, and 24/7 AI admissions support.',
    services: ['Short-Term Courses', 'Certification Programs', 'Corporate Training', 'Weekend Classes'],
    welcomeMessage: 'Hello! Welcome to our training academy. I can assist you with courses, schedules, fees, and registration.',
  },
  {
    id: 'healthcare_clinic',
    label: 'Clinic & Medical Center',
    defaultUnitName: 'Primary Care & Diagnostics',
    category: 'Healthcare & Clinics',
    brandColor: '#0F766E',
    description: 'Patient intake forms, appointment lead management, lab follow-ups, and automated SMS reminders.',
    services: ['Outpatient Consultation', 'Laboratory & Diagnostics', 'Specialist Referrals', 'Dental & Wellness'],
    welcomeMessage: 'Hello! Welcome to our clinic support desk. Ask about our departments, consultation hours, or booking an appointment.',
  },
  {
    id: 'real_estate',
    label: 'Real Estate & Property',
    defaultUnitName: 'Residential & Commercial Sales',
    category: 'Real Estate & Development',
    brandColor: '#B45309',
    description: 'Property inquiry forms, buyer qualification CRM, site visit scheduling, and broker follow-up pipelines.',
    services: ['Apartment Sales', 'Commercial Leasing', 'Property Management', 'Site Visits'],
    welcomeMessage: 'Hello! Looking for an apartment, commercial space, or site visit? I can connect you with our property advisors.',
  },
  {
    id: 'consulting_agency',
    label: 'Agency & Business Consultancy',
    defaultUnitName: 'Client Advisory Division',
    category: 'Consulting & Professional Services',
    brandColor: '#4338CA',
    description: 'Client discovery forms, proposal pipeline tracking, multi-service billing units, and client outreach.',
    services: ['Strategy & Advisory', 'Digital Marketing', 'Software & IT Projects', 'Retainer Support'],
    welcomeMessage: 'Hello! Tell us about your project goals and I will help match you with the right consulting team.',
  },
  {
    id: 'hospitality_travel',
    label: 'Hotel, Tour & Hospitality',
    defaultUnitName: 'Reservations & Events',
    category: 'Hospitality & Tourism',
    brandColor: '#9F1239',
    description: 'Group booking forms, conference inquiries, guest feedback capture, and multi-property coordination.',
    services: ['Room Reservations', 'Conference & Banquet Halls', 'Tour Packages', 'Airport Transfers'],
    welcomeMessage: 'Welcome! I can help you with room inquiries, event hall bookings, and custom tour packages.',
  },
  {
    id: 'retail_commerce',
    label: 'Multi-Branch Retail & Supply',
    defaultUnitName: 'Headquarters & B2B Orders',
    category: 'Retail & Wholesale',
    brandColor: '#1E293B',
    description: 'Wholesale order requests, branch performance reporting, distributor CRM, and SMS/Email campaigns.',
    services: ['Retail Branches', 'Wholesale Distribution', 'Custom Orders', 'After-Sales Support'],
    welcomeMessage: 'Hello! Ask about our products, wholesale inquiries, branch locations, or order support.',
  },
];

export const DEFAULT_SAAS_PLANS: Array<Omit<SaasPlan, 'updatedAt'>> = [
  {
    id: 'plan_starter',
    code: 'starter',
    name: 'Starter',
    audience: 'For single-branch businesses',
    tagline: 'Launch AI-built forms, lead CRM, and Email/SMS follow-ups for one growing business.',
    monthlyPriceEtb: 3500,
    monthlyPriceUsd: 29,
    annualDiscountPercent: 20,
    maxBusinessUnits: 2,
    maxForms: 10,
    maxLeads: 1000,
    maxStaffSeats: 5,
    includesAiSupport: false,
    includesSmsEmailAi: true,
    includesWhiteLabel: false,
    features: [
      'Up to 2 independent Business Units',
      '10 AI-generated & custom public forms with QR codes',
      '1,000 CRM leads with Kanban pipeline & duplicate alerts',
      'Up to 5 team members with role-based permissions',
      'Email & SMS Communication Center with templates',
    ],
    isRecommended: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    id: 'plan_growth',
    code: 'growth',
    name: 'Growth',
    audience: 'For expanding multi-branch teams',
    tagline: 'Full multi-business operations with 24/7 bilingual AI Support and automated SMS/Email writing.',
    monthlyPriceEtb: 8500,
    monthlyPriceUsd: 69,
    annualDiscountPercent: 20,
    maxBusinessUnits: 10,
    maxForms: 100,
    maxLeads: 15000,
    maxStaffSeats: 25,
    includesAiSupport: true,
    includesSmsEmailAi: true,
    includesWhiteLabel: false,
    features: [
      'Up to 10 Business Units with custom brand colors & logos',
      '100 dynamic AI forms, conditional logic & file uploads',
      '15,000 CRM leads, bulk actions, CSV export & analytics',
      'Up to 25 staff seats across branches & roles',
      '24/7 Bilingual (English & Amharic) AI Customer Support Widget',
      'AI Email & SMS Prompt Writer + Resend / Twilio / AfroMessage',
    ],
    isRecommended: true,
    isActive: true,
    sortOrder: 2,
  },
  {
    id: 'plan_enterprise',
    code: 'enterprise',
    name: 'Enterprise',
    audience: 'For large organizations & franchises',
    tagline: 'Unrestricted branches, white-label branding, governance audit trails, and priority onboarding.',
    monthlyPriceEtb: 19500,
    monthlyPriceUsd: 159,
    annualDiscountPercent: 20,
    maxBusinessUnits: 250,
    maxForms: 5000,
    maxLeads: 500000,
    maxStaffSeats: 500,
    includesAiSupport: true,
    includesSmsEmailAi: true,
    includesWhiteLabel: true,
    features: [
      'Up to 250 Business Units & Franchise Branches',
      '5,000 dynamic forms & 500,000 CRM lead capacity',
      '500 team seats with granular RBAC & immutable audit logs',
      'White-label workspace branding & custom domain readiness',
      'Dedicated 24/7 AI Admissions / Customer Support Assistant',
      'Priority onboarding, Telebirr/CBE/Card billing & SLA support',
    ],
    isRecommended: false,
    isActive: true,
    sortOrder: 3,
  },
];

export function formatIsoDatePlusDays(days: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function computePlanCyclePrice(
  plan: Pick<SaasPlan, 'monthlyPriceEtb' | 'monthlyPriceUsd' | 'annualDiscountPercent'>,
  billingCycle: 'monthly' | 'annual'
): { etb: number; usd: number; monthlyEquivalentEtb: number; monthlyEquivalentUsd: number } {
  const factor = billingCycle === 'annual' ? (100 - plan.annualDiscountPercent) / 100 : 1;
  const monthlyEquivalentEtb = Math.round(plan.monthlyPriceEtb * factor);
  const monthlyEquivalentUsd = Math.round(plan.monthlyPriceUsd * factor);
  return {
    etb: billingCycle === 'annual' ? monthlyEquivalentEtb * 12 : plan.monthlyPriceEtb,
    usd: billingCycle === 'annual' ? monthlyEquivalentUsd * 12 : plan.monthlyPriceUsd,
    monthlyEquivalentEtb,
    monthlyEquivalentUsd,
  };
}

export async function seedDefaultSaasPlans(): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'saasPlans'));
    if (!snap.empty) return;
    const batch = writeBatch(db);
    for (const plan of DEFAULT_SAAS_PLANS) {
      batch.set(doc(db, `saasPlans/${plan.id}`), {
        ...plan,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'saasPlans');
  }
}

export async function ensureRootTenantSubscription(params: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
}): Promise<void> {
  const path = `saasTenants/${params.organizationId}`;
  try {
    const ref = doc(db, path);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    const enterprise = DEFAULT_SAAS_PLANS[2];
    await setDoc(ref, {
      organizationId: params.organizationId,
      organizationName: clampStr(params.organizationName, 140),
      organizationSlug: slugify(params.organizationSlug || 'zacma').slice(0, 90),
      industry: 'Training Institute & Multi-Business Group',
      ownerId: params.ownerId,
      ownerName: clampStr(params.ownerName, 140),
      ownerEmail: clampStr(params.ownerEmail, 200),
      billingPhone: '',
      planId: enterprise.id,
      planName: `${enterprise.name} (Platform HQ)`,
      requestedPlanId: '',
      billingCycle: 'annual',
      currency: 'ETB',
      mrrEtb: 0,
      mrrUsd: 0,
      status: 'active',
      paymentMethod: 'invoice',
      paymentReference: 'PLATFORM_OWNER_HQ',
      trialEndsAt: '',
      currentPeriodEnd: '2030-12-31',
      maxBusinessUnits: enterprise.maxBusinessUnits,
      maxForms: enterprise.maxForms,
      maxLeads: enterprise.maxLeads,
      maxStaffSeats: enterprise.maxStaffSeats,
      adminNotes: 'Primary Zacma Technology HQ organization (Platform Owner).',
      authorizedUserIds: [params.ownerId],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveSaasPlan(plan: Omit<SaasPlan, 'updatedAt'>): Promise<void> {
  const safeId = clampStr(plan.id || makeId('plan'), 128);
  const path = `saasPlans/${safeId}`;
  try {
    await setDoc(doc(db, path), {
      id: safeId,
      code: slugify(plan.code || plan.name).slice(0, 40) || 'plan',
      name: clampStr(plan.name.trim(), 100),
      audience: clampStr(plan.audience.trim(), 140),
      tagline: clampStr(plan.tagline.trim(), 240),
      monthlyPriceEtb: Math.max(0, Math.min(10000000, Number(plan.monthlyPriceEtb) || 0)),
      monthlyPriceUsd: Math.max(0, Math.min(100000, Number(plan.monthlyPriceUsd) || 0)),
      annualDiscountPercent: Math.max(0, Math.min(90, Number(plan.annualDiscountPercent) || 0)),
      maxBusinessUnits: Math.max(1, Math.min(10000, Number(plan.maxBusinessUnits) || 1)),
      maxForms: Math.max(1, Math.min(100000, Number(plan.maxForms) || 1)),
      maxLeads: Math.max(1, Math.min(10000000, Number(plan.maxLeads) || 100)),
      maxStaffSeats: Math.max(1, Math.min(10000, Number(plan.maxStaffSeats) || 1)),
      includesAiSupport: Boolean(plan.includesAiSupport),
      includesSmsEmailAi: Boolean(plan.includesSmsEmailAi),
      includesWhiteLabel: Boolean(plan.includesWhiteLabel),
      features: (plan.features || []).map((f) => clampStr(f.trim(), 180)).filter(Boolean).slice(0, 20),
      isRecommended: Boolean(plan.isRecommended),
      isActive: Boolean(plan.isActive),
      sortOrder: Math.max(0, Math.min(100, Number(plan.sortOrder) || 1)),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function provisionNewTenantWorkspace(params: {
  companyName: string;
  industryId: string;
  primaryColor?: string;
  billingPhone?: string;
  plan: SaasPlan;
  billingCycle: 'monthly' | 'annual';
  currency: 'ETB' | 'USD';
  ownerUid: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhotoURL?: string;
  initialStatus?: SaasTenantStatus;
  paymentMethod?: SaasPaymentMethod;
  paymentReference?: string;
  switchUserProfileToNewOrg?: boolean;
  adminNotes?: string;
}): Promise<{ organizationId: string; organizationSlug: string }> {
  const cleanCompany = clampStr(params.companyName.trim(), 140);
  if (cleanCompany.length < 2) {
    throw new Error('Company or business name must be at least 2 characters.');
  }

  const blueprint =
    SAAS_INDUSTRY_BLUEPRINTS.find((b) => b.id === params.industryId) || SAAS_INDUSTRY_BLUEPRINTS[0];

  const baseSlug = slugify(cleanCompany).slice(0, 48) || 'business';
  const suffix = Math.random().toString(36).slice(2, 6);
  const organizationSlug = `${baseSlug}-${suffix}`.slice(0, 80);
  const organizationId = `org_${baseSlug.replace(/-/g, '_').slice(0, 32)}_${suffix}`;
  const brandColor = clampStr(params.primaryColor || blueprint.brandColor || '#1D4ED8', 20);
  const status: SaasTenantStatus = params.initialStatus || 'trial';
  const pricing = computePlanCyclePrice(params.plan, params.billingCycle);
  const trialEndsAt = status === 'trial' ? formatIsoDatePlusDays(14) : '';
  const currentPeriodEnd =
    status === 'trial'
      ? trialEndsAt
      : formatIsoDatePlusDays(params.billingCycle === 'annual' ? 365 : 30);

  // Batch 1: Core Organization, Super Admin Membership, Tenant Subscription, and optional User Profile switch
  try {
    const batch1 = writeBatch(db);

    batch1.set(doc(db, `organizations/${organizationId}`), {
      id: organizationId,
      name: cleanCompany,
      slug: organizationSlug,
      ownerId: params.ownerUid,
      primaryColor: brandColor,
      secondaryColor: '#0F172A',
      duplicateMatchMode: 'email_or_phone',
      authorizedUserIds: [params.ownerUid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch1.set(doc(db, `organizations/${organizationId}/members/${params.ownerUid}`), {
      userId: params.ownerUid,
      organizationId,
      email: clampStr(params.ownerEmail, 200),
      displayName: clampStr(params.ownerName || params.ownerEmail || 'Business Owner', 120),
      role: 'super_admin',
      crmAccess: true,
      assignedBusinessUnitIds: [],
      status: 'active',
      ownerId: params.ownerUid,
      authorizedUserIds: [params.ownerUid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch1.set(doc(db, `saasTenants/${organizationId}`), {
      organizationId,
      organizationName: cleanCompany,
      organizationSlug,
      industry: clampStr(blueprint.label, 100),
      ownerId: params.ownerUid,
      ownerName: clampStr(params.ownerName || params.ownerEmail, 140),
      ownerEmail: clampStr(params.ownerEmail, 200),
      billingPhone: clampStr(params.billingPhone || '', 60),
      planId: params.plan.id,
      planName: clampStr(params.plan.name, 100),
      requestedPlanId: '',
      billingCycle: params.billingCycle,
      currency: params.currency,
      mrrEtb: status === 'active' ? pricing.monthlyEquivalentEtb : 0,
      mrrUsd: status === 'active' ? pricing.monthlyEquivalentUsd : 0,
      status,
      paymentMethod: params.paymentMethod || (status === 'trial' ? 'trial' : 'invoice'),
      paymentReference: clampStr(params.paymentReference || '', 140),
      trialEndsAt,
      currentPeriodEnd,
      maxBusinessUnits: params.plan.maxBusinessUnits,
      maxForms: params.plan.maxForms,
      maxLeads: params.plan.maxLeads,
      maxStaffSeats: params.plan.maxStaffSeats,
      adminNotes: clampStr(params.adminNotes || '', 1500),
      authorizedUserIds: [params.ownerUid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (params.switchUserProfileToNewOrg !== false) {
      batch1.update(doc(db, `users/${params.ownerUid}`), {
        displayName: clampStr(params.ownerName || params.ownerEmail || 'Business Owner', 120),
        photoURL: clampStr(params.ownerPhotoURL || '', 500),
        organizationId,
        role: 'super_admin',
        crmAccess: true,
        updatedAt: serverTimestamp(),
      });
    }

    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `organizations/${organizationId}`);
  }

  // Batch 2: Starter Business Unit, AI Support Config, Integrations Governance, and Audit Log
  try {
    const batch2 = writeBatch(db);
    const buId = makeId('bu');
    const buSlug = slugify(`${baseSlug}-main`).slice(0, 80) || 'main-branch';

    batch2.set(doc(db, `organizations/${organizationId}/businessUnits/${buId}`), {
      id: buId,
      organizationId,
      name: clampStr(`${cleanCompany} — ${blueprint.defaultUnitName}`, 140),
      slug: buSlug,
      description: clampStr(blueprint.description, 1500),
      category: clampStr(blueprint.category, 100),
      services: blueprint.services.slice(0, 40),
      logoUrl: '',
      brandColor,
      contactEmail: clampStr(params.ownerEmail, 200),
      phoneNumber: clampStr(params.billingPhone || '', 50),
      physicalAddress: '',
      website: '',
      assignedAdminIds: [params.ownerUid],
      assignedStaffIds: [params.ownerUid],
      status: 'active',
      ownerId: params.ownerUid,
      authorizedUserIds: [params.ownerUid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch2.set(doc(db, `publicSupport/${organizationId}`), {
      organizationId,
      isActive: params.plan.includesAiSupport,
      assistantName: clampStr(`${cleanCompany} AI Assistant`, 100),
      welcomeMessage: clampStr(blueprint.welcomeMessage, 1000),
      aiInstructions: clampStr(
        `You are the official AI Assistant for ${cleanCompany} (${blueprint.label}). Help prospective customers with services, inquiries, and lead capture politely and accurately in English or Amharic.`,
        3000
      ),
      supportedLanguages: ['en', 'am'],
      trainingInstituteBuId: buId,
      trainingInstituteName: cleanCompany,
      registrationFormUrl: '',
      orgOwnerId: params.ownerUid,
      updatedAt: serverTimestamp(),
    });

    const starterIntegrations = [
      {
        id: 'int_gemini_ai',
        providerKey: 'gemini_ai',
        displayName: 'Google Gemini AI (Platform Managed)',
        purpose: 'Powers the AI Form Generator, Email/SMS Writer, and AI Customer Support Assistant.',
        requiredCredentials: ['GEMINI_API_KEY (Platform Managed)'],
        estimatedCost: 'Included in your Zacma Cloud subscription tier',
        approvalStatus: 'enabled',
        approvedBy: params.ownerUid,
      },
      {
        id: 'int_resend_email',
        providerKey: 'resend_email',
        displayName: 'Resend Transactional & Bulk Email',
        purpose: 'Delivers branded Email outreach from your Communication Center.',
        requiredCredentials: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
        estimatedCost: 'Included via platform gateway or bring-your-own key',
        approvalStatus: 'pending_approval',
        approvedBy: '',
      },
      {
        id: 'int_twilio_sms',
        providerKey: 'twilio_sms',
        displayName: 'Twilio / AfroMessage SMS Gateway',
        purpose: 'Sends individual and bulk SMS messages in English and Amharic.',
        requiredCredentials: ['AFROMESSAGE_API_TOKEN or TWILIO_ACCOUNT_SID'],
        estimatedCost: 'Carrier per-SMS pricing',
        approvalStatus: 'pending_approval',
        approvedBy: '',
      },
    ];

    for (const item of starterIntegrations) {
      batch2.set(doc(db, `organizations/${organizationId}/integrations/${item.id}`), {
        ...item,
        organizationId,
        ownerId: params.ownerUid,
        authorizedUserIds: [params.ownerUid],
        updatedAt: serverTimestamp(),
      });
    }

    const logId = makeId('log');
    batch2.set(doc(db, `organizations/${organizationId}/auditLogs/${logId}`), {
      id: logId,
      organizationId,
      actorId: params.ownerUid,
      actorName: clampStr(params.ownerName || params.ownerEmail, 120),
      action: 'tenant.provisioned',
      resourceType: 'organization',
      resourceId: organizationId,
      summary: clampStr(
        `Provisioned workspace "${cleanCompany}" on ${params.plan.name} plan (${status}).`,
        500
      ),
      ownerId: params.ownerUid,
      authorizedUserIds: [params.ownerUid],
      createdAt: serverTimestamp(),
    });

    await batch2.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `organizations/${organizationId}/businessUnits`);
  }

  return { organizationId, organizationSlug };
}

export async function switchActiveOrganization(params: {
  uid: string;
  displayName: string;
  photoURL?: string;
  targetOrganizationId: string;
}): Promise<void> {
  const path = `users/${params.uid}`;
  try {
    await updateDoc(doc(db, path), {
      displayName: clampStr(params.displayName || 'Workspace User', 120),
      photoURL: clampStr(params.photoURL || '', 500),
      organizationId: params.targetOrganizationId,
      role: 'super_admin',
      crmAccess: true,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateTenantSubscriptionByAdmin(params: {
  organizationId: string;
  plan?: SaasPlan;
  status: SaasTenantStatus;
  billingCycle: 'monthly' | 'annual';
  currency: 'ETB' | 'USD';
  paymentMethod: SaasPaymentMethod;
  paymentReference: string;
  trialEndsAt: string;
  currentPeriodEnd: string;
  adminNotes: string;
  currentSub: SaasTenantSubscription;
}): Promise<void> {
  const path = `saasTenants/${params.organizationId}`;
  const plan = params.plan;
  const pricing = plan
    ? computePlanCyclePrice(plan, params.billingCycle)
    : {
        monthlyEquivalentEtb: params.currentSub.mrrEtb,
        monthlyEquivalentUsd: params.currentSub.mrrUsd,
      };
  try {
    await updateDoc(doc(db, path), {
      planId: plan ? plan.id : params.currentSub.planId,
      planName: plan ? clampStr(plan.name, 100) : params.currentSub.planName,
      requestedPlanId: '',
      status: params.status,
      billingCycle: params.billingCycle,
      currency: params.currency,
      mrrEtb: params.status === 'active' ? pricing.monthlyEquivalentEtb : 0,
      mrrUsd: params.status === 'active' ? pricing.monthlyEquivalentUsd : 0,
      paymentMethod: params.paymentMethod,
      paymentReference: clampStr(params.paymentReference, 140),
      trialEndsAt: clampStr(params.trialEndsAt, 40),
      currentPeriodEnd: clampStr(params.currentPeriodEnd, 40),
      maxBusinessUnits: plan ? plan.maxBusinessUnits : params.currentSub.maxBusinessUnits,
      maxForms: plan ? plan.maxForms : params.currentSub.maxForms,
      maxLeads: plan ? plan.maxLeads : params.currentSub.maxLeads,
      maxStaffSeats: plan ? plan.maxStaffSeats : params.currentSub.maxStaffSeats,
      adminNotes: clampStr(params.adminNotes, 1500),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function submitTenantUpgradePayment(params: {
  tenant: SaasTenantSubscription;
  targetPlan: SaasPlan;
  billingCycle: 'monthly' | 'annual';
  currency: 'ETB' | 'USD';
  paymentMethod: Exclude<SaasPaymentMethod, 'trial'>;
  paymentReference: string;
  billingPhone: string;
  notes?: string;
}): Promise<string> {
  const invoiceId = makeId('inv');
  const invoiceNumber = `ZAC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const pricing = computePlanCyclePrice(params.targetPlan, params.billingCycle);
  const issuedAt = new Date().toISOString().slice(0, 10);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, `saasTenants/${params.tenant.organizationId}`), {
      requestedPlanId: params.targetPlan.id,
      billingCycle: params.billingCycle,
      currency: params.currency,
      billingPhone: clampStr(params.billingPhone, 60),
      paymentMethod: params.paymentMethod,
      paymentReference: clampStr(params.paymentReference, 140),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, `saasInvoices/${invoiceId}`), {
      id: invoiceId,
      invoiceNumber,
      organizationId: params.tenant.organizationId,
      organizationName: clampStr(params.tenant.organizationName, 140),
      ownerId: params.tenant.ownerId,
      planId: params.targetPlan.id,
      planName: clampStr(params.targetPlan.name, 100),
      billingCycle: params.billingCycle,
      amountEtb: pricing.etb,
      amountUsd: pricing.usd,
      paymentMethod: params.paymentMethod,
      paymentReference: clampStr(params.paymentReference, 140),
      status: 'pending_verification',
      notes: clampStr(params.notes || `Upgrade / renewal request for ${params.targetPlan.name} (${params.billingCycle}).`, 800),
      issuedAt,
      paidAt: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return invoiceNumber;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `saasInvoices/${invoiceId}`);
  }
}

export async function approveSaasInvoicePayment(params: {
  invoice: SaasInvoice;
  tenant: SaasTenantSubscription;
  plan: SaasPlan;
}): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const nextPeriodEnd = formatIsoDatePlusDays(params.invoice.billingCycle === 'annual' ? 365 : 30);
  const pricing = computePlanCyclePrice(params.plan, params.invoice.billingCycle);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, `saasInvoices/${params.invoice.id}`), {
      status: 'paid',
      paidAt: today,
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, `saasTenants/${params.tenant.organizationId}`), {
      planId: params.plan.id,
      planName: clampStr(params.plan.name, 100),
      requestedPlanId: '',
      billingCycle: params.invoice.billingCycle,
      status: 'active',
      mrrEtb: pricing.monthlyEquivalentEtb,
      mrrUsd: pricing.monthlyEquivalentUsd,
      paymentMethod: params.invoice.paymentMethod,
      paymentReference: clampStr(params.invoice.paymentReference, 140),
      currentPeriodEnd: nextPeriodEnd,
      maxBusinessUnits: params.plan.maxBusinessUnits,
      maxForms: params.plan.maxForms,
      maxLeads: params.plan.maxLeads,
      maxStaffSeats: params.plan.maxStaffSeats,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `saasInvoices/${params.invoice.id}`);
  }
}

export async function submitPublicSaasInquiry(input: {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  industry: string;
  branchCount: string;
  interestedPlan: string;
  message: string;
}): Promise<string> {
  const id = makeId('inq');
  const path = `saasSalesInquiries/${id}`;
  try {
    await setDoc(doc(db, path), {
      id,
      companyName: clampStr(input.companyName.trim(), 140),
      contactName: clampStr(input.contactName.trim(), 140),
      email: clampStr(input.email.trim(), 200),
      phone: clampStr(input.phone.trim(), 60),
      industry: clampStr(input.industry.trim(), 100),
      branchCount: clampStr(input.branchCount.trim(), 40),
      interestedPlan: clampStr(input.interestedPlan.trim(), 100),
      message: clampStr(input.message.trim(), 1500),
      status: 'new',
      createdAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateSaasInquiryStatus(
  inquiryId: string,
  status: SaasSalesInquiry['status']
): Promise<void> {
  const path = `saasSalesInquiries/${inquiryId}`;
  try {
    await updateDoc(doc(db, path), { status });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function fetchPublicSaasPlans(): Promise<SaasPlan[]> {
  try {
    const snap = await getDocs(
      query(collection(db, 'saasPlans'), where('isActive', '==', true))
    );
    if (snap.empty) {
      return DEFAULT_SAAS_PLANS.map((p) => ({ ...p, updatedAt: null }));
    }
    return snap.docs
      .map((d) => d.data() as SaasPlan)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return DEFAULT_SAAS_PLANS.map((p) => ({ ...p, updatedAt: null }));
  }
}
