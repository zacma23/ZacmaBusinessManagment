import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
import type {
  AppNotification,
  AuditLog,
  BusinessUnit,
  DynamicForm,
  FormSubmission,
  IntegrationConfig,
  Lead,
  MessageTemplate,
  Organization,
  OrganizationMember,
  PublicSupportConfig,
  StudentRegistration,
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

interface PortalContextValue {
  user: User | null;
  authLoading: boolean;
  dataLoading: boolean;
  profile: UserProfile | null;
  organization: Organization | null;
  currentMember: OrganizationMember | null;
  effectiveRole: UserRole;
  effectiveCrmAccess: boolean;
  isSuperAdmin: boolean;
  members: OrganizationMember[];
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
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
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
        setProfile(null);
        setOrganization(null);
        setMembers([]);
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
        setAuthLoading(false);
        return;
      }

      setDataLoading(true);
      try {
        const userRef = doc(db, `users/${firebaseUser.uid}`);
        const userSnap = await getDoc(userRef);

        const isBootstrap =
          Boolean(firebaseUser.emailVerified) &&
          firebaseUser.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL.toLowerCase();

        let orgId = DEFAULT_ORG_ID;

        if (!userSnap.exists()) {
          const initialRole: UserRole = isBootstrap ? 'super_admin' : 'staff';
          const initialCrmAccess = isBootstrap;
          const newProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || firebaseUser.email || 'Zacma User',
            photoURL: firebaseUser.photoURL || '',
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
        }

        // If bootstrapped Super Admin, ensure root organization, super_admin member, and integration governance records exist
        if (isBootstrap) {
          const orgRef = doc(db, `organizations/${orgId}`);
          const orgSnap = await getDoc(orgRef);

          if (!orgSnap.exists()) {
            const batch = writeBatch(db);
            batch.set(orgRef, {
              id: orgId,
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

            batch.set(doc(db, `organizations/${orgId}/members/${firebaseUser.uid}`), {
              userId: firebaseUser.uid,
              organizationId: orgId,
              email: firebaseUser.email || BOOTSTRAP_SUPER_ADMIN_EMAIL,
              displayName: firebaseUser.displayName || 'Zacma Super Admin',
              role: 'super_admin',
              crmAccess: true,
              assignedBusinessUnitIds: [],
              status: 'active',
              ownerId: firebaseUser.uid,
              authorizedUserIds: [firebaseUser.uid],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            // Initialize integration governance catalog (no secrets stored — strictly Super Admin approval records)
            const defaultIntegrations: Array<Omit<IntegrationConfig, 'updatedAt'>> = [
              {
                id: 'int_gemini_ai',
                organizationId: orgId,
                providerKey: 'gemini_ai',
                displayName: 'Google Gemini AI (Configured)',
                purpose: 'Powers the AI Form Generator and permission-scoped Zacma AI Assistant via server-side API.',
                requiredCredentials: ['GEMINI_API_KEY (Injected server-side)'],
                estimatedCost: 'Existing AI Studio / Gemini API allocation',
                approvalStatus: 'enabled',
                approvedBy: firebaseUser.uid,
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
              {
                id: 'int_resend_email',
                organizationId: orgId,
                providerKey: 'resend_email',
                displayName: 'Resend Transactional & Bulk Email',
                purpose: 'Delivers individual and bulk personalized emails from the CRM Communication Center.',
                requiredCredentials: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
                estimatedCost: 'Free tier up to 3,000 emails/mo; Pro starts at $20/mo',
                approvalStatus: 'pending_approval',
                approvedBy: '',
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
              {
                id: 'int_twilio_sms',
                organizationId: orgId,
                providerKey: 'twilio_sms',
                displayName: 'Twilio Programmable SMS',
                purpose: 'Sends individual and bulk SMS messages and follow-up reminders to CRM leads.',
                requiredCredentials: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
                estimatedCost: 'Pay-as-you-go (~$0.0079/SMS US; regional carrier rates apply)',
                approvalStatus: 'pending_approval',
                approvedBy: '',
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
              {
                id: 'int_whatsapp_cloud',
                organizationId: orgId,
                providerKey: 'whatsapp_cloud',
                displayName: 'WhatsApp Business Cloud API',
                purpose: 'Enables verified business messaging and lead follow-ups over WhatsApp.',
                requiredCredentials: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
                estimatedCost: 'Meta per-conversation pricing after 1,000 free service conversations/mo',
                approvalStatus: 'pending_approval',
                approvedBy: '',
                ownerId: firebaseUser.uid,
                authorizedUserIds: [firebaseUser.uid],
              },
            ];

            for (const intItem of defaultIntegrations) {
              batch.set(doc(db, `organizations/${orgId}/integrations/${intItem.id}`), {
                ...intItem,
                updatedAt: serverTimestamp(),
              });
            }

            await batch.commit();
          }

          // Ensure Section 8 AI Customer Support configuration exists for this organization
          const supportRef = doc(db, `publicSupport/${orgId}`);
          const supportSnap = await getDoc(supportRef);
          if (!supportSnap.exists()) {
            await setDoc(supportRef, {
              organizationId: orgId,
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

          // Ensure all 18 administrator-approved Zacma Training Institute courses (8,500 ETB each) exist in Firestore
          const existingCoursesSnap = await getDocs(
            query(collection(db, 'publicCourses'), where('organizationId', '==', orgId))
          );
          const existingCoursesList = existingCoursesSnap.docs.map(
            (d) => d.data() as TrainingCourse
          );
          await seedEighteenInstituteCourses({
            organizationId: orgId,
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

  // 2. Real-time Firestore listeners scoped strictly to the authenticated user & organization
  const orgId = profile?.organizationId || DEFAULT_ORG_ID;

  useEffect(() => {
    if (!user || !profile) return;

    const unsubs: Array<() => void> = [];

    const makeQuery = (colPath: string) => {
      const ref = collection(db, colPath);
      return isBootstrapSuper
        ? ref
        : query(ref, where('authorizedUserIds', 'array-contains', user.uid));
    };

    // Organization doc
    unsubs.push(
      onSnapshot(
        doc(db, `organizations/${orgId}`),
        (snap) => {
          setOrganization(snap.exists() ? (snap.data() as Organization) : null);
        },
        (err) => {
          console.warn('Org read skipped (user may await invite):', err.message);
          setOrganization(null);
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

    // Section 8: Institute Courses Catalog
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

    // Section 8: Support Knowledge & FAQs
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
  }, [user, profile, orgId, isBootstrapSuper]);

  // 3. Per-Business-Unit dynamic forms listeners (preserving Phase 9 nested collection path)
  useEffect(() => {
    if (!user || !profile || businessUnits.length === 0) {
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
  }, [user, profile, orgId, businessUnits, isBootstrapSuper]);

  const forms = useMemo(() => {
    const unitIds = new Set(businessUnits.map((b) => b.id));
    return Object.entries(formsByUnit)
      .filter(([buId]) => unitIds.has(buId))
      .flatMap(([, list]) => list)
      .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
  }, [formsByUnit, businessUnits]);

  const currentMember = useMemo(() => {
    if (!user) return null;
    return members.find((m) => m.userId === user.uid || (user.email && m.email.toLowerCase() === user.email.toLowerCase())) || null;
  }, [members, user]);

  const effectiveRole: UserRole = isBootstrapSuper
    ? 'super_admin'
    : currentMember?.role || profile?.role || 'staff';

  const effectiveCrmAccess = isBootstrapSuper
    ? true
    : currentMember
      ? currentMember.crmAccess || ['super_admin', 'org_admin', 'bu_manager', 'staff'].includes(currentMember.role)
      : Boolean(profile?.crmAccess);

  const duplicateLeadMap = useMemo(() => {
    return detectDuplicateLeads(leads, organization?.duplicateMatchMode || 'email_or_phone');
  }, [leads, organization?.duplicateMatchMode]);

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const markNotificationRead = async (notificationId: string) => {
    const path = `organizations/${orgId}/notifications/${notificationId}`;
    try {
      await updateDoc(doc(db, path), { isRead: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  return (
    <PortalContext.Provider
      value={{
        user,
        authLoading,
        dataLoading,
        profile,
        organization,
        currentMember,
        effectiveRole,
        effectiveCrmAccess,
        isSuperAdmin: effectiveRole === 'super_admin',
        members,
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
        signInWithGoogle,
        logout,
        markNotificationRead,
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
