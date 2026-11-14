import React from 'react';
import { FlaskConical, Lock, LogIn, ArrowLeft, Info } from 'lucide-react';
import type { DemoDatasetInfo } from '../services/demoApi';

interface DemoModeBannerProps {
  dataset: DemoDatasetInfo | null;
  onSignIn: () => void;
  onExit: () => void;
}

/**
 * Persistent, non-dismissible demo identity strip.
 *
 * Requirement: the demo must always look like the product while being
 * unmistakably labelled as demo. This banner is rendered on every demo section
 * (it sits above the scrolling page content), names the simulated dataset, and
 * carries the conversion action.
 */
export const DemoModeBanner: React.FC<DemoModeBannerProps> = ({
  dataset,
  onSignIn,
  onExit,
}) => {
  return (
    <div
      id="demo-mode-banner"
      role="status"
      aria-live="polite"
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 sm:px-6"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-2.5">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div className="text-[11px] leading-relaxed sm:text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-200 border border-amber-500/40">
                Demo mode
              </span>
              <span className="font-semibold text-amber-100">
                {dataset?.label || 'Public Demo Fleet (simulated dataset)'}
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-slate-900/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300 border border-slate-700">
                <Lock className="h-2.5 w-2.5" /> Read-only
              </span>
            </div>
            <p className="mt-1 text-amber-100/80">
              <Info className="mr-1 inline h-3 w-3 align-text-bottom" />
              {dataset?.notice ||
                'This dashboard shows a simulated demo dataset stored in PostgreSQL. It is not live machine telemetry, and no record can be created, changed, acknowledged, or deleted.'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end lg:self-auto">
          <button
            id="btn-demo-exit"
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-slate-500 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to site</span>
          </button>
          <button
            id="btn-demo-signin"
            onClick={onSignIn}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-cyan-400 transition-colors shadow-sm shadow-cyan-500/20"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Sign in to your workspace</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DemoModeBanner;
