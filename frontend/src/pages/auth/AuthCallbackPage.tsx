/**
 * Predict IQ - OAuth / PKCE callback page.
 *
 * Restores the session after Google redirects back (?code=...), shows a real
 * error state when the exchange fails, and only then continues to the
 * workbench. Never fakes a successful sign-in.
 */

import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AuthCard, AuthFieldError } from '../../components/auth/AuthCard';

interface AuthCallbackPageProps {
  onNavigatePath: (path: string) => void;
  onSuccess: () => void;
}

export const AuthCallbackPage: React.FC<AuthCallbackPageProps> = ({ onNavigatePath, onSuccess }) => {
  const { status, exchangeCode } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error_description') || params.get('error');
    const code = params.get('code');

    if (oauthError) {
      attempted.current = true;
      setError(oauthError);
      return;
    }

    if (code) {
      attempted.current = true;
      exchangeCode(code).then((result) => {
        if (!result.ok) setError(result.error || 'Could not complete sign-in.');
      });
      return;
    }

    // Implicit/hash flow: detectSessionInUrl may already have restored the
    // session; give it one tick before declaring failure.
    if (status === 'authenticated') {
      attempted.current = true;
      onSuccess();
    }
  }, [status, exchangeCode, onSuccess]);

  useEffect(() => {
    if (status === 'authenticated' && !error) {
      onSuccess();
    }
  }, [status, error, onSuccess]);

  if (error) {
    return (
      <AuthCard
        title="Sign-in callback failed"
        subtitle="Google could not complete the sign-in."
        footer={
          <button
            id="btn-goto-signin-from-callback"
            onClick={() => onNavigatePath('/signin')}
            className="font-semibold text-cyan-400 hover:text-cyan-300"
          >
            Back to sign in
          </button>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/10">
            <ShieldAlert className="h-7 w-7 text-rose-400" />
          </div>
          <AuthFieldError message={error} />
          <p className="text-[11px] leading-relaxed text-slate-500">
            If this keeps happening, verify that this origin is listed in the Supabase redirect URL
            allow-list and that Google OAuth is configured for the project.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Completing sign-in" subtitle="Restoring your secure session…">
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-500/10">
          <CheckCircle2 className="h-7 w-7 animate-pulse text-cyan-400" />
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <span>Verifying credentials…</span>
        </div>
      </div>
    </AuthCard>
  );
};

export default AuthCallbackPage;
