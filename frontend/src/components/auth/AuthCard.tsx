/**
 * Predict IQ - Shared authentication page shell.
 * Keeps the existing slate/cyan PredictIQ visual identity across auth pages.
 */

import React from 'react';
import { Radio } from 'lucide-react';

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const AuthCard: React.FC<AuthCardProps> = ({ title, subtitle, children, footer }) => (
  <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10 text-slate-100">
    <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-gradient-to-tr from-cyan-500/10 via-blue-600/10 to-purple-600/10 blur-3xl" />

    <div className="relative w-full max-w-md">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
          <Radio className="h-6 w-6 text-slate-950" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-black tracking-wider text-white">PREDICT</span>
          <span className="rounded border border-cyan-500/30 bg-cyan-500/20 px-1.5 py-0.5 text-xs font-bold text-cyan-400">
            IQ
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
        <p className="mt-1.5 text-sm text-slate-400">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>

      {footer && <div className="mt-5 text-center text-xs text-slate-400">{footer}</div>}

      <div className="mt-6 text-center">
        <a href="/" className="font-mono text-[11px] text-slate-500 hover:text-cyan-400 transition-colors">
          &larr; Predict IQ landing page
        </a>
      </div>
    </div>
  </div>
);

export const AuthFieldError: React.FC<{ message: string | null | undefined }> = ({ message }) => {
  if (!message) return null;
  return (
    <div
      id="auth-error"
      role="alert"
      className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-300"
    >
      {message}
    </div>
  );
};

export const AuthSuccessNotice: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4">
    <h2 className="text-sm font-bold text-emerald-300">{title}</h2>
    <p className="mt-1 text-xs text-emerald-200/80">{message}</p>
  </div>
);

export const GoogleButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({
  onClick,
  disabled,
}) => (
  <button
    id="btn-google-signin"
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-700 bg-slate-950/60 px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-cyan-500/40 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
    <span>Continue with Google</span>
  </button>
);

export const PasswordInput: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
}> = ({ id, value, onChange, placeholder, disabled, autoComplete }) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        className="w-full rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 pr-12 text-sm text-slate-100 placeholder-slate-500 transition-colors focus:border-cyan-500 focus:outline-none disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-slate-400 hover:text-cyan-400"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? 'HIDE' : 'SHOW'}
      </button>
    </div>
  );
};
