import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updatePassword,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  FIREBASE_PROJECT_ID,
  handleFirestoreError,
  OperationType,
  parseFirebaseAuthError,
  SYSTEM_OWNER_EMAIL,
  SYSTEM_OWNER_NAME,
} from './firebase';
import { clampList, clampStr, DEFAULT_ORG_ID, generateId, logAuditEvent } from './zacmaService';
import { safeFetchJson } from './apiClient';
import type {
  LoginActivityRecord,
  MemberPermissions,
  OrganizationMember,
  SaasTenantSubscription,
  ServerVerifiedSession,
  SubscriptionPolicy,
  SystemOwnerConfig,
  UserRole,
} from '../types';
import defaultFirebaseConfig from '../../firebase-applet-config.json';

const FIREBASE_PUBLIC_API_KEY =
  ((import.meta.env as Record<string, string | undefined>).VITE_FIREBASE_API_KEY?.trim()) ||
  defaultFirebaseConfig.apiKey;

// =============================================================================
// RBAC DEFAULT PERMISSION MATRIX
// =============================================================================

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, MemberPermissions> = {
  super_admin: {
    businessUnits: true,
    forms: true,
    crm: true,
    communications: true,
    aiSupport: true,
    reports: true,
    userManagement: true,
    billing: true,
  },
  org_admin: {
    businessUnits: true,
    forms: true,
    crm: true,
    communications: true,
    aiSupport: true,
    reports: true,
    userManagement: true,
    billing: true,
  },
  bu_manager: {
    businessUnits: true,
    forms: true,
    crm: true,
    communications: true,
    aiSupport: true,
    reports: true,
    userManagement: false,
    billing: false,
  },
  staff: {
    businessUnits: false,
    forms: false,
    crm: true,
    communications: true,
    aiSupport: true,
    reports: true,
    userManagement: false,
    billing: false,
  },
  accountant: {
    businessUnits: false,
    forms: false,
    crm: false,
    communications: false,
    aiSupport: false,
    reports: true,
    userManagement: false,
    billing: true,
  },
  instructor: {
    businessUnits: false,
    forms: false,
    crm: false,
    communications: false,
    aiSupport: true,
    reports: false,
    userManagement: false,
    billing: false,
  },
  student: {
    businessUnits: false,
    forms: false,
    crm: false,
    communications: false,
    aiSupport: false,
    reports: false,
    userManagement: false,
    billing: false,
  },
};

export function resolveEffectivePermissions(
  role: UserRole,
  customPermissions?: Partial<MemberPermissions>,
  explicitCrmAccess?: boolean
): MemberPermissions {
  const base = { ...DEFAULT_ROLE_PERMISSIONS[role] };
  if (role === 'super_admin') {
    return { ...DEFAULT_ROLE_PERMISSIONS.super_admin };
  }
  if (role === 'student') {
    return { ...DEFAULT_ROLE_PERMISSIONS.student };
  }
  const merged: MemberPermissions = {
    businessUnits: customPermissions?.businessUnits ?? base.businessUnits,
    forms: customPermissions?.forms ?? base.forms,
    crm: customPermissions?.crm ?? (explicitCrmAccess !== undefined ? explicitCrmAccess : base.crm),
    communications: customPermissions?.communications ?? base.communications,
    aiSupport: customPermissions?.aiSupport ?? base.aiSupport,
    reports: customPermissions?.reports ?? base.reports,
    userManagement: customPermissions?.userManagement ?? base.userManagement,
    billing: customPermissions?.billing ?? base.billing,
  };
  return merged;
}

// =============================================================================
// USERNAME & PASSWORD SECURITY POLICY
// =============================================================================

export function normalizeUsername(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 40);
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9._-]{3,40}$/.test(username);
}

export interface PasswordStrengthResult {
  valid: boolean;
  score: number; // 0..5
  checks: {
    length: boolean;
    upper: boolean;
    lower: boolean;
    number: boolean;
    special: boolean;
  };
  message: string;
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const checks = {
    length: password.length >= 8 && password.length <= 128,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const valid = score === 5;
  let message = 'Strong password';
  if (!checks.length) message = 'Use at least 8 characters.';
  else if (!checks.upper) message = 'Include at least one uppercase letter (A-Z).';
  else if (!checks.lower) message = 'Include at least one lowercase letter (a-z).';
  else if (!checks.number) message = 'Include at least one number (0-9).';
  else if (!checks.special) message = 'Include at least one symbol (!@#$%^&*).';
  return { valid, score, checks, message };
}

export function generateStrongPassword(length = 14): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;

