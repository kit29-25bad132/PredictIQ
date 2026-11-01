/**
 * Predict IQ - Reset-password page (Supabase recovery session).
 *
 * Handles the recovery link: invalid/expired links show a clear error, a valid
 * recovery session unlocks the new-password form, and success returns the user
 * to the workbench. Waiting for session restoration is explicit so nothing
 * private renders early.
 */

import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AuthCard, AuthFieldError, AuthSuccessNotice, PasswordInput } from '../../components/auth/AuthCard';

interface ResetPasswordPageProps {
  onNavigatePath: (path: string) => void;
  onSuccess: () => void;
}

function readRecoveryError(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('error_code') || params.get('error');
  const description = params.get('error_description');
  if (!code && !description) return null;
  if ((code || '').includes('otp_expired') || (description || '').toLowerCase().includes('expired')) {
    return 'This password reset link has expired. Request a new one.';
  }
  if ((code || '').includes('access_denied') || (description || '').toLowerCase().includes('bad')) {
    return 'This password reset link is invalid or has already been used. Request a new one.';
  }
  return 'The password reset link could not be used. Request a new one.';
}

export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({ onNavigatePath, onSuccess }) => {
  const { status, updatePassword, configError } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(readRecoveryError() ?? configError ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // A recovery link invalidates itself: surface that instead of a blank form.
  useEffect(() => {
    const urlError = readRecoveryError();
    if (urlError && status === 'unauthenticated') {
      setError(urlError);
    }
  }, [status]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || 'Password update failed. The link may have expired.');
      return;
    }
    setDone(true);
    window.setTimeout(() => onSuccess(), 1500);
  };

  if (readRecoveryError() && status === 'unauthenticated') {
    return (
      <AuthCard
        title="Reset link problem"
        subtitle="This recovery link can no longer be used."
        footer={
          <button
            id="btn-goto-forgot-from-reset"
            onClick={() => onNavigatePath('/forgot-password')}
            className="font-semibold text-cyan-400 hover:text-cyan-300"
          >
            Request a new link
          </button>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/10">
            <ShieldAlert className="h-7 w-7 text-rose-400" />
          </div>
          <p className="text-sm text-slate-300">{error}</p>
        </div>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password updated" subtitle="Signing you in with your new password…">
        <AuthSuccessNotice
          title="All set"
          message="Your password has been changed. Redirecting you to the workbench…"
        />
      </AuthCard>
    );
  }

  if (status === 'loading') {
    return (
      <AuthCard title="Preparing reset…" subtitle="Validating your recovery link.">
        <div className="flex items-center justify-center gap-3 py-6 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <span>Checking your session…</span>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="Your recovery session is valid. Set a new password to continue."
      footer={
        <button
          id="btn-goto-signin-from-reset"
          onClick={() => onNavigatePath('/signin')}
          className="font-semibold text-cyan-400 hover:text-cyan-300"
        >
          Back to sign in
        </button>
      }
    >
      <AuthFieldError message={error} />

      {status !== 'authenticated' && !error && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-semibold text-amber-300">
          No valid recovery session found. Open the link from your reset email again.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="reset-password" className="mb-1.5 block text-xs font-semibold text-slate-300">
            New password
          </label>
          <PasswordInput
            id="reset-password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            disabled={submitting || status !== 'authenticated'}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label htmlFor="reset-confirm" className="mb-1.5 block text-xs font-semibold text-slate-300">
            Confirm new password
          </label>
          <PasswordInput
            id="reset-confirm"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Repeat the new password"
            disabled={submitting || status !== 'authenticated'}
            autoComplete="new-password"
          />
        </div>

        <button
          id="btn-reset-submit"
          type="submit"
          disabled={submitting || status !== 'authenticated'}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          <span>{submitting ? 'Updating…' : 'Update password'}</span>
        </button>
      </form>
    </AuthCard>
  );
};

export default ResetPasswordPage;
