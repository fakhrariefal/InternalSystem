import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  inMemoryPersistence,
  type Auth,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import provisionedConfig from '../../firebase-applet-config.json';

export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  firestoreDatabaseId?: string;
}

const envConfig: Partial<FirebaseEnvConfig> = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID,
};

const envDbId =
  envConfig.firestoreDatabaseId &&
  envConfig.firestoreDatabaseId.trim() !== '' &&
  envConfig.firestoreDatabaseId !== '(default)'
    ? envConfig.firestoreDatabaseId
    : undefined;

const resolvedConfig: FirebaseEnvConfig = {
  apiKey: envConfig.apiKey || provisionedConfig.apiKey || '',
  authDomain: envConfig.authDomain || provisionedConfig.authDomain || '',
  projectId: envConfig.projectId || provisionedConfig.projectId || '',
  storageBucket: envConfig.storageBucket || provisionedConfig.storageBucket || '',
  messagingSenderId:
    envConfig.messagingSenderId || provisionedConfig.messagingSenderId || '',
  appId: envConfig.appId || provisionedConfig.appId || '',
  firestoreDatabaseId:
    envDbId ||
    provisionedConfig.firestoreDatabaseId ||
    envConfig.firestoreDatabaseId ||
    undefined,
};

export function validateFirebaseEnv(config: FirebaseEnvConfig = resolvedConfig): {
  valid: boolean;
  missingKeys: string[];
} {
  const required: Array<keyof FirebaseEnvConfig> = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ];
  const missingKeys = required.filter((k) => !config[k] || String(config[k]).trim() === '');
  return {
    valid: missingKeys.length === 0,
    missingKeys,
  };
}

const validation = validateFirebaseEnv(resolvedConfig);
if (!validation.valid) {
  console.warn(
    `[Domestiq Hub] Konfigurasi Firebase belum lengkap (${validation.missingKeys.join(', ')}). Periksa file .env atau konfigurasi environment.`
  );
}

console.info('[Domestiq Hub] Firebase resolved', {
  projectId: resolvedConfig.projectId,
  authDomain: resolvedConfig.authDomain,
  firestoreDatabaseId: resolvedConfig.firestoreDatabaseId || '(default)',
});

const app: FirebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(resolvedConfig);

function createResilientAuth(firebaseApp: FirebaseApp): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [
        browserLocalPersistence,
        indexedDBLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

function createResilientFirestore(firebaseApp: FirebaseApp, databaseId?: string): Firestore {
  try {
    return databaseId
      ? initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true }, databaseId)
      : initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true });
  } catch {
    return databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);
  }
}

export const auth: Auth = createResilientAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const db: Firestore = createResilientFirestore(app, resolvedConfig.firestoreDatabaseId);

export const storage: FirebaseStorage = getStorage(app);

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

export async function testConnection(): Promise<boolean> {
  if (!validation.valid) return false;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    return true;
  }
}

void testConnection();