  const pick = (pool: string) => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return pool[arr[0] % pool.length];
  };

  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) {
    chars.push(pick(all));
  }
  // Fisher-Yates shuffle using crypto RNG
  for (let i = chars.length - 1; i > 0; i--) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const j = arr[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// =============================================================================
// SUBSCRIPTION ACCESS POLICY (NEVER LOCKS TENANTS OUT OF VIEWING EXISTING DATA)
// =============================================================================

export function computeSubscriptionPolicy(
  sub: SaasTenantSubscription | null,
  isPlatformOwner: boolean
): SubscriptionPolicy {
  if (isPlatformOwner || !sub) {
    return {
      status: sub?.status || 'none',
      isReadOnly: false,
      isSuspended: false,
      isExpired: false,
      canPublishForms: true,
      canDispatchBulkMessages: true,
      canCreateBusinessUnits: true,
      canCreateUsers: true,
      bannerMessage: null,
    };
  }

  const nowMs = Date.now();
  const periodEndMs = sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : NaN;
  const trialEndMs = sub.trialEndsAt ? Date.parse(sub.trialEndsAt) : NaN;
  const isTrialExpired = sub.status === 'trial' && !Number.isNaN(trialEndMs) && trialEndMs < nowMs;
  const isPeriodExpired =
    sub.status === 'active' && !Number.isNaN(periodEndMs) && periodEndMs < nowMs;
  const isExpired = isTrialExpired || isPeriodExpired;

  if (sub.status === 'suspended') {
    return {
      status: 'suspended',
      isReadOnly: true,
      isSuspended: true,
      isExpired: true,
      canPublishForms: false,
      canDispatchBulkMessages: false,
      canCreateBusinessUnits: false,
      canCreateUsers: false,
      bannerMessage:
        'Workspace subscription is suspended. You can still view and export all existing organization data, but creating new forms, users, or campaigns is paused until billing is renewed.',
    };
  }

  if (sub.status === 'past_due' || sub.status === 'cancelled' || isExpired) {
    return {
      status: sub.status,
      isReadOnly: true,
      isSuspended: false,
      isExpired: true,
      canPublishForms: false,
      canDispatchBulkMessages: false,
      canCreateBusinessUnits: false,
      canCreateUsers: false,
      bannerMessage: isTrialExpired
        ? 'Your 14-day free trial has ended. Existing leads, forms, and records remain fully viewable — renew your subscription under Billing & Plan to resume publishing and team expansion.'
        : 'Your organization subscription requires renewal. Existing data remains safely viewable; renew under Billing & Plan to restore full write actions.',
    };
  }

  return {
    status: sub.status,
    isReadOnly: false,
    isSuspended: false,
    isExpired: false,
    canPublishForms: true,
    canDispatchBulkMessages: true,
    canCreateBusinessUnits: true,
    canCreateUsers: true,
    bannerMessage: null,
  };
}

// =============================================================================
// AUTH PROVIDER STATUS & DIAGNOSTICS
// =============================================================================

export interface AuthProviderStatus {
  projectId: string;
  googleEnabled: boolean;
  emailPasswordEnabled: boolean;
  detail: string;
}

export async function fetchAuthProviderStatus(): Promise<AuthProviderStatus> {
  const serverRes = await safeFetchJson<AuthProviderStatus>('/api/auth/provider-status');
  if (serverRes.ok && serverRes.data) {
    return serverRes.data;
  }

  // Fallback to direct Identity Toolkit probe if deployed without Express API
  const probeRes = await safeFetchJson<{ error?: { message?: string } }>(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_PUBLIC_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'probe-status-check@invalid.zacma.local',
        password: 'ProbeCheck#0000',
        returnSecureToken: false,
      }),
    }
  );
  if (probeRes.isJson && probeRes.data) {
    const msg = probeRes.data.error?.message || '';
    const disabled =
      msg.includes('PASSWORD_LOGIN_DISABLED') || msg.includes('OPERATION_NOT_ALLOWED');
    return {
      projectId: FIREBASE_PROJECT_ID,
      googleEnabled: true,
      emailPasswordEnabled: !disabled,
      detail: disabled
        ? 'Email/Password sign-in is disabled in Firebase Console. Enable it under Authentication → Sign-in method → Email/Password.'
        : 'Email/Password sign-in is active.',
    };
  }

  return {
    projectId: FIREBASE_PROJECT_ID,
    googleEnabled: true,
    emailPasswordEnabled: false,
    detail: probeRes.errorMessage || 'Could not verify Firebase provider status.',
  };
}

