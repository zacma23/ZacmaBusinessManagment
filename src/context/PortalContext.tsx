import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  getRedirectResult,
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
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  logFirestoreListenerError,
  OperationType,
  SYSTEM_OWNER_EMAIL,
  SYSTEM_OWNER_NAME,
} from '../lib/firebase';
import {
  DEFAULT_ORG_ID,
  detectDuplicateLeads,
  timestampToMillis,
} from '../lib/zacmaService';
import {
  changeAuthenticatedUserPassword,
  computeSubscriptionPolicy,
  DEFAULT_ROLE_PERMISSIONS,
  ensureSystemOwnerAnchor,
  logLoginActivity,
  loginWithUsernameAndPassword,
  resolveEffectivePermissions,
  verifySessionWithServer,
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
  ServerVerifiedSession,
  StudentRegistration,
  SubscriptionPolicy,
  SupportConversation,
  SupportKnowledgeItem,
  SystemOwnerConfig,
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

const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours genuine inactivity auto-logout
const IDLE_WARNING_MS = 2 * 60 * 1000; // Show 2-minute interactive countdown before logout
const MIN_SESSION_GRACE_MS = 2 * 60 * 1000; // Never auto-logout within first 2 minutes of login

interface PortalContextValue {
  user: User | null;
  authLoading: boolean;
  profileLoading: boolean;
  dataLoading: boolean;
  profileError: string | null;
  syncWarning: string | null;
  dismissSyncWarning: () => void;
  retryProfileSync: () => Promise<void>;
  profile: UserProfile | null;
  organization: Organization | null;
  myOrganizations: Organization[];
  currentMember: OrganizationMember | null;
  systemOwnerConfig: SystemOwnerConfig | null;
  serverVerifiedSession: ServerVerifiedSession | null;
  effectiveRole: UserRole;
  effectiveCrmAccess: boolean;
  effectivePermissions: MemberPermissions;
  isSuperAdmin: boolean;
  isPlatformOwner: boolean;
  isSystemOwner: boolean;
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

function resolveOwnerDisplayName(rawName?: string | null): string {
  const clean = (rawName || '').trim();
  if (
    !clean ||
    clean.toLowerCase() === SYSTEM_OWNER_EMAIL.toLowerCase() ||
    clean === 'Zacma User' ||
    clean === 'Zacma Super Admin'
  ) {
    return SYSTEM_OWNER_NAME;
  }
  return clean;
}

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [myOrganizations, setMyOrganizations] = useState<Organization[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [ownMemberDoc, setOwnMemberDoc] = useState<OrganizationMember | null>(null);
  const [systemOwnerConfig, setSystemOwnerConfig] = useState<SystemOwnerConfig | null>(null);
  const [serverVerifiedSession, setServerVerifiedSession] = useState<ServerVerifiedSession | null>(null);
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

  // Session guards & monotonic run counter (prevents stale async callbacks from clobbering state)
  const authRunIdRef = useRef(0);
  const lastActivityAtRef = useRef<number>(Date.now());
  const sessionStartedAtRef = useRef<number>(Date.now());
  const loggedSessionUidRef = useRef<string | null>(null);
  const [sessionWarningSeconds, setSessionWarningSeconds] = useState<number | null>(null);

  const isPrimaryOwnerEmail = Boolean(
    user?.email &&
      user.emailVerified &&
      user.email.toLowerCase() === SYSTEM_OWNER_EMAIL.toLowerCase()
  );

  const isSystemOwner = Boolean(
    isPrimaryOwnerEmail ||
      (user?.emailVerified &&
        systemOwnerConfig?.status === 'active' &&
        systemOwnerConfig.ownerUid === user.uid) ||
      (user?.emailVerified && serverVerifiedSession?.isSystemOwner === true)
  );

  const hydrateAuthenticatedSession = useCallback(
    async (firebaseUser: User, runId: number) => {
      lastActivityAtRef.current = Date.now();
      sessionStartedAtRef.current = Date.now();
      setProfileLoading(true);
      setDataLoading(true);
      setBootstrapReady(false);
      setProfileError(null);

      try {
        // 1. Check permanent System Owner anchor in Firestore (if already initialized)
        let ownerAnchor: SystemOwnerConfig | null = null;
        try {
          const anchorSnap = await getDoc(doc(db, 'platformConfig/systemOwner'));
          if (anchorSnap.exists()) {
            ownerAnchor = anchorSnap.data() as SystemOwnerConfig;
            if (authRunIdRef.current === runId) {
              setSystemOwnerConfig(ownerAnchor);
            }
          }
        } catch {
          // Non-fatal: continue with verified email check
        }

        const isOwner = Boolean(
          firebaseUser.emailVerified &&
            (firebaseUser.email?.toLowerCase() === SYSTEM_OWNER_EMAIL.toLowerCase() ||
              (ownerAnchor?.status === 'active' && ownerAnchor.ownerUid === firebaseUser.uid))
        );

        const isPasswordProvider = firebaseUser.providerData?.some(
          (p) => p.providerId === 'password'
        );
        const nowIso = new Date().toISOString();

        // 2. Anchor permanent System Owner record for Zekimuluken (preserving existing account — zero duplicates)
        if (isOwner) {
          const syncedAnchor = await ensureSystemOwnerAnchor({
            uid: firebaseUser.uid,
            email: firebaseUser.email || SYSTEM_OWNER_EMAIL,
          });
          if (syncedAnchor && authRunIdRef.current === runId) {
            setSystemOwnerConfig(syncedAnchor);
          }
        }

        // 3. Retrieve or initialize the user's profile document
        const userRef = doc(db, `users/${firebaseUser.uid}`);
        const userSnap = await getDoc(userRef);
        let orgId = DEFAULT_ORG_ID;
        let resolvedProfile: UserProfile;

        if (!userSnap.exists()) {
          const initialRole: UserRole = isOwner ? 'super_admin' : 'staff';
          resolvedProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: isOwner
              ? SYSTEM_OWNER_NAME
              : firebaseUser.displayName || firebaseUser.email || 'Zacma User',
            photoURL: firebaseUser.photoURL || '',
            username: isOwner ? 'zekimuluken' : '',
            phone: '',
            authProvider: isPasswordProvider ? 'username_password' : 'google',
            mustChangePassword: false,
            status: 'active',
            isSystemOwner: isOwner,
            accountType: isOwner ? 'primary_system_owner' : 'staff',
            lastLoginAt: nowIso,
            organizationId: orgId,
            role: initialRole,
            crmAccess: isOwner,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(userRef, resolvedProfile);
        } else {
          const existingProfile = userSnap.data() as UserProfile;
          orgId = existingProfile.organizationId || DEFAULT_ORG_ID;

          if (isOwner) {
            const ownerDisplayName = resolveOwnerDisplayName(existingProfile.displayName);
            resolvedProfile = {
              ...existingProfile,
              displayName: ownerDisplayName,
              role: 'super_admin',
              crmAccess: true,
              status: 'active',
              isSystemOwner: true,
              accountType: 'primary_system_owner',
              mustChangePassword: false,
              lastLoginAt: nowIso,
            };
            // Upgrade & lock Zekimuluken's existing user profile without creating any duplicate account
            await updateDoc(userRef, {
              displayName: ownerDisplayName,
              role: 'super_admin',
              crmAccess: true,
              status: 'active',
              isSystemOwner: true,
              accountType: 'primary_system_owner',
              mustChangePassword: false,
              lastLoginAt: nowIso,
              updatedAt: serverTimestamp(),
            }).catch((err) => {
              console.warn('Owner profile sync warning:', err instanceof Error ? err.message : err);
            });
          } else {
            resolvedProfile = { ...existingProfile, lastLoginAt: nowIso };
            await updateDoc(userRef, {
              lastLoginAt: nowIso,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }
        }

        if (authRunIdRef.current !== runId) return;

        // 4. For Primary System Owner (Zekimuluken), ensure root organization, owner member record, plans, AI support, and 18 courses exist
        if (isOwner) {
          const rootOrgRef = doc(db, `organizations/${DEFAULT_ORG_ID}`);
          const rootOrgSnap = await getDoc(rootOrgRef);
          const ownerDisplayName = resolveOwnerDisplayName(resolvedProfile.displayName);

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
              email: firebaseUser.email || SYSTEM_OWNER_EMAIL,
              username: 'zekimuluken',
              phone: '',
              displayName: ownerDisplayName,
              role: 'super_admin',
              crmAccess: true,
              permissions: { ...DEFAULT_ROLE_PERMISSIONS.super_admin },
              authProvider: 'google',
              mustChangePassword: false,
              isSystemOwner: true,
              accountType: 'primary_system_owner',
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
          } else {
            // Existing root organization found: preserve all data and ensure Zekimuluken's owner member record is permanently active & protected
            const rootOrgData = rootOrgSnap.data() as Organization;
            const ownerMemberRef = doc(db, `organizations/${DEFAULT_ORG_ID}/members/${firebaseUser.uid}`);
            const ownerMemberSnap = await getDoc(ownerMemberRef);
            if (!ownerMemberSnap.exists()) {
              await setDoc(ownerMemberRef, {
                userId: firebaseUser.uid,
                organizationId: DEFAULT_ORG_ID,
                email: firebaseUser.email || SYSTEM_OWNER_EMAIL,
                username: 'zekimuluken',
                phone: '',
                displayName: ownerDisplayName,
                role: 'super_admin',
                crmAccess: true,
                permissions: { ...DEFAULT_ROLE_PERMISSIONS.super_admin },
                authProvider: 'google',
                mustChangePassword: false,
                isSystemOwner: true,
                accountType: 'primary_system_owner',
                lastLoginAt: nowIso,
                assignedBusinessUnitIds: [],
                status: 'active',
                ownerId: rootOrgData.ownerId || firebaseUser.uid,
                authorizedUserIds: Array.from(
                  new Set([...(rootOrgData.authorizedUserIds || []), firebaseUser.uid])
                ),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }).catch(() => {});
            } else {
              await updateDoc(ownerMemberRef, {
                displayName: ownerDisplayName,
                role: 'super_admin',
                crmAccess: true,
                permissions: { ...DEFAULT_ROLE_PERMISSIONS.super_admin },
                isSystemOwner: true,
                accountType: 'primary_system_owner',
                status: 'active',
                mustChangePassword: false,
                lastLoginAt: nowIso,
                updatedAt: serverTimestamp(),
              }).catch(() => {});
            }
          }

          // Non-blocking background seeding (errors here must NEVER block login or trigger logout)
          void (async () => {
            try {
              await seedDefaultSaasPlans();
              await ensureRootTenantSubscription({
                organizationId: DEFAULT_ORG_ID,
                organizationName: 'Zacma Technology',
                organizationSlug: 'zacma',
                ownerId: firebaseUser.uid,
                ownerName: ownerDisplayName,
                ownerEmail: firebaseUser.email || SYSTEM_OWNER_EMAIL,
              });

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
                actorName: ownerDisplayName,
                skipAudit: true,
              });
            } catch (seedErr) {
              console.warn('Non-blocking owner bootstrap warning:', seedErr);
            }
          })();
        }

        // 5. Pre-fetch active organization & own member record BEFORE releasing loading gate
        // so AuthGate NEVER flashes "No organization" or redirects while data is still loading!
        const [orgSnap, memberSnap] = await Promise.all([
          getDoc(doc(db, `organizations/${orgId}`)).catch(() => null),
          getDoc(doc(db, `organizations/${orgId}/members/${firebaseUser.uid}`)).catch(() => null),
        ]);

        if (authRunIdRef.current !== runId) return;

        setProfile(resolvedProfile);
        setOrganization(orgSnap && orgSnap.exists() ? (orgSnap.data() as Organization) : null);
        setOwnMemberDoc(
          memberSnap && memberSnap.exists() ? (memberSnap.data() as OrganizationMember) : null
        );
        setBootstrapReady(true);

        // 6. Verify session with backend server asynchronously (non-blocking, never triggers logout)
        void verifySessionWithServer().then((verified) => {
          if (authRunIdRef.current === runId && verified) {
            setServerVerifiedSession(verified);
          }
        });
      } catch (error) {
        console.error('Session hydration warning (session preserved):', error);
        if (authRunIdRef.current !== runId) return;

        // CRITICAL: NEVER log the user out because of temporary database failures or delayed profile retrieval!
        const isOwnerFallback = Boolean(
          firebaseUser.emailVerified &&
            firebaseUser.email?.toLowerCase() === SYSTEM_OWNER_EMAIL.toLowerCase()
        );
        setProfileError(
          error instanceof Error
            ? `Temporary database sync issue (${error.message}). Your session remains active — click Retry Sync.`
            : 'Temporary database sync issue. Your session remains active — click Retry Sync.'
        );

        // Provide a safe in-memory fallback profile so the System Owner is never locked out during a transient glitch
        if (isOwnerFallback) {
          setProfile((prev) =>
            prev || {
              uid: firebaseUser.uid,
              email: firebaseUser.email || SYSTEM_OWNER_EMAIL,
              displayName: SYSTEM_OWNER_NAME,
              photoURL: firebaseUser.photoURL || '',
              username: 'zekimuluken',
              authProvider: 'google',
              mustChangePassword: false,
              status: 'active',
              isSystemOwner: true,
              accountType: 'primary_system_owner',
              organizationId: DEFAULT_ORG_ID,
              role: 'super_admin',
              crmAccess: true,
              createdAt: null,
              updatedAt: null,
            }
          );
          setBootstrapReady(true);
        }
      } finally {
        if (authRunIdRef.current === runId) {
          setAuthLoading(false);
          setProfileLoading(false);
          setDataLoading(false);
        }
      }
    },
    []
  );

  // 1. Auth state initialization (awaits authStateReady + redirect result before releasing loading state)
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    const initAuth = async () => {
      try {
        // Safely settle any pending OAuth redirect result & wait for Firebase persistent storage hydration
        await getRedirectResult(auth).catch(() => null);
        await auth.authStateReady();
      } catch (err) {
        console.warn('Auth readiness notice:', err instanceof Error ? err.message : err);
      }

      if (!active) return;

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (!active) return;
        const runId = ++authRunIdRef.current;

        if (!firebaseUser) {
          loggedSessionUidRef.current = null;
          setSessionWarningSeconds(null);
          setUser(null);
          setProfile(null);
          setOrganization(null);
          setMyOrganizations([]);
          setMembers([]);
          setOwnMemberDoc(null);
          setSystemOwnerConfig(null);
          setServerVerifiedSession(null);
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
          setBootstrapReady(false);
          setProfileError(null);
          setProfileLoading(false);
          setDataLoading(false);
          setAuthLoading(false);
          return;
        }

        // Set user & immediately mark profileLoading = true BEFORE releasing render
        // so AuthGate NEVER flashes onboarding or redirects while profile loads!
        setProfileLoading(true);
        setUser(firebaseUser);
        await hydrateAuthenticatedSession(firebaseUser, runId);
      });
    };

    void initAuth();

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [hydrateAuthenticatedSession]);

  const retryProfileSync = useCallback(async () => {
    if (!auth.currentUser) return;
    const runId = ++authRunIdRef.current;
    await hydrateAuthenticatedSession(auth.currentUser, runId);
  }, [hydrateAuthenticatedSession]);

  // 1b. Live UserProfile & SystemOwnerConfig listeners (only after bootstrapReady)
  useEffect(() => {
    if (!user || !bootstrapReady) return;
    const unsubProfile = onSnapshot(
      doc(db, `users/${user.uid}`),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
          setProfileError(null);
        }
      },
      (err) => {
        logFirestoreListenerError(err, OperationType.GET, `users/${user.uid}`);
      }
    );

    const unsubOwner = onSnapshot(
      doc(db, 'platformConfig/systemOwner'),
      (snap) => {
        if (snap.exists()) {
          setSystemOwnerConfig(snap.data() as SystemOwnerConfig);
        }
      },
      () => {
        // Non-fatal
      }
    );

    return () => {
      unsubProfile();
      unsubOwner();
    };
  }, [user, bootstrapReady]);

  const orgId = profile?.organizationId || DEFAULT_ORG_ID;
  const isStudentProfile = !isSystemOwner && profile?.role === 'student';

  // 1c. Live Own Member Document listener (works for all roles including students)
  useEffect(() => {
    if (!user || !profile || !bootstrapReady) return;
    const unsub = onSnapshot(
      doc(db, `organizations/${orgId}/members/${user.uid}`),
      (snap) => {
        setOwnMemberDoc(snap.exists() ? (snap.data() as OrganizationMember) : null);
      },
      (err) => {
        logFirestoreListenerError(err, OperationType.GET, `organizations/${orgId}/members/${user.uid}`);
      }
    );
    return () => unsub();
  }, [user, profile?.organizationId, orgId, bootstrapReady]);

  // 1d. Global SaaS Plans, Owned Organizations, Tenant Subscriptions, Invoices & Sales Inquiries listeners
  useEffect(() => {
    if (!user || !bootstrapReady || isStudentProfile) return;
    const unsubs: Array<() => void> = [];

    const plansQuery = isSystemOwner
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
        (err) => logFirestoreListenerError(err, OperationType.LIST, 'saasPlans')
      )
    );

    const orgsQuery = isSystemOwner
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
        (err) => logFirestoreListenerError(err, OperationType.LIST, 'organizations')
      )
    );

    const tenantsQuery = isSystemOwner
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
        (err) => logFirestoreListenerError(err, OperationType.LIST, 'saasTenants')
      )
    );

    const invoicesQuery = isSystemOwner
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
        (err) => logFirestoreListenerError(err, OperationType.LIST, 'saasInvoices')
      )
    );

    if (isSystemOwner) {
      unsubs.push(
        onSnapshot(
          collection(db, 'saasSalesInquiries'),
          (snap) => {
            const list = snap.docs
              .map((d) => d.data() as SaasSalesInquiry)
              .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
            setSaasSalesInquiries(list);
          },
          (err) => logFirestoreListenerError(err, OperationType.LIST, 'saasSalesInquiries')
        )
      );
    } else {
      setSaasSalesInquiries([]);
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [user, bootstrapReady, isSystemOwner, isStudentProfile]);

  // 2. Real-time Firestore listeners scoped strictly to the active organization & role
  useEffect(() => {
    if (!user || !profile || !bootstrapReady) return;

    const unsubs: Array<() => void> = [];

    const safeListenerError = (path: string) => (err: unknown) => {
      logFirestoreListenerError(err, OperationType.LIST, path);
    };

    // Active Organization doc (allowed for both active staff and active students)
    unsubs.push(
      onSnapshot(
        doc(db, `organizations/${orgId}`),
        (snap) => {
          setOrganization(snap.exists() ? (snap.data() as Organization) : null);
        },
        (err) => {
          logFirestoreListenerError(err, OperationType.GET, `organizations/${orgId}`);
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
          safeListenerError(`organizations/${orgId}/studentRegistrations`)
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
          safeListenerError('publicCourses')
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
          safeListenerError(`organizations/${orgId}/loginActivity`)
        )
      );

      return () => {
        unsubs.forEach((fn) => fn());
      };
    }

    const makeQuery = (colPath: string) => {
      const ref = collection(db, colPath);
      return isSystemOwner
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
        safeListenerError(`organizations/${orgId}/members`)
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
        safeListenerError(`organizations/${orgId}/loginActivity`)
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
        safeListenerError(`organizations/${orgId}/businessUnits`)
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
        safeListenerError(`organizations/${orgId}/leads`)
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
        safeListenerError(`organizations/${orgId}/formSubmissions`)
      )
    );

    // Message Templates
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/messageTemplates`),
        (snap) => {
          setTemplates(snap.docs.map((d) => d.data() as MessageTemplate));
        },
        safeListenerError(`organizations/${orgId}/messageTemplates`)
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
        safeListenerError(`organizations/${orgId}/auditLogs`)
      )
    );

    // Integrations Governance
    unsubs.push(
      onSnapshot(
        makeQuery(`organizations/${orgId}/integrations`),
        (snap) => {
          setIntegrations(snap.docs.map((d) => d.data() as IntegrationConfig));
        },
        safeListenerError(`organizations/${orgId}/integrations`)
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
        safeListenerError(`organizations/${orgId}/notifications`)
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
          logFirestoreListenerError(err, OperationType.GET, `publicSupport/${orgId}`);
        }
      )
    );

    // Section 8: Courses Catalog scoped to active org
    const coursesQuery = isSystemOwner
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
        safeListenerError('publicCourses')
      )
    );

    // Section 8: Support Knowledge & FAQs scoped to active org
    const faqsQuery = isSystemOwner
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
        safeListenerError('publicFaqs')
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
        safeListenerError(`organizations/${orgId}/supportConversations`)
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
        safeListenerError(`organizations/${orgId}/studentRegistrations`)
      )
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [user, profile?.organizationId, orgId, bootstrapReady, isSystemOwner, isStudentProfile]);

  // 3. Per-Business-Unit dynamic forms listeners
  useEffect(() => {
    if (!user || !profile || !bootstrapReady || isStudentProfile || businessUnits.length === 0) {
      setFormsByUnit({});
      return;
    }

    const unsubs: Array<() => void> = [];
    for (const bu of businessUnits) {
      const colPath = `organizations/${orgId}/businessUnits/${bu.id}/forms`;
      const ref = collection(db, colPath);
      const q = isSystemOwner
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
          (err) => logFirestoreListenerError(err, OperationType.LIST, colPath)
        )
      );
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [user, profile?.organizationId, orgId, businessUnits, bootstrapReady, isSystemOwner, isStudentProfile]);

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

  const effectiveRole: UserRole = isSystemOwner
    ? 'super_admin'
    : currentMember?.role || profile?.role || 'staff';

  const effectivePermissions = useMemo(
    () =>
      isSystemOwner
        ? resolveEffectivePermissions('super_admin')
        : resolveEffectivePermissions(
            effectiveRole,
            currentMember?.permissions,
            currentMember?.crmAccess ?? profile?.crmAccess
          ),
    [isSystemOwner, effectiveRole, currentMember, profile?.crmAccess]
  );

  const effectiveCrmAccess = effectivePermissions.crm;
  const isStudent = effectiveRole === 'student';

  const accountBlockedReason: 'inactive' | 'suspended' | null = useMemo(() => {
    if (isSystemOwner) return null;
    const status = currentMember?.status || profile?.status;
    if (status === 'suspended') return 'suspended';
    if (status === 'inactive') return 'inactive';
    return null;
  }, [isSystemOwner, currentMember?.status, profile?.status]);

  const mustChangePassword = useMemo(() => {
    if (isSystemOwner) return false;
    return Boolean(currentMember?.mustChangePassword || profile?.mustChangePassword);
  }, [isSystemOwner, currentMember?.mustChangePassword, profile?.mustChangePassword]);

  const subscriptionPolicy = useMemo(
    () => computeSubscriptionPolicy(currentTenantSubscription, isSystemOwner),
    [currentTenantSubscription, isSystemOwner]
  );

  const duplicateLeadMap = useMemo(() => {
    return detectDuplicateLeads(leads, organization?.duplicateMatchMode || 'email_or_phone');
  }, [leads, organization?.duplicateMatchMode]);

  // Record immutable login event once per authenticated session & organization
  useEffect(() => {
    if (!user || !organization || !profile || !bootstrapReady || accountBlockedReason) return;
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
      displayName: isSystemOwner
        ? resolveOwnerDisplayName(currentMember?.displayName || profile.displayName)
        : currentMember?.displayName || profile.displayName || user.displayName || 'User',
      role: effectiveRole,
      authMethod: isPasswordAuth ? 'username_password' : 'google',
      eventType: 'login',
    });

    if (currentMember) {
      void updateDoc(doc(db, `organizations/${organization.id}/members/${user.uid}`), {
        lastLoginAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  }, [user, organization, profile, currentMember, effectiveRole, accountBlockedReason, bootstrapReady, isSystemOwner]);

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
        displayName: isSystemOwner
          ? resolveOwnerDisplayName(currentMember?.displayName || profile.displayName)
          : currentMember?.displayName || profile.displayName || user.displayName || 'User',
        role: effectiveRole,
        authMethod: isPasswordAuth ? 'username_password' : 'google',
        eventType: 'logout',
      }).catch(() => {});
    }
    setSessionWarningSeconds(null);
    await signOut(auth);
  }, [user, organization, profile, currentMember, effectiveRole, isSystemOwner]);

  // Keep a stable ref to logout so the idle timer never tears down on profile/org snapshot updates
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  // 4. Hardened session inactivity timeout guard (4 hours genuine idle; NEVER logs out immediately after login)
  const extendSession = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    setSessionWarningSeconds(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    // Always reset clocks when a user session becomes active
    lastActivityAtRef.current = Date.now();
    sessionStartedAtRef.current = Date.now();
    setSessionWarningSeconds(null);

    const touch = () => {
      lastActivityAtRef.current = Date.now();
      setSessionWarningSeconds((prev) => (prev !== null ? null : prev));
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const idleMs = Date.now() - lastActivityAtRef.current;
        // If laptop slept past timeout, give user a 60-second warning banner instead of instant silent logout
        if (idleMs >= IDLE_TIMEOUT_MS - IDLE_WARNING_MS) {
          lastActivityAtRef.current = Date.now() - (IDLE_TIMEOUT_MS - 60_000);
          setSessionWarningSeconds(60);
        }
      }
    };

    const events: Array<keyof WindowEventMap> = [
      'mousedown',
      'pointerdown',
      'keydown',
      'scroll',
      'touchstart',
    ];
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);

    const timer = window.setInterval(() => {
      const now = Date.now();
      const sessionAgeMs = now - sessionStartedAtRef.current;
      // Grace guard: never auto-logout during initial 2 minutes of login
      if (sessionAgeMs < MIN_SESSION_GRACE_MS) {
        return;
      }

      const idleMs = now - lastActivityAtRef.current;
      const remainingMs = IDLE_TIMEOUT_MS - idleMs;
      if (remainingMs <= 0) {
        void logoutRef.current();
      } else if (remainingMs <= IDLE_WARNING_MS) {
        setSessionWarningSeconds(Math.ceil(remainingMs / 1000));
      } else {
        setSessionWarningSeconds((prev) => (prev !== null ? null : prev));
      }
    }, 10_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, touch));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(timer);
    };
  }, [user?.uid]);

  const signInWithGoogle = async () => {
    lastActivityAtRef.current = Date.now();
    sessionStartedAtRef.current = Date.now();
    await signInWithPopup(auth, googleProvider);
  };

  const signInWithUsername = async (identifier: string, password: string) => {
    lastActivityAtRef.current = Date.now();
    sessionStartedAtRef.current = Date.now();
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
      displayName: isSystemOwner
        ? SYSTEM_OWNER_NAME
        : user.displayName || user.email || 'Workspace User',
      photoURL: user.photoURL || '',
      targetOrganizationId: targetOrgId,
    });
  };

  return (
    <PortalContext.Provider
      value={{
        user,
        authLoading,
        profileLoading,
        dataLoading,
        profileError,
        syncWarning,
        dismissSyncWarning: () => setSyncWarning(null),
        retryProfileSync,
        profile,
        organization,
        myOrganizations,
        currentMember,
        systemOwnerConfig,
        serverVerifiedSession,
        effectiveRole,
        effectiveCrmAccess,
        effectivePermissions,
        isSuperAdmin: effectiveRole === 'super_admin' || isSystemOwner,
        isPlatformOwner: isSystemOwner,
        isSystemOwner,
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
