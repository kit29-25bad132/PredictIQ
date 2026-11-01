/**
 * Predict IQ - Phase 4 authentication verification suite.
 *
 * Runs under `npx tsx src/tests/authSystem.test.ts` (same harness style as
 * alarmSystem.test.ts). All Supabase network interaction and all fetch calls
 * are mocked: no live service, no credentials, no production data.
 *
 * Covers: session restoration, expiry, auth-state changes, single listener,
 * login/signup/logout, password reset (enumeration-safe), OAuth callback
 * exchange, API token attachment, no token on public/device/operator paths,
 * the single 401 refresh-retry (no loops), 403/404 classification,
 * no-membership handling, route-guard decisions and config validation.
 */

import { AuthSessionManager, humanizeAuthError, SessionLike } from '../lib/authSession';
import {
  buildSignInPath,
  getAuthGuardDecision,
  isPublicAuthRoute,
  resolvePostSignInPath,
  shouldRenderPrivateContent,
} from '../lib/authGuard';
import { readSupabaseConfig, SUPABASE_CONFIG_ERROR } from '../lib/supabaseClient';
import api, { ApiError, isOrganizationAccessError } from '../services/api';

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, testName: string) {
  totalCount++;
  if (condition) {
    console.log(`  [PASS] Test ${totalCount}: ${testName}`);
    passedCount++;
  } else {
    console.error(`  [FAIL] Test ${totalCount}: ${testName}`);
    throw new Error(`Test assertion failed for: ${testName}`);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ============================================================================
// Fake Supabase auth (mocks all external network interaction)
// ============================================================================

interface FakeState {
  session: SessionLike | null;
  listeners: Array<(event: string, session: SessionLike | null) => void>;
  listenerCount: number;
  refreshCalls: number;
  signOutCalls: number;
  signOutError: { message: string } | null;
  passwordError: { message: string } | null;
  signUpSession: SessionLike | null;
  signUpError: { message: string } | null;
  oauthError: { message: string } | null;
  resetError: { message: string } | null;
  updateError: { message: string } | null;
  exchangeError: { message: string } | null;
  refreshSession: SessionLike | null;
  oauthRedirectTo: string | null;
}

function createFakeSupabase(): { client: any; state: FakeState } {
  const state: FakeState = {
    session: null,
    listeners: [],
    listenerCount: 0,
    refreshCalls: 0,
    signOutCalls: 0,
    signOutError: null,
    passwordError: null,
    signUpSession: null,
    signUpError: null,
    oauthError: null,
    resetError: null,
    updateError: null,
    exchangeError: null,
    refreshSession: null,
    oauthRedirectTo: null,
  };

  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange(cb: (event: string, session: SessionLike | null) => void) {
        state.listenerCount += 1;
        state.listeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: async (_input: { email: string; password: string }) => ({
        data: { session: state.session },
        error: state.passwordError,
      }),
      signUp: async (_input: { email: string; password: string }) => ({
        data: { session: state.signUpSession, user: { id: 'u-1' } },
        error: state.signUpError,
      }),
      signInWithOAuth: async (input: { provider: string; options?: { redirectTo?: string } }) => {
        state.oauthRedirectTo = input.options?.redirectTo ?? null;
        return { data: {}, error: state.oauthError };
      },
      signOut: async () => {
        state.signOutCalls += 1;
        return { error: state.signOutError };
      },
      resetPasswordForEmail: async () => ({ error: state.resetError }),
      updateUser: async () => ({ error: state.updateError }),
      refreshSession: async () => {
        state.refreshCalls += 1;
        state.session = state.refreshSession;
        return { data: { session: state.refreshSession } };
      },
      exchangeCodeForSession: async () => ({ data: {}, error: state.exchangeError }),
    },
  };

  return { client, state };
}

function makeSession(token: string, expiresInSec = 3600, email = 'user@example.com'): SessionLike {
  return {
    access_token: token,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    user: { id: 'user-1', email },
  };
}

console.log('================================================================');
console.log('PREDICT IQ - PHASE 4 AUTHENTICATION VERIFICATION SUITE');
console.log('================================================================\n');

// ============================================================================
// 1. Supabase configuration validation (no silent mock auth)
// ============================================================================
console.log('-- Configuration --');
{
  assert(readSupabaseConfig({}) === null, 'Missing VITE_SUPABASE_* values are detected (no mock fallback).');
  assert(
    readSupabaseConfig({ VITE_SUPABASE_URL: 'not-a-url', VITE_SUPABASE_ANON_KEY: 'k' }) === null,
    'Malformed Supabase URL is rejected.'
  );
  const config = readSupabaseConfig({
    VITE_SUPABASE_URL: 'https://proj.supabase.co/',
    VITE_SUPABASE_ANON_KEY: 'public-anon-key',
  });
  assert(
    config !== null && config.url === 'https://proj.supabase.co' && config.anonKey === 'public-anon-key',
    'Valid public config is read and normalised.'
  );
  assert(
    SUPABASE_CONFIG_ERROR.includes('VITE_SUPABASE_URL'),
    'Configuration error message names the required variables.'
  );
  assert(
    !SUPABASE_CONFIG_ERROR.toLowerCase().includes('service_role'),
    'Configuration error never mentions service-role material.'
  );
}

// ============================================================================
// 2. Session restoration, auth-state changes, listener discipline
// ============================================================================
console.log('\n-- Session restoration & state --');
{
  const { client, state } = createFakeSupabase();
  state.session = makeSession('token-initial');
  const manager = new AuthSessionManager(client);

  assert(manager.getStatus() === 'loading', 'Status starts as loading before restoration resolves (no dashboard flash).');
  manager.start();
  await tick();
  assert(manager.getStatus() === 'authenticated', 'Restored session authenticates the manager.');
  assert(manager.getAccessToken() === 'token-initial', 'Restored access token is exposed to the API client.');
  assert(manager.getUser()?.email === 'user@example.com', 'Authenticated user identity is available.');

  manager.start();
  manager.start();
  assert(state.listenerCount === 1, 'Starting twice registers exactly one auth listener (no duplicates).');

  let seen: string[] = [];
  const unsubscribe = manager.subscribe((status) => seen.push(status));
  assert(seen[0] === 'authenticated', 'New subscribers immediately receive the current state.');
  state.session = makeSession('token-rotated');
  state.listeners.forEach((cb) => cb('TOKEN_REFRESHED', state.session));
  assert(manager.getAccessToken() === 'token-rotated', 'Auth-state changes update the active token.');
  assert(seen[seen.length - 1] === 'authenticated', 'Listeners observe state changes.');
  unsubscribe();

  state.session = null;
  state.listeners.forEach((cb) => cb('SIGNED_OUT', null));
  assert(manager.getStatus() === 'unauthenticated' && manager.getAccessToken() === null, 'Sign-out event clears auth state.');
}

// ============================================================================
// 3. Expiry, refresh, invalidation
// ============================================================================
console.log('\n-- Expiry & refresh --');
{
  const { client, state } = createFakeSupabase();
  state.session = makeSession('expired-token', -60);
  const manager = new AuthSessionManager(client);
  manager.start();
  await tick();
  assert(manager.getAccessToken() === null, 'An expired session never yields an access token.');

  state.refreshSession = makeSession('fresh-token');
  const refreshed = await manager.refreshAccessToken();
  assert(refreshed === 'fresh-token', 'Controlled refresh returns the new access token.');
  assert(state.refreshCalls === 1, 'Refresh calls the Supabase session endpoint once.');
  assert(manager.getAccessToken() === 'fresh-token', 'Refreshed token becomes the active token.');

  state.refreshSession = null;
  const failedRefresh = await manager.refreshAccessToken();
  assert(failedRefresh === null, 'Failed refresh returns null instead of throwing.');

  manager.invalidateSession();
  assert(
    manager.getStatus() === 'unauthenticated' && manager.getAccessToken() === null,
    'invalidateSession (final 401) drops local auth state without a network call.'
  );
}

// ============================================================================
// 4. Login / signup / logout / recovery flows
// ============================================================================
console.log('\n-- Authentication flows --');
{
  const { client, state } = createFakeSupabase();
  const manager = new AuthSessionManager(client);

  state.passwordError = { message: 'Invalid login credentials' };
  const badLogin = await manager.signInWithPassword('a@b.co', 'wrong');
  assert(badLogin.ok === false && badLogin.error === 'Incorrect email or password.', 'Invalid credentials are humanized, not raw.');

  state.passwordError = null;
  const goodLogin = await manager.signInWithPassword('a@b.co', 'correct-horse');
  assert(goodLogin.ok === true, 'Successful sign-in reports success.');

  state.signUpSession = null;
  state.signUpError = null;
  const verifySignup = await manager.signUp('new@user.co', 'long-enough-pw');
  assert(
    verifySignup.ok === true && verifySignup.needsEmailVerification === true,
    'Sign-up without a session requests email verification (no fake session).'
  );

  state.signUpSession = makeSession('immediate-token');
  const immediateSignup = await manager.signUp('instant@user.co', 'long-enough-pw');
  assert(
    immediateSignup.ok === true && !immediateSignup.needsEmailVerification,
    'Sign-up with auto-confirm proceeds straight to an authenticated session.'
  );

  state.signUpError = { message: 'Signups not allowed for this instance' };
  const disabledSignup = await manager.signUp('x@y.co', 'long-enough-pw');
  assert(disabledSignup.ok === false, 'Registration-disabled deployments surface a real error.');
  state.signUpError = null;

  const google = await manager.signInWithGoogle('https://app.example.com/auth/callback');
  assert(google.ok === true, 'Google OAuth start succeeds when Supabase accepts it.');
  assert(
    state.oauthRedirectTo === 'https://app.example.com/auth/callback',
    'Google OAuth uses the /auth/callback redirect URL.'
  );
  state.oauthError = { message: 'Provider is not enabled for this project' };
  const googleDown = await manager.signInWithGoogle('https://app.example.com/auth/callback');
  assert(
    googleDown.ok === false && googleDown.error?.includes('not enabled'),
    'Unconfigured Google provider is reported honestly (never pretended to work).'
  );
  state.oauthError = null;

  // Enumeration-safe password recovery.
  state.resetError = { message: 'User not found' };
  const unknownUser = await manager.requestPasswordReset('nobody@example.com');
  assert(unknownUser.ok === true, 'Password reset never reveals whether an account exists.');
  state.resetError = { message: 'SMTP server not reachable' };
  const smtpDown = await manager.requestPasswordReset('somebody@example.com');
  assert(smtpDown.ok === false, 'Infrastructure failures are still surfaced to the user.');
  state.resetError = null;
  const resetSent = await manager.requestPasswordReset('somebody@example.com');
  assert(resetSent.ok === true, 'Valid reset request reports success generically.');

  // Password update (recovery session).
  state.updateError = { message: 'Password should be at least 6 characters' };
  const weak = await manager.updatePassword('abc');
  assert(weak.ok === false, 'Weak new password is rejected with readable copy.');
  state.updateError = null;
  const strong = await manager.updatePassword('a-strong-enough-password');
  assert(strong.ok === true, 'Strong new password is accepted.');

  // Logout clears local state even when the network call fails.
  state.session = makeSession('to-be-cleared');
  manager.start();
  await tick();
  state.signOutError = { message: 'network down' };
  const failedSignOut = await manager.signOut();
  assert(failedSignOut.ok === false, 'Failed sign-out network call reports failure.');
  assert(
    manager.getStatus() === 'unauthenticated' && manager.getAccessToken() === null,
    'Local auth state clears even when sign-out fails (no stuck session).'
  );
  state.signOutError = null;
  state.signOutCalls = 0;
  state.session = makeSession('valid-again');
  state.listeners.forEach((cb) => cb('SIGNED_IN', state.session));
  const okSignOut = await manager.signOut();
  assert(okSignOut.ok === true && state.signOutCalls === 1, 'Successful sign-out calls Supabase once and clears state.');

  // OAuth/PKCE callback exchange.
  state.exchangeError = null;
  const exchanged = await manager.exchangeCode('auth-code-123');
  assert(exchanged.ok === true, 'Auth callback code exchange succeeds.');
  state.exchangeError = { message: 'bad code' };
  const badExchange = await manager.exchangeCode('bad-code');
  assert(badExchange.ok === false, 'Invalid callback code surfaces a real error.');
}

// ============================================================================
// 5. Route guard decisions (no flash, preserved destination)
// ============================================================================
console.log('\n-- Route guard --');
{
  assert(getAuthGuardDecision('loading') === 'loading', 'Loading state blocks private rendering.');
  assert(!shouldRenderPrivateContent('loading'), 'Private content never renders while restoring (no flash).');
  assert(!shouldRenderPrivateContent('unauthenticated'), 'Signed-out visitors never see the dashboard.');
  assert(shouldRenderPrivateContent('authenticated'), 'Authenticated users render the dashboard.');
  assert(getAuthGuardDecision('unauthenticated') === 'redirect-signin', 'Signed-out visitors are sent to sign-in.');

  assert(buildSignInPath('/predictions') === `/signin?next=${encodeURIComponent('/predictions')}`, 'Intended destination is preserved.');
  assert(buildSignInPath('//evil.example') === '/signin', 'Protocol-relative destinations are rejected.');
  assert(buildSignInPath(null) === '/signin', 'Missing destination falls back to /signin.');
  assert(buildSignInPath('/signin') === '/signin', 'Sign-in does not chain into itself.');

  assert(resolvePostSignInPath('') === '/dashboard', 'Post-sign-in default destination is the dashboard.');
  assert(resolvePostSignInPath('?next=%2Falerts') === '/alerts', 'Preserved destination is honoured after sign-in.');
  assert(resolvePostSignInPath('?next=javascript:alert(1)') === '/dashboard', 'Unsafe destinations are discarded.');
  assert(resolvePostSignInPath('?next=/signin') === '/dashboard', 'Sign-in/signup targets are not looped.');

  assert(isPublicAuthRoute('/') && isPublicAuthRoute('/signin') && isPublicAuthRoute('/reset-password'), 'Auth routes and landing page are public.');
  assert(!isPublicAuthRoute('/predictions'), 'Dashboard routes are private.');
}

// ============================================================================
// 6. API token integration (mocked fetch, no network)
// ============================================================================

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  credentials?: RequestInit['credentials'];
}

