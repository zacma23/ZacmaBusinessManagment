import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

// Load Firebase public web config from provisioned config (works in local dev, Cloud Run, and Vercel serverless)
let firebaseWebApiKey = (process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '').trim();
let firebaseProjectId = (process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
let firebaseDatabaseId = (process.env.VITE_FIREBASE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID || '(default)').trim();
try {
  const candidatePaths = [
    path.resolve(__dirname, 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];
  const cfgPath = candidatePaths.find((p) => fs.existsSync(p));
  if (cfgPath) {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    firebaseWebApiKey = firebaseWebApiKey || parsed.apiKey || '';
    firebaseProjectId = firebaseProjectId || parsed.projectId || '';
    if (firebaseDatabaseId === '(default)' && parsed.firestoreDatabaseId) {
      firebaseDatabaseId = parsed.firestoreDatabaseId;
    }
  }
} catch (err) {
  console.warn('[Zacma Server] Unable to read firebase-applet-config.json:', err instanceof Error ? err.message : err);
}

// Never blindly call resp.json() on upstream HTTP calls — inspect raw response first
async function safeParseUpstreamJson<T = Record<string, unknown>>(
  resp: Response,
  label: string
): Promise<T | null> {
  const contentType = resp.headers.get('content-type') || '';
  let rawText = '';
  try {
    rawText = await resp.text();
  } catch (err) {
    console.error(`[Zacma Server Upstream] Failed to read body (${label})`, {
      status: resp.status,
      contentType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    console.error(`[Zacma Server Upstream] Non-JSON response (${label})`, {
      status: resp.status,
      contentType,
      rawBodyPreview: trimmed.slice(0, 400),
      parseError: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Safely parse structured JSON returned by Gemini (strips accidental markdown code fences)
function safeParseAiJson<T = Record<string, unknown>>(rawText: string, label: string): T {
  let cleaned = (rawText || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    const parseErr = err instanceof Error ? err.message : String(err);
    console.error(`[Zacma Server AI JSON] Failed to parse AI output (${label})`, {
      rawBodyPreview: (rawText || '').slice(0, 500),
      parseError: parseErr,
    });
    throw new Error(`AI returned malformed JSON (${label}): ${parseErr}`);
  }
}

// Resolve server-side Gemini API key (supports GEMINI_API_KEY and standard server aliases)
function resolveGeminiApiKey(): string {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    process.env.API_KEY,
  ];
  for (const raw of candidates) {
    const trimmed = (raw || '').trim().replace(/^["']|["']$/g, '');
    if (trimmed && trimmed !== 'MY_GEMINI_API_KEY') {
      return trimmed;
    }
  }
  return '';
}

class MissingGeminiKeyError extends Error {
  public readonly status = 503;
  constructor() {
    super(
      'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in your hosting environment (e.g., Vercel Project Settings → Environment Variables, then redeploy) or check Settings > Secrets.'
    );
    this.name = 'MissingGeminiKeyError';
  }
}

// Gemini AI Server-Side Client
const getGeminiClient = () => {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new MissingGeminiKeyError();
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// Simple in-memory sliding-window rate limiter per IP + route bucket
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
}

// Permanent Primary System Owner identity (server-side source of truth)
const SYSTEM_OWNER_EMAIL = (
  process.env.ZACMA_SYSTEM_OWNER_EMAIL || 'zekimuluken@gmail.com'
)
  .trim()
  .toLowerCase();
const SYSTEM_OWNER_NAME = 'Zekimuluken';

// Verify Firebase ID token via Identity Toolkit lookup (works on every Firebase tier without Admin IAM)
async function verifyFirebaseBearer(req: express.Request): Promise<{
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
} | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.length > 4096 || !firebaseWebApiKey) {
    return null;
  }
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const data = await safeParseUpstreamJson<{
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    }>(resp, 'identitytoolkit:accounts:lookup');
    const user = data?.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: (user.email || '').toLowerCase(),
      emailVerified: Boolean(user.emailVerified),
      idToken,
    };
  } catch {
    return null;
  }
}

// Read a Firestore document using the caller's verified Firebase ID token (enforced by firestore.rules)
async function fetchFirestoreDocWithToken(
  docPath: string,
  idToken: string
): Promise<Record<string, { stringValue?: string; booleanValue?: boolean }> | null> {
  if (!firebaseProjectId || !idToken) return null;
  const encodedPath = docPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/databases/${encodeURIComponent(firebaseDatabaseId)}/documents/${encodedPath}`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!resp.ok) return null;
    const data = await safeParseUpstreamJson<{
      fields?: Record<string, { stringValue?: string; booleanValue?: boolean }>;
    }>(resp, `firestore:${docPath}`);
    return data?.fields || null;
  } catch {
    return null;
  }
}

// Authoritative server-side identity & permanent System Owner verification
async function verifyServerIdentity(req: express.Request): Promise<{
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
  isSystemOwner: boolean;
  ownerName: string;
  accountType: 'primary_system_owner' | 'tenant_admin' | 'staff' | 'student';
} | null> {
  const verified = await verifyFirebaseBearer(req);
  if (!verified) return null;

  let isSystemOwner =
    verified.emailVerified && verified.email === SYSTEM_OWNER_EMAIL;
  let ownerName = SYSTEM_OWNER_NAME;

  // Also check permanent platformConfig/systemOwner anchor (supports verified ownership transfer)
  if (verified.emailVerified) {
    const ownerDoc = await fetchFirestoreDocWithToken('platformConfig/systemOwner', verified.idToken);
    if (ownerDoc) {
      const docOwnerUid = ownerDoc.ownerUid?.stringValue || '';
      const docStatus = ownerDoc.status?.stringValue || '';
      const docOwnerName = ownerDoc.ownerName?.stringValue || SYSTEM_OWNER_NAME;
      ownerName = docOwnerName;
      if (docOwnerUid === verified.uid && docStatus === 'active') {
        isSystemOwner = true;
      }
    }
  }

  return {
    ...verified,
    isSystemOwner,
    ownerName,
    accountType: isSystemOwner ? 'primary_system_owner' : 'staff',
  };
}

const SUPPORTED_FIELD_TYPES = new Set([
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'time',
  'dropdown',
  'multi_select',
  'radio',
  'checkboxes',
  'file_upload',
  'image_upload',
  'address',
  'url',
  'yes_no',
  'section_heading',
  'conditional',
]);

function sanitizeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'custom-form';
}

function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').trim().slice(0, maxLen);
}

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // Ensure Google OAuth popup windows communicate cleanly without session loss
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'zacma-saas-portal' });
  });

  // Server-side authoritative session & permanent System Owner verification
  app.get('/api/auth/session-verify', async (req, res) => {
    const identity = await verifyServerIdentity(req);
    if (!identity) {
      res.status(401).json({
        authenticated: false,
        error: 'Valid Firebase ID token required.',
      });
      return;
    }

    res.json({
      authenticated: true,
      uid: identity.uid,
      email: identity.email,
      emailVerified: identity.emailVerified,
      isSystemOwner: identity.isSystemOwner,
      accountType: identity.accountType,
      ownerName: identity.ownerName,
      verifiedAt: new Date().toISOString(),
      source: 'server',
    });
  });

  // ===========================================================================
  // AUTHENTICATION HELPERS (Brute-Force Lockout, Username Lookup, Identity Toolkit)
  // ===========================================================================
  const loginFailures = new Map<string, { count: number; lockedUntil: number }>();
  const MAX_LOGIN_FAILURES = 5;
  const LOCKOUT_WINDOW_MS = 15 * 60_000;

  function checkLoginLockout(key: string): { locked: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const record = loginFailures.get(key);
    if (!record) return { locked: false, retryAfterSeconds: 0 };
    if (record.lockedUntil > now) {
      return { locked: true, retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
    }
    if (record.lockedUntil > 0 && record.lockedUntil <= now) {
      loginFailures.delete(key);
    }
    return { locked: false, retryAfterSeconds: 0 };
  }

  function recordLoginFailure(key: string): number {
    const now = Date.now();
    const current = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
    const nextCount = current.count + 1;
    const lockedUntil = nextCount >= MAX_LOGIN_FAILURES ? now + LOCKOUT_WINDOW_MS : 0;
    loginFailures.set(key, { count: nextCount, lockedUntil });
    return Math.max(0, MAX_LOGIN_FAILURES - nextCount);
  }

  function clearLoginFailures(key: string): void {
    loginFailures.delete(key);
  }

  function isValidUsernameFormat(raw: string): boolean {
    return /^[a-z0-9._-]{3,40}$/.test(raw);
  }

  function isStrongPassword(pw: string): { valid: boolean; reason?: string } {
    if (pw.length < 8 || pw.length > 128) {
      return { valid: false, reason: 'Password must be between 8 and 128 characters.' };
    }
    if (!/[A-Z]/.test(pw)) {
      return { valid: false, reason: 'Password must include at least one uppercase letter.' };
    }
    if (!/[a-z]/.test(pw)) {
      return { valid: false, reason: 'Password must include at least one lowercase letter.' };
    }
    if (!/[0-9]/.test(pw)) {
      return { valid: false, reason: 'Password must include at least one number.' };
    }
    if (!/[^A-Za-z0-9]/.test(pw)) {
      return { valid: false, reason: 'Password must include at least one special character.' };
    }
    return { valid: true };
  }

  async function lookupUsernameInFirestore(username: string): Promise<{
    loginEmail: string;
    uid: string;
    organizationId: string;
    status: string;
  } | null> {
    if (!firebaseProjectId || !isValidUsernameFormat(username)) return null;
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId)}/databases/${encodeURIComponent(firebaseDatabaseId)}/documents/usernameLookup/${encodeURIComponent(username)}`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const doc = await safeParseUpstreamJson<{
        fields?: Record<string, { stringValue?: string }>;
      }>(resp, `firestore:usernameLookup/${username}`);
      const f = doc?.fields;
      if (!f?.loginEmail?.stringValue || !f?.uid?.stringValue) return null;
      return {
        loginEmail: f.loginEmail.stringValue,
        uid: f.uid.stringValue,
        organizationId: f.organizationId?.stringValue || '',
        status: f.status?.stringValue || 'active',
      };
    } catch {
      return null;
    }
  }

  // Check live Firebase Authentication provider readiness (safe public diagnostics only)
  app.get('/api/auth/provider-status', async (_req, res) => {
    if (!firebaseWebApiKey) {
      res.json({
        projectId: firebaseProjectId,
        googleEnabled: true,
        emailPasswordEnabled: false,
        detail: 'Firebase web configuration not found.',
      });
      return;
    }
    try {
      // Lightweight non-mutating probe with an impossible credential to inspect provider enablement
      const probe = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseWebApiKey)}`,
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
      const data = await safeParseUpstreamJson<{ error?: { message?: string } }>(
        probe,
        'identitytoolkit:provider-probe'
      );
      const errMsg = data?.error?.message || '';
      const disabled =
        errMsg.includes('PASSWORD_LOGIN_DISABLED') || errMsg.includes('OPERATION_NOT_ALLOWED');
      res.json({
        projectId: firebaseProjectId,
        googleEnabled: true,
        emailPasswordEnabled: !disabled,
        detail: disabled
          ? 'Email/Password sign-in is disabled in Firebase Console. Enable it under Authentication → Sign-in method → Email/Password.'
          : 'Email/Password sign-in is active.',
      });
    } catch {
      res.json({
        projectId: firebaseProjectId,
        googleEnabled: true,
        emailPasswordEnabled: false,
        detail: 'Unable to probe Firebase Auth provider right now.',
      });
    }
  });

  // Resolve username/email + verify password via Firebase Identity Toolkit with brute-force lockout
  app.post('/api/auth/username-login', async (req, res) => {
    const ip = req.ip || 'unknown';
    const rawIdentifier =
      typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!rawIdentifier || !password) {
      res.status(400).json({ error: 'Username (or email) and password are required.' });
      return;
    }
    if (rawIdentifier.length > 200 || password.length > 128) {
      res.status(400).json({ error: 'Invalid credential length.' });
      return;
    }

    const lockoutKey = `${ip}:${rawIdentifier}`;
    const lockState = checkLoginLockout(lockoutKey);
    if (lockState.locked) {
      res.status(429).json({
        code: 'auth/too-many-requests',
        error: `Too many failed login attempts. Try again in ${Math.ceil(lockState.retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds: lockState.retryAfterSeconds,
      });
      return;
    }

    if (!checkRateLimit(`login-ip:${ip}`, 30, 60_000)) {
      res.status(429).json({
        code: 'auth/too-many-requests',
        error: 'Too many login requests from this network. Please wait a minute.',
      });
      return;
    }

    try {
      let resolvedEmail = rawIdentifier;
      if (!rawIdentifier.includes('@')) {
        const lookup = await lookupUsernameInFirestore(rawIdentifier);
        if (!lookup) {
          recordLoginFailure(lockoutKey);
          res.status(401).json({
            code: 'auth/invalid-credential',
            error: 'Invalid username or password.',
          });
          return;
        }
        if (lookup.status === 'inactive' || lookup.status === 'suspended') {
          res.status(403).json({
            code: 'auth/user-disabled',
            error:
              lookup.status === 'suspended'
                ? 'This account has been suspended. Please contact your organization administrator.'
                : 'This account is inactive. Please contact your organization administrator.',
          });
          return;
        }
        resolvedEmail = lookup.loginEmail;
      }

      if (!firebaseWebApiKey) {
        res.status(500).json({ error: 'Firebase configuration missing on server.' });
        return;
      }

      const verifyResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseWebApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: resolvedEmail,
            password,
            returnSecureToken: true,
          }),
        }
      );

      const verifyData =
        (await safeParseUpstreamJson<{
          localId?: string;
          email?: string;
          error?: { message?: string };
        }>(verifyResp, 'identitytoolkit:signInWithPassword')) || {};

      if (!verifyResp.ok) {
        const fbErr = verifyData.error?.message || 'INVALID_LOGIN_CREDENTIALS';
        if (fbErr.includes('PASSWORD_LOGIN_DISABLED') || fbErr.includes('OPERATION_NOT_ALLOWED')) {
          res.status(503).json({
            code: 'auth/operation-not-allowed',
            error:
              'Email/Password sign-in is not yet enabled in Firebase Console for this project. Please enable Authentication → Sign-in method → Email/Password.',
          });
          return;
        }
        if (fbErr.includes('USER_DISABLED')) {
          res.status(403).json({
            code: 'auth/user-disabled',
            error: 'This account has been disabled by an administrator.',
          });
          return;
        }
        if (fbErr.includes('TOO_MANY_ATTEMPTS_TRY_LATER')) {
          res.status(429).json({
            code: 'auth/too-many-requests',
            error: 'Account temporarily locked due to repeated failed attempts. Please wait and try again.',
          });
          return;
        }

        const remaining = recordLoginFailure(lockoutKey);
        res.status(401).json({
          code: 'auth/invalid-credential',
          error:
            remaining > 0
              ? `Invalid username or password. (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before temporary lockout)`
              : 'Account temporarily locked for 15 minutes after 5 failed attempts.',
        });
        return;
      }

      clearLoginFailures(lockoutKey);
      res.json({
        ok: true,
        loginEmail: resolvedEmail,
        uid: verifyData.localId || '',
      });
    } catch (err: unknown) {
      console.error('Username login error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Authentication service unavailable. Please try again.' });
    }
  });

  // Admin-initiated account creation via Firebase Identity Toolkit (does NOT sign out the admin)
  app.post('/api/auth/admin/create-account', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`admin-create:${ip}`, 30, 60_000)) {
      res.status(429).json({ error: 'Too many account creation requests. Please wait a minute.' });
      return;
    }

    const identity = await verifyServerIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Administrator authentication required.' });
      return;
    }

    const loginEmail =
      typeof req.body?.loginEmail === 'string' ? req.body.loginEmail.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const displayName = sanitizeText(req.body?.displayName, 120);
    const organizationId = sanitizeText(req.body?.organizationId, 128);
    const requestedRole = sanitizeText(req.body?.role, 40) || 'staff';

    // Server-side RBAC check: never trust frontend role claims alone
    if (!identity.isSystemOwner) {
      if (requestedRole === 'super_admin' || loginEmail === SYSTEM_OWNER_EMAIL) {
        res.status(403).json({
          error: 'Only the verified System Owner can provision Super Admin accounts.',
        });
        return;
      }
      if (!organizationId || !/^[a-zA-Z0-9_-]{1,128}$/.test(organizationId)) {
        res.status(400).json({ error: 'Valid organizationId is required for account provisioning.' });
        return;
      }
      const memberFields = await fetchFirestoreDocWithToken(
        `organizations/${organizationId}/members/${identity.uid}`,
        identity.idToken
      );
      const callerRole = memberFields?.role?.stringValue || '';
      const callerStatus = memberFields?.status?.stringValue || '';
      if (
        callerStatus !== 'active' ||
        (callerRole !== 'org_admin' && callerRole !== 'super_admin')
      ) {
        res.status(403).json({
          error: 'Active organization administrator privileges are required to create user accounts.',
        });
        return;
      }
    }

    if (!loginEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) {
      res.status(400).json({ error: 'A valid account login email is required.' });
      return;
    }

    const pwCheck = isStrongPassword(password);
    if (!pwCheck.valid) {
      res.status(400).json({ error: pwCheck.reason || 'Password does not meet security policy.' });
      return;
    }

    if (!firebaseWebApiKey) {
      res.status(500).json({ error: 'Firebase configuration missing on server.' });
      return;
    }

    try {
      const signUpResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(firebaseWebApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: loginEmail,
            password,
            returnSecureToken: true,
          }),
        }
      );

      const signUpData =
        (await safeParseUpstreamJson<{
          localId?: string;
          idToken?: string;
          email?: string;
          error?: { message?: string };
        }>(signUpResp, 'identitytoolkit:signUp')) || {};

      if (!signUpResp.ok || !signUpData.localId) {
        const fbErr = signUpData.error?.message || 'ACCOUNT_CREATE_FAILED';
        if (fbErr.includes('OPERATION_NOT_ALLOWED') || fbErr.includes('PASSWORD_LOGIN_DISABLED')) {
          res.status(503).json({
            code: 'auth/operation-not-allowed',
            error:
              'Email/Password authentication is currently disabled in Firebase Console. Enable Authentication → Sign-in method → Email/Password on project zacma-4881c first.',
          });
          return;
        }
        if (fbErr.includes('EMAIL_EXISTS')) {
          res.status(409).json({
            code: 'auth/email-already-in-use',
            error: 'An account with this email or username login already exists in Firebase Authentication.',
          });
          return;
        }
        if (fbErr.includes('WEAK_PASSWORD')) {
          res.status(400).json({
            code: 'auth/weak-password',
            error: 'Password is too weak. Please choose a stronger password.',
          });
          return;
        }
        res.status(400).json({ error: `Unable to create user account: ${fbErr}` });
        return;
      }

      // Optionally set displayName on the newly created Firebase Auth profile
      if (displayName && signUpData.idToken) {
        await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(firebaseWebApiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              idToken: signUpData.idToken,
              displayName,
              returnSecureToken: false,
            }),
          }
        ).catch(() => {});
      }

      res.json({
        uid: signUpData.localId,
        loginEmail: signUpData.email || loginEmail,
      });
    } catch (err: unknown) {
      console.error('Admin account creation error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to provision Firebase Auth account.' });
    }
  });

  // Password reset request (supports both username and email; non-enumerating response)
  app.post('/api/auth/password-reset', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`pw-reset:${ip}`, 10, 15 * 60_000)) {
      res.status(429).json({ error: 'Too many password reset requests. Please try again later.' });
      return;
    }

    const rawIdentifier =
      typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    if (!rawIdentifier || rawIdentifier.length > 200) {
      res.status(400).json({ error: 'Please enter your username or email address.' });
      return;
    }

    try {
      let targetEmail = rawIdentifier;
      if (!rawIdentifier.includes('@')) {
        const lookup = await lookupUsernameInFirestore(rawIdentifier);
        if (!lookup) {
          // Non-enumerating response
          res.json({
            ok: true,
            message:
              'If a matching account with a deliverable email exists, a password reset link has been sent. Otherwise contact your organization administrator.',
          });
          return;
        }
        targetEmail = lookup.loginEmail;
      }

      if (targetEmail.endsWith('.zacma.local')) {
        res.json({
          ok: true,
          requiresAdminReset: true,
          message:
            'This username uses an internal organization login without an external recovery email. Please ask your organization administrator to issue a password reset.',
        });
        return;
      }

      if (firebaseWebApiKey) {
        await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(firebaseWebApiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestType: 'PASSWORD_RESET',
              email: targetEmail,
            }),
          }
        );
      }

      res.json({
        ok: true,
        message:
          'If a matching account exists, a password reset link has been sent to the registered email address.',
      });
    } catch {
      res.json({
        ok: true,
        message:
          'If a matching account exists, a password reset link has been sent to the registered email address.',
      });
    }
  });

  // ===========================================================================
  // INTEGRATIONS STATUS (Safe boolean flags only — never exposes secret values)
  // ===========================================================================
  app.get('/api/integrations/status', async (req, res) => {
    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const twilioReady = Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER
    );
    const afroReady = Boolean(process.env.AFROMESSAGE_API_TOKEN);

    res.json({
      gemini_ai: {
        configured: Boolean(resolveGeminiApiKey()),
        model: 'gemini-4-hydrogen',
      },
      resend_email: {
        configured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      },
      twilio_sms: {
        configured: twilioReady || afroReady,
        provider: twilioReady ? 'twilio_sms' : afroReady ? 'afromessage_sms' : 'unconfigured',
      },
      whatsapp_cloud: {
        configured: Boolean(
          process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
        ),
      },
    });
  });

  // ===========================================================================
  // PHASE 3: AI-POWERED DYNAMIC FORM GENERATOR (Gemini Structured JSON)
  // ===========================================================================
  app.post('/api/ai/generate-form', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`ai-form:${ip}`, 20, 60_000)) {
      res.status(429).json({ error: 'Too many form generation requests. Please wait a minute.' });
      return;
    }

    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required to generate forms.' });
      return;
    }

    const prompt = sanitizeText(req.body?.prompt, 2000);
    const businessUnitName = sanitizeText(req.body?.businessUnitName, 140);
    const businessUnitCategory = sanitizeText(req.body?.businessUnitCategory, 100);
    const servicesOffered = Array.isArray(req.body?.services)
      ? req.body.services.slice(0, 20).map((s: unknown) => sanitizeText(s, 80)).filter(Boolean)
      : [];

    if (!prompt || prompt.length < 10) {
      res.status(400).json({ error: 'Please provide a clear description (at least 10 characters) of the form you want to generate.' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Create a structured, production-ready form schema for the business unit "${businessUnitName || 'Zacma Business Unit'}" (Category: ${businessUnitCategory || 'General Enterprise'}${servicesOffered.length ? `, Services: ${servicesOffered.join(', ')}` : ''}).

Administrator instructions:
${prompt}

Requirements:
- Organize fields cleanly into logical sections using section_heading items where appropriate.
- Always use the exact allowed field types: short_text, long_text, email, phone, number, date, time, dropdown, multi_select, radio, checkboxes, file_upload, image_upload, address, url, yes_no, section_heading.
- Include realistic dropdown/radio/checkbox options when applicable.
- Set sensible required flags, placeholders, helperText, and validation rules (minLength, maxLength, min, max, pattern).
- If conditional follow-up fields make sense (or were requested), set conditionalOnFieldId (referencing an earlier field's id) and conditionalEqualsValue.
- Make sure field IDs are clean snake_case strings (e.g. full_name, email_address, phone_number, preferred_course).`,
        config: {
          systemInstruction:
            'You are an enterprise form architect for Zacma SaaS Portal. Produce clean, well-structured, mobile-friendly form schemas as valid JSON matching the schema.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Professional form title' },
              description: { type: Type.STRING, description: 'Clear introductory instructions for visitors' },
              slug: { type: Type.STRING, description: 'URL-friendly lowercase hyphenated slug' },
              confirmationMessage: {
                type: Type.STRING,
                description: 'Polite confirmation message displayed after submission',
              },
              fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: 'Unique snake_case field identifier' },
                    type: {
                      type: Type.STRING,
                      description:
                        'One of: short_text, long_text, email, phone, number, date, time, dropdown, multi_select, radio, checkboxes, file_upload, image_upload, address, url, yes_no, section_heading',
                    },
                    label: { type: Type.STRING, description: 'Human-readable field label' },
                    placeholder: { type: Type.STRING, description: 'Helpful input placeholder' },
                    helperText: { type: Type.STRING, description: 'Optional guidance text below field' },
                    required: { type: Type.BOOLEAN, description: 'Whether field is mandatory' },
                    section: { type: Type.STRING, description: 'Logical section name' },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'Choices for dropdown, multi_select, radio, checkboxes',
                    },
                    validation: {
                      type: Type.OBJECT,
                      properties: {
                        minLength: { type: Type.INTEGER },
                        maxLength: { type: Type.INTEGER },
                        min: { type: Type.NUMBER },
                        max: { type: Type.NUMBER },
                        pattern: { type: Type.STRING },
                      },
                    },
                    conditionalOnFieldId: {
                      type: Type.STRING,
                      description: 'Optional earlier field id this field depends on',
                    },
                    conditionalEqualsValue: {
                      type: Type.STRING,
                      description: 'Value of conditionalOnFieldId that reveals this field',
                    },
                  },
                  required: ['id', 'type', 'label', 'required'],
                },
              },
            },
            required: ['title', 'description', 'slug', 'confirmationMessage', 'fields'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'AI returned an empty schema. Please try again.' });
        return;
      }

      const parsed = safeParseAiJson<Record<string, unknown>>(rawText, 'generate-form');
      const seenIds = new Set<string>();
      const validatedFields = Array.isArray(parsed.fields)
        ? parsed.fields.slice(0, 60).map((f: Record<string, unknown>, idx: number) => {
            const rawType = typeof f.type === 'string' ? f.type : 'short_text';
            const type = SUPPORTED_FIELD_TYPES.has(rawType) ? rawType : 'short_text';
            let id = String(f.id || `field_${idx + 1}`)
              .toLowerCase()
              .replace(/[^a-z0-9_]+/g, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 48);
            if (!id || seenIds.has(id)) {
              id = `field_${idx + 1}_${Date.now().toString(36).slice(-3)}`;
            }
            seenIds.add(id);

            const options = Array.isArray(f.options)
              ? f.options.map((o) => sanitizeText(o, 120)).filter(Boolean).slice(0, 40)
              : [];

            const valObj =
              f.validation && typeof f.validation === 'object'
                ? (f.validation as Record<string, unknown>)
                : {};

            return {
              id,
              type,
              label: sanitizeText(f.label, 140) || `Field ${idx + 1}`,
              placeholder: sanitizeText(f.placeholder, 140),
              helperText: sanitizeText(f.helperText, 240),
              required: type === 'section_heading' ? false : Boolean(f.required),
              section: sanitizeText(f.section, 80) || 'General Information',
              options,
              validation: {
                ...(typeof valObj.minLength === 'number' ? { minLength: valObj.minLength } : {}),
                ...(typeof valObj.maxLength === 'number' ? { maxLength: valObj.maxLength } : {}),
                ...(typeof valObj.min === 'number' ? { min: valObj.min } : {}),
                ...(typeof valObj.max === 'number' ? { max: valObj.max } : {}),
                ...(typeof valObj.pattern === 'string' && valObj.pattern.length <= 120
                  ? { pattern: valObj.pattern }
                  : {}),
              },
              ...(typeof f.conditionalOnFieldId === 'string' && f.conditionalOnFieldId.trim()
                ? {
                    conditionalOnFieldId: sanitizeText(f.conditionalOnFieldId, 48),
                    conditionalEqualsValue: sanitizeText(f.conditionalEqualsValue, 120),
                  }
                : {}),
            };
          })
        : [];

      if (validatedFields.length === 0) {
        res.status(422).json({ error: 'Generated form contained no valid fields. Please refine your prompt.' });
        return;
      }

      res.json({
        title: sanitizeText(parsed.title, 180) || 'Generated Inquiry Form',
        description: sanitizeText(parsed.description, 1500),
        slug: sanitizeSlug(String(parsed.slug || parsed.title || 'generated-form')),
        confirmationMessage:
          sanitizeText(parsed.confirmationMessage, 1000) ||
          'Thank you for your submission. Our team will contact you shortly.',
        fields: validatedFields,
      });
    } catch (err: unknown) {
      const status = err instanceof MissingGeminiKeyError ? err.status : 500;
      const msg = err instanceof Error ? err.message : 'Failed to generate form.';
      console.error('AI Form Generation Error:', msg);
      res.status(status).json({ error: `AI Form Generator error: ${msg}` });
    }
  });

  // ===========================================================================
  // PHASE 10: CONTEXTUAL ZACMA AI ASSISTANT (Permission-Scoped)
  // ===========================================================================
  app.post('/api/ai/assistant', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`ai-assistant:${ip}`, 30, 60_000)) {
      res.status(429).json({ error: 'Too many assistant requests. Please wait a moment.' });
      return;
    }

    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required for Zacma AI Assistant.' });
      return;
    }

    const message = sanitizeText(req.body?.message, 2000);
    const userRole = sanitizeText(req.body?.userRole, 40) || 'staff';
    const contextSummary = req.body?.contextSummary && typeof req.body.contextSummary === 'object'
      ? req.body.contextSummary
      : {};
    const history: Array<{ role: 'assistant' | 'user'; content: string }> = Array.isArray(req.body?.history)
      ? req.body.history.slice(-8).map((h: Record<string, unknown>) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: sanitizeText(h.content, 1000),
        }))
      : [];

    if (!message) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const systemInstruction = `You are the Zacma AI Assistant inside the Zacma SaaS Portal.
Current User Role: ${userRole}.
Strict Governance Rules:
1. You ONLY answer based on the authorized organization workspace data provided in the context JSON below. Never fabricate leads, numbers, or business units that are not in the context.
2. Respect RBAC: If the user's role is "accountant" or "instructor" without CRM access, politely explain they do not have CRM permissions.
3. For consequential actions (creating a form, drafting bulk communications, navigating to filtered leads), propose a structured suggestedAction with requiresConfirmation: true so the user explicitly reviews and confirms before execution.
4. Keep answers crisp, executive, well-structured, and actionable with real counts/percentages computed from the provided data.`;

      const promptPayload = `AUTHORIZED WORKSPACE SNAPSHOT (scoped strictly to this user's permissions):
${JSON.stringify(contextSummary).slice(0, 24000)}

RECENT CONVERSATION:
${history.map((h) => `${h.role.toUpperCase()}: ${h.content}`).join('\n')}

USER REQUEST:
${message}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: promptPayload,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: 'Clear, helpful response using only authorized workspace data',
              },
              suggestedAction: {
                type: Type.OBJECT,
                description: 'Optional actionable shortcut or confirmation proposal',
                properties: {
                  type: {
                    type: Type.STRING,
                    description: 'One of: none, create_form, filter_leads, draft_communication, open_business_units',
                  },
                  label: { type: Type.STRING, description: 'Short plain button label' },
                  requiresConfirmation: { type: Type.BOOLEAN },
                  businessUnitId: { type: Type.STRING },
                  leadStatus: { type: Type.STRING },
                  unassignedOnly: { type: Type.BOOLEAN },
                  formPrompt: { type: Type.STRING },
                  channel: { type: Type.STRING },
                  draftSubject: { type: Type.STRING },
                  draftBody: { type: Type.STRING },
                },
                required: ['type', 'label', 'requiresConfirmation'],
              },
            },
            required: ['reply'],
          },
        },
      });

      const parsed = safeParseAiJson<{
        reply?: string;
        suggestedAction?: { type?: string } & Record<string, unknown>;
      }>(response.text ?? '{}', 'ai-assistant');
      res.json({
        reply: typeof parsed.reply === 'string' ? parsed.reply : 'I reviewed your authorized workspace data.',
        suggestedAction:
          parsed.suggestedAction && parsed.suggestedAction.type && parsed.suggestedAction.type !== 'none'
            ? parsed.suggestedAction
            : null,
      });
    } catch (err: unknown) {
      const status = err instanceof MissingGeminiKeyError ? err.status : 500;
      const msg = err instanceof Error ? err.message : 'Assistant request failed.';
      console.error('Zacma AI Assistant Error:', msg);
      res.status(status).json({ error: `Zacma AI Assistant error: ${msg}` });
    }
  });

  // ===========================================================================
  // SECTION 8: ZACMA AI CUSTOMER SUPPORT & STUDENT ASSISTANT (24/7 Multilingual)
  // ===========================================================================
  app.post('/api/ai/support-chat', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`ai-support:${ip}`, 40, 60_000)) {
      res.status(429).json({ error: 'Too many messages sent. Please wait a minute before trying again.' });
      return;
    }

    const message = sanitizeText(req.body?.message, 2000);
    if (!message) {
      res.status(400).json({ error: 'Message is required.' });
      return;
    }

    // Verify optional Firebase ID token — private student records are ONLY used if verified
    const verifiedUser = await verifyFirebaseBearer(req);
    const preferredLanguage = req.body?.preferredLanguage === 'am' ? 'Amharic (አማርኛ)' : 'Auto-detect (English or Amharic)';
    const customInstructions = sanitizeText(req.body?.aiInstructions, 2500);
    const registrationFormUrl = sanitizeText(req.body?.registrationFormUrl, 500);

    const courses = Array.isArray(req.body?.courses) ? req.body.courses.slice(0, 40) : [];
    const faqs = Array.isArray(req.body?.faqs) ? req.body.faqs.slice(0, 50) : [];
    const currentDraft =
      req.body?.registrationDraft && typeof req.body.registrationDraft === 'object'
        ? req.body.registrationDraft
        : {};
    const history: Array<{ role: string; text: string }> = Array.isArray(req.body?.history)
      ? req.body.history.slice(-10).map((m: Record<string, unknown>) => ({
          role: m.role === 'assistant' || m.role === 'agent' ? 'assistant' : 'user',
          text: sanitizeText(m.text, 1000),
        }))
      : [];

    // Only accept student account records when the caller holds a verified Firebase session
    const verifiedStudentRecords =
      verifiedUser && Array.isArray(req.body?.studentRegistrations)
        ? req.body.studentRegistrations
            .filter(
              (r: Record<string, unknown>) =>
                r && typeof r === 'object' && r.studentUid === verifiedUser.uid
            )
            .slice(0, 10)
        : [];

    try {
      const ai = getGeminiClient();
      const systemInstruction = `You are ZACMA AI ASSISTANT, the 24/7 virtual admission officer, student support representative, and training consultant for Zacma Technology Training Institute.

LANGUAGE POLICY:
- Preferred language setting: ${preferredLanguage}.
- If the user writes in Amharic (አማርኛ) or requests Amharic, respond naturally, politely, and accurately in Amharic. Otherwise respond in clear, friendly, professional English.

STRICT FACTUAL GROUNDING (NON-NEGOTIABLE):
- Answer course and institute questions ONLY using the ADMINISTRATOR-APPROVED COURSE CATALOG and SUPPORT KNOWLEDGE BASE provided below.
- NEVER invent, guess, or estimate course fees, durations, start dates, training batches, or certificates. If a requested detail (such as fee or next batch date) is empty or not present in the catalog/FAQs, transparently state that the administrator has not published that detail yet, offer to connect them with an admission officer, and record their exact question in "unansweredQuestion".

CONVERSATIONAL REGISTRATION FLOW:
- When a prospective student wants to register for a course, guide them warmly step by step (1-2 questions at a time) through:
  1. Full name
  2. Phone number
  3. Address (city/area)
  4. Preferred course
  5. Training delivery method (Online, In-Person, or Weekend)
  6. Preferred schedule (e.g., Morning, Afternoon, Evening, Weekend)
  7. Preferred payment method
  8. Document uploads — NEVER ask for or accept ID cards, passport photos, or private files directly inside chat! Instead, set "suggestRegistrationFormLink": true and explain they can securely upload documents through the official registration form link (${registrationFormUrl || 'provided after confirmation'}).
- Keep updating "registrationDraft" with every field collected or corrected so far.
- Once fullName, phone, address, preferredCourse, deliveryMethod, preferredSchedule, and paymentMethod are all collected and validated, summarize the details clearly, ask for explicit confirmation, and set "readyForConfirmation": true.

STUDENT SUPPORT PRIVACY:
- Caller authenticated: ${verifiedUser ? `YES (verified email: ${verifiedUser.email})` : 'NO (unauthenticated visitor)'}.
- If an unauthenticated visitor asks for private account details (personal registration status, personal payment balance, or personal certificate issuance), politely explain they must sign in to their Zacma account first to view private records, and NEVER expose or speculate about anyone's private data.
- If authenticated, answer ONLY from VERIFIED STUDENT RECORDS below.

HUMAN ESCALATION & LEAD CAPTURE:
- If the visitor asks to speak with a human agent, reports an urgent billing/complaint issue, or needs assistance outside the knowledge base, set "needsHumanEscalation": true.
- If a prospective student expresses interest in a course and provides a phone number or email (without finishing full registration yet), set "captureLeadSuggested": true so they can consent to admission follow-up.

ADMINISTRATOR CUSTOM INSTRUCTIONS:
${customInstructions || 'Be warm, structured, concise, and helpful.'}`;

      const contents = `ADMINISTRATOR-APPROVED COURSE CATALOG (Firebase):
${JSON.stringify(courses).slice(0, 18000)}

SUPPORT KNOWLEDGE BASE & FAQS (Firebase):
${JSON.stringify(faqs).slice(0, 10000)}

VERIFIED STUDENT RECORDS (only populated for verified signed-in student):
${JSON.stringify(verifiedStudentRecords).slice(0, 4000)}

CURRENT REGISTRATION DRAFT COLLECTED SO FAR:
${JSON.stringify(currentDraft)}

CONVERSATION HISTORY:
${history.map((h) => `${h.role.toUpperCase()}: ${h.text}`).join('\n')}

LATEST VISITOR MESSAGE:
${message}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING, description: 'Helpful conversational response in English or Amharic' },
              detectedLanguage: { type: Type.STRING, description: 'en, am, or other' },
              intent: {
                type: Type.STRING,
                description: 'One of: course_inquiry, registration, student_support, escalation, general',
              },
              interestedCourse: { type: Type.STRING, description: 'Matched course title if discussed' },
              needsHumanEscalation: { type: Type.BOOLEAN },
              unansweredQuestion: {
                type: Type.STRING,
                description: 'Non-empty ONLY if visitor asked a factual question not covered in the catalog or FAQs',
              },
              suggestRegistrationFormLink: { type: Type.BOOLEAN },
              captureLeadSuggested: { type: Type.BOOLEAN },
              registrationDraft: {
                type: Type.OBJECT,
                properties: {
                  fullName: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  email: { type: Type.STRING },
                  address: { type: Type.STRING },
                  preferredCourse: { type: Type.STRING },
                  deliveryMethod: { type: Type.STRING },
                  preferredSchedule: { type: Type.STRING },
                  paymentMethod: { type: Type.STRING },
                  readyForConfirmation: { type: Type.BOOLEAN },
                },
              },
            },
            required: ['reply', 'detectedLanguage', 'intent', 'needsHumanEscalation'],
          },
        },
      });

      const parsed = safeParseAiJson<Record<string, any>>(response.text ?? '{}', 'support-chat');
      const validIntents = new Set(['course_inquiry', 'registration', 'student_support', 'escalation', 'general']);
      const validLangs = new Set(['en', 'am', 'other']);

      res.json({
        reply: typeof parsed.reply === 'string' && parsed.reply.trim()
          ? parsed.reply.trim()
          : 'Thank you for reaching out to Zacma Technology Training Institute. How may I assist you?',
        detectedLanguage: validLangs.has(parsed.detectedLanguage) ? parsed.detectedLanguage : 'en',
        intent: validIntents.has(parsed.intent) ? parsed.intent : 'general',
        interestedCourse: sanitizeText(parsed.interestedCourse, 160),
        needsHumanEscalation: Boolean(parsed.needsHumanEscalation),
        unansweredQuestion: sanitizeText(parsed.unansweredQuestion, 400),
        suggestRegistrationFormLink: Boolean(parsed.suggestRegistrationFormLink),
        captureLeadSuggested: Boolean(parsed.captureLeadSuggested),
        registrationDraft:
          parsed.registrationDraft && typeof parsed.registrationDraft === 'object'
            ? {
                fullName: sanitizeText(parsed.registrationDraft.fullName, 160),
                phone: sanitizeText(parsed.registrationDraft.phone, 60),
                email: sanitizeText(parsed.registrationDraft.email, 200),
                address: sanitizeText(parsed.registrationDraft.address, 300),
                preferredCourse: sanitizeText(parsed.registrationDraft.preferredCourse, 160),
                deliveryMethod: sanitizeText(parsed.registrationDraft.deliveryMethod, 80),
                preferredSchedule: sanitizeText(parsed.registrationDraft.preferredSchedule, 120),
                paymentMethod: sanitizeText(parsed.registrationDraft.paymentMethod, 120),
                readyForConfirmation: Boolean(parsed.registrationDraft.readyForConfirmation),
              }
            : null,
      });
    } catch (err: unknown) {
      const status = err instanceof MissingGeminiKeyError ? err.status : 500;
      const msg = err instanceof Error ? err.message : 'Support assistant failed.';
      console.error('AI Support Chat Error:', msg);
      res.status(status).json({ error: `Zacma AI Support error: ${msg}` });
    }
  });

  // ===========================================================================
  // AI SMS & EMAIL MESSAGE WRITER (Bilingual English / Amharic with Merge Tags)
  // ===========================================================================
  app.post('/api/ai/compose-message', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`ai-compose:${ip}`, 30, 60_000)) {
      res.status(429).json({ error: 'Too many AI drafting requests. Please wait a minute.' });
      return;
    }

    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required to generate Email/SMS drafts.' });
      return;
    }

    const prompt = sanitizeText(req.body?.prompt, 1200);
    const channel =
      req.body?.channel === 'sms' || req.body?.channel === 'both' ? req.body.channel : 'email';
    const language = req.body?.language === 'am' ? 'Amharic (አማርኛ)' : 'English';
    const tone = sanitizeText(req.body?.tone, 60) || 'Professional and helpful';
    const businessUnitName =
      sanitizeText(req.body?.businessUnitName, 140) || 'Zacma Technology Training Institute';
    const courseName = sanitizeText(req.body?.courseName, 140);
    const courseFee = sanitizeText(req.body?.courseFee, 80) || '8,500 ETB';

    if (!prompt) {
      res.status(400).json({ error: 'Please describe the Email or SMS message you want to write.' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const systemInstruction = `You are the Zacma SaaS Portal Communications Copywriter for ${businessUnitName}.
Generate ready-to-send personalized Email and/or SMS drafts based strictly on the administrator's prompt.

STRICT RULES:
1. Language: Write naturally in ${language}.
2. Tone: ${tone}.
3. Personalization variables available (use when helpful, keeping exact double curly brace syntax):
   - {{full_name}}
   - {{business_name}}
   - {{lead_ref}}
   - {{course_name}}
   - {{course_fee}}
   - {{form_title}}
4. If the user asks about course fees and did not specify another amount, standard institute tuition is ${courseFee}. Never invent unauthorized discounts, fake bank account numbers, or unapproved deadlines.
5. For SMS (smsBody): Keep it clear, polite, and concise (ideally under 160 characters in English or brief in Amharic) with no markdown formatting.
6. For Email (emailSubject & emailBody): Provide a clear subject line and well-structured plain-text paragraphs with greeting and sign-off from {{business_name}}.`;

      const contents = `CHANNEL TARGET: ${channel.toUpperCase()}
BUSINESS UNIT: ${businessUnitName}
${courseName ? `TARGET COURSE: ${courseName}` : ''}
APPROVED STANDARD FEE: ${courseFee}

STAFF PROMPT:
${prompt}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              emailSubject: {
                type: Type.STRING,
                description: 'Concise email subject line using merge tags if helpful',
              },
              emailBody: {
                type: Type.STRING,
                description: 'Complete personalized plain-text email body',
              },
              smsBody: {
                type: Type.STRING,
                description: 'Concise personalized SMS message body',
              },
            },
            required: ['emailSubject', 'emailBody', 'smsBody'],
          },
        },
      });

      const parsed = safeParseAiJson<Record<string, unknown>>(response.text ?? '{}', 'compose-message');
      res.json({
        emailSubject: sanitizeText(parsed.emailSubject, 250),
        emailBody: typeof parsed.emailBody === 'string' ? parsed.emailBody.trim().slice(0, 4000) : '',
        smsBody: typeof parsed.smsBody === 'string' ? parsed.smsBody.trim().slice(0, 600) : '',
      });
    } catch (err: unknown) {
      const status = err instanceof MissingGeminiKeyError ? err.status : 500;
      const msg = err instanceof Error ? err.message : 'Failed to generate message draft.';
      console.error('AI Compose Message Error:', msg);
      res.status(status).json({ error: `AI Message Writer error: ${msg}` });
    }
  });

  // ===========================================================================
  // PHASE 6: COMMUNICATION DISPATCH (RESEND EMAIL + TWILIO / AFROMESSAGE SMS)
  // ===========================================================================
  const escapeHtml = (unsafe: string) =>
    unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  app.post('/api/communications/dispatch', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`comm:${ip}`, 40, 60_000)) {
      res.status(429).json({ error: 'Rate limit exceeded for communications.' });
      return;
    }

    const verified = await verifyFirebaseBearer(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required to send communications.' });
      return;
    }

    const channel = req.body?.channel === 'sms' ? 'sms' : 'email';
    const recipient = sanitizeText(req.body?.recipient, 200);
    const subject = sanitizeText(req.body?.subject, 250);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 5000) : '';

    if (!recipient || !body) {
      res.status(400).json({ error: 'Recipient and message body are required.' });
      return;
    }

    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      res.status(400).json({ error: 'Please provide a valid recipient email address.' });
      return;
    }

    const normalizedPhone = recipient.replace(/[^0-9+]/g, '');
    if (channel === 'sms' && normalizedPhone.length < 7) {
      res.status(400).json({ error: 'Please provide a valid recipient phone number.' });
      return;
    }

    // 1. Live Email Dispatch via Resend (strictly server-side credentials)
    if (channel === 'email' && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const htmlBody = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
          <div style="background:#1D4ED8;color:#FFFFFF;padding:18px 24px;font-weight:700;font-size:16px;">Zacma Technology Portal</div>
          <div style="padding:24px;color:#0F172A;font-size:14px;line-height:1.65;white-space:pre-line;">${escapeHtml(body)}</div>
          <div style="background:#F8FAFC;border-top:1px solid #E2E8F0;padding:12px 24px;color:#64748B;font-size:11px;">Sent via Zacma Communication Center</div>
        </div>`;

        const emailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [recipient],
            subject: subject || 'Message from Zacma Portal',
            text: body,
            html: htmlBody,
          }),
        });
        if (emailResp.ok) {
          res.json({ deliveryStatus: 'sent', provider: 'resend_email' });
          return;
        }
        res.json({
          deliveryStatus: 'failed',
          provider: 'resend_email',
          note: `Provider returned HTTP ${emailResp.status}`,
        });
        return;
      } catch {
        res.json({ deliveryStatus: 'failed', provider: 'resend_email' });
        return;
      }
    }

    // 2A. Live SMS Dispatch via Twilio (strictly server-side credentials)
    if (
      channel === 'sms' &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
    ) {
      try {
        const creds = Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64');
        const params = new URLSearchParams({
          To: normalizedPhone,
          From: process.env.TWILIO_FROM_NUMBER,
          Body: body,
        });
        const smsResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${creds}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
          }
        );
        if (smsResp.ok) {
          res.json({ deliveryStatus: 'sent', provider: 'twilio_sms' });
          return;
        }
        res.json({
          deliveryStatus: 'failed',
          provider: 'twilio_sms',
          note: `Provider returned HTTP ${smsResp.status}`,
        });
        return;
      } catch {
        res.json({ deliveryStatus: 'failed', provider: 'twilio_sms' });
        return;
      }
    }

    // 2B. Live SMS Dispatch via AfroMessage (optional Ethiopian SMS gateway)
    if (channel === 'sms' && process.env.AFROMESSAGE_API_TOKEN) {
      try {
        const afroResp = await fetch('https://api.afromessage.com/api/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.AFROMESSAGE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: normalizedPhone,
            message: body,
            ...(process.env.AFROMESSAGE_SENDER_ID ? { sender: process.env.AFROMESSAGE_SENDER_ID } : {}),
            ...(process.env.AFROMESSAGE_IDENTIFIER_ID ? { from: process.env.AFROMESSAGE_IDENTIFIER_ID } : {}),
          }),
        });
        if (afroResp.ok) {
          res.json({ deliveryStatus: 'sent', provider: 'afromessage_sms' });
          return;
        }
        res.json({
          deliveryStatus: 'failed',
          provider: 'afromessage_sms',
          note: `Provider returned HTTP ${afroResp.status}`,
        });
        return;
      } catch {
        res.json({ deliveryStatus: 'failed', provider: 'afromessage_sms' });
        return;
      }
    }

    // API Approval Rule: External provider not yet approved/configured with server env credentials
    res.json({
      deliveryStatus: 'queued_pending_provider_approval',
      provider: channel === 'email' ? 'resend_email' : 'twilio_sms',
      note:
        channel === 'email'
          ? 'Logged in CRM Communication History. Configure RESEND_API_KEY & RESEND_FROM_EMAIL after Super Admin approval to dispatch live external emails.'
          : 'Logged in CRM Communication History. Configure TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER or AFROMESSAGE_API_TOKEN after Super Admin approval to dispatch live SMS.',
    });
  });

  // ===========================================================================
  // PHASE 11: PUBLIC FORM SUBMISSION RATE-LIMIT & SPAM CHECKPOINT
  // ===========================================================================
  app.post('/api/security/verify-submission', (req, res) => {
    const ip = req.ip || 'unknown';
    const publicSlugKey = sanitizeText(req.body?.publicSlugKey, 180);
    const honeypot = typeof req.body?.websiteTrap === 'string' ? req.body.websiteTrap.trim() : '';

    if (honeypot.length > 0) {
      res.status(400).json({ allowed: false, reason: 'Automated spam submission rejected.' });
      return;
    }

    if (!publicSlugKey) {
      res.status(400).json({ allowed: false, reason: 'Invalid form identifier.' });
      return;
    }

    if (!checkRateLimit(`public-submit:${ip}:${publicSlugKey}`, 8, 60_000)) {
      res.status(429).json({
        allowed: false,
        reason: 'Too many submissions from this device. Please wait a minute before trying again.',
      });
      return;
    }

    res.json({ allowed: true });
  });

  // Explicit JSON 404 catch-all for any unmatched /api/* route (NEVER fall through to HTML SPA)
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      status: 404,
    });
  });

  // Explicit JSON error handler for malformed request bodies or uncaught /api/* errors
  app.use(
    (
      err: Error & { status?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (req.originalUrl.startsWith('/api') || err.type === 'entity.parse.failed') {
        const statusCode =
          err.type === 'entity.parse.failed' ? 400 : typeof err.status === 'number' ? err.status : 500;
        console.error('[Zacma Server API Error]', {
          url: req.originalUrl,
          method: req.method,
          status: statusCode,
          error: err.message,
        });
        res.status(statusCode).json({
          error:
            err.type === 'entity.parse.failed'
              ? 'Malformed JSON request payload.'
              : err.message || 'Internal API server error.',
          status: statusCode,
        });
        return;
      }
      next(err);
    }
  );

  return app;
}

async function startServer() {
  const app = createApiApp();

  // ===========================================================================
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC ASSETS
  // ===========================================================================
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Zacma SaaS Portal running on http://0.0.0.0:${PORT}`);
  });
}

// Only start standalone HTTP listener when executed directly (never when imported by Vercel serverless api/index.ts)
const isDirectExecution =
  !process.env.VERCEL &&
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  startServer().catch((err) => {
    console.error('Failed to start Zacma server:', err);
    process.exit(1);
  });
}
