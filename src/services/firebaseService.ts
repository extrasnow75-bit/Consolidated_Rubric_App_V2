import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  User,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyB-GW-tlt1xXgKpKvoXni6vCug8kqSi6AI',
  authDomain: 'updated-rubric-creator.firebaseapp.com',
  projectId: 'updated-rubric-creator',
  storageBucket: 'updated-rubric-creator.firebasestorage.app',
  messagingSenderId: '370242542078',
  appId: '1:370242542078:web:2bba0fe30c70ebbedb08af',
  measurementId: 'G-S725EX5RXP',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Google OAuth provider with Drive scopes
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');

// SessionStorage keys for the Google access token
// (Firebase persists the user identity but not the Google access token)
const GOOGLE_ACCESS_TOKEN_KEY = 'firebase_google_access_token';
const GOOGLE_ACCESS_TOKEN_EXPIRY_KEY = 'firebase_google_access_token_expiry';

export interface FirebaseSignInResult {
  user: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
  accessToken: string;
  expiresAt: number;
}

/**
 * Initiate Google sign-in via redirect. The page navigates away to Google's
 * auth page and returns to the app after the user selects an account.
 * Call handleGoogleRedirectResult() on page load to obtain the sign-in result.
 */
export async function initiateGoogleSignIn(): Promise<void> {
  await signInWithRedirect(auth, googleProvider);
}

/**
 * Call on every page load to check if the user just returned from a Google
 * redirect sign-in. Returns the sign-in result if a redirect completed,
 * or null if there is no pending redirect (normal page load).
 * The access token is persisted to sessionStorage for same-tab refreshes.
 */
export async function handleGoogleRedirectResult(): Promise<FirebaseSignInResult | null> {
  const result = await getRedirectResult(auth);
  if (!result) return null;

  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;

  if (!accessToken) {
    throw new Error('Failed to obtain Google access token from redirect. Please try signing in again.');
  }

  // Google access tokens expire in ~1 hour
  const expiresAt = Date.now() + 60 * 60 * 1000;

  // Persist so the token survives a same-tab page refresh
  sessionStorage.setItem(GOOGLE_ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(GOOGLE_ACCESS_TOKEN_EXPIRY_KEY, String(expiresAt));

  const firebaseUser = result.user;
  return {
    user: {
      id: firebaseUser.uid,
      email: firebaseUser.email || '',
      name: firebaseUser.displayName || firebaseUser.email || 'Google User',
      picture: firebaseUser.photoURL || undefined,
    },
    accessToken,
    expiresAt,
  };
}

/**
 * Sign out from Firebase and clear the stored Google access token.
 */
export async function signOutFromGoogle(): Promise<void> {
  sessionStorage.removeItem(GOOGLE_ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(GOOGLE_ACCESS_TOKEN_EXPIRY_KEY);
  await firebaseSignOut(auth);
}

/**
 * Return the stored Google access token if it exists and has not expired
 * (with a 5-minute safety buffer). Returns null otherwise.
 */
export function getStoredAccessToken(): { accessToken: string; expiresAt: number } | null {
  const token = sessionStorage.getItem(GOOGLE_ACCESS_TOKEN_KEY);
  const expiryStr = sessionStorage.getItem(GOOGLE_ACCESS_TOKEN_EXPIRY_KEY);
  if (!token || !expiryStr) return null;
  const expiresAt = Number(expiryStr);
  if (Date.now() > expiresAt - 5 * 60 * 1000) return null; // expired or nearly expired
  return { accessToken: token, expiresAt };
}

/**
 * Subscribe to Firebase auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthStateChanged(callback: (user: User | null) => void): () => void {
  return firebaseOnAuthStateChanged(auth, callback);
}
