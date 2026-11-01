/**
 * Predict IQ - Authentication session manager.
 *
 * Framework-free core of the frontend auth state: it owns session restoration,
 * the single auth-state listener, token access for API calls, and the
 * sign-in / sign-up / OAuth / recovery flows. React binds to it through
 * `AuthContext`; tests drive it with a fake Supabase client (no network).
 *
 * Rules encoded here:
 * - exactly one auth listener per manager (no duplicate subscriptions)
 * - status starts at 'loading' and never renders private content before the
 *   restored session is known (prevents dashboard flash)
 * - expired sessions never yield an access token
 * - sign-out always clears local auth state, even if the network call fails
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  /** Sign-up only: Supabase requires email confirmation before sign-in. */
  needsEmailVerification?: boolean;
}

export interface SessionLike {
  access_token?: string | null;
  expires_at?: number | null;
  user?: { id?: string; email?: string } | null;
}

export interface AuthErrorLike {
  message?: string;
  code?: string | number;
  status?: number;
}

export interface SupabaseAuthLike {
  auth: {
    getSession(): Promise<{ data: { session: SessionLike | null }; error?: unknown }>;
    onAuthStateChange(
      callback: (event: string, session: SessionLike | null) => void
    ): { data: { subscription: { unsubscribe(): void } } };
    signInWithPassword(input: {
      email: string;
      password: string;
    }): Promise<{ data: unknown; error: AuthErrorLike | null }>;
    signUp(input: {
      email: string;
      password: string;
      options?: { emailRedirectTo?: string };
    }): Promise<{ data: unknown; error: AuthErrorLike | null }>;
    signInWithOAuth(input: {
      provider: string;
      options?: { redirectTo?: string };
    }): Promise<{ data: unknown; error: AuthErrorLike | null }>;
    signOut(options?: { scope?: string }): Promise<{ error: AuthErrorLike | null }>;
    resetPasswordForEmail(
      email: string,
      options?: { redirectTo?: string }
    ): Promise<{ error: AuthErrorLike | null }>;
    updateUser(input: { password: string }): Promise<{ error: AuthErrorLike | null }>;
    refreshSession(): Promise<{ data: { session: SessionLike | null }; error?: unknown }>;
    /** Supabase JS v2 PKCE callback exchange. */
    exchangeCodeForSession?(authCode: string): Promise<{ data: unknown; error: AuthErrorLike | null }>;
  };
}

export type AuthListener = (status: AuthStatus, user: AuthUser | null) => void;

