import React from 'react';
import {
  LayoutDashboard,
  Cpu,
  LineChart,
  Activity,
  BrainCircuit,
  Wrench,
  AlertTriangle,
  Database,
  Settings,
  Radio,
  ShieldCheck
} from 'lucide-react';

export type NavTab = 
  | 'dashboard'
  | 'machines'
  | 'machine-details'
  | 'monitoring'
  | 'predictions'
  | 'maintenance'
  | 'alerts'
  | 'sensor-data'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeAlertsCount: number;
  criticalMachinesCount: number;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  activeAlertsCount,
  criticalMachinesCount,
  isMobileOpen,
  onCloseMobile,
}) => {
  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: null,
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
      id: 'sensor-data' as NavTab,
      label: 'Sensor Data',
      icon: Database,
      badge: null,
    },
    {
      id: 'settings' as NavTab,
      label: 'ESP32 & Settings',
      icon: Settings,
      badge: 'IoT',
      badgeColor: 'blue',
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
              INDUSTRIAL AI ENGINE v2.4
            </p>
          </div>
        </div>

        {/* Navigation List */}
        <nav className="mt-6 flex-1 space-y-1.5 overflow-y-auto">
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

        {/* Bottom System Health Footer */}
        <div className="mt-auto border-t border-slate-800/80 pt-4 px-2">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <ShieldCheck className="h-4 w-4 text-emerald-400" /> API Gateway
              </span>
              <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                ONLINE
              </span>
            </div>
            <div className="mt-2 text-[11px] text-slate-400 font-mono flex justify-between">
              <span>FastAPI Port:</span>
              <span className="text-slate-300">3000 / 8000</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400 font-mono flex justify-between">
              <span>Model:</span>
              <span className="text-cyan-400">PhysicsRule v2.4</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
export default Sidebar;