function withMockedFetch(
  responder: (request: RecordedRequest, callIndex: number) => { status: number; body: any },
  run: (recorded: RecordedRequest[]) => Promise<void>
) {
  const recorded: RecordedRequest[] = [];
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, options: RequestInit = {}) => {
    const headers = { ...((options.headers as Record<string, string>) || {}) };
    const entry: RecordedRequest = { url: String(url), headers, credentials: options.credentials };
    recorded.push(entry);
    const result = responder(entry, recorded.length - 1);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: 'Mocked',
      json: async () => result.body,
    };
  };
  return run(recorded).finally(() => {
    (globalThis as any).fetch = originalFetch;
  });
}

console.log('\n-- API token attachment --');
{
  const TOKEN = 'user-access-token';
  api.setAuthTokenProvider(() => TOKEN);
  api.setRefreshTokenHandler(async () => null);
  api.setUnauthorizedHandler(() => {});

  await withMockedFetch(
    () => ({ status: 200, body: [] }),
    async (recorded) => {
      await api.getMachines();
      await api.getHealth();
      await api.checkSession();
      await api.getAlerts();

      const machines = recorded.find((r) => r.url.endsWith('/api/machines'))!;
      const health = recorded.find((r) => r.url.endsWith('/api/health'))!;
      const session = recorded.find((r) => r.url.endsWith('/api/auth/session'))!;

      assert(
        machines.headers['Authorization'] === `Bearer ${TOKEN}`,
        'Authenticated user API calls carry the Supabase access token.'
      );
      assert(!('Authorization' in health.headers), 'Public health endpoint receives no user token.');
      assert(!('Authorization' in session.headers), 'Operator session endpoint receives no user token.');
      assert(
        recorded.every((r) => !('X-API-Key' in r.headers)),
        'No device API key is ever sent from browser code.'
      );
    }
  );

  await withMockedFetch(
    () => ({ status: 200, body: { success: true } }),
    async (recorded) => {
      await api.acknowledgeAlert(7);
      const op = recorded.find((r) => r.url.includes('/api/operator/alerts/7/acknowledge'))!;
      assert(op.credentials === 'include', 'Operator writes keep credentials: include (HttpOnly cookie).');
      assert(!('Authorization' in op.headers), 'Operator writes never attach a Supabase JWT.');
    }
  );

  api.setAuthTokenProvider(null);
  api.setRefreshTokenHandler(null);
  api.setUnauthorizedHandler(null);
}

