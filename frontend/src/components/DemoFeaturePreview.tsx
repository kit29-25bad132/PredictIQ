import React from 'react';
import { LockKeyhole, LogIn } from 'lucide-react';

interface DemoFeaturePreviewProps {
  title: string;
  description: string;
  onSignIn: () => void;
}

/** Read-only boundary for authenticated-only product surfaces in public demo mode. */
const DemoFeaturePreview: React.FC<DemoFeaturePreviewProps> = ({ title, description, onSignIn }) => (
  <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
    <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-300">
        <LockKeyhole className="h-7 w-7" />
      </div>
      <p className="mt-5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">Preview access</p>
      <h1 className="mt-2 text-2xl font-bold text-white">{title}</h1>
      <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">{description}</p>
      <button
        onClick={onSignIn}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-400"
      >
        <LogIn className="h-4 w-4" /> Sign in to unlock
      </button>
    </div>
  </section>
);

export default DemoFeaturePreview;
