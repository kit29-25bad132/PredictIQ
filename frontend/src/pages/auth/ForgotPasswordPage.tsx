/**
 * Predict IQ - Forgot-password page.
 *
 * Enumeration-safe: the confirmation shown after submission is identical
 * whether or not the address exists.
 */

import React, { useState } from 'react';
import { KeyRound, Mail, Send } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AuthCard, AuthFieldError, AuthSuccessNotice } from '../../components/auth/AuthCard';

interface ForgotPasswordPageProps {
  onNavigatePath: (path: string) => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ onNavigatePath }) => {
  const { requestPasswordReset, configError } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(configError ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }

    setSubmitting(true);
    const result = await requestPasswordReset(trimmed);
    setSubmitting(false);

    if (!result.ok) {
      // Infrastructure failures only (never address-specific answers).
      setError(result.error || 'The reset request could not be sent.');
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle="Password reset instructions are on the way."
        footer={
          <button
            id="btn-goto-signin-from-forgot"
            onClick={() => onNavigatePath('/signin')}
            className="font-semibold text-cyan-400 hover:text-cyan-300"
          >
            Back to sign in
          </button>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10">
            <Mail className="h-7 w-7 text-emerald-400" />
          </div>
          <AuthSuccessNotice
            title="Reset email sent"
            message="If an account exists for that address, a password reset link has been sent. The link expires after a short time."
          />
          <p className="text-[11px] leading-relaxed text-slate-500">
            For your security we do not confirm whether an account exists. Didn&rsquo;t receive it? Check
            your spam folder and try again in a few minutes.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a secure link to choose a new password."
      footer={
        <button
          id="btn-goto-signin-from-forgot"
          onClick={() => onNavigatePath('/signin')}
          className="font-semibold text-cyan-400 hover:text-cyan-300"
        >
          Back to sign in
        </button>
      }
    >
      <AuthFieldError message={error} />

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="forgot-email" className="mb-1.5 block text-xs font-semibold text-slate-300">
            Email address
          </label>
          <input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            disabled={submitting}
            autoComplete="email"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 transition-colors focus:border-cyan-500 focus:outline-none disabled:opacity-60"
          />
        </div>

        <button
          id="btn-forgot-submit"
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          <span>{submitting ? 'Sending…' : 'Send reset link'}</span>
        </button>
      </form>

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
        <span>Reset links are single-use and time-limited. We never reveal whether an email is registered.</span>
      </p>
    </AuthCard>
  );
};

export default ForgotPasswordPage;
