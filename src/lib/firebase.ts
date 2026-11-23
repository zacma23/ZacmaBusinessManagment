import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import defaultFirebaseConfig from '../../firebase-applet-config.json';

// Allow Vercel production/preview environment variables to override firebase-applet-config.json
// without ever embedding server secrets in frontend code.
const env = import.meta.env as Record<string, string | undefined>;
const resolvedConfig = {
  projectId: env.VITE_FIREBASE_PROJECT_ID?.trim() || defaultFirebaseConfig.projectId,
  appId: env.VITE_FIREBASE_APP_ID?.trim() || defaultFirebaseConfig.appId,
  apiKey: env.VITE_FIREBASE_API_KEY?.trim() || defaultFirebaseConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || defaultFirebaseConfig.authDomain,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || defaultFirebaseConfig.storageBucket,
  messagingSenderId:
    env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || defaultFirebaseConfig.messagingSenderId,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID?.trim() || defaultFirebaseConfig.measurementId,
  firestoreDatabaseId:
    env.VITE_FIREBASE_DATABASE_ID?.trim() || defaultFirebaseConfig.firestoreDatabaseId,
};

export const FIREBASE_PROJECT_ID = resolvedConfig.projectId;
export const FIREBASE_AUTH_DOMAIN = resolvedConfig.authDomain;
export const FIREBASE_CONSOLE_AUTH_DOMAINS_URL = `https://console.firebase.google.com/project/${resolvedConfig.projectId}/authentication/settings`;
export const FIREBASE_CONSOLE_SIGNIN_METHODS_URL = `https://console.firebase.google.com/project/${resolvedConfig.projectId}/authentication/providers`;

const app = initializeApp(resolvedConfig);

// CRITICAL: Pass resolvedConfig.firestoreDatabaseId so queries target the provisioned database
export const db = getFirestore(app, resolvedConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Persist authenticated sessions cleanly across page refreshes and Vercel routes
void setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Auth persistence setup warning:', err instanceof Error ? err.message : err);
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export interface ParsedAuthError {
  code: string;
  message: string;
  isUnauthorizedDomain: boolean;
  isPasswordProviderDisabled: boolean;
  currentHostname: string;
}

export function parseFirebaseAuthError(error: unknown): ParsedAuthError {
  const currentHostname =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : 'unknown-host';

  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const combined = `${rawCode} ${rawMessage}`;

  if (
    rawCode === 'auth/unauthorized-domain' ||
    combined.includes('auth/unauthorized-domain')
  ) {
    return {
      code: 'auth/unauthorized-domain',
      message: `This domain (${currentHostname}) is not authorized in Firebase Authentication for project "${FIREBASE_PROJECT_ID}". Add "${currentHostname}" under Firebase Console → Authentication → Settings → Authorized domains.`,
      isUnauthorizedDomain: true,
      isPasswordProviderDisabled: false,
      currentHostname,
    };
  }

  if (
    rawCode === 'auth/operation-not-allowed' ||
    combined.includes('OPERATION_NOT_ALLOWED') ||
    combined.includes('PASSWORD_LOGIN_DISABLED')
  ) {
    return {
      code: 'auth/operation-not-allowed',
      message: `Email/Password sign-in is currently disabled in Firebase project "${FIREBASE_PROJECT_ID}". Enable it in Firebase Console → Authentication → Sign-in method → Email/Password.`,
      isUnauthorizedDomain: false,
      isPasswordProviderDisabled: true,
      currentHostname,
    };
  }

  if (rawCode === 'auth/popup-closed-by-user' || rawCode === 'auth/cancelled-popup-request') {
    return {
      code: rawCode,
      message: 'Google sign-in popup was closed before completion. Please try again.',
      isUnauthorizedDomain: false,
      isPasswordProviderDisabled: false,
      currentHostname,
    };
  }

  if (rawCode === 'auth/popup-blocked') {
    return {
      code: rawCode,
      message: 'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.',
      isUnauthorizedDomain: false,
      isPasswordProviderDisabled: false,
      currentHostname,
    };
  }

  if (
    rawCode === 'auth/invalid-credential' ||
    rawCode === 'auth/wrong-password' ||
    rawCode === 'auth/user-not-found' ||
    rawCode === 'auth/invalid-login-credentials'
  ) {
    return {
      code: rawCode,
      message: 'Invalid username or password. Please check your credentials and try again.',
      isUnauthorizedDomain: false,
      isPasswordProviderDisabled: false,
      currentHostname,
    };
  }

  if (rawCode === 'auth/user-disabled') {
    return {
      code: rawCode,
      message: 'This account has been deactivated or suspended. Please contact your organization administrator.',
      isUnauthorizedDomain: false,
      isPasswordProviderDisabled: false,
      currentHostname,
    };
  }

  if (rawCode === 'auth/too-many-requests') {
    return {
      code: rawCode,
      message: 'Too many unsuccessful attempts. Access has been temporarily locked for security — please wait and try again.',
      isUnauthorizedDomain: false,
      isPasswordProviderDisabled: false,
      currentHostname,
    };
  }

  if (rawCode === 'auth/network-request-failed') {
    return {
      code: rawCode,
      message: 'Network error contacting Firebase Authentication. Please check your internet connection.',
      isUnauthorizedDomain: false,
      isPasswordProviderDisabled: false,
      currentHostname,
    };
  }

  return {
    code: rawCode || 'auth/unknown',
    message: rawMessage || 'Authentication failed. Please try again.',
    isUnauthorizedDomain: false,
    isPasswordProviderDisabled: false,
    currentHostname,
  };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connectivity on startup
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
