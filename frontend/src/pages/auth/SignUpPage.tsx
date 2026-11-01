/**
 * Predict IQ - Sign-up page with email-verification pending state.
 */

import React, { useState } from 'react';
import { CheckCircle2, MailCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AuthCard, AuthFieldError, AuthSuccessNotice, GoogleButton, PasswordInput } from '../../components/auth/AuthCard';

interface SignUpPageProps {
  onNavigatePath: (path: string) => void;
  onSuccess: () => void;
}

const MIN_PASSWORD_LENGTH = 8;

export const SignUpPage: React.FC<SignUpPageProps> = ({ onNavigatePath, onSuccess }) => {
  const { signUp, signInWithGoogle, configError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(configError ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const validate = (): string | null => {
    const trimmed = email.trim();
    if (!trimmed) return 'Enter your email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Enter a valid email address.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirmPassword) return 'Passwords do not match.';
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    const result = await signUp(email.trim(), password);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || 'Account creation failed.');
      return;
    }
    if (result.needsEmailVerification) {
      setVerificationSent(true);
      return;
    }
    onSuccess();
  };

  const handleGoogle = async () => {
    if (googleSubmitting) return;
    setError(null);
    setGoogleSubmitting(true);
    const result = await signInWithGoogle();
    if (!result.ok) {
      setGoogleSubmitting(false);
      setError(result.error || 'Google sign-up could not be started.');
    }
  };

  if (verificationSent) {
    return (
      <AuthCard
        title="Confirm your email"
        subtitle="One more step before your account is ready."
        footer={
          <button
            id="btn-goto-signin-from-verify"
            onClick={() => onNavigatePath('/signin')}
            className="font-semibold text-cyan-400 hover:text-cyan-300"
          >
            Back to sign in
          </button>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/40 bg-emerald-500/10">
            <MailCheck className="h-7 w-7 text-emerald-400" />
          </div>
          <AuthSuccessNotice
            title="Verification email sent"
            message={`We sent a confirmation link to ${email.trim()}. Open it to activate your account, then sign in.`}
          />
          <p className="text-[11px] leading-relaxed text-slate-500">
            The link expires and can only be used once. Check your spam folder, or request a new link from
            the sign-in screen if it has expired.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Register with your work email to access Predict IQ."
      footer={
        <span>
          Already have an account?{' '}
          <button
            id="btn-goto-signin"
            onClick={() => onNavigatePath('/signin')}
            className="font-semibold text-cyan-400 hover:text-cyan-300"
          >
            Sign in
          </button>
        </span>
      }
    >
      <AuthFieldError message={error} />

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="signup-email" className="mb-1.5 block text-xs font-semibold text-slate-300">
            Email address
          </label>
          <input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            disabled={submitting}
            autoComplete="email"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 transition-colors focus:border-cyan-500 focus:outline-none disabled:opacity-60"
          />
        </div>

        <div>
          <label htmlFor="signup-password" className="mb-1.5 block text-xs font-semibold text-slate-300">
            Password
          </label>
          <PasswordInput
            id="signup-password"
            value={password}
            onChange={setPassword}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label htmlFor="signup-confirm" className="mb-1.5 block text-xs font-semibold text-slate-300">
            Confirm password
          </label>
          <PasswordInput
            id="signup-confirm"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Repeat your password"
            disabled={submitting}
            autoComplete="new-password"
          />
        </div>

        <button
          id="btn-signup-submit"
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          <span>{submitting ? 'Creating account…' : 'Create account'}</span>
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-800" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">or</span>
        <span className="h-px flex-1 bg-slate-800" />
      </div>

      <GoogleButton onClick={handleGoogle} disabled={googleSubmitting || submitting} />

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <span>
          Email verification is required. New accounts start with no organization membership until setup
          is completed — existing organizations are never joined automatically.
        </span>
      </p>
    </AuthCard>
  );
};

export default SignUpPage;
