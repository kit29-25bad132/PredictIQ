import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';

// Firebase configuration from environment or fallback to project config
const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || "AIzaSyBA8GCNWAL3q-owrAC2R8NSfDgS7nhhxlg",
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || "techmain-3dc2a.firebaseapp.com",
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || "techmain-3dc2a",
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || "techmain-3dc2a.firebasestorage.app",
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "27211537518",
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || "1:27211537518:web:24f0008a0629e5436f1a7f",
  measurementId: (import.meta as any).env?.VITE_FIREBASE_MEASUREMENT_ID || "G-2Y7KVNK0F0",
};

// Initialize Firebase App singleton
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Initialize Firebase Analytics conditionally for browser environments
export let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics not supported or blocked
  });
}

/**
 * Format Firebase Auth errors into clear, friendly, and secure user messages.
 */
export function formatAuthError(error: any): string {
  if (!error) return 'An unexpected authentication error occurred.';
  const code = error.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'The email address is improperly formatted.';
    case 'auth/user-disabled':
      return 'This user account has been disabled. Please contact support.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email address. Please sign in instead.';
    case 'auth/weak-password':
      return 'The password is too weak. Please use at least 6 characters.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before completing the sign-in.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please enable popups for this site.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled. Please sign in with email and password.';
    case 'auth/too-many-requests':
      return 'Access temporarily blocked due to many failed attempts. Please reset your password or try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection and try again.';
    default:
      return error.message || 'Authentication failed. Please verify your details.';
  }
}

/**
 * Calculate dynamic time-of-day greeting (Good morning, Good afternoon, Good evening)
 * personalized with the user's name.
 */
export function getPersonalizedGreeting(displayName?: string | null, email?: string | null): {
  greeting: string;
  name: string;
  initials: string;
} {
  let name = '';
  if (displayName && displayName.trim()) {
    // Extract first name or full name if short
    const parts = displayName.trim().split(' ');
    name = parts[0];
  } else if (email && email.trim()) {
    const prefix = email.split('@')[0];
    name = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }

  // Determine time of day
  const hour = new Date().getHours();
  let timeGreeting = 'Good day';
  if (hour >= 4 && hour < 12) {
    timeGreeting = 'Good morning';
  } else if (hour >= 12 && hour < 17) {
    timeGreeting = 'Good afternoon';
  } else if (hour >= 17 && hour < 22) {
    timeGreeting = 'Good evening';
  } else {
    timeGreeting = 'Welcome back';
  }

  const finalGreeting = name ? `${timeGreeting}, ${name}!` : 'Hi there!';

  // Initials
  let initials = 'U';
  if (displayName && displayName.trim()) {
    const parts = displayName.trim().split(' ').filter(Boolean);
    if (parts.length >= 2) {
      initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (parts.length === 1) {
      initials = parts[0].substring(0, 2).toUpperCase();
    }
  } else if (name) {
    initials = name.substring(0, 2).toUpperCase();
  }

  return {
    greeting: finalGreeting,
    name: name || 'Operator',
    initials,
  };
}

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  type User,
};