// =============================================================================
// PERMANENT SYSTEM OWNER VERIFICATION & PROTECTION (ZEKIMULUKEN)
// =============================================================================

export function isProtectedSystemOwnerAccount(account: {
  email?: string;
  isSystemOwner?: boolean;
  accountType?: string;
}): boolean {
  return Boolean(
    account.isSystemOwner === true ||
      account.accountType === 'primary_system_owner' ||
      (account.email && account.email.toLowerCase() === SYSTEM_OWNER_EMAIL.toLowerCase())
  );
}

/**
 * Verifies the active Firebase ID token against the backend server (/api/auth/session-verify).
 * Never triggers logout on transient network errors or static-host 404s.
 */
export async function verifySessionWithServer(): Promise<ServerVerifiedSession | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;

  try {
    const idToken = await currentUser.getIdToken();
    const res = await safeFetchJson<ServerVerifiedSession>('/api/auth/session-verify', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.ok && res.data && res.data.authenticated) {
      return res.data;
    }
  } catch {
    // Graceful fallback when backend route is unreachable
  }

  const email = (currentUser.email || '').toLowerCase();
  const isOwner = Boolean(currentUser.emailVerified && email === SYSTEM_OWNER_EMAIL.toLowerCase());
  return {
    authenticated: true,
    uid: currentUser.uid,
    email,
    emailVerified: Boolean(currentUser.emailVerified),
    isSystemOwner: isOwner,
    accountType: isOwner ? 'primary_system_owner' : 'staff',
    ownerName: isOwner ? SYSTEM_OWNER_NAME : currentUser.displayName || email,
    verifiedAt: new Date().toISOString(),
    source: 'firebase_sdk',
  };
}

/**
 * Idempotently binds Zekimuluken's verified account to the tamper-proof platformConfig/systemOwner
 * anchor in Firestore without ever creating duplicate user accounts.
 */
