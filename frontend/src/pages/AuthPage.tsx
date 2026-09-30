import React, { useState, FormEvent } from 'react';
import {
  Radio,
  Lock,
  Mail,
  User,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthPageProps {
  initialMode?: 'signin' | 'signup';
  onSuccess: () => void;
  onBackToHome: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  initialMode = 'signin',
  onSuccess,
  onBackToHome,
}) => {
  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    sendPasswordReset,
    authError,
    setAuthError,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(initialMode);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const handleModeChange = (newMode: 'signin' | 'signup' | 'forgot') => {
    setAuthError(null);
    setResetSuccessMessage(null);
    setMode(newMode);
  };

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setLoading(true);
    setAuthError(null);

    try {
      await signInWithEmail(email, password);
      onSuccess();
    } catch (err: any) {
      // Error is set in AuthContext
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setAuthError('Passwords do not match. Please verify.');
      return;
    }

    setLoading(true);
    setAuthError(null);

    try {
      await signUpWithEmail(email, password, fullName);
      onSuccess();
    } catch (err: any) {
      // Error is set in AuthContext
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setGoogleLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
      onSuccess();
    } catch (err: any) {
      // Error is set in AuthContext
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setAuthError('Please enter your account email address.');
      return;
    }

    setLoading(true);
    setAuthError(null);
    setResetSuccessMessage(null);

    try {
      await sendPasswordReset(email);
      setResetSuccessMessage('Password reset instructions have been sent to your email.');
    } catch (err: any) {
      // Error handled by AuthContext
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-8 relative">
      {/* Background glow effects */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[450px] w-[600px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-cyan-500/10 via-blue-600/10 to-transparent blur-3xl" />

      {/* Back to Home Button */}
      <div className="mb-6 w-full max-w-md flex items-center justify-between">
        <button
          onClick={onBackToHome}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-cyan-400 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Home</span>
        </button>

        <span className="font-mono text-[11px] text-slate-500">
          Predict IQ Auth Portal
        </span>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        {/* Branding & Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20 mb-3">
            <Radio className="h-6 w-6 text-slate-950" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-wider text-white">
            PREDICT<span className="text-cyan-400">IQ</span>
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {mode === 'signin' && 'Sign in to access industrial telemetry & condition intelligence'}
            {mode === 'signup' && 'Create your industrial operator account'}
            {mode === 'forgot' && 'Reset your operator account password'}
          </p>
        </div>

        {/* Tab Switcher (between Sign In and Sign Up) */}
        {mode !== 'forgot' && (
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-950 p-1 border border-slate-800">
            <button
              type="button"
              id="tab-btn-signin"
              onClick={() => handleModeChange('signin')}
              className={`rounded-lg py-2 text-xs font-bold transition-all ${
                mode === 'signin'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              id="tab-btn-signup"
              onClick={() => handleModeChange('signup')}
              className={`rounded-lg py-2 text-xs font-bold transition-all ${
                mode === 'signup'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/10'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign Up
            </button>
          </div>
        )}

        {/* Error Notification Alert */}
        {authError && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
            <span className="leading-relaxed">{authError}</span>
          </div>
        )}

        {/* Password Reset Success Alert */}
        {resetSuccessMessage && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
            <span className="leading-relaxed">{resetSuccessMessage}</span>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SIGN IN FORM                                                              */}
        {/* ========================================================================= */}
        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label htmlFor="signin-email" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="signin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@plant.com"
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="signin-password" className="block text-xs font-semibold text-slate-300">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => handleModeChange('forgot')}
                  className="text-[11px] font-medium text-cyan-400 hover:text-cyan-300"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="btn-submit-signin"
              disabled={loading || !email.trim() || !password}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-cyan-500/20"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* SIGN UP FORM                                                              */}
        {/* ========================================================================= */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-3.5">
            <div>
              <label htmlFor="signup-name" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="signup-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Sri"
                  required
                  autoComplete="name"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                />
              </div>
            </div>

            <div>
              <label htmlFor="signup-email" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@plant.com"
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                />
              </div>
            </div>

            <div>
              <label htmlFor="signup-password" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password (min. 6 characters)
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="signup-confirm-password" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="signup-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              id="btn-submit-signup"
              disabled={loading || !email.trim() || !password || !fullName.trim()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-cyan-500/20"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <>
                  <span>Create Operator Account</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* FORGOT PASSWORD FORM                                                      */}
        {/* ========================================================================= */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Account Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@plant.com"
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-2.5 text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-cyan-500/20"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Sending Reset Link...</span>
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  <span>Send Password Reset Email</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleModeChange('signin')}
              className="w-full text-center text-xs font-semibold text-cyan-400 hover:text-cyan-300 mt-2"
            >
              &larr; Back to Sign In
            </button>
          </form>
        )}

        {/* ========================================================================= */}
        {/* GOOGLE SIGN IN                                                            */}
        {/* ========================================================================= */}
        {mode !== 'forgot' && (
          <div className="mt-6">
            <div className="my-5 flex items-center gap-3">
              <div className="flex-1 border-t border-slate-800" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                Or continue with
              </span>
              <div className="flex-1 border-t border-slate-800" />
            </div>

            <button
              type="button"
              id="btn-google-auth"
              onClick={handleGoogleAuth}
              disabled={googleLoading || loading}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-xs font-semibold text-white transition-all hover:bg-slate-800 hover:border-slate-600 disabled:opacity-50"
            >
              {googleLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span>Google Account</span>
            </button>
          </div>
        )}

        <div className="mt-6 border-t border-slate-800/80 pt-4 text-center">
          <p className="text-[11px] text-slate-500">
            Protected by Firebase Authentication &middot; Enterprise Security
          </p>
        </div>
      </div>
    </div>
  );
};
export default AuthPage;