/** Map raw Supabase errors to safe, user-facing copy. */
export function humanizeAuthError(error: AuthErrorLike | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  const message = (error.message || '').toLowerCase();
  if (message.includes('invalid login credentials')) {
    return 'Incorrect email or password.';
  }
  if (message.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (message.includes('password should be at least')) {
    return 'Password must be at least 6 characters.';
  }
  if (message.includes('signups not allowed') || message.includes('sign up is disabled')) {
    return 'New account registration is disabled on this deployment.';
  }
  if (message.includes('provider is not enabled') || message.includes('provider') && message.includes('not enabled')) {
    return 'This sign-in provider is not enabled. Ask an administrator to configure it.';
  }
  if (message.includes('database error') || message.includes('smtp')) {
    return 'The authentication service could not complete the request. Please try again later.';
  }
  return error.message || 'Something went wrong. Please try again.';
}

export class AuthSessionManager {
  private status: AuthStatus = 'loading';
  private user: AuthUser | null = null;
  private accessToken: string | null = null;
  private expiresAt: number | null = null;
  private started = false;
  private subscription: { unsubscribe(): void } | null = null;
  private readonly listeners = new Set<AuthListener>();

  public constructor(private readonly supabase: SupabaseAuthLike) {}

  /** Idempotent start: restores the session and registers ONE listener. */
  public start(): void {
    if (this.started) return;
    this.started = true;

    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
    });

    this.supabase.auth
      .getSession()
      .then(({ data }) => this.applySession(data?.session ?? null))
      .catch(() => this.applySession(null));
  }

  public getStatus(): AuthStatus {
    return this.status;
  }

  public getUser(): AuthUser | null {
    return this.user;
  }

  public subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    listener(this.status, this.user);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Current access token, or null when signed out / expired.
   * Never returns an expired token (defence in depth before the backend 401s).
   */
  public getAccessToken(): string | null {
    if (this.status !== 'authenticated' || !this.accessToken) return null;
    if (this.expiresAt !== null && this.expiresAt * 1000 <= Date.now()) return null;
    return this.accessToken;
  }

  /** Single controlled refresh used by the API client's one 401 retry. */
  public async refreshAccessToken(): Promise<string | null> {
    try {
      const { data } = await this.supabase.auth.refreshSession();
      const session = data?.session ?? null;
      this.applySession(session);
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  public async signInWithPassword(email: string, password: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: humanizeAuthError(error) };
    return { ok: true };
  }

  public async signUp(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error) return { ok: false, error: humanizeAuthError(error) };

    const record = (data ?? {}) as { session?: SessionLike | null; user?: unknown };
    // No session back => email confirmation is required before sign-in.
    if (!record.session && record.user) {
      return { ok: true, needsEmailVerification: true };
    }
    return { ok: true };
  }

  public async signInWithGoogle(redirectTo: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) return { ok: false, error: humanizeAuthError(error) };
    return { ok: true };
  }

  /**
   * Enumeration-safe password recovery: callers must always show the same
   * generic confirmation, whatever Supabase reports about the address.
   */
  public async requestPasswordReset(email: string, redirectTo?: string): Promise<AuthResult> {
    try {
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) {
        const message = (error.message || '').toLowerCase();
        // Infrastructure failures are safe to surface; "user not found" is not.
        if (message.includes('rate limit') || message.includes('smtp') || message.includes('database error')) {
          return { ok: false, error: humanizeAuthError(error) };
        }
      }
      return { ok: true };
    } catch {
      return { ok: true };
    }
  }

  public async updatePassword(password: string): Promise<AuthResult> {
    const { error } = await this.supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: humanizeAuthError(error) };
    return { ok: true };
  }

  /**
   * Drop local session state without a network call. Used when the backend
   * rejects our token after the single refresh retry (dead session), so the
   * route guard reacts immediately instead of retrying forever.
   */
  public invalidateSession(): void {
    this.applySession(null);
  }

  public async signOut(): Promise<AuthResult> {
    try {
      const { error } = await this.supabase.auth.signOut();
      if (error) return { ok: false, error: humanizeAuthError(error) };
      return { ok: true };
    } finally {
      // Local state must clear regardless of network outcome.
      this.applySession(null);
    }
  }

  /** Exchange an OAuth/PKCE `?code=` for a session (auth callback page). */
  public async exchangeCode(authCode: string): Promise<AuthResult> {
    // Official Supabase JS v2 callback API; keep token handling centralized.
    const exchange = this.supabase.auth.exchangeCodeForSession;
    if (typeof exchange !== 'function') {
      return { ok: false, error: 'This authentication callback is not supported by the client.' };
    }
    try {
      const { error } = await exchange.call(this.supabase.auth, authCode);
      if (error) return { ok: false, error: humanizeAuthError(error) };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Could not complete the sign-in callback.' };
    }
  }

  private applySession(session: SessionLike | null): void {
    if (session && session.access_token) {
      this.status = 'authenticated';
      this.accessToken = session.access_token;
      this.expiresAt = typeof session.expires_at === 'number' ? session.expires_at : null;
      this.user = {
        id: session.user?.id ?? 'unknown',
        email: session.user?.email ?? null,
      };
    } else {
      this.status = 'unauthenticated';
      this.accessToken = null;
      this.expiresAt = null;
      this.user = null;
    }
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.status, this.user);
      } catch (err) {
        console.warn('[Auth] listener error:', err);
      }
    });
  }
}