console.log('\n-- 401 refresh-and-retry discipline --');
{
  // Success path: one refresh, one retry, request succeeds.
  let refreshCount = 0;
  let unauthorizedCount = 0;
  api.setAuthTokenProvider(() => 'stale-token');
  api.setRefreshTokenHandler(async () => {
    refreshCount += 1;
    return 'fresh-token';
  });
  api.setUnauthorizedHandler(() => {
    unauthorizedCount += 1;
  });

  await withMockedFetch(
    (_req, callIndex) => (callIndex === 0 ? { status: 401, body: { detail: 'Token expired' } } : { status: 200, body: [] }),
    async (recorded) => {
      const result = await api.getMachines();
      assert(Array.isArray(result), 'Request succeeds after the single refresh-and-retry.');
      assert(refreshCount === 1, 'Exactly one refresh is attempted on 401.');
      assert(recorded.length === 2, 'Exactly two requests: original + one retry.');
      assert(
        recorded[1].headers['Authorization'] === 'Bearer fresh-token',
        'Retry carries the refreshed access token.'
      );
      assert(unauthorizedCount === 0, 'No sign-out when the retry succeeds.');
    }
  );

  // Dead session: retry still 401 -> stop, notify once, never loop.
  refreshCount = 0;
  unauthorizedCount = 0;
  api.setRefreshTokenHandler(async () => {
    refreshCount += 1;
    return 'still-bad-token';
  });

  await withMockedFetch(
    () => ({ status: 401, body: { detail: 'Invalid token' } }),
    async (recorded) => {
      let error: unknown = null;
      try {
        await api.getMachines();
      } catch (err) {
        error = err;
      }
      assert(error instanceof ApiError && error.status === 401, 'Persistent 401 surfaces as ApiError(401).');
      assert(refreshCount === 1, 'Refresh is attempted at most once (no infinite refresh loop).');
      assert(recorded.length === 2, 'At most one retry is issued for a dead session.');
      assert(unauthorizedCount === 1, 'The unauthorized handler fires exactly once.');
    }
  );

  // Refresh yields nothing -> no retry at all.
  refreshCount = 0;
  api.setRefreshTokenHandler(async () => {
    refreshCount += 1;
    return null;
  });

  await withMockedFetch(
    () => ({ status: 401, body: { detail: 'no refresh available' } }),
    async (recorded) => {
      let error: unknown = null;
      try {
        await api.getMachines();
      } catch (err) {
        error = err;
      }
      assert(error instanceof ApiError && error.status === 401, 'Unrefreshable session fails with 401.');
      assert(recorded.length === 1, 'No retry is issued when refresh yields no token.');
    }
  );

  api.setAuthTokenProvider(null);
  api.setRefreshTokenHandler(null);
  api.setUnauthorizedHandler(null);
}

