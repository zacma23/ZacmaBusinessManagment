export type UserRole =
  | 'super_admin'
  | 'org_admin'
  | 'bu_manager'
  | 'staff'
  | 'accountant'
  | 'instructor';

export type DuplicateMatchMode =
  | 'email_or_phone'
  | 'email_only'
  | 'phone_only'
  | 'email_and_phone';

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'interested'
  | 'converted'
  | 'lost'
  | 'archived';

export type LeadPriority = 'low' | 'medium' | 'high' | 'urgent';

export type FormFieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'time'
  | 'dropdown'
  | 'multi_select'
  | 'radio'
  | 'checkboxes'
  | 'file_upload'
  | 'image_upload'
  | 'address'
  | 'url'
  | 'yes_no'
  | 'section_heading'
  | 'conditional';

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  helperText?: string;
  required: boolean;
  section?: string;
  options?: string[];
  validation?: FieldValidation;
  conditionalOnFieldId?: string;
  conditionalEqualsValue?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  organizationId: string;
  role: UserRole;
  crmAccess: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  primaryColor: string;
  secondaryColor: string;
  duplicateMatchMode: DuplicateMatchMode;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface OrganizationMember {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  role: UserRole;
  crmAccess: boolean;
  assignedBusinessUnitIds: string[];
  status: 'active' | 'inactive' | 'invited';
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface BusinessUnit {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
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
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface DynamicForm {
  id: string;
  organizationId: string;
  businessUnitId: string;
  businessUnitSlug: string;
  businessUnitName: string;
  title: string;
  slug: string;
  publicSlugKey: string;
  description: string;
  fields: FormField[];
  isPublished: boolean;
  isActive: boolean;
  submissionLimit: number;
  submissionCount: number;
  confirmationMessage: string;
  brandColor: string;
  logoUrl: string;
  aiPrompt: string;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PublicFormProjection {
  publicSlugKey: string;
  organizationId: string;
  businessUnitId: string;
  businessUnitSlug: string;
  businessUnitName: string;
  formId: string;
  formSlug: string;
  title: string;
  description: string;
  fields: FormField[];
  isPublished: boolean;
  isActive: boolean;
  submissionLimit: number;
  confirmationMessage: string;
  brandColor: string;
  logoUrl: string;
  orgOwnerId: string;
  updatedAt: unknown;
}

export interface FormSubmission {
  id: string;
  organizationId: string;
  businessUnitId: string;
  businessUnitName: string;
  formId: string;
  formTitle: string;
  publicSlugKey: string;
  leadId: string;
  leadRef: string;
  responses: Record<string, unknown>;
  submitterName: string;
  submitterEmail: string;
  submitterPhone: string;
  source: 'public_form' | 'manual_entry' | 'portal_preview';
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
}

export interface LeadAttachment {
  id: string;
  name: string;
  url: string;
  uploadedAt: string;
}

export interface Lead {
  id: string;
  leadRef: string;
  organizationId: string;
  businessUnitId: string;
  businessUnitName: string;
  formId: string;
  formTitle: string;
  submissionId: string;
  publicSlugKey: string;
  fullName: string;
  email: string;
  phone: string;
  responses: Record<string, unknown>;
  source: string;
  assignedStaffId: string;
  assignedStaffName: string;
  status: LeadStatus;
  priority: LeadPriority;
  followUpDate: string;
  lastContactAt: string;
  internalNotes: string;
  attachments: LeadAttachment[];
  ownerId: string;
  authorizedUserIds: string[];
  submittedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface LeadActivity {
  id: string;
  organizationId: string;
  leadId: string;
  type:
    | 'submission'
    | 'status_change'
    | 'assignment'
    | 'note'
    | 'call'
    | 'meeting'
    | 'followup'
    | 'communication'
    | 'archive'
    | 'restore'
    | 'edit';
  summary: string;
  details: string;
  actorId: string;
  actorName: string;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
}

export interface CommunicationRecord {
  id: string;
  organizationId: string;
  businessUnitId: string;
  leadId: string;
  leadName: string;
  channel: 'email' | 'sms';
  recipient: string;
  subject: string;
  body: string;
  deliveryStatus: 'sent' | 'queued_pending_provider_approval' | 'failed';
  provider: string;
  senderId: string;
  senderName: string;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
}

export interface MessageTemplate {
  id: string;
  organizationId: string;
  businessUnitId: string;
  name: string;
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  actorId: string;
  actorName: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
}

export interface IntegrationConfig {
  id: string;
  organizationId: string;
  providerKey: 'gemini_ai' | 'resend_email' | 'twilio_sms' | 'whatsapp_cloud';
  displayName: string;
  purpose: string;
  requiredCredentials: string[];
  estimatedCost: string;
  approvalStatus: 'enabled' | 'pending_approval' | 'approved_awaiting_env' | 'disabled';
  approvedBy: string;
  ownerId: string;
  authorizedUserIds: string[];
  updatedAt: unknown;
}

export interface AppNotification {
  id: string;
  organizationId: string;
  recipientUserId: string;
  title: string;
  message: string;
  entityType: 'lead' | 'form' | 'followup' | 'integration';
  entityId: string;
  isRead: boolean;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
}

export interface PublicSupportConfig {
  organizationId: string;
  isActive: boolean;
  assistantName: string;
  welcomeMessage: string;
  aiInstructions: string;
  supportedLanguages: string[];
  trainingInstituteBuId: string;
  trainingInstituteName: string;
  registrationFormUrl: string;
  orgOwnerId: string;
  updatedAt: unknown;
}

export interface TrainingCourse {
  id: string;
  organizationId: string;
  title: string;
  category: string;
  description: string;
  learningObjectives: string[];
  qualifications: string;
  duration: string;
  deliveryMethods: string[];
  schedules: string;
  availableBatches: string;
  certificateInfo: string;
  approvedFee: string;
  registrationProcedure: string;
  isActive: boolean;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export type SupportKnowledgeCategory =
  | 'registration'
  | 'payment'
  | 'schedule'
  | 'location'
  | 'attendance'
  | 'certificates'
  | 'materials'
  | 'student_services'
  | 'general';

export interface SupportKnowledgeItem {
  id: string;
  organizationId: string;
  category: SupportKnowledgeCategory;
  question: string;
  answer: string;
  language: 'en' | 'am' | 'both';
  isActive: boolean;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface SupportChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'agent';
  text: string;
  timestamp: string;
}

export interface SupportConversation {
  id: string;
  organizationId: string;
  businessUnitId: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string;
  studentUid: string;
  language: 'en' | 'am' | 'other';
  intent: 'course_inquiry' | 'registration' | 'student_support' | 'escalation' | 'general';
  interestedCourse: string;
  status: 'active' | 'escalated' | 'assigned' | 'resolved';
  assignedAgentId: string;
  assignedAgentName: string;
  unansweredQuestions: string[];
  leadId: string;
  leadRef: string;
  messages: SupportChatMessage[];
  summary: string;
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface StudentRegistration {
  id: string;
  organizationId: string;
  businessUnitId: string;
  leadId: string;
  leadRef: string;
  studentUid: string;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  preferredCourse: string;
  deliveryMethod: string;
  preferredSchedule: string;
  paymentMethod: string;
  registrationStatus: 'submitted' | 'under_review' | 'approved' | 'enrolled' | 'completed';
  batchName: string;
  classSchedule: string;
  trainingLocation: string;
  paymentStatus: 'pending' | 'partial' | 'paid';
  certificateStatus: 'not_issued' | 'in_progress' | 'issued';
  documentUploadFormUrl: string;
  source: 'ai_chat' | 'public_form' | 'portal';
  ownerId: string;
  authorizedUserIds: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface RegistrationDraft {
  fullName?: string;
  phone?: string;
  email?: string;
  address?: string;
  preferredCourse?: string;
  deliveryMethod?: string;
  preferredSchedule?: string;
  paymentMethod?: string;
  readyForConfirmation?: boolean;
}

export type NavSection =
  | 'business_overview'
  | 'business_units'
  | 'business_staff'
  | 'business_reports'
  | 'ai_form_generator'
  | 'form_builder'
  | 'published_forms'
  | 'form_submissions'
  | 'form_analytics'
  | 'crm_dashboard'
  | 'all_leads'
  | 'lead_pipeline'
  | 'follow_ups'
  | 'communication_center'
  | 'message_templates'
  | 'crm_reports'
  | 'ai_support_overview'
  | 'ai_support_courses'
  | 'ai_support_knowledge'
  | 'ai_support_inbox'
  | 'integrations_security';

export interface LeadFilterPreset {
  businessUnitId?: string;
  formId?: string;
  status?: LeadStatus | 'all';
  assignment?: 'all' | 'assigned' | 'unassigned';
  search?: string;
}