export async function ensureSystemOwnerAnchor(params: {
  uid: string;
  email: string;
}): Promise<SystemOwnerConfig | null> {
  const ref = doc(db, 'platformConfig/systemOwner');
  const nowIso = new Date().toISOString();
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const payload: SystemOwnerConfig = {
        id: 'systemOwner',
        ownerUid: params.uid,
        ownerEmail: params.email.toLowerCase(),
        ownerName: SYSTEM_OWNER_NAME,
        accountType: 'primary_system_owner',
        role: 'super_admin',
        status: 'active',
        protected: true,
        transferCount: 0,
        lastVerifiedAt: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, payload);
      return payload;
    }

    const existing = snap.data() as SystemOwnerConfig;
    // Update verification timestamp cleanly if this is the active System Owner
    if (
      existing.ownerUid === params.uid ||
      params.email.toLowerCase() === SYSTEM_OWNER_EMAIL.toLowerCase()
    ) {
      await updateDoc(ref, {
        ownerUid: params.uid,
        ownerEmail: existing.ownerEmail || params.email.toLowerCase(),
        ownerName: existing.ownerName || SYSTEM_OWNER_NAME,
        lastVerifiedAt: nowIso,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      return {
        ...existing,
        ownerUid: params.uid,
        lastVerifiedAt: nowIso,
      };
    }
    return existing;
  } catch (err) {
    console.warn('SystemOwner anchor sync warning:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Authorized System Owner ownership transfer procedure (strictly gated by Firestore rules to current System Owner).
 */
export async function transferSystemOwnership(params: {
  targetMember: OrganizationMember;
  currentOwnerConfig: SystemOwnerConfig;
  actorId: string;
  actorName: string;
  organizationId: string;
  authorizedUserIds: string[];
}): Promise<void> {
  if (!params.targetMember.userId || !params.targetMember.email) {
    throw new Error('Target account must have a valid UID and verified email address.');
  }
  if (params.targetMember.status !== 'active') {
    throw new Error('Ownership can only be transferred to an active user account.');
  }

  const nowIso = new Date().toISOString();
  const ref = doc(db, 'platformConfig/systemOwner');
  try {
    await updateDoc(ref, {
      ownerUid: params.targetMember.userId,
      ownerEmail: params.targetMember.email.toLowerCase(),
      ownerName: clampStr(params.targetMember.displayName, 120),
      transferCount: (params.currentOwnerConfig.transferCount || 0) + 1,
      lastVerifiedAt: nowIso,
      updatedAt: serverTimestamp(),
    });

    await logAuditEvent({
      organizationId: params.organizationId || DEFAULT_ORG_ID,
      ownerId: params.actorId,
      authorizedUserIds: params.authorizedUserIds,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'platform.ownership_transferred',
      resourceType: 'system_owner',
      resourceId: 'systemOwner',
      summary: `Transferred Primary System Owner authority to ${params.targetMember.displayName} (${params.targetMember.email})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, 'platformConfig/systemOwner');
  }
}

// =============================================================================
// USERNAME + PASSWORD SIGN-IN (REAL FIREBASE AUTH + BRUTE-FORCE PROTECTION)
// =============================================================================

export async function loginWithUsernameAndPassword(
  identifierInput: string,
  password: string
): Promise<{ uid: string; email: string }> {
  const identifier = identifierInput.trim().toLowerCase();
  if (!identifier || !password) {
    throw new Error('Please enter both your username (or email) and password.');
  }

  let resolvedEmail = identifier;

  // Step 1: Try hardened server endpoint (enforces IP + username brute-force lockout)
  let usedServerRoute = false;
  const loginRes = await safeFetchJson<{
    ok?: boolean;
    loginEmail?: string;
    code?: string;
    error?: string;
  }>('/api/auth/username-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });

  if (loginRes.isJson && !loginRes.isEndpointUnavailable) {
    usedServerRoute = true;
    const data = loginRes.data;
    if (!loginRes.ok || !data?.loginEmail) {
      const err = new Error(
        data?.error || loginRes.errorMessage || 'Invalid username or password.'
      ) as Error & { code?: string };
      err.code = data?.code;
      throw err;
    }
    resolvedEmail = data.loginEmail;
  } else if (!loginRes.isEndpointUnavailable && loginRes.status >= 500) {
    throw new Error(loginRes.errorMessage || 'Authentication server returned an invalid response.');
  }

  // Static-host fallback: resolve username via exact-match Firestore rule
  if (!usedServerRoute && !identifier.includes('@')) {
    const cleanUsername = normalizeUsername(identifier);
    if (!isValidUsername(cleanUsername)) {
      throw new Error('Invalid username or password.');
    }
    const lookupSnap = await getDoc(doc(db, `usernameLookup/${cleanUsername}`));
    if (!lookupSnap.exists()) {
      throw new Error('Invalid username or password.');
    }
    const lookup = lookupSnap.data() as { loginEmail: string; status: string };
    if (lookup.status === 'inactive' || lookup.status === 'suspended') {
      throw new Error(
        lookup.status === 'suspended'
          ? 'This account has been suspended. Please contact your organization administrator.'
          : 'This account is inactive. Please contact your organization administrator.'
      );
    }
    resolvedEmail = lookup.loginEmail;
  }

  // Step 2: Establish real Firebase client SDK authenticated session
  try {
    const cred = await signInWithEmailAndPassword(auth, resolvedEmail, password);
    return { uid: cred.user.uid, email: cred.user.email || resolvedEmail };
  } catch (err: unknown) {
    const parsed = parseFirebaseAuthError(err);
    const wrapped = new Error(parsed.message) as Error & { code?: string };
    wrapped.code = parsed.code;
    throw wrapped;
  }
}

// =============================================================================
// PASSWORD RESET & PASSWORD CHANGE
// =============================================================================

export async function requestPasswordReset(
  identifierInput: string
): Promise<{ message: string; requiresAdminReset?: boolean }> {
  const identifier = identifierInput.trim().toLowerCase();
  if (!identifier) {
    throw new Error('Please enter your username or email address.');
  }

  const resetRes = await safeFetchJson<{
    message?: string;
    requiresAdminReset?: boolean;
    error?: string;
  }>('/api/auth/password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });

  if (resetRes.isJson && !resetRes.isEndpointUnavailable) {
    if (!resetRes.ok) {
      throw new Error(resetRes.data?.error || resetRes.errorMessage || 'Could not process password reset.');
    }
    return {
      message:
        resetRes.data?.message ||
        'If a matching account exists, a password reset link has been sent to the registered email.',
      requiresAdminReset: resetRes.data?.requiresAdminReset,
    };
  } else if (!resetRes.isEndpointUnavailable && resetRes.status >= 500) {
    throw new Error(resetRes.errorMessage || 'Password reset service returned an invalid response.');
  }

  // Static-host fallback
  let targetEmail = identifier;
  if (!identifier.includes('@')) {
    const clean = normalizeUsername(identifier);
    if (isValidUsername(clean)) {
      const snap = await getDoc(doc(db, `usernameLookup/${clean}`));
      if (snap.exists()) {
        targetEmail = String(snap.data().loginEmail || '');
      } else {
        return {
          message:
            'If a matching account exists, a password reset link has been sent to the registered email.',
        };
      }
    }
  }

  if (targetEmail.endsWith('.zacma.local')) {
    return {
      requiresAdminReset: true,
      message:
        'This username uses an internal organization login without an external recovery email. Please ask your organization administrator to reset your password.',
    };
  }

  try {
    await sendPasswordResetEmail(auth, targetEmail);
  } catch {
    // Non-enumerating
  }
  return {
    message:
      'If a matching account exists, a password reset link has been sent to the registered email.',
  };
}

export async function changeAuthenticatedUserPassword(params: {
  currentPassword: string;
  newPassword: string;
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  role: UserRole;
  username?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error('You must be signed in to change your password.');
  }

  const strength = validatePasswordStrength(params.newPassword);
  if (!strength.valid) {
    throw new Error(strength.message);
  }

  // Re-authenticate with current password before changing
  try {
    const credential = EmailAuthProvider.credential(user.email, params.currentPassword);
    await reauthenticateWithCredential(user, credential);
  } catch {
    throw new Error('Current password is incorrect. Please check and try again.');
  }

  await updatePassword(user, params.newPassword);

  const nowIso = new Date().toISOString();
  // Clear mustChangePassword flag on user profile & member doc
  try {
    await updateDoc(doc(db, `users/${user.uid}`), {
      mustChangePassword: false,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Could not clear mustChangePassword on user profile:', err);
  }

  try {
    await updateDoc(doc(db, `organizations/${params.organizationId}/members/${user.uid}`), {
      mustChangePassword: false,
      lastLoginAt: nowIso,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Member doc may not exist for newly bootstrapped account
  }

  await logLoginActivity({
    organizationId: params.organizationId,
    ownerId: params.ownerId,
    authorizedUserIds: params.authorizedUserIds,
    userId: user.uid,
    username: params.username || '',
    email: user.email,
    displayName: user.displayName || user.email,
    role: params.role,
    authMethod: 'username_password',
    eventType: 'password_change',
  });
}

// =============================================================================
// ADMIN USER ACCOUNT PROVISIONING (USERNAME + PASSWORD OR GOOGLE ACCOUNT)
// =============================================================================

export interface AdminCreateUserParams {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  actorId: string;
  actorName: string;
  authProvider: 'username_password' | 'google';
  displayName: string;
  username?: string;
  email?: string;
  phone?: string;
  password?: string;
  role: UserRole;
  crmAccess: boolean;
  permissions: MemberPermissions;
  assignedBusinessUnitIds: string[];
  mustChangePassword: boolean;
  status: 'active' | 'inactive' | 'invited' | 'suspended';
  existingUid?: string;
}

export async function adminProvisionUserAccount(
  params: AdminCreateUserParams
): Promise<{
  uid: string;
  username: string;
  loginEmail: string;
}> {
  const cleanName = clampStr(params.displayName, 120);
  if (!cleanName) throw new Error('Full name is required.');

  const cleanUsername = params.username ? normalizeUsername(params.username) : '';
  const cleanEmail = clampStr(params.email, 200).toLowerCase();
  const cleanPhone = clampStr(params.phone, 60);

  let targetUid = clampStr(params.existingUid, 128);
  let loginEmail = cleanEmail;

  if (params.authProvider === 'username_password') {
    if (!isValidUsername(cleanUsername)) {
      throw new Error(
        'Username must be 3–40 characters using lowercase letters, numbers, dots, underscores, or hyphens.'
      );
    }

    const strength = validatePasswordStrength(params.password || '');
    if (!strength.valid) {
      throw new Error(strength.message);
    }

    // Check username availability first
    const existingLookup = await getDoc(doc(db, `usernameLookup/${cleanUsername}`));
    if (existingLookup.exists()) {
      throw new Error(`Username "@${cleanUsername}" is already taken. Please choose another.`);
    }

    // Use real email if provided, otherwise synthesize a deterministic internal login email
    loginEmail = cleanEmail || `${cleanUsername}@${params.organizationId}.zacma.local`;

    // Provision Firebase Auth user WITHOUT signing out the currently logged-in administrator
    const token = await auth.currentUser?.getIdToken();
    let usedServerRoute = false;
    const createRes = await safeFetchJson<{
      uid?: string;
      loginEmail?: string;
      error?: string;
      code?: string;
    }>('/api/auth/admin/create-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        loginEmail,
        password: params.password,
        displayName: cleanName,
        organizationId: params.organizationId,
        role: params.role,
      }),
    });

    if (createRes.isJson && !createRes.isEndpointUnavailable) {
      usedServerRoute = true;
      const data = createRes.data;
      if (!createRes.ok || !data?.uid) {
        const err = new Error(
          data?.error || createRes.errorMessage || 'Failed to create user credentials.'
        ) as Error & { code?: string };
        err.code = data?.code;
        throw err;
      }
      targetUid = data.uid;
      loginEmail = data.loginEmail || loginEmail;
    } else if (!createRes.isEndpointUnavailable && createRes.status >= 500) {
      throw new Error(createRes.errorMessage || 'Account provisioning server returned an invalid response.');
    }

    // Static-host fallback: call Firebase Identity Toolkit accounts:signUp directly
    if (!usedServerRoute) {
      const signUpRes = await safeFetchJson<{
        localId?: string;
        email?: string;
        error?: { message?: string };
      }>(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_PUBLIC_API_KEY)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: loginEmail,
            password: params.password,
            returnSecureToken: true,
          }),
        }
      );
      const signUpData = signUpRes.data;
      if (!signUpRes.ok || !signUpData?.localId) {
        const fbErr = signUpData?.error?.message || signUpRes.errorMessage || 'ACCOUNT_CREATE_FAILED';
        if (fbErr.includes('OPERATION_NOT_ALLOWED') || fbErr.includes('PASSWORD_LOGIN_DISABLED')) {
          const err = new Error(
            'Email/Password sign-in is disabled in Firebase Console. Enable Authentication → Sign-in method → Email/Password on project zacma-4881c.'
          ) as Error & { code?: string };
          err.code = 'auth/operation-not-allowed';
          throw err;
        }
        if (fbErr.includes('EMAIL_EXISTS')) {
          throw new Error('An account with this email already exists in Firebase Authentication.');
        }
        throw new Error(`Unable to create account: ${fbErr}`);
      }
      targetUid = signUpData.localId;
    }
  } else {
    // Google Auth member entry
    if (!cleanEmail) throw new Error('Google email address is required.');
    targetUid = targetUid || generateId('staff');
    loginEmail = cleanEmail;
  }

  // Students must NEVER be added to organization.authorizedUserIds so CRM/leads stay isolated
  const isStudent = params.role === 'student';
  const nextAuthorized = isStudent
    ? clampList(params.authorizedUserIds, 100, 128)
    : clampList([...params.authorizedUserIds, targetUid], 100, 128);

  const memberPath = `organizations/${params.organizationId}/members/${targetUid}`;
  const userProfilePath = `users/${targetUid}`;

  try {
    const batch = writeBatch(db);

    // 1. Organization member document (enforces tenant + role + permissions)
    batch.set(doc(db, memberPath), {
      userId: targetUid,
      organizationId: params.organizationId,
      email: loginEmail,
      username: cleanUsername,
      phone: cleanPhone,
      displayName: cleanName,
      role: params.role,
      crmAccess: isStudent ? false : Boolean(params.crmAccess),
      permissions: resolveEffectivePermissions(params.role, params.permissions, params.crmAccess),
      authProvider: params.authProvider,
      mustChangePassword:
        params.authProvider === 'username_password' ? Boolean(params.mustChangePassword) : false,
      lastLoginAt: '',
      assignedBusinessUnitIds: isStudent ? [] : clampList(params.assignedBusinessUnitIds, 50, 128),
      status: params.status,
      ownerId: params.ownerId,
      authorizedUserIds: nextAuthorized,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 2. Global UserProfile document bound to this UID & tenant
    batch.set(doc(db, userProfilePath), {
      uid: targetUid,
      email: loginEmail,
      displayName: cleanName,
      photoURL: '',
      username: cleanUsername,
      phone: cleanPhone,
      authProvider: params.authProvider,
      mustChangePassword:
        params.authProvider === 'username_password' ? Boolean(params.mustChangePassword) : false,
      status: params.status === 'invited' ? 'active' : params.status,
      lastLoginAt: '',
      organizationId: params.organizationId,
      role: params.role,
      crmAccess: isStudent ? false : Boolean(params.crmAccess),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 3. Username lookup index (if username set)
    if (cleanUsername) {
      batch.set(doc(db, `usernameLookup/${cleanUsername}`), {
        username: cleanUsername,
        loginEmail,
        uid: targetUid,
        organizationId: params.organizationId,
        status: params.status === 'invited' ? 'active' : params.status,
        ownerId: params.ownerId,
        authorizedUserIds: nextAuthorized,
        updatedAt: serverTimestamp(),
      });
    }

    // 4. Keep organization.authorizedUserIds synced for non-student staff
    if (!isStudent) {
      batch.update(doc(db, `organizations/${params.organizationId}`), {
        authorizedUserIds: nextAuthorized,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: nextAuthorized,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'user.created',
      resourceType: 'member',
      resourceId: targetUid,
      summary: `Created ${params.authProvider === 'username_password' ? `username/password (@${cleanUsername})` : 'Google'} account for ${cleanName} (${params.role})`,
    });

    return { uid: targetUid, username: cleanUsername, loginEmail };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, memberPath);
  }
}

export async function adminUpdateUserAccount(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  existing: OrganizationMember;
  updates: {
    displayName: string;
    email: string;
    phone: string;
    role: UserRole;
    crmAccess: boolean;
    permissions: MemberPermissions;
    assignedBusinessUnitIds: string[];
    status: 'active' | 'inactive' | 'invited' | 'suspended';
    mustChangePassword: boolean;
  };
  actorId: string;
  actorName: string;
}): Promise<void> {
  const targetUid = params.existing.userId;
  if (isProtectedSystemOwnerAccount(params.existing)) {
    if (params.updates.role !== 'super_admin' || params.updates.status !== 'active') {
      throw new Error(
        'The Primary System Owner account (Zekimuluken) is permanently protected and cannot be demoted, deactivated, or suspended.'
      );
    }
  }
  const isStudent = params.updates.role === 'student';
  const isActiveStaff = !isStudent && params.updates.status === 'active';

  const nextAuthorized = isActiveStaff
    ? clampList([...params.authorizedUserIds, targetUid], 100, 128)
    : clampList(
        params.authorizedUserIds.filter((uid) => uid !== targetUid || uid === params.ownerId),
        100,
        128
      );

  const memberPath = `organizations/${params.organizationId}/members/${targetUid}`;
  const cleanName = clampStr(params.updates.displayName, 120);
  const cleanEmail = clampStr(params.updates.email, 200).toLowerCase();
  const cleanPhone = clampStr(params.updates.phone, 60);
  const profileStatus: 'active' | 'inactive' | 'suspended' =
    params.updates.status === 'invited' ? 'active' : params.updates.status;

  try {
    const batch = writeBatch(db);

    batch.update(doc(db, memberPath), {
      displayName: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      role: params.updates.role,
      crmAccess: isStudent ? false : Boolean(params.updates.crmAccess),
      permissions: resolveEffectivePermissions(
        params.updates.role,
        params.updates.permissions,
        params.updates.crmAccess
      ),
      assignedBusinessUnitIds: isStudent
        ? []
        : clampList(params.updates.assignedBusinessUnitIds, 50, 128),
      status: params.updates.status,
      mustChangePassword: Boolean(params.updates.mustChangePassword),
      authorizedUserIds: nextAuthorized,
      updatedAt: serverTimestamp(),
    });

    // Update UserProfile if it exists
    const userRef = doc(db, `users/${targetUid}`);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      batch.update(userRef, {
        displayName: cleanName,
        phone: cleanPhone,
        role: params.updates.role,
        crmAccess: isStudent ? false : Boolean(params.updates.crmAccess),
        status: profileStatus,
        mustChangePassword: Boolean(params.updates.mustChangePassword),
        updatedAt: serverTimestamp(),
      });
    }

    // Keep usernameLookup status synced so deactivated/suspended accounts cannot sign in
    if (params.existing.username) {
      const lookupRef = doc(db, `usernameLookup/${params.existing.username}`);
      const lookupSnap = await getDoc(lookupRef);
      if (lookupSnap.exists()) {
        batch.update(lookupRef, {
          loginEmail: cleanEmail || params.existing.email,
          status: profileStatus,
          authorizedUserIds: nextAuthorized,
          updatedAt: serverTimestamp(),
        });
      }
    }

    batch.update(doc(db, `organizations/${params.organizationId}`), {
      authorizedUserIds: nextAuthorized,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: nextAuthorized,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'user.updated',
      resourceType: 'member',
      resourceId: targetUid,
      summary: `Updated account ${cleanName} → role=${params.updates.role}, status=${params.updates.status}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, memberPath);
  }
}

export async function adminDeleteUserAccount(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  member: OrganizationMember;
  actorId: string;
  actorName: string;
}): Promise<void> {
  if (params.member.userId === params.actorId) {
    throw new Error('You cannot delete your own active administrator account.');
  }
  if (isProtectedSystemOwnerAccount(params.member)) {
    throw new Error(
      'The Primary System Owner account (Zekimuluken) is permanently protected and cannot be deleted.'
    );
  }
  if (params.member.userId === params.ownerId) {
    throw new Error('The primary organization owner account cannot be deleted.');
  }

  const nextAuthorized = clampList(
    params.authorizedUserIds.filter((uid) => uid !== params.member.userId),
    100,
    128
  );
  const memberPath = `organizations/${params.organizationId}/members/${params.member.userId}`;

  try {
    await deleteDoc(doc(db, memberPath));

    if (params.member.username) {
      await deleteDoc(doc(db, `usernameLookup/${params.member.username}`)).catch(() => {});
    }

    await deleteDoc(doc(db, `users/${params.member.userId}`)).catch(() => {});

    await updateDoc(doc(db, `organizations/${params.organizationId}`), {
      authorizedUserIds: nextAuthorized,
      updatedAt: serverTimestamp(),
    });

    await logAuditEvent({
      organizationId: params.organizationId,
      ownerId: params.ownerId,
      authorizedUserIds: nextAuthorized,
      actorId: params.actorId,
      actorName: params.actorName,
      action: 'user.deleted',
      resourceType: 'member',
      resourceId: params.member.userId,
      summary: `Removed user account ${params.member.displayName} (${params.member.username ? `@${params.member.username}` : params.member.email})`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, memberPath);
  }
}

// =============================================================================
// IMMUTABLE LOGIN ACTIVITY LOGGING
// =============================================================================

export async function logLoginActivity(params: {
  organizationId: string;
  ownerId: string;
  authorizedUserIds: string[];
  userId: string;
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
  authMethod: 'google' | 'username_password';
  eventType: LoginActivityRecord['eventType'];
}): Promise<void> {
  const eventId = generateId('auth');
  const path = `organizations/${params.organizationId}/loginActivity/${eventId}`;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 250) : 'web';
  const domain = typeof window !== 'undefined' ? window.location.hostname.slice(0, 150) : '';

  try {
    await setDoc(doc(db, path), {
      id: eventId,
      organizationId: params.organizationId,
      userId: params.userId,
      username: clampStr(params.username, 60),
      email: clampStr(params.email, 200),
      displayName: clampStr(params.displayName, 120),
      role: params.role,
      authMethod: params.authMethod,
      eventType: params.eventType,
      userAgent: ua,
      domain,
      ownerId: params.ownerId,
      authorizedUserIds: clampList(params.authorizedUserIds, 100, 128),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-blocking audit trail write
    console.warn('Login activity log skipped:', err instanceof Error ? err.message : err);
  }
}
