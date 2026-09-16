import React from 'react';
import { Radio, RefreshCw, Bell, Plus, Database, CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../services/api';

interface HeaderProps {
  activeTab: string;
  autoRefresh: boolean;
  onToggleAutoRefresh: (val: boolean) => void;
  activeAlertsCount: number;
  onOpenManualModal: () => void;
  onNavigateToAlerts: () => void;
  backendOnline: boolean;
  onRetryBackend: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  autoRefresh,
  onToggleAutoRefresh,
  activeAlertsCount,
  onOpenManualModal,
  onNavigateToAlerts,
  backendOnline,
  onRetryBackend,
}) => {
  const getPageTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Industrial Fleet Overview';
      case 'machines':
        return 'Asset Directory & Condition Index';
      case 'machine-details':
        return 'Machine Diagnostic Workbench';
      case 'monitoring':
        return 'Live Sensor Telemetry Stream';
      case 'predictions':
        return 'AI Model Readiness & Diagnostics';
      case 'maintenance':
        return 'Ground-Truth Maintenance Records';
      case 'alerts':
        return 'Anomaly Alerts & Incident Log';
      case 'sensor-data':
        return 'Sensor Ingestion & PostgreSQL Studio';
      case 'settings':
        return 'FastAPI & PostgreSQL Architecture';
      default:
        return 'Predict IQ Dashboard';
    }
  };

  return (
    <header
      id="predictiq-header"
      className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-4 sm:px-6 backdrop-blur-md"
    >
      {/* Left: Current Page Title & Breadcrumb */}
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
            {getPageTitle()}
          </h1>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono text-cyan-400">PREDICT IQ</span>
            <span>/</span>
            <span className="capitalize">{activeTab.replace('-', ' ')}</span>
          </div>
        </div>
      </div>

      {/* Right: Controls & Indicators */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* PostgreSQL / FastAPI Backend Status Indicator */}
        <div className="flex items-center">
          {backendOnline ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="hidden sm:inline">PostgreSQL + FastAPI Online</span>
              <span className="sm:hidden">Online</span>
            </div>
          ) : (
            <button
              onClick={onRetryBackend}
              title="Click to retry FastAPI backend connection"
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-all"
            >
              <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
              <span>Backend Offline (Retry)</span>
            </button>
          )}
        </div>

        {/* Live Auto-Refresh Controller */}
        <button
          id="btn-toggle-autorefresh"
          onClick={() => onToggleAutoRefresh(!autoRefresh)}
          title={autoRefresh ? 'Live Polling Active (4s)' : 'Polling Paused'}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
            autoRefresh
              ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? 'animate-spin text-cyan-400' : ''}`} />
          <span className="hidden lg:inline">{autoRefresh ? 'SYNC (4s)' : 'PAUSED'}</span>
        </button>

        {/* Quick Sensor Injection CTA */}
        <button
          id="btn-header-inject"
          onClick={onOpenManualModal}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
        >
          <Plus className="h-3.5 w-3.5 stroke-[3]" />
          <span className="hidden sm:inline">Manual Input</span>
          <span className="sm:hidden">Input</span>
        </button>

        {/* Alerts Bell Notification */}
        <button
          id="btn-header-alerts"
          onClick={onNavigateToAlerts}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <Bell className="h-4 w-4" />
          {activeAlertsCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold text-white animate-pulse">
              {activeAlertsCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
export default Header;