console.log('\n-- 403 / 404 and no-membership classification --');
{
  api.setAuthTokenProvider(() => 'user-token');

  await withMockedFetch(
    () => ({ status: 403, body: { detail: 'Insufficient organization role for this operation.' } }),
    async () => {
      let error: any = null;
      try {
        await api.getMachines();
      } catch (err) {
        error = err;
      }
      assert(error instanceof ApiError && error.status === 403, '403 is preserved with its status (not an auth failure).');
      assert(!isOrganizationAccessError(error), 'A plain role denial is not mistaken for missing membership.');
    }
  );

  await withMockedFetch(
    () => ({ status: 404, body: { detail: "Machine 'M-B' does not exist in registry." } }),
    async () => {
      let error: any = null;
      try {
        await api.getMachineDetails('M-B');
      } catch (err) {
        error = err;
      }
      assert(error instanceof ApiError && error.status === 404, 'Cross-tenant 404 keeps its status and message.');
      assert(!isOrganizationAccessError(error), 'Ordinary 404 is not treated as a membership problem.');
    }
  );

  await withMockedFetch(
    () => ({ status: 403, body: { detail: 'No active organization membership for this user.' } }),
    async () => {
      let error: any = null;
      try {
        await api.getMachines();
      } catch (err) {
        error = err;
      }
      assert(isOrganizationAccessError(error), 'Missing membership is recognised for the pending screen.');
      try {
        await api.getFleetStats();
        assert(false, 'getFleetStats must rethrow membership denials instead of masking them as zeros.');
      } catch (err) {
        assert(isOrganizationAccessError(err), 'getFleetStats rethrows the membership denial (no silent zero data).');
      }
    }
  );

  await withMockedFetch(
    () => ({ status: 404, body: { detail: 'Organization not found or access denied.' } }),
    async () => {
      let error: any = null;
      try {
        await api.getMachines();
      } catch (err) {
        error = err;
      }
      assert(isOrganizationAccessError(error), 'Non-disclosing organization denial maps to the pending screen.');
    }
  );

  assert(
    isOrganizationAccessError(new Error('boom')) === false,
    'Non-HTTP errors are never classified as organization denials.'
  );
  assert(
    !humanizeAuthError({ message: 'Invalid login credentials' }).includes('stack'),
    'Auth error humanization returns clean user-facing copy.'
  );

  api.setAuthTokenProvider(null);
}

// ============================================================================
// Summary
// ============================================================================
console.log('\n================================================================');
console.log(`ALL ${passedCount}/${totalCount} AUTH TESTS PASSED SUCCESSFULLY!`);
console.log('================================================================');
