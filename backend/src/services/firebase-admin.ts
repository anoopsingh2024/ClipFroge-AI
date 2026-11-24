import {
  applicationDefault,
  cert,
  getApps,
  initializeApp
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getFirebaseApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();

  if (serviceAccountJson) {
    let serviceAccount: Record<string, unknown>;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as Record<string, unknown>;
    } catch (error) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.', {
        cause: error
      });
    }
    return initializeApp({
      credential: cert(serviceAccount as Parameters<typeof cert>[0]),
      ...(projectId ? { projectId } : {})
    });
  }

  if (projectId || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {})
    });
  }

  throw new Error(
    'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or application credentials.'
  );
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseApp());
}

export function getFirestoreDb() {
  return getFirestore(getFirebaseApp());
}
