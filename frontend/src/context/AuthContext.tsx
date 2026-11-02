/**
 * Predict IQ - Centralized authentication context.
 *
 * Owns exactly one AuthSessionManager (one session listener, restored on
 * startup) and one WorkspaceInitializer. Authentication and workspace
 * initialization are a single controlled flow: the app is only ready once the
 * backend has confirmed the user's workspace, and no tenant-scoped request is
 * issued before that.
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
import api, { OrganizationSummary } from '../services/api';
import { WorkspaceInitializer } from '../lib/workspaceInit';
import type { WorkspaceState } from '../lib/workspaceInit';

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
  /** The single authoritative workspace for this session. */
  workspace: OrganizationSummary | null;
  workspaceStatus: WorkspaceState['status'];
  workspaceLoading: boolean;
  workspaceError: string | null;
  retryWorkspace: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Non-browser fallback (SSR/unit tests): keeps the initializer DOM-free. */
const memoryStorage = {
  getItem: (_key: string) => null,
  setItem: (_key: string, _value: string) => undefined,
  removeItem: (_key: string) => undefined,
};

function buildRedirectUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${path}`;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const managerRef = useRef<AuthSessionManager | null>(null);
  if (managerRef.current === null) {
    // Creates (and caches) the Supabase client; sets the module config error
    // when the public environment values are missing.
    const supabase = getSupabase();
    if (supabase) {
      managerRef.current = new AuthSessionManager(supabase as any);
    }
  }
  const manager = managerRef.current;
  const configError = getSupabaseConfigError();

  const initializerRef = useRef<WorkspaceInitializer | null>(null);
  if (initializerRef.current === null) {
    initializerRef.current = new WorkspaceInitializer({
      getUserId: () => managerRef.current?.getUser()?.id ?? null,
      fetchWorkspace: (savedWorkspaceId) => api.initializeWorkspace(savedWorkspaceId),
      selectWorkspace: (id) => api.setOrganizationId(id),
      storage: typeof window !== 'undefined' ? window.localStorage : memoryStorage,
    });
  }
  const initializer = initializerRef.current;

  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    status: 'idle',
    workspace: null,
    error: null,
  });

  useEffect(() => initializer.subscribe(setWorkspaceState), [initializer]);

  useEffect(() => {
    if (!manager) return;

    // Wire credentials BEFORE the first auth event can trigger workspace
    // initialization, so the initialization request carries the user token.
    api.setAuthTokenProvider(() => manager.getAccessToken());
    api.setRefreshTokenHandler(() => manager.refreshAccessToken());
    api.setUnauthorizedHandler(() => {
      manager.invalidateSession();
    });

    manager.start();

    const unsubscribe = manager.subscribe((nextStatus, nextUser) => {
      setStatus(nextStatus);
      setUser(nextUser);
      // Single trigger for every auth transition: sign-in, sign-up, OAuth
      // callback, restored session, token loss, sign-out.
      void initializer.sync();
    });

    return () => {
      unsubscribe();
      api.setAuthTokenProvider(null);
      api.setRefreshTokenHandler(null);
      api.setUnauthorizedHandler(null);
      initializer.reset();
    };
  }, [manager, initializer]);

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

  const signOut = useCallback(async () => {
    const result = manager ? await manager.signOut() : { ok: true };
    // Explicit clear in addition to the auth-event reset, so workspace state
    // can never survive a failed sign-out call.
    initializer.reset();
    return result;
  }, [manager, initializer]);

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

  const retryWorkspace = useCallback(() => {
    void initializer.retry();
  }, [initializer]);

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
      workspace: workspaceState.workspace,
      workspaceStatus: workspaceState.status,
      workspaceLoading: workspaceState.status === 'loading',
      workspaceError: workspaceState.error,
      retryWorkspace,
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
      workspaceState,
      retryWorkspace,
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
