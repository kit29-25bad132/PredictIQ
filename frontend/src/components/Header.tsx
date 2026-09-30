import React, { useState } from 'react';
import {
  Radio,
  RefreshCw,
  Bell,
  Plus,
  Database,
  CheckCircle2,
  AlertCircle,
  User,
  LogOut,
  ChevronDown,
  Globe,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  activeTab: string;
  autoRefresh: boolean;
  onToggleAutoRefresh: (val: boolean) => void;
  activeAlertsCount: number;
  onOpenManualModal: () => void;
  onNavigateToAlerts: () => void;
  backendOnline: boolean;
  onRetryBackend: () => void;
  onNavigateHome?: () => void;
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
  onNavigateHome,
}) => {
  const { user, userName, initials, photoURL, logout } = useAuth();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

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
      case 'feedback':
        return 'Ground-Truth Technician Feedback';
      case 'sensor-data':
        return 'Sensor Ingestion & PostgreSQL Studio';
      case 'settings':
        return 'System Status';
      default:
        return 'Predict IQ Dashboard';
    }
  };

  return (
    <header
      id="predictiq-header"
      className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-800/80 bg-slate-950/85 px-4 sm:px-6 backdrop-blur-md"
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

      {/* Right: Controls, Status & User Profile Menu */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* PostgreSQL / FastAPI Backend Status Indicator */}
        <div className="flex items-center">
          {backendOnline ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="hidden md:inline">PostgreSQL + FastAPI Online</span>
              <span className="md:hidden">Online</span>
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

        {/* User Profile Dropdown Menu */}
        <div className="relative">
          <button
            id="btn-user-profile-menu"
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 py-1 pl-1.5 pr-2.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:bg-slate-800 transition-all"
          >
            {photoURL ? (
              <img
                src={photoURL}
                alt={userName}
                className="h-7 w-7 rounded-lg object-cover border border-cyan-500/30"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs">
                {initials}
              </div>
            )}
            <span className="hidden md:inline font-semibold text-slate-200 max-w-[100px] truncate">
              {userName}
            </span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </button>

          {/* Profile Menu Dropdown */}
          {isProfileMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsProfileMenuOpen(false)}
              />
              <div className="absolute right-0 mt-2 z-50 w-56 rounded-2xl border border-slate-800 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-xl">
                <div className="border-b border-slate-800 px-3 py-2.5">
                  <div className="font-bold text-xs text-white truncate">{userName}</div>
                  <div className="text-[11px] text-slate-400 font-mono truncate">{user?.email}</div>
                  <div className="mt-1 inline-block rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                    Operator Account
                  </div>
                </div>

                <div className="py-1">
                  {onNavigateHome && (
                    <button
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        onNavigateHome();
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                    >
                      <Globe className="h-4 w-4 text-cyan-400" />
                      <span>Public Home Page</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setIsProfileMenuOpen(false);
                      logout();
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 transition-colors"
                  >
                    <LogOut className="h-4 w-4 text-rose-400" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
export default Header;
