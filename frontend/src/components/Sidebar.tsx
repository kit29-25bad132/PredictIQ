import React from 'react';
import {
  LayoutDashboard,
  Box,
  Cpu,
  LineChart,
  Activity,
  BrainCircuit,
  Wrench,
  AlertTriangle,
  Database,
  Settings,
  Radio,
  ShieldCheck,
  ClipboardCheck,
  LogOut,
  Globe,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type NavTab = 
  | 'dashboard'
  | '3d-view'
  | 'machines'
  | 'machine-details'
  | 'monitoring'
  | 'predictions'
  | 'maintenance'
  | 'alerts'
  | 'feedback'
  | 'sensor-data'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeAlertsCount: number;
  criticalMachinesCount: number;
  backendOnline: boolean;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
  onNavigateHome?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  activeAlertsCount,
  criticalMachinesCount,
  backendOnline,
  isMobileOpen,
  onCloseMobile,
  onLogout,
  onNavigateHome,
}) => {
  const { user, userName, initials, photoURL } = useAuth();

  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: '3d-view' as NavTab,
      label: '3D Machine View',
      icon: Box,
      badge: '3D',
      badgeColor: 'purple',
    },
    {
      id: 'machines' as NavTab,
      label: 'Machines',
      icon: Cpu,
      badge: criticalMachinesCount > 0 ? `${criticalMachinesCount} crit` : null,
      badgeColor: 'rose',
    },
    {
      id: 'machine-details' as NavTab,
      label: 'Machine Details',
      icon: LineChart,
      badge: null,
    },
    {
      id: 'monitoring' as NavTab,
      label: 'Live Monitoring',
      icon: Activity,
      badge: 'LIVE',
      badgeColor: 'cyan',
    },
    {
      id: 'predictions' as NavTab,
      label: 'Predictions & AI',
      icon: BrainCircuit,
      badge: 'XAI',
      badgeColor: 'purple',
    },
    {
      id: 'maintenance' as NavTab,
      label: 'Maintenance',
      icon: Wrench,
      badge: null,
    },
    {
      id: 'alerts' as NavTab,
      label: 'Alerts',
      icon: AlertTriangle,
      badge: activeAlertsCount > 0 ? `${activeAlertsCount}` : null,
      badgeColor: 'rose',
    },
    {
      id: 'feedback' as NavTab,
      label: 'Feedback & Ground Truth',
      icon: ClipboardCheck,
      badge: null,
    },
    {
      id: 'sensor-data' as NavTab,
      label: 'Sensor Data',
      icon: Database,
      badge: null,
    },
    {
      id: 'settings' as NavTab,
      label: 'System Status',
      icon: Settings,
      badge: null,
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          id="sidebar-mobile-backdrop"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside
        id="predictiq-sidebar"
        className={`fixed top-0 bottom-0 left-0 z-40 flex w-64 flex-col border-r border-slate-800 bg-slate-950 p-4 transition-transform duration-300 lg:static lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Logo & Name */}
        <div className="flex items-center gap-3 px-2 py-3 border-b border-slate-800/80">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
            <Radio className="h-5 w-5 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-black tracking-wider text-white">PREDICT</span>
              <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-xs font-bold text-cyan-400 border border-cyan-500/30">
                IQ
              </span>
            </div>
            <p className="text-[10px] font-mono tracking-tight text-slate-400">
              Industrial IoT Platform
            </p>
          </div>
        </div>

        {/* User Mini Profile Card */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-900/60 p-2.5">
          {photoURL ? (
            <img
              src={photoURL}
              alt={userName}
              className="h-9 w-9 rounded-lg object-cover border border-cyan-500/30"
            />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate">{userName}</div>
            <div className="text-[10px] text-slate-400 font-mono truncate">{user?.email}</div>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto pr-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                id={`nav-item-${item.id}`}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/5'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 transition-colors ${
                      isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                      item.badgeColor === 'rose'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : item.badgeColor === 'cyan'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : item.badgeColor === 'purple'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom System Health & Sign Out Footer */}
        <div className="mt-auto border-t border-slate-800/80 pt-3 px-1 space-y-2">
          {onNavigateHome && (
            <button
              onClick={onNavigateHome}
              className="flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-all"
            >
              <Globe className="h-4 w-4 text-cyan-400" />
              <span>Public Landing Page</span>
            </button>
          )}

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium text-[11px]">
                <ShieldCheck className={`h-3.5 w-3.5 ${backendOnline ? 'text-emerald-400' : 'text-rose-400'}`} /> FastAPI Gateway
              </span>
              <span className={`flex items-center gap-1 font-mono text-[10px] ${backendOnline ? 'text-emerald-400' : 'text-rose-400'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${backendOnline ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'}`} />
                {backendOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-medium text-rose-300 hover:border-rose-500/30 hover:bg-rose-500/10 transition-all"
          >
            <LogOut className="h-4 w-4 text-rose-400" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
};
export default Sidebar;
