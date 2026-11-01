/**
 * Predict IQ - Centralized authentication context.
 *
 * Owns exactly one AuthSessionManager (one session listener, restored on
 * startup) and wires the API service to the current access token so no
 * component ever attaches credentials itself.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AuthResult, AuthSessionManager, AuthStatus, AuthUser } from '../lib/authSession';
import { getSupabase, getSupabaseConfigError, SUPABASE_CONFIG_ERROR } from '../lib/supabaseClient';
import api from '../services/api';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  configError: string | null;
  manager: AuthSessionManager | null;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  exchangeCode: (code: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildRedirectUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${path}`;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const configError = getSupabaseConfigError();
  const managerRef = useRef<AuthSessionManager | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  if (managerRef.current === null && !configError) {
    const supabase = getSupabase();
    if (supabase) {
      managerRef.current = new AuthSessionManager(supabase as any);
    }
  }

  const manager = managerRef.current;

  useEffect(() => {
    if (!manager) return;

    manager.start();
    const unsubscribe = manager.subscribe((nextStatus, nextUser) => {
      setStatus(nextStatus);
      setUser(nextUser);
    });

    // Single place where API credentials are attached (no per-component logic).
    api.setAuthTokenProvider(() => manager.getAccessToken());
    api.setRefreshTokenHandler(() => manager.refreshAccessToken());
    // A final 401 after the single refresh retry means the session is dead.
    api.setUnauthorizedHandler(() => {
      manager.invalidateSession();
    });

    return () => {
      unsubscribe();
      api.setAuthTokenProvider(null);
      api.setRefreshTokenHandler(null);
      api.setUnauthorizedHandler(null);
    };
  }, [manager]);

  const signIn = useCallback(
    (email: string, password: string) =>
      manager
        ? manager.signInWithPassword(email, password)
        : Promise.resolve({ ok: false, error: SUPABASE_CONFIG_ERROR }),
    [manager]
  );

  const signUp = useCallback(
    (email: string, password: string) =>
      manager ? manager.signUp(email, password) : Promise.resolve({ ok: false, error: SUPABASE_CONFIG_ERROR }),
    [manager]
  );

  const signInWithGoogle = useCallback(
    () =>
      manager
        ? manager.signInWithGoogle(buildRedirectUrl('/auth/callback'))
        : Promise.resolve({ ok: false, error: SUPABASE_CONFIG_ERROR }),
    [manager]
  );

  const signOut = useCallback(
    () => (manager ? manager.signOut() : Promise.resolve({ ok: true })),
    [manager]
  );

  const requestPasswordReset = useCallback(
    (email: string) =>
      manager
        ? manager.requestPasswordReset(email, buildRedirectUrl('/reset-password'))
        : Promise.resolve({ ok: false, error: SUPABASE_CONFIG_ERROR }),
    [manager]
  );

  const updatePassword = useCallback(
    (password: string) =>
      manager
        ? manager.updatePassword(password)
        : Promise.resolve({ ok: false, error: SUPABASE_CONFIG_ERROR }),
    [manager]
  );

  const exchangeCode = useCallback(
    (code: string) =>
      manager ? manager.exchangeCode(code) : Promise.resolve({ ok: false, error: SUPABASE_CONFIG_ERROR }),
    [manager]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      configError: configError ?? null,
      manager,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      requestPasswordReset,
      updatePassword,
      exchangeCode,
    }),
    [
      status,
      user,
      configError,
      manager,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      requestPasswordReset,
      updatePassword,
      exchangeCode,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

export default AuthContext;
