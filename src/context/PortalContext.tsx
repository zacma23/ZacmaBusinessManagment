import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  BOOTSTRAP_SUPER_ADMIN_EMAIL,
  DEFAULT_ORG_ID,
  detectDuplicateLeads,
  timestampToMillis,
} from '../lib/zacmaService';
import {
  changeAuthenticatedUserPassword,
  computeSubscriptionPolicy,
  logLoginActivity,
  loginWithUsernameAndPassword,
  resolveEffectivePermissions,
} from '../lib/authService';
import type {
  AppNotification,
  AuditLog,
  BusinessUnit,
  DynamicForm,
  FormSubmission,
  IntegrationConfig,
  Lead,
  LoginActivityRecord,
  MemberPermissions,
  MessageTemplate,
  Organization,
  OrganizationMember,
  PublicSupportConfig,
  SaasInvoice,
  SaasPlan,
  SaasSalesInquiry,
  SaasTenantSubscription,
  StudentRegistration,
  SubscriptionPolicy,
  SupportConversation,
  SupportKnowledgeItem,
  TrainingCourse,
  UserProfile,
  UserRole,
} from '../types';
import {
  DEFAULT_SUPPORT_AI_INSTRUCTIONS,
  DEFAULT_SUPPORT_WELCOME_MESSAGE,
  seedEighteenInstituteCourses,
} from '../lib/supportService';
import {
  DEFAULT_SAAS_PLANS,
  ensureRootTenantSubscription,
  seedDefaultSaasPlans,
  switchActiveOrganization,
} from '../lib/saasService';

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes inactivity auto-logout
const IDLE_WARNING_MS = 2 * 60 * 1000; // Show 2-minute countdown warning before logout

interface PortalContextValue {
  user: User | null;
  authLoading: boolean;
  dataLoading: boolean;
  profile: UserProfile | null;
  organization: Organization | null;
  myOrganizations: Organization[];
  currentMember: OrganizationMember | null;
  effectiveRole: UserRole;
  effectiveCrmAccess: boolean;
  effectivePermissions: MemberPermissions;
  isSuperAdmin: boolean;
  isPlatformOwner: boolean;
  isStudent: boolean;
  mustChangePassword: boolean;
  accountBlockedReason: 'inactive' | 'suspended' | null;
  subscriptionPolicy: SubscriptionPolicy;
  sessionWarningSeconds: number | null;
  extendSession: () => void;
  members: OrganizationMember[];
  loginActivity: LoginActivityRecord[];
  businessUnits: BusinessUnit[];
  forms: DynamicForm[];
  submissions: FormSubmission[];
  leads: Lead[];
  duplicateLeadMap: Map<string, string[]>;
  templates: MessageTemplate[];
  auditLogs: AuditLog[];
  integrations: IntegrationConfig[];
  notifications: AppNotification[];
  supportConfig: PublicSupportConfig | null;
  courses: TrainingCourse[];
  knowledgeItems: SupportKnowledgeItem[];
  supportConversations: SupportConversation[];
  studentRegistrations: StudentRegistration[];
  saasPlans: SaasPlan[];
  currentTenantSubscription: SaasTenantSubscription | null;
  allTenantSubscriptions: SaasTenantSubscription[];
  saasInvoices: SaasInvoice[];
  saasSalesInquiries: SaasSalesInquiry[];
  signInWithGoogle: () => Promise<void>;
  signInWithUsername: (identifier: string, password: string) => Promise<void>;
  changeCurrentUserPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  switchOrganization: (targetOrgId: string) => Promise<void>;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [myOrganizations, setMyOrganizations] = useState<Organization[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [ownMemberDoc, setOwnMemberDoc] = useState<OrganizationMember | null>(null);
  const [loginActivity, setLoginActivity] = useState<LoginActivityRecord[]>([]);
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [formsByUnit, setFormsByUnit] = useState<Record<string, DynamicForm[]>>({});
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [supportConfig, setSupportConfig] = useState<PublicSupportConfig | null>(null);
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<SupportKnowledgeItem[]>([]);
  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([]);
  const [studentRegistrations, setStudentRegistrations] = useState<StudentRegistration[]>([]);

  // Commercial Multi-Tenant SaaS state
  const [saasPlans, setSaasPlans] = useState<SaasPlan[]>(
    DEFAULT_SAAS_PLANS.map((p) => ({ ...p, updatedAt: null }))
  );
  const [currentTenantSubscription, setCurrentTenantSubscription] =
    useState<SaasTenantSubscription | null>(null);
  const [allTenantSubscriptions, setAllTenantSubscriptions] = useState<SaasTenantSubscription[]>([]);
  const [saasInvoices, setSaasInvoices] = useState<SaasInvoice[]>([]);
  const [saasSalesInquiries, setSaasSalesInquiries] = useState<SaasSalesInquiry[]>([]);

  // Inactivity session guard
  const lastActivityAtRef = useRef<number>(Date.now());
  const loggedSessionUidRef = useRef<string | null>(null);
  const [sessionWarningSeconds, setSessionWarningSeconds] = useState<number | null>(null);

  const isBootstrapSuper = Boolean(
    user?.email &&
      user.emailVerified &&
      user.email.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL.toLowerCase()
  );

  // 1. Auth state listener & first-login organization bootstrap
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        loggedSessionUidRef.current = null;
        setSessionWarningSeconds(null);
        setProfile(null);
        setOrganization(null);
        setMyOrganizations([]);
        setMembers([]);
        setOwnMemberDoc(null);
        setLoginActivity([]);
        setBusinessUnits([]);
        setFormsByUnit({});
        setSubmissions([]);
        setLeads([]);
        setTemplates([]);
        setAuditLogs([]);
        setIntegrations([]);
        setNotifications([]);
        setSupportConfig(null);
        setCourses([]);
        setKnowledgeItems([]);
        setSupportConversations([]);
        setStudentRegistrations([]);
        setCurrentTenantSubscription(null);
        setAllTenantSubscriptions([]);
        setSaasInvoices([]);
        setSaasSalesInquiries([]);
        setAuthLoading(false);
        return;
      }

