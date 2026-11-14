import React, { useCallback, useEffect, useState } from 'react';
import { Menu, AlertTriangle, RefreshCw, Loader2, Radio, ArrowLeft, LogIn } from 'lucide-react';
import Sidebar, { NavTab } from './Sidebar';
import Header from './Header';
import DemoModeBanner from './DemoModeBanner';
import DashboardPage from '../pages/DashboardPage';
import MachinesPage from '../pages/MachinesPage';
import MachineDetailsPage from '../pages/MachineDetailsPage';
import PredictionsPage from '../pages/PredictionsPage';
import MaintenancePage from '../pages/MaintenancePage';
import AlertsPage from '../pages/AlertsPage';
import SensorDataPage from '../pages/SensorDataPage';
import { AlarmProvider } from '../context/AlarmContext';
import { DemoProvider, useDemo } from '../context/DemoContext';
import demoApi from '../services/demoApi';
import {
  DEMO_HIDDEN_TABS,
  DEMO_TAB_IDS,
  demoTabPath,
  resolveDemoTab,
} from '../lib/demoMode';

/**
 * Public demo workbench.
 *
 * Renders the SAME layout components (Sidebar, Header, page components) as the
 * authenticated dashboard, but:
 *   - it is mounted outside AuthProvider (no Supabase session, no workspace
 *     initialization, no organization header);
 *   - every data read goes through the unauthenticated `demoApi` service;
 *   - write controls are hidden (`readOnly`) and the backend has no demo write
 *     routes at all.
 *
 * Mounting the alarm provider with `backendSync={false}` keeps the shared
 * Header/page UI working without it querying authenticated alert endpoints.
 */

const DEMO_REFRESH_INTERVAL_MS = 15000;

interface DemoWorkbenchProps {
  onExit: () => void;
  onSignIn: () => void;
}

