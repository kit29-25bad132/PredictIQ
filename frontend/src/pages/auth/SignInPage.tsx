/**
 * Predict IQ - Sign-in page (email/password + Google OAuth).
 */

import React, { useState } from 'react';
import { LogIn, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AuthCard, AuthFieldError, GoogleButton, PasswordInput } from '../../components/auth/AuthCard';

interface SignInPageProps {
  onNavigatePath: (path: string) => void;
  /** Called after a successful sign-in (App resolves the preserved destination). */
  onSuccess: () => void;
}

export const SignInPage: React.FC<SignInPageProps> = ({ onNavigatePath, onSuccess }) => {
  const { signIn, signInWithGoogle, configError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(configError ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || 'Sign-in failed.');
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
      setError(result.error || 'Google sign-in could not be started.');
    }
    // On success the browser is redirected to Supabase; state stays pending.
  };

  return (
    <AuthCard
      title="Sign in to Predict IQ"
      subtitle="Access your organization's fleet workbench."
      footer={
        <span>
          New to Predict IQ?{' '}
          <button
            id="btn-goto-signup"
            onClick={() => onNavigatePath('/signup')}
            className="font-semibold text-cyan-400 hover:text-cyan-300"
          >
            Create an account
          </button>
        </span>
      }
    >
      <AuthFieldError message={error} />

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="signin-email" className="mb-1.5 block text-xs font-semibold text-slate-300">
            Email address
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={submitting}
              autoComplete="email"
              className="w-full rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 pl-10 text-sm text-slate-100 placeholder-slate-500 transition-colors focus:border-cyan-500 focus:outline-none disabled:opacity-60"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="signin-password" className="text-xs font-semibold text-slate-300">
              Password
            </label>
            <button
              id="btn-goto-forgot"
              type="button"
              onClick={() => onNavigatePath('/forgot-password')}
              className="text-[11px] font-semibold text-slate-400 hover:text-cyan-400"
            >
              Forgot password?
            </button>
          </div>
          <PasswordInput
            id="signin-password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            disabled={submitting}
            autoComplete="current-password"
          />
        </div>

        <button
          id="btn-signin-submit"
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          <span>{submitting ? 'Signing in…' : 'Sign in'}</span>
        </button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-800" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">or</span>
        <span className="h-px flex-1 bg-slate-800" />
      </div>

      <GoogleButton onClick={handleGoogle} disabled={googleSubmitting || submitting} />

      <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <span>
          Sessions are managed by Supabase. Device and operator credentials are never accepted here, and
          the backend independently verifies every request.
        </span>
      </p>
    </AuthCard>
  );
};

export default SignInPage;
