import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Machine, FleetStats, FeedbackContext } from './types';
import api from './services/api';
import Sidebar, { NavTab } from './components/Sidebar';
import Header from './components/Header';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import MachinesPage from './pages/MachinesPage';
import MachineDetailsPage from './pages/MachineDetailsPage';
import Machine3DViewPage from './pages/Machine3DViewPage';
import LiveMonitoringPage from './pages/LiveMonitoringPage';
import PredictionsPage from './pages/PredictionsPage';
import MaintenancePage from './pages/MaintenancePage';
import AlertsPage from './pages/AlertsPage';
import FeedbackPage from './pages/FeedbackPage';
import SensorDataPage from './pages/SensorDataPage';
import SettingsPage from './pages/SettingsPage';
import ManualSensorModal from './components/ManualSensorModal';
import AddMachineModal from './components/AddMachineModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AlarmProvider, useAlarm } from './context/AlarmContext';
import { SimulationProvider } from './context/SimulationContext';
import { Menu, AlertOctagon, CheckCircle2, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';

type AppRoute = 'home' | 'signin' | 'signup' | 'workbench';

function MainAppContent() {
  const { user, loading: authLoading, isAuthenticated, userName, logout } = useAuth();
  const { evaluateFleetTelemetry, isAlarmActive, isAudioMuted, muteAlarm } = useAlarm();

  // Route State: 'home' | 'signin' | 'signup' | 'workbench'
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('home');
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');

  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [fleetStats, setFleetStats] = useState<FleetStats>({
    total_machines: 0,
    total_devices: 0,
    connected_devices: 0,
    total_sensor_readings: 0,
    total_maintenance_records: 0,
    active_alerts: 0,
    data_collection_status: 'WAITING',
  });
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean>(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  // Modals
  const [isManualModalOpen, setIsManualModalOpen] = useState<boolean>(false);
  const [modalTargetMachineId, setModalTargetMachineId] = useState<string | undefined>(undefined);
  const [isAddMachineModalOpen, setIsAddMachineModalOpen] = useState<boolean>(false);

  // Feedback form pre-link context
  const [feedbackInitialContext, setFeedbackInitialContext] = useState<FeedbackContext | null>(null);

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'alert'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'alert' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Synchronize route from browser URL on mount and on popstate
  const syncRouteFromPath = useCallback(() => {
    const path = window.location.pathname.toLowerCase();
    if (path === '/signin') {
      setCurrentRoute('signin');
    } else if (path === '/signup') {
      setCurrentRoute('signup');
    } else if (
      path === '/dashboard' ||
      path === '/3d-view' ||
      path === '/machines' ||
      path === '/machine-details' ||
      path === '/monitoring' ||
      path === '/predictions' ||
      path === '/maintenance' ||
      path === '/alerts' ||
      path === '/feedback' ||
      path === '/sensor-data' ||
      path === '/settings'
    ) {
      setCurrentRoute('workbench');
      const tabName = path.substring(1) as NavTab;
      setActiveTab(tabName);
    } else {
      setCurrentRoute('home');
    }
  }, []);

  // Update browser URL without reloading
  const navigateTo = useCallback((route: AppRoute, tab?: NavTab) => {
    setCurrentRoute(route);
    let targetPath = '/';
    if (route === 'signin') targetPath = '/signin';
    else if (route === 'signup') targetPath = '/signup';
    else if (route === 'workbench') {
      const selected = tab || activeTab || 'dashboard';
      setActiveTab(selected);
      targetPath = `/${selected}`;
    }

    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  }, [activeTab]);

  useEffect(() => {
    syncRouteFromPath();
    const handlePopState = () => syncRouteFromPath();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [syncRouteFromPath]);

  // Auth navigation guards
  useEffect(() => {
    if (authLoading) return;

    if (isAuthenticated) {
      // If user is already authenticated and visits signin or signup, redirect to dashboard
      if (currentRoute === 'signin' || currentRoute === 'signup') {
        navigateTo('workbench', 'dashboard');
      }
    } else {
      // If user is unauthenticated and visits protected routes, redirect to signin
      if (currentRoute === 'workbench') {
        navigateTo('signin');
      }
    }
  }, [isAuthenticated, authLoading, currentRoute, navigateTo]);

  // Primary Fleet Data Fetcher
  const loadFleetData = useCallback(async () => {
    try {
      // 1. Health check
      try {
        await api.getHealth();
        setBackendOnline(true);
        setBackendError(null);
      } catch (err: any) {
        setBackendOnline(false);
        setBackendError(err.message || 'FastAPI service unreachable');
        setMachines([]);
      }

      // 2. Fetch PostgreSQL fleet data
      const [fetchedMachines, fetchedStats] = await Promise.all([
        api.getMachines().catch(() => []),
        api.getFleetStats().catch(() => null),
      ]);

      setMachines(fetchedMachines);
      if (fetchedMachines.length > 0) {
        if (!selectedMachineId && fetchedMachines.length > 0) {
          setSelectedMachineId(fetchedMachines[0].machine_id);
        }
      }

      if (fetchedStats) {
        setFleetStats(fetchedStats);
      }
    } catch (err: any) {
      console.warn('Error synchronizing fleet data from PostgreSQL:', err.message || err);
    }
  }, [selectedMachineId]);

  // Initial Load
  useEffect(() => {
    loadFleetData();
  }, [loadFleetData]);

  // Polling loop
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadFleetData();
    }, 4000);

    return () => clearInterval(interval);
  }, [autoRefresh, loadFleetData]);

  // Synchronize telemetry feed to the Industrial Alarm Engine
  useEffect(() => {
    evaluateFleetTelemetry(machines);
  }, [machines, evaluateFleetTelemetry]);

  // Keyboard accessibility: Escape or 'm' to quickly mute an active alarm
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }
      if ((e.key === 'Escape' || e.key === 'm' || e.key === 'M') && isAlarmActive && !isAudioMuted) {
        muteAlarm();
        showToast('Audible alarm muted by operator', 'alert');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAlarmActive, isAudioMuted, muteAlarm]);

  // Navigation handlers
  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    navigateTo('workbench', tab);
  };

  const handleSelectMachine = (machineId: string) => {
    setSelectedMachineId(machineId);
    handleSelectTab('machine-details');
  };

  const handleOpenManualModal = (machineId?: string) => {
    setModalTargetMachineId(machineId || selectedMachineId || (machines.length > 0 ? machines[0].machine_id : ''));
    setIsManualModalOpen(true);
  };

  const handleOpenFeedback = (context: FeedbackContext) => {
    setFeedbackInitialContext(context);
    handleSelectTab('feedback');
  };

  const handleRetryBackend = async () => {
    showToast('Connecting to FastAPI backend & PostgreSQL...', 'success');
    await loadFleetData();
    if (backendOnline) {
      showToast('FastAPI Backend & PostgreSQL connected!', 'success');
    } else {
      showToast('Backend still unreachable. Please verify FastAPI is running.', 'alert');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigateTo('home');
    showToast('Signed out successfully.');
  };

  // Auth Loading Screen
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          <span className="text-sm text-slate-400 font-mono">Restoring session...</span>
        </div>
      </div>
    );
  }

  // Route 1: Public Landing Page
  if (currentRoute === 'home') {
    return (
      <HomePage
        onNavigate={(dest) => {
          if (dest === 'signin') navigateTo('signin');
          else if (dest === 'signup') navigateTo('signup');
          else if (dest === 'dashboard') navigateTo('workbench', 'dashboard');
        }}
        isAuthenticated={isAuthenticated}
        userName={userName}
      />
    );
  }

  // Route 2 & 3: Sign In & Sign Up Pages
  if (currentRoute === 'signin' || currentRoute === 'signup') {
    return (
      <AuthPage
        initialMode={currentRoute === 'signup' ? 'signup' : 'signin'}
        onSuccess={() => {
          navigateTo('workbench', 'dashboard');
          showToast(`Welcome back, ${userName || 'Operator'}!`);
        }}
        onBackToHome={() => navigateTo('home')}
      />
    );
  }

  // Route 4: Authenticated Industrial Workbench
  return (
    <div id="predictiq-root" className="flex min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-cyan-500 selection:text-slate-950">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        activeAlertsCount={fleetStats.active_alerts}
        criticalMachinesCount={machines.filter(m => m.status === 'Critical').length}
        backendOnline={backendOnline}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
        onLogout={handleLogout}
        onNavigateHome={() => navigateTo('home')}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top Header */}
        <Header
          activeTab={activeTab}
          autoRefresh={autoRefresh}
          onToggleAutoRefresh={setAutoRefresh}
          activeAlertsCount={fleetStats.active_alerts}
          onOpenManualModal={() => handleOpenManualModal()}
          onNavigateToAlerts={() => handleSelectTab('alerts')}
          backendOnline={backendOnline}
          onRetryBackend={handleRetryBackend}
          onNavigateHome={() => navigateTo('home')}
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

          <span className="font-mono text-xs text-cyan-400 font-bold">
            Predict IQ
          </span>
        </div>

        {/* Backend Unavailable Warning Banner */}
        {!backendOnline && (
          <div className="mx-4 mt-4 sm:mx-6 lg:mx-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                <div>
                  <h4 className="text-xs font-bold text-amber-300">FastAPI Backend Offline</h4>
                  <p className="text-xs text-amber-200/80 mt-0.5">
                    Could not connect to FastAPI server at <code className="font-mono bg-slate-900/80 px-1 py-0.5 rounded text-white">{api.getBaseUrl()}</code>.
                    {backendError ? ` (${backendError})` : ''} Verify backend is running.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRetryBackend}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry Connection</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Page Content View */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardPage
              machines={machines}
              stats={fleetStats}
              backendOnline={backendOnline}
              onSelectMachine={handleSelectMachine}
              onOpenManualModal={handleOpenManualModal}
              onOpenAddMachineModal={() => setIsAddMachineModalOpen(true)}
              onRefresh={loadFleetData}
            />
          )}

          {activeTab === '3d-view' && (
            <Machine3DViewPage
              machines={machines}
              initialMachineId={selectedMachineId}
              onSelectMachine={handleSelectMachine}
            />
          )}

          {activeTab === 'machines' && (
            <MachinesPage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              onOpenManualModal={handleOpenManualModal}
              onOpenAddMachineModal={() => setIsAddMachineModalOpen(true)}
            />
          )}

          {activeTab === 'machine-details' && (
            <MachineDetailsPage
              machineId={selectedMachineId}
              machines={machines}
              onSelectMachine={setSelectedMachineId}
              onBackToDashboard={() => handleSelectTab('dashboard')}
              onOpenManualModal={handleOpenManualModal}
              onNavigate3DView={(id) => {
                setSelectedMachineId(id);
                handleSelectTab('3d-view');
              }}
            />
          )}

          {activeTab === 'monitoring' && (
            <LiveMonitoringPage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              onOpenManualModal={handleOpenManualModal}
            />
          )}

          {activeTab === 'predictions' && (
            <PredictionsPage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              onOpenManualModal={handleOpenManualModal}
              onRecordFeedback={handleOpenFeedback}
            />
          )}

          {activeTab === 'maintenance' && (
            <MaintenancePage
              machines={machines}
              onSelectMachine={handleSelectMachine}
            />
          )}

          {activeTab === 'alerts' && (
            <AlertsPage
              machines={machines}
              onSelectMachine={handleSelectMachine}
              onRefreshAlerts={loadFleetData}
              onRecordFeedback={handleOpenFeedback}
            />
          )}

          {activeTab === 'feedback' && (
            <FeedbackPage
              machines={machines}
              initialContext={feedbackInitialContext}
              onClearInitialContext={() => setFeedbackInitialContext(null)}
            />
          )}

          {activeTab === 'sensor-data' && (
            <SensorDataPage
              machines={machines}
              onOpenManualModal={handleOpenManualModal}
              onSelectMachine={handleSelectMachine}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPage machines={machines} />
          )}
        </main>
      </div>

      {/* Manual Sensor Injection Modal */}
      <ManualSensorModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        machines={machines}
        initialMachineId={modalTargetMachineId}
        onDataSubmitted={() => {
          loadFleetData();
          showToast('Real measurement saved to PostgreSQL!');
        }}
      />

      {/* Add Machine Asset Modal */}
      <AddMachineModal
        isOpen={isAddMachineModalOpen}
        onClose={() => setIsAddMachineModalOpen(false)}
        onMachineAdded={() => {
          loadFleetData();
          showToast('New Machine Asset registered in PostgreSQL!');
        }}
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          id="toast-notification"
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 shadow-2xl text-xs font-semibold backdrop-blur-md animate-in slide-in-from-bottom-3 duration-300 ${
            toastMessage.type === 'alert'
              ? 'border-rose-500/40 bg-rose-950/90 text-rose-200'
              : 'border-emerald-500/40 bg-slate-900/95 text-emerald-300'
          }`}
        >
          {toastMessage.type === 'alert' ? (
            <AlertOctagon className="h-4 w-4 text-rose-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AlarmProvider>
        <SimulationProvider>
          <MainAppContent />
        </SimulationProvider>
      </AlarmProvider>
    </AuthProvider>
  );
}

export default App;