      lastActivityAtRef.current = Date.now();
      setDataLoading(true);
      try {
        const userRef = doc(db, `users/${firebaseUser.uid}`);
        const userSnap = await getDoc(userRef);

        const isBootstrap =
          Boolean(firebaseUser.emailVerified) &&
          firebaseUser.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL.toLowerCase();

        const isPasswordProvider = firebaseUser.providerData?.some(
          (p) => p.providerId === 'password'
        );

        let orgId = DEFAULT_ORG_ID;
        const nowIso = new Date().toISOString();

        if (!userSnap.exists()) {
          const initialRole: UserRole = isBootstrap ? 'super_admin' : 'staff';
          const initialCrmAccess = isBootstrap;
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || firebaseUser.email || 'Zacma User',
            photoURL: firebaseUser.photoURL || '',
            username: '',
            phone: '',
            authProvider: isPasswordProvider ? 'username_password' : 'google',
            mustChangePassword: false,
            status: 'active',
            lastLoginAt: nowIso,
            organizationId: orgId,
            role: initialRole,
            crmAccess: initialCrmAccess,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(userRef, newProfile);
          setProfile(newProfile);
        } else {
          const existingProfile = userSnap.data() as UserProfile;
          orgId = existingProfile.organizationId || DEFAULT_ORG_ID;
          setProfile(existingProfile);
          // Stamp lastLoginAt cleanly
          await updateDoc(userRef, {
            lastLoginAt: nowIso,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }

        // If bootstrapped Super Admin (Platform Owner), ensure root organization, plans, and 18 institute courses exist
        if (isBootstrap) {
          const rootOrgRef = doc(db, `organizations/${DEFAULT_ORG_ID}`);
          const rootOrgSnap = await getDoc(rootOrgRef);

          if (!rootOrgSnap.exists()) {
            const batch = writeBatch(db);
            batch.set(rootOrgRef, {
              id: DEFAULT_ORG_ID,
              name: 'Zacma Technology',
              slug: 'zacma',
              ownerId: firebaseUser.uid,
              primaryColor: '#1D4ED8',
              secondaryColor: '#DC2626',
              duplicateMatchMode: 'email_or_phone',
              authorizedUserIds: [firebaseUser.uid],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            batch.set(doc(db, `organizations/${DEFAULT_ORG_ID}/members/${firebaseUser.uid}`), {
              userId: firebaseUser.uid,
              organizationId: DEFAULT_ORG_ID,
              email: firebaseUser.email || BOOTSTRAP_SUPER_ADMIN_EMAIL,
              username: 'superadmin',
              phone: '',
              displayName: firebaseUser.displayName || 'Zacma Super Admin',
              role: 'super_admin',
              crmAccess: true,
              authProvider: 'google',
              mustChangePassword: false,
              lastLoginAt: nowIso,
              assignedBusinessUnitIds: [],
              status: 'active',
              ownerId: firebaseUser.uid,
              authorizedUserIds: [firebaseUser.uid],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            const defaultIntegrations: Array<Omit<IntegrationConfig, 'updatedAt'>> = [
              {
                id: 'int_gemini_ai',
                organizationId: DEFAULT_ORG_ID,
                providerKey: 'gemini_ai',
                displayName: 'Google Gemini AI (Configured)',
                purpose:
                  'Powers the AI Form Generator and permission-scoped Zacma AI Assistant via server-side API.',
                requiredCredentials: ['GEMINI_API_KEY (Injected server-side)'],
                estimatedCost: 'Existing AI Studio / Gemini API allocation',
                approvalStatus: 'enabled',
                approvedBy: firebaseUser.uid,
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
              {
                id: 'int_resend_email',
                organizationId: DEFAULT_ORG_ID,
                providerKey: 'resend_email',
                displayName: 'Resend Transactional & Bulk Email',
                purpose:
                  'Delivers individual and bulk personalized emails from the CRM Communication Center.',
                requiredCredentials: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
                estimatedCost: 'Free tier up to 3,000 emails/mo; Pro starts at $20/mo',
                approvalStatus: 'pending_approval',
                approvedBy: '',
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
              {
                id: 'int_twilio_sms',
                organizationId: DEFAULT_ORG_ID,
                providerKey: 'twilio_sms',
                displayName: 'Twilio / AfroMessage Programmable SMS',
                purpose:
                  'Sends individual and bulk SMS messages and follow-up reminders to CRM leads.',
                requiredCredentials: [
                  'TWILIO_ACCOUNT_SID',
                  'TWILIO_AUTH_TOKEN',
                  'TWILIO_FROM_NUMBER',
                ],
                estimatedCost: 'Pay-as-you-go (~$0.0079/SMS US; regional carrier rates apply)',
                approvalStatus: 'pending_approval',
                approvedBy: '',
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
              {
                id: 'int_whatsapp_cloud',
                organizationId: DEFAULT_ORG_ID,
                providerKey: 'whatsapp_cloud',
                displayName: 'WhatsApp Business Cloud API',
                purpose: 'Enables verified business messaging and lead follow-ups over WhatsApp.',
                requiredCredentials: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
                estimatedCost:
                  'Meta per-conversation pricing after 1,000 free service conversations/mo',
                approvalStatus: 'pending_approval',
                approvedBy: '',
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
            ];

            for (const intItem of defaultIntegrations) {
              batch.set(doc(db, `organizations/${DEFAULT_ORG_ID}/integrations/${intItem.id}`), {
                ...intItem,
                updatedAt: serverTimestamp(),
              });
            }

            await batch.commit();
          }

          // Seed SaaS Commercial Plans & Root Tenant record
          await seedDefaultSaasPlans();
          await ensureRootTenantSubscription({
            organizationId: DEFAULT_ORG_ID,
            organizationName: 'Zacma Technology',
            organizationSlug: 'zacma',
            ownerId: firebaseUser.uid,
            ownerName: firebaseUser.displayName || 'Zacma Super Admin',
            ownerEmail: firebaseUser.email || BOOTSTRAP_SUPER_ADMIN_EMAIL,
          });

          // Ensure Section 8 AI Customer Support configuration exists for Zacma HQ
          const supportRef = doc(db, `publicSupport/${DEFAULT_ORG_ID}`);
          const supportSnap = await getDoc(supportRef);
          if (!supportSnap.exists()) {
            await setDoc(supportRef, {
              organizationId: DEFAULT_ORG_ID,
              isActive: true,
              assistantName: 'ZACMA AI ASSISTANT',
              welcomeMessage: DEFAULT_SUPPORT_WELCOME_MESSAGE,
              aiInstructions: DEFAULT_SUPPORT_AI_INSTRUCTIONS,
              supportedLanguages: ['en', 'am'],
              trainingInstituteBuId: '',
              trainingInstituteName: 'Zacma Technology Training Institute',
              registrationFormUrl: '',
              orgOwnerId: firebaseUser.uid,
              updatedAt: serverTimestamp(),
            });
          }

          // Ensure all 18 administrator-approved Zacma Training Institute courses (8,500 ETB each) exist in Zacma HQ
          const existingCoursesSnap = await getDocs(
            query(collection(db, 'publicCourses'), where('organizationId', '==', DEFAULT_ORG_ID))
          );
          const existingCoursesList = existingCoursesSnap.docs.map(
            (d) => d.data() as TrainingCourse
          );
          await seedEighteenInstituteCourses({
            organizationId: DEFAULT_ORG_ID,
            ownerId: firebaseUser.uid,
            authorizedUserIds: [firebaseUser.uid],
            existingCourses: existingCoursesList,
            actorId: firebaseUser.uid,
            actorName: firebaseUser.displayName || 'Zacma Super Admin',
            skipAudit: true,
          });
        }
      } catch (error) {
        console.error('Bootstrap error:', error);
      } finally {
        setAuthLoading(false);
        setDataLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // 1b. Live UserProfile listener so workspace switches & role updates reflect immediately
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, `users/${user.uid}`),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        }
      },
      (err) => {
        console.warn('User profile listener warning:', err.message);
      }
    );
    return () => unsub();
  }, [user]);

  const orgId = profile?.organizationId || DEFAULT_ORG_ID;
  const isStudentProfile = !isBootstrapSuper && profile?.role === 'student';

  // 1c. Live Own Member Document listener (works for all roles including students)
  useEffect(() => {
    if (!user || !profile) return;
    const unsub = onSnapshot(
      doc(db, `organizations/${orgId}/members/${user.uid}`),
      (snap) => {
        setOwnMemberDoc(snap.exists() ? (snap.data() as OrganizationMember) : null);
      },
      () => {
        setOwnMemberDoc(null);
      }
    );
    return () => unsub();
  }, [user, profile?.organizationId, orgId]);

  // 1d. Global SaaS Plans, Owned Organizations, Tenant Subscriptions, Invoices & Sales Inquiries listeners
  useEffect(() => {
    if (!user || isStudentProfile) return;
    const unsubs: Array<() => void> = [];

    const plansQuery = isBootstrapSuper
      ? collection(db, 'saasPlans')
      : query(collection(db, 'saasPlans'), where('isActive', '==', true));
    unsubs.push(
      onSnapshot(
        plansQuery,
        (snap) => {
          if (!snap.empty) {
            const list = snap.docs
              .map((d) => d.data() as SaasPlan)
              .sort((a, b) => a.sortOrder - b.sortOrder);
            setSaasPlans(list);
          }
        },
        (err) => console.warn('SaaS plans read skipped:', err.message)
      )
    );

    const orgsQuery = isBootstrapSuper
      ? collection(db, 'organizations')
      : query(collection(db, 'organizations'), where('authorizedUserIds', 'array-contains', user.uid));
    unsubs.push(
      onSnapshot(
        orgsQuery,
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as Organization)
            .sort((a, b) => a.name.localeCompare(b.name));
          setMyOrganizations(list);
        },
        (err) => console.warn('Organizations list skipped:', err.message)
      )
    );

    const tenantsQuery = isBootstrapSuper
      ? collection(db, 'saasTenants')
      : query(collection(db, 'saasTenants'), where('authorizedUserIds', 'array-contains', user.uid));
    unsubs.push(
      onSnapshot(
        tenantsQuery,
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as SaasTenantSubscription)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setAllTenantSubscriptions(list);
        },
        (err) => console.warn('Tenant subscriptions skipped:', err.message)
      )
    );

    const invoicesQuery = isBootstrapSuper
      ? collection(db, 'saasInvoices')
      : query(collection(db, 'saasInvoices'), where('ownerId', '==', user.uid));
    unsubs.push(
      onSnapshot(
        invoicesQuery,
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as SaasInvoice)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setSaasInvoices(list);
        },
        (err) => console.warn('SaaS invoices skipped:', err.message)
      )
    );

    if (isBootstrapSuper) {
      unsubs.push(
        onSnapshot(
          collection(db, 'saasSalesInquiries'),
          (snap) => {
            const list = snap.docs
              .map((d) => d.data() as SaasSalesInquiry)
              .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
            setSaasSalesInquiries(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'saasSalesInquiries')
        )
      );
    } else {
      setSaasSalesInquiries([]);
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [user, isBootstrapSuper, isStudentProfile]);

  // 2. Real-time Firestore listeners scoped strictly to the active organization & role
  useEffect(() => {
    if (!user || !profile) return;

    const unsubs: Array<() => void> = [];

    // Active Organization doc (allowed for both active staff and active students)
    unsubs.push(
      onSnapshot(
        doc(db, `organizations/${orgId}`),
        (snap) => {
          setOrganization(snap.exists() ? (snap.data() as Organization) : null);
        },
        (err) => {
          console.warn('Org read skipped:', err.message);
          setOrganization(null);
        }
      )
    );

    // Student Role: strictly isolated listeners (only own registrations, own login activity, active public courses)
    if (isStudentProfile) {
      setMembers([]);
      setBusinessUnits([]);
      setFormsByUnit({});
      setSubmissions([]);
      setLeads([]);
      setTemplates([]);
      setAuditLogs([]);
      setIntegrations([]);
      setNotifications([]);
      setKnowledgeItems([]);
      setSupportConversations([]);
      setCurrentTenantSubscription(null);

      unsubs.push(
        onSnapshot(
          query(
            collection(db, `organizations/${orgId}/studentRegistrations`),
            where('studentUid', '==', user.uid)
          ),
          (snap) => {
            const list = snap.docs
              .map((d) => d.data() as StudentRegistration)
              .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
            setStudentRegistrations(list);
          },
          (err) => console.warn('Student registrations read skipped:', err.message)
        )
      );

      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'publicCourses'),
            where('organizationId', '==', orgId),
            where('isActive', '==', true)
          ),
          (snap) => {
            const list = snap.docs
              .map((d) => d.data() as TrainingCourse)
              .sort((a, b) => a.title.localeCompare(b.title));
            setCourses(list);
          },
          (err) => console.warn('Student courses read skipped:', err.message)
        )
      );

      unsubs.push(
        onSnapshot(
          query(
            collection(db, `organizations/${orgId}/loginActivity`),
            where('userId', '==', user.uid)
          ),
          (snap) => {
            const list = snap.docs
              .map((d) => d.data() as LoginActivityRecord)
              .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
            setLoginActivity(list);
          },
          (err) => console.warn('Student login activity skipped:', err.message)
        )
      );

      return () => {
        unsubs.forEach((fn) => fn());
      };
    }

