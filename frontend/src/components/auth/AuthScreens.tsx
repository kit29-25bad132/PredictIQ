/**
 * Predict IQ - Shared authentication screens.
 *
 * - AuthLoadingScreen: shown while the restored session is still unknown, so
 *   private dashboard content never flashes before authentication resolves.
 * - AuthConfigErrorScreen: explicit configuration failure instead of silently
 *   falling back to mock authentication.
 * - OrganizationPendingScreen: signed in, but with no organization membership
 *   yet (Phase 5 will add onboarding). Never a login failure, never a loop.
 */

import React from 'react';
import { Building2, LogOut, Radio, ShieldAlert, TriangleAlert } from 'lucide-react';

export const AuthLoadingScreen: React.FC<{ label?: string }> = ({
  label = 'Restoring secure session…',
}) => (
  <div
    id="auth-loading"
    className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-4 text-slate-100"
  >
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
      <Radio className="h-7 w-7 text-slate-950" />
    </div>
    <div className="flex items-center gap-3 text-sm text-slate-300">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      <span>{label}</span>
    </div>
    <p className="font-mono text-[11px] text-slate-500">PREDICT IQ · SECURE WORKBENCH</p>
  </div>
);

export const AuthConfigErrorScreen: React.FC<{ message: string }> = ({ message }) => (
  <div
    id="auth-config-error"
    className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-950 px-4 text-slate-100"
  >
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/10">
      <ShieldAlert className="h-7 w-7 text-rose-400" />
    </div>
    <div className="max-w-md text-center">
      <h1 className="text-lg font-bold text-white">Authentication is not configured</h1>
      <p className="mt-2 text-sm text-slate-400">{message}</p>
    </div>
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 font-mono text-[11px] text-slate-400">
      VITE_SUPABASE_URL
      <br />
      VITE_SUPABASE_ANON_KEY
    </div>
    <a
      href="/"
      className="rounded-xl bg-cyan-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-colors"
    >
      Back to landing page
    </a>
  </div>
);

export const OrganizationPendingScreen: React.FC<{ userEmail: string | null; onSignOut: () => void }> = ({
  userEmail,
  onSignOut,
}) => (
  <div
    id="organization-pending"
    className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-950 px-4 text-slate-100"
  >
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-500/10">
      <Building2 className="h-7 w-7 text-cyan-400" />
    </div>
    <div className="max-w-lg text-center">
      <h1 className="text-lg font-bold text-white">Your organization is being set up</h1>
      <p className="mt-2 text-sm text-slate-400">
        You are signed in{userEmail ? ` as ${userEmail}` : ''}, but this account does not belong to an
        organization yet. Organization setup will be available shortly — your session stays active and
        no data has been assigned to a default organization.
      </p>
    </div>
    <div className="flex items-center gap-3">
      <a
        href="/"
        className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-2.5 text-xs font-semibold text-slate-200 hover:border-cyan-500/40 transition-colors"
      >
        Back to landing page
      </a>
      <button
        id="btn-pending-signout"
        onClick={onSignOut}
        className="flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </div>
    <p className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
      <TriangleAlert className="h-3.5 w-3.5 text-amber-400" />
      No organization membership · access is not granted
    </p>
  </div>
);
