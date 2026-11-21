import {
  collection,
  deleteDoc,
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
import {
  clampList,
  clampStr,
  generateId,
  generateLeadRef,
  logAuditEvent,
  timestampToMillis,
} from './zacmaService';
import type {
  PublicSupportConfig,
  RegistrationDraft,
  StudentRegistration,
  SupportChatMessage,
  SupportConversation,
  SupportKnowledgeCategory,
  SupportKnowledgeItem,
  TrainingCourse,
} from '../types';

export const DEFAULT_SUPPORT_WELCOME_MESSAGE =
  "Hello! Welcome to Zacma Technology Training Institute. I'm your AI assistant. How can I help you today? I can assist you with course information, registration, training schedules, payment methods, and student support.";

export const DEFAULT_SUPPORT_AI_INSTRUCTIONS =
  'Serve as a courteous, accurate virtual admission officer, student support representative, and training consultant for Zacma Technology Training Institute. Answer strictly from administrator-approved Firebase courses and FAQs, never invent fees or schedules, guide conversational registrations step by step, direct document uploads exclusively to the official registration form link, and escalate complex or human-requested matters promptly.';

export const DEFAULT_APPROVED_COURSE_FEE = '8,500 ETB';

export interface CourseSeedDefinition {
  title: string;
  category: string;
  description: string;
  learningObjectives: string[];
  qualifications: string;
  deliveryMethods: string[];
  approvedFee: string;
  registrationProcedure: string;
}

// All 18 Zacma Technology Training Institute programs with administrator-approved tuition (8,500 ETB each).
// Duration, schedules, availableBatches, and certificateInfo remain customizable by admins in Course Catalog.
export const INSTITUTE_18_COURSES: CourseSeedDefinition[] = [
  {
    title: 'Graphics Design',
    category: 'Creative & Design',
    description:
      'Practical visual communication training covering brand identity, print and digital layout, typography, and modern design workflows.',
    learningObjectives: [
      'Master visual hierarchy, color theory, and typography',
      'Design logos, marketing collateral, and social media visuals',
      'Build a client-ready portfolio for print and digital media',
    ],
    qualifications: 'Basic computer literacy and creative interest; no prior design experience required.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Complete registration through the Zacma AI Assistant or official registration form and submit required ID documents via the secure upload link.',
  },
  {
    title: 'Computer Maintenance',
    category: 'Hardware & Infrastructure',
    description:
      'Hands-on training in PC assembly, hardware diagnostics, operating system installation, preventive maintenance, and troubleshooting.',
    learningObjectives: [
      'Diagnose and replace desktop and laptop hardware components',
      'Install, configure, and troubleshoot operating systems and drivers',
      'Implement backup, BIOS configuration, and security hygiene',
    ],
    qualifications: 'Basic familiarity with using a computer.',
    deliveryMethods: ['In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register via the Zacma AI Assistant or institute registration portal and verify your seat with admissions.',
  },
  {
    title: 'Mobile Maintenance',
    category: 'Hardware & Infrastructure',
    description:
      'Applied technical training in smartphone diagnostics, board-level troubleshooting, screen and battery replacement, and mobile software recovery.',
    learningObjectives: [
      'Use diagnostic meters and repair tools safely on mobile devices',
      'Perform component replacements and soldering fundamentals',
      'Resolve mobile firmware, unlocking, and OS recovery issues',
    ],
    qualifications: 'Open to beginners and technicians looking to formalize practical mobile repair skills.',
    deliveryMethods: ['In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Submit your registration through the Zacma AI Assistant or official registration form.',
  },
  {
    title: 'Digital Marketing',
    category: 'Business & Growth',
    description:
      'Comprehensive training in search engine optimization, social media strategy, paid advertising campaigns, email funnels, and performance analytics.',
    learningObjectives: [
      'Plan multi-channel digital acquisition and content calendars',
      'Run and optimize search and social ad campaigns',
      'Measure ROI using conversion tracking and web analytics',
    ],
    qualifications: 'Basic internet and computer skills; ideal for marketers, entrepreneurs, and graduates.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register conversationally with ZACMA AI ASSISTANT or via the official institute registration form.',
  },
  {
    title: 'Artificial Intelligence (AI)',
    category: 'Data & Emerging Tech',
    description:
      'Applied program covering machine learning foundations, neural networks, generative AI workflows, prompt engineering, and responsible deployment.',
    learningObjectives: [
      'Understand core supervised, unsupervised, and deep learning concepts',
      'Build practical AI-powered applications and automation pipelines',
      'Evaluate model accuracy, safety, and real-world deployment tradeoffs',
    ],
    qualifications: 'Basic programming familiarity or strong analytical background recommended.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register through ZACMA AI ASSISTANT or complete the official Zacma Technology Training Institute form.',
  },
  {
    title: 'Cloud Computing',
    category: 'Cloud & DevOps',
    description:
      'Architecture and administration of modern cloud infrastructure including compute, networking, storage, IAM security, and serverless workloads.',
    learningObjectives: [
      'Deploy scalable virtual networks, compute instances, and managed storage',
      'Configure identity, access control, monitoring, and cost governance',
      'Architect resilient, high-availability cloud applications',
    ],
    qualifications: 'Foundational IT, networking, or software knowledge recommended.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Complete registration through ZACMA AI ASSISTANT or the institute registration link.',
  },
  {
    title: 'Robotics',
    category: 'Engineering & Emerging Tech',
    description:
      'Interdisciplinary hands-on training in microcontrollers, sensors, actuators, embedded programming, and autonomous robotic systems.',
    learningObjectives: [
      'Wire and program microcontrollers with real-time sensors and motors',
      'Design mechanical and electronic prototypes for automation tasks',
      'Test, calibrate, and debug autonomous robotic behaviors',
    ],
    qualifications: 'Interest in electronics, mechanics, or coding; beginner-friendly entry track available.',
    deliveryMethods: ['In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register via ZACMA AI ASSISTANT or official registration form to reserve lab bench space.',
  },
  {
    title: 'Data Science',
    category: 'Data & Emerging Tech',
    description:
      'End-to-end data analysis and predictive modeling program covering Python for data, statistical analysis, visualization, and machine learning.',
    learningObjectives: [
      'Clean, transform, and explore real-world datasets programmatically',
      'Build interactive executive dashboards and statistical summaries',
      'Train and validate predictive models for business decisions',
    ],
    qualifications: 'Basic numeracy and computer literacy; prior coding is helpful but not mandatory.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Apply through ZACMA AI ASSISTANT or the official institute registration portal.',
  },
  {
    title: 'Database Management',
    category: 'Software & Data Systems',
    description:
      'Structured training in relational and NoSQL database design, SQL querying, indexing, backup strategies, security, and performance tuning.',
    learningObjectives: [
      'Design normalized relational schemas and document data models',
      'Write complex SQL queries, views, stored procedures, and transactions',
      'Administer backups, replication, access roles, and query optimization',
    ],
    qualifications: 'Basic computer literacy; suitable for aspiring DBAs, analysts, and developers.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register via ZACMA AI ASSISTANT or submit the official training registration form.',
  },
  {
    title: 'DevOps',
    category: 'Cloud & DevOps',
    description:
      'Practical engineering track covering Linux administration, Git workflows, CI/CD pipelines, containerization, infrastructure as code, and observability.',
    learningObjectives: [
      'Automate build, test, and deployment pipelines with CI/CD tools',
      'Containerize applications and orchestrate production services',
      'Implement infrastructure as code, logging, and reliability monitoring',
    ],
    qualifications: 'Basic software development or system administration background recommended.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Complete registration through ZACMA AI ASSISTANT or official admissions form.',
  },
  {
    title: 'IT Help Desk',
    category: 'Hardware & Infrastructure',
    description:
      'Career-focused technical support training covering ticketing workflows, workstation support, Active Directory basics, networking fundamentals, and customer service.',
    learningObjectives: [
      'Troubleshoot hardware, software, printer, and connectivity incidents',
      'Manage service desk tickets, SLAs, and escalation procedures',
      'Deliver clear, empathetic technical support to end users',
    ],
    qualifications: 'Basic computer proficiency and strong communication interest.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register with ZACMA AI ASSISTANT or via the official institute registration link.',
  },
  {
    title: 'Mobile Development',
    category: 'Software & Data Systems',
    description:
      'Build production Android and cross-platform mobile applications covering UI architecture, local persistence, REST APIs, and app store publishing.',
    learningObjectives: [
      'Build responsive mobile interfaces and multi-screen navigation',
      'Integrate authentication, cloud databases, and external APIs',
      'Test, package, and prepare mobile apps for store release',
    ],
    qualifications: 'Basic computer skills; introductory programming familiarity is helpful.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Complete admission details with ZACMA AI ASSISTANT or through the official registration form.',
  },
  {
    title: 'Network and System Administration',
    category: 'Hardware & Infrastructure',
    description:
      'Enterprise infrastructure training in TCP/IP routing and switching, Windows/Linux server administration, virtualization, firewalls, and security hardening.',
    learningObjectives: [
      'Design, subnet, and troubleshoot local and wide-area networks',
      'Configure Linux and Windows enterprise servers and directory services',
      'Enforce firewall policies, VPNs, and proactive system monitoring',
    ],
    qualifications: 'Foundational IT or computer hardware knowledge recommended.',
    deliveryMethods: ['In-Person', 'Weekend', 'Online'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register via ZACMA AI ASSISTANT or submit the official registration form.',
  },
  {
    title: 'Software Development',
    category: 'Software & Data Systems',
    description:
      'Full-stack software engineering training covering programming fundamentals, modern web frontend and backend architectures, APIs, testing, and deployment.',
    learningObjectives: [
      'Write clean, maintainable code using modern software engineering practices',
      'Build full-stack web applications with databases and secure APIs',
      'Collaborate using Git, automated testing, and cloud deployment workflows',
    ],
    qualifications: 'Basic computer literacy and strong problem-solving motivation.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Apply through ZACMA AI ASSISTANT or complete the official registration form.',
  },
  {
    title: 'Blockchain',
    category: 'Web3 & FinTech',
    description:
      'Technical foundations of distributed ledgers, cryptographic hashing, consensus protocols, smart contract architecture, and decentralized applications.',
    learningObjectives: [
      'Explain distributed ledger architecture and cryptographic verification',
      'Write, test, and audit foundational smart contracts',
      'Evaluate enterprise and public blockchain use cases securely',
    ],
    qualifications: 'Basic programming or computer science familiarity recommended.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register through ZACMA AI ASSISTANT or the official institute form.',
  },
  {
    title: 'Cryptocurrency',
    category: 'Web3 & FinTech',
    description:
      'Educational program on digital asset ecosystems, wallet security, custody best practices, on-chain mechanics, risk management, and regulatory awareness.',
    learningObjectives: [
      'Understand digital asset protocols, exchanges, and self-custody wallets',
      'Apply operational security practices to protect digital assets from scams',
      'Analyze market infrastructure and compliance fundamentals responsibly',
    ],
    qualifications: 'Basic digital literacy; designed as an educational technology course.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Complete registration through ZACMA AI ASSISTANT or official registration form.',
  },
  {
    title: 'Augmented Reality and Virtual Reality',
    category: 'Creative & Emerging Tech',
    description:
      'Immersive media training covering 3D spatial design, interactive AR/VR experiences, real-time rendering engines, and deployment across mobile and headset platforms.',
    learningObjectives: [
      'Create and optimize 3D assets and interactive spatial environments',
      'Build augmented reality mobile experiences and VR simulations',
      'Design comfortable, accessible spatial user interfaces',
    ],
    qualifications: 'Basic computer proficiency; design or coding familiarity is a plus.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Apply via ZACMA AI ASSISTANT or the official registration form.',
  },
  {
    title: 'Dropshipping',
    category: 'Business & Growth',
    description:
      'Practical e-commerce operations course covering niche product research, storefront setup, supplier vetting, order fulfillment workflows, and customer retention.',
    learningObjectives: [
      'Set up and brand an online storefront with conversion-focused pages',
      'Evaluate reliable suppliers, pricing margins, and fulfillment timelines',
      'Launch ethical customer acquisition campaigns and handle post-sale support',
    ],
    qualifications: 'Basic internet and computer skills; ideal for aspiring e-commerce operators.',
    deliveryMethods: ['Online', 'In-Person', 'Weekend'],
    approvedFee: DEFAULT_APPROVED_COURSE_FEE,
    registrationProcedure:
      'Register through ZACMA AI ASSISTANT or submit the official Zacma registration form.',
  },
];

// =============================================================================
// ADMIN CONFIGURATION, COURSES & KNOWLEDGE BASE OPERATIONS
// =============================================================================

export async function saveSupportConfig(params: {
  organizationId: string;
  orgOwnerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
  existing: PublicSupportConfig | null;
  data: {
    isActive: boolean;
    assistantName: string;
    welcomeMessage: string;
    aiInstructions: string;
    supportedLanguages: string[];
    trainingInstituteBuId: string;
    trainingInstituteName: string;
    registrationFormUrl: string;
  };
}) {
  const path = `publicSupport/${params.organizationId}`;
  try {
    const payload = {
      organizationId: params.organizationId,
      isActive: Boolean(params.data.isActive),
      assistantName: clampStr(params.data.assistantName || 'ZACMA AI ASSISTANT', 100),
      welcomeMessage: clampStr(params.data.welcomeMessage || DEFAULT_SUPPORT_WELCOME_MESSAGE, 1000),
      aiInstructions: clampStr(params.data.aiInstructions, 3000),
      supportedLanguages: clampList(
        params.data.supportedLanguages.length > 0 ? params.data.supportedLanguages : ['en', 'am'],
        10,
        20
      ),
      trainingInstituteBuId: clampStr(params.data.trainingInstituteBuId, 128),
      trainingInstituteName: clampStr(
        params.data.trainingInstituteName || 'Zacma Technology Training Institute',
        160
      ),
      registrationFormUrl: clampStr(params.data.registrationFormUrl, 500),
      orgOwnerId: params.existing?.orgOwnerId || params.orgOwnerId,
      updatedAt: serverTimestamp(),
    };

    if (params.existing) {
      await updateDoc(doc(db, path), {
        isActive: payload.isActive,
        assistantName: payload.assistantName,
        welcomeMessage: payload.welcomeMessage,
        aiInstructions: payload.aiInstructions,
        supportedLanguages: payload.supportedLanguages,
        trainingInstituteBuId: payload.trainingInstituteBuId,
        trainingInstituteName: payload.trainingInstituteName,
        registrationFormUrl: payload.registrationFormUrl,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, path), payload);
    }

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.orgOwnerId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'ai_support.config_updated',
      resourceType: 'publicSupport',
      resourceId: params.organizationId,
      summary: `Updated ZACMA AI ASSISTANT config (${payload.isActive ? 'Active' : 'Inactive'})`,
    });
  } catch (error) {
    handleFirestoreError(error, params.existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

function normalizeCourseKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(ai\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function seedEighteenInstituteCourses(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existingCourses: TrainingCourse[];
  actorId: string;
  actorName: string;
  skipAudit?: boolean;
}): Promise<{ createdCount: number; updatedFeeCount: number }> {
  const existingByKey = new Map<string, TrainingCourse>();
  for (const c of params.existingCourses) {
    existingByKey.set(normalizeCourseKey(c.title), c);
  }

  const missing = INSTITUTE_18_COURSES.filter(
    (seed) => !existingByKey.has(normalizeCourseKey(seed.title))
  );
  const needsFeeBackfill = INSTITUTE_18_COURSES.map((seed) => {
    const match = existingByKey.get(normalizeCourseKey(seed.title));
    return match && !match.approvedFee.trim() ? { course: match, fee: seed.approvedFee } : null;
  }).filter((item): item is { course: TrainingCourse; fee: string } => item !== null);

  if (missing.length === 0 && needsFeeBackfill.length === 0) {
    return { createdCount: 0, updatedFeeCount: 0 };
  }

  const authUsers = clampList([...params.authorizedUserIds, params.ownerId, params.actorId], 100);
  try {
    const batch = writeBatch(db);
    for (const seed of missing) {
      const id = generateId('course');
      batch.set(doc(db, `publicCourses/${id}`), {
        id,
        organizationId: params.organizationId,
        title: clampStr(seed.title, 160),
        category: clampStr(seed.category, 100),
        description: clampStr(seed.description, 2000),
        learningObjectives: clampList(seed.learningObjectives, 20, 200),
        qualifications: clampStr(seed.qualifications, 600),
        duration: '',
        deliveryMethods: clampList(seed.deliveryMethods, 10, 60),
        schedules: '',
        availableBatches: '',
        certificateInfo: '',
        approvedFee: clampStr(seed.approvedFee, 200),
        registrationProcedure: clampStr(seed.registrationProcedure, 1000),
        isActive: true,
        ownerId: params.ownerId,
        authorizedUserIds: authUsers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    for (const item of needsFeeBackfill) {
      batch.update(doc(db, `publicCourses/${item.course.id}`), {
        approvedFee: clampStr(item.fee, 200),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    if (!params.skipAudit) {
      await logAuditEvent({
        organizationId: params.organizationId,
        ownerId: params.ownerId,
        authorizedUserIds: authUsers,
        actorId: params.actorId,
        actorName: params.actorName,
        action: 'ai_support.courses_seeded',
        resourceType: 'publicCourses',
        resourceId: params.organizationId,
        summary: `Synced institute courses (${missing.length} created, ${needsFeeBackfill.length} fees set to ${DEFAULT_APPROVED_COURSE_FEE})`,
      });
    }
    return { createdCount: missing.length, updatedFeeCount: needsFeeBackfill.length };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'publicCourses');
  }
}

export async function applyUniformFeeToAllCourses(params: {
  organizationId: string;
  courses: TrainingCourse[];
  fee: string;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
}): Promise<number> {
  const cleanFee = clampStr(params.fee, 200);
  if (!cleanFee || params.courses.length === 0) return 0;

  try {
    const batch = writeBatch(db);
    let updated = 0;
    for (const c of params.courses) {
      if (c.approvedFee.trim() !== cleanFee) {
        batch.update(doc(db, `publicCourses/${c.id}`), {
          approvedFee: cleanFee,
          updatedAt: serverTimestamp(),
        });
        updated++;
      }
    }
    if (updated === 0) return 0;
    await batch.commit();

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'ai_support.courses_bulk_fee_updated',
      resourceType: 'publicCourses',
      resourceId: params.organizationId,
      summary: `Set approved tuition fee to ${cleanFee} across ${updated} courses`,
    });
    return updated;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'publicCourses');
  }
}

export async function saveTrainingCourse(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existing?: TrainingCourse | null;
  data: {
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
  };
  actorId: string;
  actorName: string;
}): Promise<string> {
  const id = params.existing?.id || generateId('course');
  const path = `publicCourses/${id}`;
  const authUsers = clampList([...params.authorizedUserIds, params.ownerId, params.actorId], 100);

  try {
    if (params.existing) {
      await updateDoc(doc(db, path), {
        title: clampStr(params.data.title, 160),
        category: clampStr(params.data.category, 100),
        description: clampStr(params.data.description, 2000),
        learningObjectives: clampList(params.data.learningObjectives, 20, 200),
        qualifications: clampStr(params.data.qualifications, 600),
        duration: clampStr(params.data.duration, 120),
        deliveryMethods: clampList(params.data.deliveryMethods, 10, 60),
        schedules: clampStr(params.data.schedules, 600),
        availableBatches: clampStr(params.data.availableBatches, 600),
        certificateInfo: clampStr(params.data.certificateInfo, 600),
        approvedFee: clampStr(params.data.approvedFee, 200),
        registrationProcedure: clampStr(params.data.registrationProcedure, 1000),
        isActive: Boolean(params.data.isActive),
        authorizedUserIds: authUsers,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, path), {
        id,
        organizationId: params.organizationId,
        title: clampStr(params.data.title, 160),
        category: clampStr(params.data.category, 100),
        description: clampStr(params.data.description, 2000),
        learningObjectives: clampList(params.data.learningObjectives, 20, 200),
        qualifications: clampStr(params.data.qualifications, 600),
        duration: clampStr(params.data.duration, 120),
        deliveryMethods: clampList(params.data.deliveryMethods, 10, 60),
        schedules: clampStr(params.data.schedules, 600),
        availableBatches: clampStr(params.data.availableBatches, 600),
        certificateInfo: clampStr(params.data.certificateInfo, 600),
        approvedFee: clampStr(params.data.approvedFee, 200),
        registrationProcedure: clampStr(params.data.registrationProcedure, 1000),
        isActive: Boolean(params.data.isActive),
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
      action: params.existing ? 'ai_support.course_updated' : 'ai_support.course_created',
      resourceType: 'publicCourses',
      resourceId: id,
      summary: `${params.existing ? 'Updated' : 'Created'} training course "${params.data.title}"`,
    });

    return id;
  } catch (error) {
    handleFirestoreError(error, params.existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function deleteTrainingCourse(params: {
  organizationId: string;
  course: TrainingCourse;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
}) {
  const path = `publicCourses/${params.course.id}`;
  try {
    await deleteDoc(doc(db, path));
    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'ai_support.course_deleted',
      resourceType: 'publicCourses',
      resourceId: params.course.id,
      summary: `Deleted training course "${params.course.title}"`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveSupportKnowledge(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existing?: SupportKnowledgeItem | null;
  data: {
    category: SupportKnowledgeCategory;
    question: string;
    answer: string;
    language: 'en' | 'am' | 'both';
    isActive: boolean;
  };
  actorId: string;
  actorName: string;
}): Promise<string> {
  const id = params.existing?.id || generateId('faq');
  const path = `publicFaqs/${id}`;
  const authUsers = clampList([...params.authorizedUserIds, params.ownerId, params.actorId], 100);

  try {
    if (params.existing) {
      await updateDoc(doc(db, path), {
        category: params.data.category,
        question: clampStr(params.data.question, 400),
        answer: clampStr(params.data.answer, 3000),
        language: params.data.language,
        isActive: Boolean(params.data.isActive),
        authorizedUserIds: authUsers,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, path), {
        id,
        organizationId: params.organizationId,
        category: params.data.category,
        question: clampStr(params.data.question, 400),
        answer: clampStr(params.data.answer, 3000),
        language: params.data.language,
        isActive: Boolean(params.data.isActive),
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
      action: params.existing ? 'ai_support.faq_updated' : 'ai_support.faq_created',
      resourceType: 'publicFaqs',
      resourceId: id,
      summary: `${params.existing ? 'Updated' : 'Created'} FAQ: "${params.data.question.slice(0, 80)}"`,
    });

    return id;
  } catch (error) {
    handleFirestoreError(error, params.existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function deleteSupportKnowledge(params: {
  organizationId: string;
  item: SupportKnowledgeItem;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
}) {
  const path = `publicFaqs/${params.item.id}`;
  try {
    await deleteDoc(doc(db, path));
    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'ai_support.faq_deleted',
      resourceType: 'publicFaqs',
      resourceId: params.item.id,
      summary: `Deleted FAQ "${params.item.question.slice(0, 80)}"`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// =============================================================================
// PUBLIC WIDGET & AUTHENTICATED STUDENT READ HELPERS
// =============================================================================

function buildApprovedFallbackCourses(organizationId: string): TrainingCourse[] {
  return INSTITUTE_18_COURSES.map((seed, idx) => ({
    id: `catalog_${idx + 1}`,
    organizationId,
    title: seed.title,
    category: seed.category,
    description: seed.description,
    learningObjectives: seed.learningObjectives,
    qualifications: seed.qualifications,
    duration: '',
    deliveryMethods: seed.deliveryMethods,
    schedules: '',
    availableBatches: '',
    certificateInfo: '',
    approvedFee: seed.approvedFee,
    registrationProcedure: seed.registrationProcedure,
    isActive: true,
    ownerId: '',
    authorizedUserIds: [],
    createdAt: null,
    updatedAt: null,
  })).sort((a, b) => a.title.localeCompare(b.title));
}

export async function fetchPublicSupportBundle(organizationId: string): Promise<{
  config: PublicSupportConfig | null;
  courses: TrainingCourse[];
  faqs: SupportKnowledgeItem[];
}> {
  try {
    const configSnap = await getDoc(doc(db, `publicSupport/${organizationId}`));
    const config = configSnap.exists() ? (configSnap.data() as PublicSupportConfig) : null;

    const coursesQuery = query(
      collection(db, 'publicCourses'),
      where('organizationId', '==', organizationId),
      where('isActive', '==', true)
    );
    const faqsQuery = query(
      collection(db, 'publicFaqs'),
      where('organizationId', '==', organizationId),
      where('isActive', '==', true)
    );

    const [coursesSnap, faqsSnap] = await Promise.all([
      getDocs(coursesQuery),
      getDocs(faqsQuery),
    ]);

    const firestoreCourses = coursesSnap.docs
      .map((d) => d.data() as TrainingCourse)
      .sort((a, b) => a.title.localeCompare(b.title));

    // If Firestore courses haven't been synced yet, serve the administrator-approved 18-course catalog (8,500 ETB each).
    const courses =
      firestoreCourses.length > 0
        ? firestoreCourses
        : buildApprovedFallbackCourses(organizationId);

    const faqs = faqsSnap.docs
      .map((d) => d.data() as SupportKnowledgeItem)
      .sort((a, b) => timestampToMillis(b.updatedAt) - timestampToMillis(a.updatedAt));

    return { config, courses, faqs };
  } catch {
    return {
      config: null,
      courses: buildApprovedFallbackCourses(organizationId),
      faqs: [],
    };
  }
}

export async function fetchStudentOwnRegistrations(
  organizationId: string,
  studentUid: string
): Promise<StudentRegistration[]> {
  if (!studentUid) return [];
  const path = `organizations/${organizationId}/studentRegistrations`;
  try {
    const q = query(collection(db, path), where('studentUid', '==', studentUid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as StudentRegistration)
      .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
  } catch {
    return [];
  }
}

// =============================================================================
// PUBLIC AI CHAT ATOMIC WRITES (REGISTRATION, LEAD CAPTURE, HUMAN ESCALATION)
// =============================================================================

function sanitizeMessagesForFirestore(messages: SupportChatMessage[]): SupportChatMessage[] {
  return messages.slice(-80).map((m) => ({
    id: clampStr(m.id || generateId('msg'), 60),
    role: m.role === 'agent' ? 'agent' : m.role === 'assistant' ? 'assistant' : 'user',
    text: clampStr(m.text, 2000),
    timestamp: clampStr(m.timestamp || new Date().toISOString(), 40),
  }));
}

export async function submitAiChatRegistration(params: {
  config: PublicSupportConfig;
  draft: RegistrationDraft;
  messages: SupportChatMessage[];
  language: 'en' | 'am' | 'other';
  unansweredQuestions: string[];
  studentUid: string;
  documentUploadFormUrl: string;
}): Promise<{ leadRef: string; registrationId: string; conversationId: string }> {
  const orgId = params.config.organizationId;
  const ownerId = params.config.orgOwnerId;
  const buId = params.config.trainingInstituteBuId || 'zacma-training-institute';
  const buName = params.config.trainingInstituteName || 'Zacma Technology Training Institute';

  const conversationId = generateId('conv');
  const leadId = generateId('lead');
  const registrationId = generateId('reg');
  const activityId = generateId('act');
  const notifId = generateId('notif');
  const leadRef = generateLeadRef();

  const fullName = clampStr(params.draft.fullName || 'Prospective Student', 160);
  const phone = clampStr(params.draft.phone || '', 60);
  const email = clampStr(params.draft.email || '', 200);
  const address = clampStr(params.draft.address || '', 300);
  const preferredCourse = clampStr(params.draft.preferredCourse || 'General Training', 160);
  const deliveryMethod = clampStr(params.draft.deliveryMethod || 'Flexible', 80);
  const preferredSchedule = clampStr(params.draft.preferredSchedule || 'Flexible', 120);
  const paymentMethod = clampStr(params.draft.paymentMethod || 'To be confirmed', 120);
  const docFormUrl = clampStr(params.documentUploadFormUrl || params.config.registrationFormUrl, 500);

  const summary = clampStr(
    `AI Registration submitted for ${preferredCourse} (${deliveryMethod}, ${preferredSchedule}). Payment preference: ${paymentMethod}.`,
    1000
  );

  const convPath = `organizations/${orgId}/supportConversations/${conversationId}`;
  const leadPath = `organizations/${orgId}/leads/${leadId}`;
  const regPath = `organizations/${orgId}/studentRegistrations/${registrationId}`;
  const actPath = `organizations/${orgId}/leads/${leadId}/activities/${activityId}`;
  const notifPath = `organizations/${orgId}/notifications/${notifId}`;

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, convPath), {
      id: conversationId,
      organizationId: orgId,
      businessUnitId: buId,
      visitorName: fullName,
      visitorPhone: phone,
      visitorEmail: email,
      studentUid: clampStr(params.studentUid, 128),
      language: params.language,
      intent: 'registration',
      interestedCourse: preferredCourse,
      status: 'active',
      assignedAgentId: '',
      assignedAgentName: '',
      unansweredQuestions: clampList(params.unansweredQuestions, 30, 300),
      leadId,
      leadRef,
      messages: sanitizeMessagesForFirestore(params.messages),
      summary,
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, leadPath), {
      id: leadId,
      leadRef,
      organizationId: orgId,
      businessUnitId: buId,
      businessUnitName: clampStr(buName, 140),
      formId: 'ai_registration',
      formTitle: `AI Registration — ${preferredCourse}`.slice(0, 180),
      submissionId: conversationId,
      publicSlugKey: 'ai_chat_registration',
      fullName,
      email,
      phone,
      responses: {
        preferredCourse,
        deliveryMethod,
        preferredSchedule,
        paymentMethod,
        address,
        conversationSummary: summary,
        documentUploadFormUrl: docFormUrl,
      },
      source: 'ai_chat',
      assignedStaffId: '',
      assignedStaffName: '',
      status: 'new',
      priority: 'medium',
      followUpDate: '',
      lastContactAt: '',
      internalNotes: summary,
      attachments: [],
      ownerId,
      authorizedUserIds: [ownerId],
      submittedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, regPath), {
      id: registrationId,
      organizationId: orgId,
      businessUnitId: buId,
      leadId,
      leadRef,
      studentUid: clampStr(params.studentUid, 128),
      fullName,
      phone,
      email,
      address,
      preferredCourse,
      deliveryMethod,
      preferredSchedule,
      paymentMethod,
      registrationStatus: 'submitted',
      batchName: '',
      classSchedule: preferredSchedule,
      trainingLocation: '',
      paymentStatus: 'pending',
      certificateStatus: 'not_issued',
      documentUploadFormUrl: docFormUrl,
      source: 'ai_chat',
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, actPath), {
      id: activityId,
      organizationId: orgId,
      leadId,
      type: 'submission',
      summary: `AI Chat Registration: ${preferredCourse} (${leadRef})`,
      details: `${fullName} registered via ZACMA AI ASSISTANT (${deliveryMethod} / ${preferredSchedule}).`,
      actorId: 'ai_support_visitor',
      actorName: fullName,
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, notifPath), {
      id: notifId,
      organizationId: orgId,
      recipientUserId: ownerId,
      title: `New AI Registration: ${fullName}`,
      message: `${preferredCourse} (${deliveryMethod}) registered via ZACMA AI ASSISTANT (${leadRef}).`,
      entityType: 'lead',
      entityId: leadId,
      isRead: false,
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return { leadRef, registrationId, conversationId };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, regPath);
  }
}

export async function captureAiChatLeadOrEscalation(params: {
  config: PublicSupportConfig;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string;
  interestedCourse: string;
  intent: SupportConversation['intent'];
  language: 'en' | 'am' | 'other';
  escalateToHuman: boolean;
  consentToLeadCapture: boolean;
  messages: SupportChatMessage[];
  unansweredQuestions: string[];
  summary: string;
  studentUid: string;
}): Promise<{ conversationId: string; leadRef: string }> {
  const orgId = params.config.organizationId;
  const ownerId = params.config.orgOwnerId;
  const buId = params.config.trainingInstituteBuId || 'zacma-training-institute';
  const buName = params.config.trainingInstituteName || 'Zacma Technology Training Institute';

  const conversationId = generateId('conv');
  const createLead = Boolean(
    params.consentToLeadCapture && (params.visitorPhone.trim() || params.visitorEmail.trim())
  );
  const leadId = createLead ? generateId('lead') : '';
  const leadRef = createLead ? generateLeadRef() : '';

  const cleanName = clampStr(params.visitorName || 'Website Visitor', 160);
  const cleanPhone = clampStr(params.visitorPhone, 60);
  const cleanEmail = clampStr(params.visitorEmail, 200);
  const cleanCourse = clampStr(params.interestedCourse, 160);
  const cleanSummary = clampStr(
    params.summary ||
      `${params.escalateToHuman ? 'Escalated to human support' : 'Course inquiry'} via ZACMA AI ASSISTANT${cleanCourse ? ` regarding ${cleanCourse}` : ''}.`,
    1000
  );

  const convPath = `organizations/${orgId}/supportConversations/${conversationId}`;

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, convPath), {
      id: conversationId,
      organizationId: orgId,
      businessUnitId: buId,
      visitorName: cleanName,
      visitorPhone: cleanPhone,
      visitorEmail: cleanEmail,
      studentUid: clampStr(params.studentUid, 128),
      language: params.language,
      intent: params.escalateToHuman ? 'escalation' : params.intent,
      interestedCourse: cleanCourse,
      status: params.escalateToHuman ? 'escalated' : 'active',
      assignedAgentId: '',
      assignedAgentName: '',
      unansweredQuestions: clampList(params.unansweredQuestions, 30, 300),
      leadId,
      leadRef,
      messages: sanitizeMessagesForFirestore(params.messages),
      summary: cleanSummary,
      ownerId,
      authorizedUserIds: [ownerId],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (createLead) {
      const leadPath = `organizations/${orgId}/leads/${leadId}`;
      const activityId = generateId('act');
      const notifId = generateId('notif');

      batch.set(doc(db, leadPath), {
        id: leadId,
        leadRef,
        organizationId: orgId,
        businessUnitId: buId,
        businessUnitName: clampStr(buName, 140),
        formId: 'ai_support_inquiry',
        formTitle: cleanCourse ? `AI Inquiry — ${cleanCourse}`.slice(0, 180) : 'AI Support Inquiry',
        submissionId: conversationId,
        publicSlugKey: 'ai_chat_inquiry',
        fullName: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        responses: {
          interestedCourse: cleanCourse || 'General Inquiry',
          conversationSource: 'ZACMA AI ASSISTANT',
          escalatedToHuman: params.escalateToHuman ? 'Yes' : 'No',
          conversationSummary: cleanSummary,
        },
        source: 'ai_chat',
        assignedStaffId: '',
        assignedStaffName: '',
        status: 'new',
        priority: 'medium',
        followUpDate: '',
        lastContactAt: '',
        internalNotes: cleanSummary,
        attachments: [],
        ownerId,
        authorizedUserIds: [ownerId],
        submittedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(doc(db, `organizations/${orgId}/leads/${leadId}/activities/${activityId}`), {
        id: activityId,
        organizationId: orgId,
        leadId,
        type: 'submission',
        summary: `AI Lead Captured: ${cleanCourse || 'Institute Inquiry'} (${leadRef})`,
        details: cleanSummary,
        actorId: 'ai_support_visitor',
        actorName: cleanName,
        ownerId,
        authorizedUserIds: [ownerId],
        createdAt: serverTimestamp(),
      });

      batch.set(doc(db, `organizations/${orgId}/notifications/${notifId}`), {
        id: notifId,
        organizationId: orgId,
        recipientUserId: ownerId,
        title: params.escalateToHuman
          ? `Escalated Support + Lead: ${cleanName}`
          : `New AI Chat Lead: ${cleanName}`,
        message: `${cleanCourse || 'General inquiry'} captured via ZACMA AI ASSISTANT (${leadRef}).`,
        entityType: 'lead',
        entityId: leadId,
        isRead: false,
        ownerId,
        authorizedUserIds: [ownerId],
        createdAt: serverTimestamp(),
      });
    } else if (params.escalateToHuman) {
      const notifId = generateId('notif');
      batch.set(doc(db, `organizations/${orgId}/notifications/${notifId}`), {
        id: notifId,
        organizationId: orgId,
        recipientUserId: ownerId,
        title: `Human Support Requested: ${cleanName}`,
        message: cleanSummary.slice(0, 480),
        entityType: 'followup',
        entityId: conversationId,
        isRead: false,
        ownerId,
        authorizedUserIds: [ownerId],
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return { conversationId, leadRef };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

// =============================================================================
// HUMAN SUPPORT INBOX & REGISTRATION MANAGEMENT
// =============================================================================

export async function assignSupportConversation(params: {
  organizationId: string;
  conversation: SupportConversation;
  agentId: string;
  agentName: string;
}) {
  const path = `organizations/${params.organizationId}/supportConversations/${params.conversation.id}`;
  const nextAuth = params.agentId
    ? clampList([...params.conversation.authorizedUserIds, params.agentId], 100)
    : params.conversation.authorizedUserIds;

  try {
    await updateDoc(doc(db, path), {
      assignedAgentId: clampStr(params.agentId, 128),
      assignedAgentName: clampStr(params.agentName, 120),
      status: params.agentId ? 'assigned' : 'escalated',
      authorizedUserIds: nextAuth,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function sendHumanAgentReply(params: {
  organizationId: string;
  conversation: SupportConversation;
  agentId: string;
  agentName: string;
  replyText: string;
  markResolved?: boolean;
}) {
  const path = `organizations/${params.organizationId}/supportConversations/${params.conversation.id}`;
  const nextMsg: SupportChatMessage = {
    id: generateId('agent'),
    role: 'agent',
    text: clampStr(`[${params.agentName}] ${params.replyText}`, 2000),
    timestamp: new Date().toISOString(),
  };
  const nextMessages = sanitizeMessagesForFirestore([...params.conversation.messages, nextMsg]);
  const nextAuth = clampList([...params.conversation.authorizedUserIds, params.agentId], 100);

  try {
    await updateDoc(doc(db, path), {
      messages: nextMessages,
      assignedAgentId: params.conversation.assignedAgentId || params.agentId,
      assignedAgentName: params.conversation.assignedAgentName || clampStr(params.agentName, 120),
      status: params.markResolved ? 'resolved' : 'assigned',
      authorizedUserIds: nextAuth,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSupportConversationStatus(params: {
  organizationId: string;
  conversation: SupportConversation;
  status: SupportConversation['status'];
  unansweredQuestions?: string[];
}) {
  const path = `organizations/${params.organizationId}/supportConversations/${params.conversation.id}`;
  try {
    const payload: Record<string, unknown> = {
      status: params.status,
      updatedAt: serverTimestamp(),
    };
    if (params.unansweredQuestions !== undefined) {
      payload.unansweredQuestions = clampList(params.unansweredQuestions, 30, 300);
    }
    await updateDoc(doc(db, path), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateStudentRegistrationRecord(params: {
  organizationId: string;
  registration: StudentRegistration;
  updates: Partial<
    Pick<
      StudentRegistration,
      | 'registrationStatus'
      | 'batchName'
      | 'classSchedule'
      | 'trainingLocation'
      | 'paymentStatus'
      | 'certificateStatus'
      | 'documentUploadFormUrl'
    >
  >;
}) {
  const path = `organizations/${params.organizationId}/studentRegistrations/${params.registration.id}`;
  try {
    await updateDoc(doc(db, path), {
      ...params.updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