    const makeQuery = (colPath: string) => {
      const ref = collection(db, colPath);
      return isBootstrapSuper
        ? ref
        : query(ref, where('authorizedUserIds', 'array-contains', user.uid));
    };

    // Active Tenant Subscription doc
    unsubs.push(
      onSnapshot(
        doc(db, `saasTenants/${orgId}`),
        (snap) => {
          setCurrentTenantSubscription(
            snap.exists() ? (snap.data() as SaasTenantSubscription) : null
          );
        },
        () => {
          setCurrentTenantSubscription(null);
        }
      )
    );

    // Members
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/members`),
        (snap) => {
          setMembers(snap.docs.map((d) => d.data() as OrganizationMember));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/members`)
      )
    );

    // Login Activity & Security Audit
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/loginActivity`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as LoginActivityRecord)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setLoginActivity(list);
        },
        (err) => console.warn('Login activity read skipped:', err.message)
      )
    );

    // Business Units
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/businessUnits`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as BusinessUnit)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setBusinessUnits(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/businessUnits`)
      )
    );

    // Leads
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/leads`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as Lead)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setLeads(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/leads`)
      )
    );

    // Form Submissions
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/formSubmissions`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as FormSubmission)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setSubmissions(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/formSubmissions`)
      )
    );

    // Message Templates
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/messageTemplates`),
        (snap) => {
          setTemplates(snap.docs.map((d) => d.data() as MessageTemplate));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/messageTemplates`)
      )
    );

    // Audit Logs
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/auditLogs`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as AuditLog)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setAuditLogs(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/auditLogs`)
      )
    );

    // Integrations Governance
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/integrations`),
        (snap) => {
          setIntegrations(snap.docs.map((d) => d.data() as IntegrationConfig));
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/integrations`)
      )
    );

    // Notifications
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/notifications`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as AppNotification)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setNotifications(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/notifications`)
      )
    );

    // Section 8: Public AI Support Config
    unsubs.push(
      onSnapshot(
        doc(db, `publicSupport/${orgId}`),
        (snap) => {
          setSupportConfig(snap.exists() ? (snap.data() as PublicSupportConfig) : null);
        },
        (err) => {
          console.warn('Public support config read skipped:', err.message);
          setSupportConfig(null);
        }
      )
    );

    // Section 8: Courses Catalog scoped to active org
    const coursesQuery = isBootstrapSuper
      ? query(collection(db, 'publicCourses'), where('organizationId', '==', orgId))
      : query(
          collection(db, 'publicCourses'),
          where('organizationId', '==', orgId),
          where('authorizedUserIds', 'array-contains', user.uid)
        );
    unsubs.push(
      onSnapshot(
        coursesQuery,
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as TrainingCourse)
            .sort((a, b) => a.title.localeCompare(b.title));
          setCourses(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'publicCourses')
      )
    );

    // Section 8: Support Knowledge & FAQs scoped to active org
    const faqsQuery = isBootstrapSuper
      ? query(collection(db, 'publicFaqs'), where('organizationId', '==', orgId))
      : query(
          collection(db, 'publicFaqs'),
          where('organizationId', '==', orgId),
          where('authorizedUserIds', 'array-contains', user.uid)
        );
    unsubs.push(
      onSnapshot(
        faqsQuery,
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as SupportKnowledgeItem)
            .sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
          setKnowledgeItems(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'publicFaqs')
      )
    );

    // Section 8: Support Conversations & Escalations
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/supportConversations`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as SupportConversation)
            .sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));
          setSupportConversations(list);
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/supportConversations`)
      )
    );

    // Section 8: Student Registrations
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/studentRegistrations`),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as StudentRegistration)
            .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
          setStudentRegistrations(list);
        },
        (err) =>
          handleFirestoreError(err, OperationType.LIST, `organizations/${orgId}/studentRegistrations`)
      )
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [user, profile?.organizationId, orgId, isBootstrapSuper, isStudentProfile]);

  // 3. Per-Business-Unit dynamic forms listeners
  useEffect(() => {
    if (!user || !profile || isStudentProfile || businessUnits.length === 0) {
      setFormsByUnit({});
      return;
    }

    const unsubs: Array<() => void> = [];
    for (const bu of businessUnits) {
      const colPath = `organizations/${orgId}/businessUnits/${bu.id}/forms`;
      const ref = collection(db, colPath);
      const q = isBootstrapSuper
        ? ref
        : query(ref, where('authorizedUserIds', 'array-contains', user.uid));

      unsubs.push(
        onSnapshot(
          q,
          (snap) => {
            const unitForms = snap.docs
              .map((d) => d.data() as DynamicForm)
              .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
            setFormsByUnit((prev) => ({ ...prev, [bu.id]: unitForms }));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, colPath)
        )
      );
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [user, profile?.organizationId, orgId, businessUnits, isBootstrapSuper, isStudentProfile]);

  const forms = useMemo(() => {
    const unitIds = new Set(businessUnits.map((b) => b.id));
    return Object.entries(formsByUnit)
      .filter(([buId]) => unitIds.has(buId))
      .flatMap(([, list]) => list)
      .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
  }, [formsByUnit, businessUnits]);

  const currentMember = useMemo(() => {
    if (!user) return null;
    if (ownMemberDoc) return ownMemberDoc;
    return (
      members.find(
        (m) =>
          m.userId === user.uid ||
          (user.email && m.email.toLowerCase() === user.email.toLowerCase())
      ) || null
    );
  }, [ownMemberDoc, members, user]);

  const effectiveRole: UserRole = isBootstrapSuper
    ? 'super_admin'
    : currentMember?.role || profile?.role || 'staff';

  const effectivePermissions = useMemo(
    () =>
      isBootstrapSuper
        ? resolveEffectivePermissions('super_admin')
        : resolveEffectivePermissions(
            effectiveRole,
            currentMember?.permissions,
            currentMember?.crmAccess ?? profile?.crmAccess
          ),
    [isBootstrapSuper, effectiveRole, currentMember, profile?.crmAccess]
  );

  const effectiveCrmAccess = effectivePermissions.crm;
  const isStudent = effectiveRole === 'student';

  const accountBlockedReason: 'inactive' | 'suspended' | null = useMemo(() => {
    if (isBootstrapSuper) return null;
    const status = currentMember?.status || profile?.status;
    if (status === 'suspended') return 'suspended';
    if (status === 'inactive') return 'inactive';
    return null;
  }, [isBootstrapSuper, currentMember?.status, profile?.status]);

  const mustChangePassword = useMemo(() => {
    if (isBootstrapSuper) return false;
    return Boolean(currentMember?.mustChangePassword || profile?.mustChangePassword);
  }, [isBootstrapSuper, currentMember?.mustChangePassword, profile?.mustChangePassword]);

  const subscriptionPolicy = useMemo(
    () => computeSubscriptionPolicy(currentTenantSubscription, isBootstrapSuper),
    [currentTenantSubscription, isBootstrapSuper]
  );

  const duplicateLeadMap = useMemo(() => {
    return detectDuplicateLeads(leads, organization?.duplicateMatchMode || 'email_or_phone');
  }, [leads, organization?.duplicateMatchMode]);

  // Record immutable login event once per authenticated session & organization
  useEffect(() => {
    if (!user || !organization || !profile || accountBlockedReason) return;
    const sessionKey = `${user.uid}:${organization.id}`;
    if (loggedSessionUidRef.current === sessionKey) return;
    loggedSessionUidRef.current = sessionKey;

    const isPasswordAuth = user.providerData?.some((p) => p.providerId === 'password');
    void logLoginActivity({
      organizationId: organization.id,
      ownerId: organization.ownerId,
      authorizedUserIds: organization.authorizedUserIds,
      userId: user.uid,
      username: currentMember?.username || profile.username || '',
      email: user.email || profile.email || '',
      displayName: currentMember?.displayName || profile.displayName || user.displayName || 'User',
      role: effectiveRole,
      authMethod: isPasswordAuth ? 'username_password' : 'google',
      eventType: 'login',
    });

    // Stamp lastLoginAt on member doc
    if (currentMember) {
      void updateDoc(doc(db, `organizations/${organization.id}/members/${user.uid}`), {
        lastLoginAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  }, [user, organization, profile, currentMember, effectiveRole, accountBlockedReason]);

  const logout = useCallback(async () => {
    if (user && organization && profile) {
      const isPasswordAuth = user.providerData?.some((p) => p.providerId === 'password');
      await logLoginActivity({
        organizationId: organization.id,
        ownerId: organization.ownerId,
        authorizedUserIds: organization.authorizedUserIds,
        userId: user.uid,
        username: currentMember?.username || profile.username || '',
        email: user.email || profile.email || '',
        displayName: currentMember?.displayName || profile.displayName || user.displayName || 'User',
        role: effectiveRole,
        authMethod: isPasswordAuth ? 'username_password' : 'google',
        eventType: 'logout',
      });
    }
    setSessionWarningSeconds(null);
    await signOut(auth);
  }, [user, organization, profile, currentMember, effectiveRole]);

  // 4. Session inactivity timeout guard (60 min auto-logout with 2 min warning)
  const extendSession = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    setSessionWarningSeconds(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    const touch = () => {
      lastActivityAtRef.current = Date.now();
      setSessionWarningSeconds((prev) => (prev !== null ? null : prev));
    };

    const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));

    const timer = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityAtRef.current;
      const remainingMs = IDLE_TIMEOUT_MS - idleMs;
      if (remainingMs <= 0) {
        void logout();
      } else if (remainingMs <= IDLE_WARNING_MS) {
        setSessionWarningSeconds(Math.ceil(remainingMs / 1000));
      } else {
        setSessionWarningSeconds(null);
      }
    }, 10_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, touch));
      window.clearInterval(timer);
    };
  }, [user, logout]);

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signInWithUsername = async (identifier: string, password: string) => {
    await loginWithUsernameAndPassword(identifier, password);
  };

  const changeCurrentUserPassword = async (currentPassword: string, newPassword: string) => {
    await changeAuthenticatedUserPassword({
      currentPassword,
      newPassword,
      organizationId: organization?.id || profile?.organizationId || DEFAULT_ORG_ID,
      ownerId: organization?.ownerId || user?.uid || '',
      authorizedUserIds: organization?.authorizedUserIds || (user ? [user.uid] : []),
      role: effectiveRole,
      username: currentMember?.username || profile?.username || '',
    });
  };

  const markNotificationRead = async (notificationId: string) => {
    const path = `organizations/${orgId}/notifications/${notificationId}`;
    try {
      await updateDoc(doc(db, path), { isRead: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const switchOrganization = async (targetOrgId: string) => {
    if (!user) return;
    await switchActiveOrganization({
      uid: user.uid,
      displayName: user.displayName || user.email || 'Workspace User',
      photoURL: user.photoURL || '',
      targetOrganizationId: targetOrgId,
    });
  };

  return (
    <PortalContext.Provider
      value={{
        user,
        authLoading,
        dataLoading,
        profile,
        organization,
        myOrganizations,
        currentMember,
        effectiveRole,
        effectiveCrmAccess,
        effectivePermissions,
        isSuperAdmin: effectiveRole === 'super_admin',
        isPlatformOwner: isBootstrapSuper,
        isStudent,
        mustChangePassword,
        accountBlockedReason,
        subscriptionPolicy,
        sessionWarningSeconds,
        extendSession,
        members,
        loginActivity,
        businessUnits,
        forms,
        submissions,
        leads,
        duplicateLeadMap,
        templates,
        auditLogs,
        integrations,
        notifications,
        supportConfig,
        courses,
        knowledgeItems,
        supportConversations,
        studentRegistrations,
        saasPlans,
        currentTenantSubscription,
        allTenantSubscriptions,
        saasInvoices,
        saasSalesInquiries,
        signInWithGoogle,
        signInWithUsername,
        changeCurrentUserPassword,
        logout,
        markNotificationRead,
        switchOrganization,
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

export function usePortal() {
  const ctx = useContext(PortalContext);
  if (!ctx) {
    throw new Error('usePortal must be used inside PortalProvider');
  }
  return ctx;
}
