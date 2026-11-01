/**
 * Predict IQ - Pure route-guard decisions.
 *
 * Frontend route protection is a UX layer only: the backend remains the
 * authoritative authorization boundary (Phase 3). These helpers exist so the
 * guard's behaviour (no dashboard flash, preserved return path) can be unit
 * tested without a DOM.
 */

import type { AuthStatus } from './authSession';

export type GuardDecision = 'loading' | 'redirect-signin' | 'render';

/** What a protected route should do for a given auth status. */
export function getAuthGuardDecision(status: AuthStatus): GuardDecision {
  if (status === 'loading') return 'loading';
  if (status === 'authenticated') return 'render';
  return 'redirect-signin';
}

/** Private routes are never rendered before the session is restored. */
export function shouldRenderPrivateContent(status: AuthStatus): boolean {
  return getAuthGuardDecision(status) === 'render';
}

/** Sign-in destination that preserves where the user was trying to go. */
export function buildSignInPath(destination: string | undefined | null): string {
  const path = (destination || '').trim();
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    return '/signin';
  }
  if (path === '/signin' || path.startsWith('/signin?')) {
    return '/signin';
  }
  return `/signin?next=${encodeURIComponent(path)}`;
}

/** Where to land after a successful sign-in (defaults to the dashboard). */
export function resolvePostSignInPath(search: string | undefined | null): string {
  if (!search) return '/dashboard';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const next = params.get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  if (next.startsWith('/signin') || next.startsWith('/signup')) return '/dashboard';
  return next;
}

/** Sign-in / sign-up routes themselves stay public. */
export function isPublicAuthRoute(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return (
    path === '/' ||
    path === '/signin' ||
    path === '/signup' ||
    path === '/forgot-password' ||
    path === '/reset-password' ||
    path === '/auth/callback' ||
    path === '/callback'
  );
}