const DemoWorkbench: React.FC<DemoWorkbenchProps> = ({ onExit, onSignIn }) => {
  const {
    status,
    error,
    machines,
    stats,
    activeAlerts,
    backendOnline,
    overview,
    refresh,
  } = useDemo();

  const [activeTab, setActiveTab] = useState<NavTab>(() =>
    resolveDemoTab(window.location.pathname)
  );
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);

  useEffect(() => {
    if (machines.length > 0 && !selectedMachineId) {
      setSelectedMachineId(machines[0].machine_id);
    }
  }, [machines, selectedMachineId]);

  // Browser back/forward inside the demo route.
  useEffect(() => {
    const handlePopState = () => setActiveTab(resolveDemoTab(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Demo data is a fixed dataset; polling keeps the "live product" feel without
  // implying hardware telemetry.
  useEffect(() => {
    if (!autoRefresh || status !== 'ready') return;
    const interval = setInterval(refresh, DEMO_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoRefresh, status, refresh]);

  const handleSelectTab = useCallback((tab: NavTab) => {
    const nextTab = (DEMO_TAB_IDS as string[]).includes(tab) ? tab : 'dashboard';
    setActiveTab(nextTab as NavTab);
    const path = demoTabPath(nextTab as NavTab);
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setIsMobileNavOpen(false);
  }, []);

  const handleSelectMachine = useCallback(
    (machineId: string) => {
      setSelectedMachineId(machineId);
      handleSelectTab('machine-details');
    },
    [handleSelectTab]
  );

  if (status === 'loading') {
    return (
      <div
        id="demo-loading-screen"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-slate-200"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
          <Radio className="h-7 w-7 text-slate-950" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">PREDICT<span className="text-cyan-400">IQ</span> — Demo Mode</h1>
          <p className="mt-1 text-xs text-slate-400">
            Loading the public demo dataset from the PredictIQ API…
          </p>
        </div>
        <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </button>
          <button
            onClick={onSignIn}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400"
          >
            <LogIn className="h-3.5 w-3.5" /> Sign in
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        id="demo-error-screen"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div className="max-w-md">
          <h1 className="text-base font-bold text-white">The demo dataset could not be loaded</h1>
          <p className="mt-1 text-xs leading-relaxed text-rose-200/80">{error}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            The public demo reads only the isolated demo dataset served by
            <code className="mx-1 rounded bg-slate-900 px-1 py-0.5 font-mono text-slate-300">/api/public/demo</code>.
            No account or customer data is involved.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="btn-demo-retry"
            onClick={refresh}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to site
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      id="predictiq-demo-root"
      className="flex min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-cyan-500 selection:text-slate-950"
    >
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        activeAlertsCount={activeAlerts}
        criticalMachinesCount={machines.filter((m) => m.status === 'Critical').length}
        backendOnline={backendOnline}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
        onNavigateHome={onExit}
        hiddenTabs={DEMO_HIDDEN_TABS}
      />

      <div className="flex flex-1 flex-col min-w-0">
        <Header
          activeTab={activeTab}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={setAutoRefresh}
          activeAlertsCount={activeAlerts}
          onOpenManualModal={() => undefined}
          onNavigateToAlerts={() => handleSelectTab('alerts')}
          backendOnline={backendOnline}
          onRetryBackend={refresh}
          userEmail={null}
          onSignOut={onSignIn}
          demoMode
          readOnly
          onExitDemo={onExit}
          onSignIn={onSignIn}
        />

        {/* Persistent demo identity + dataset disclosure + conversion actions */}
        <DemoModeBanner
          dataset={overview?.dataset ?? null}
          onSignIn={onSignIn}
          onExit={onExit}
        />

        {/* Mobile Navigation Trigger Bar */}
        <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-4 py-2 lg:hidden">
          <button
            onClick={() => setIsMobileNavOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <Menu className="h-4 w-4" />
            <span>Navigation Menu</span>
          </button>
          <span className="font-mono text-xs font-bold text-amber-300">DEMO MODE</span>
        </div>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardPage
              machines={machines}
              stats={stats}
              backendOnline={backendOnline}
              onSelectMachine={handleSelectMachine}
              onOpenManualModal={() => undefined}
              onOpenAddMachineModal={() => undefined}
              onRefresh={refresh}
              dataService={demoApi}
              readOnly
              demoMode
            />
          )}

          {activeTab === 'machines' && (
            <MachinesPage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              onOpenManualModal={() => undefined}
              onOpenAddMachineModal={() => undefined}
              readOnly
            />
          )}

          {activeTab === 'machine-details' && (
            <MachineDetailsPage
              machineId={selectedMachineId}
              machines={machines}
              onSelectMachine={setSelectedMachineId}
              onBackToDashboard={() => handleSelectTab('dashboard')}
              onOpenManualModal={() => undefined}
              dataService={demoApi}
              readOnly
            />
          )}

          {activeTab === 'predictions' && (
            <PredictionsPage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              onOpenManualModal={() => undefined}
              dataService={demoApi}
              readOnly
              demoMode
            />
          )}

          {activeTab === 'maintenance' && (
            <MaintenancePage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              dataService={demoApi}
              readOnly
            />
          )}

          {activeTab === 'alerts' && (
            <AlertsPage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              onRefreshAlerts={refresh}
              dataService={demoApi}
              readOnly
            />
          )}

          {activeTab === 'sensor-data' && (
            <SensorDataPage
              machines={machines}
              onOpenManualModal={() => undefined}
              onSelectMachine={handleSelectMachine}
              dataService={demoApi}
              readOnly
            />
          )}
        </main>
      </div>
    </div>
  );
};

interface DemoDashboardProps {
  onExit?: () => void;
  onSignIn?: () => void;
}

/**
 * Entry point for /demo. Mounts its own data + alarm providers and deliberately
 * does not mount AuthProvider, the workspace initializer, or the simulation
 * provider (which is bound to authenticated hardware/simulation writes).
 */
export const DemoDashboard: React.FC<DemoDashboardProps> = ({
  onExit = () => window.location.assign('/'),
  onSignIn = () => window.location.assign('/signin'),
}) => (
  <DemoProvider>
    <AlarmProvider backendSync={false}>
      <DemoWorkbench onExit={onExit} onSignIn={onSignIn} />
    </AlarmProvider>
  </DemoProvider>
);

export default DemoDashboard;
