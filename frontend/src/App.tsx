import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Machine, FleetStats, FeedbackContext } from './types';
import api from './services/api';
import Sidebar, { NavTab } from './components/Sidebar';
import Header from './components/Header';
import HomePage from './pages/HomePage';
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
import { AlarmProvider, useAlarm } from './context/AlarmContext';
import { SimulationProvider } from './context/SimulationContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import RequireAuth from './components/auth/RequireAuth';
import { OrganizationPendingScreen } from './components/auth/AuthScreens';
import SignInPage from './pages/auth/SignInPage';
import SignUpPage from './pages/auth/SignUpPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import AuthCallbackPage from './pages/auth/AuthCallbackPage';
import { buildSignInPath, resolvePostSignInPath } from './lib/authGuard';
import { isOrganizationAccessError } from './services/api';
import { Menu, AlertOctagon, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

type AppRoute =
  | 'home'
  | 'workbench'
  | 'signin'
  | 'signup'
  | 'forgot-password'
  | 'reset-password'
  | 'auth-callback';

const WORKBENCH_TABS: string[] = [
  'dashboard',
  '3d-view',
  'machines',
  'machine-details',
  'monitoring',
  'predictions',
  'maintenance',
  'alerts',
  'feedback',
  'sensor-data',
  'settings',
];

function MainAppContent() {
  const { evaluateFleetTelemetry, isAlarmActive, isAudioMuted, muteAlarm } = useAlarm();
  const { user, signOut } = useAuth();

  // Route State: 'home' | 'workbench'
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
  // Signed in, but with no organization membership yet (Phase 5 adds onboarding).
  const [orgAccessPending, setOrgAccessPending] = useState<boolean>(false);

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
    if (
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
    } else if (path === '/signin' || path === '/login') {
      setCurrentRoute('signin');
    } else if (path === '/signup' || path === '/register') {
      setCurrentRoute('signup');
    } else if (path === '/forgot-password') {
      setCurrentRoute('forgot-password');
    } else if (path === '/reset-password') {
      setCurrentRoute('reset-password');
    } else if (path === '/auth/callback' || path === '/callback') {
      setCurrentRoute('auth-callback');
    } else {
      setCurrentRoute('home');
    }
  }, []);

  // Update browser URL without reloading
  const navigateTo = useCallback((route: AppRoute, tab?: NavTab) => {
    setCurrentRoute(route);
    let targetPath = '/';
    if (route === 'workbench') {
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

  // Navigate to an arbitrary in-app path (auth pages, deep links).
  const navigateToPath = useCallback(
    (path: string) => {
      const clean = (path.split('?')[0] || '/').toLowerCase();
      const tab = clean.startsWith('/') ? clean.slice(1) : '';
      if (WORKBENCH_TABS.includes(tab)) {
        navigateTo('workbench', tab as NavTab);
        return;
      }
      window.history.pushState({}, '', path);
      syncRouteFromPath();
    },
    [navigateTo, syncRouteFromPath]
  );

  // Protected route asked us to send the visitor to sign-in (path preserved).
  const handleAuthBlocked = useCallback(
    (currentPath: string) => {
      window.history.pushState({}, '', buildSignInPath(currentPath));
      syncRouteFromPath();
    },
    [syncRouteFromPath]
  );

  // Successful sign-in: return to the originally requested destination.
  const handleAuthSuccess = useCallback(() => {
    navigateToPath(resolvePostSignInPath(window.location.search));
  }, [navigateToPath]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigateTo('home');
  }, [signOut, navigateTo]);

  // Primary Fleet Data Fetcher
  const loadFleetData = useCallback(async () => {
    if (orgAccessPending) return; // do not hammer a denied organization context
    try {
      // 1. Health check (public endpoint, no credentials attached)
      try {
        await api.getHealth();
        setBackendOnline(true);
        setBackendError(null);
      } catch (err: any) {
        setBackendOnline(false);
        setBackendError(err.message || 'FastAPI service unreachable');
        setMachines([]);
      }

      // 2. Fetch PostgreSQL fleet data (organization-scoped, user token attached)
      const [fetchedMachines, fetchedStats] = await Promise.all([
        api.getMachines().catch((err) => {
          if (isOrganizationAccessError(err)) throw err;
          return [];
        }),
        api.getFleetStats().catch((err) => {
          if (isOrganizationAccessError(err)) throw err;
          return null;
        }),
      ]);

      setOrgAccessPending(false);
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
      if (isOrganizationAccessError(err)) {
        // Authenticated, but without organization membership: never a login failure.
        setOrgAccessPending(true);
        setMachines([]);
        return;
      }
      console.warn('Error synchronizing fleet data from PostgreSQL:', err.message || err);
    }
  }, [selectedMachineId, orgAccessPending]);

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

  // Route 0: Authentication pages (public)
  if (currentRoute === 'signin') {
    return <SignInPage onNavigatePath={navigateToPath} onSuccess={handleAuthSuccess} />;
  }
  if (currentRoute === 'signup') {
    return <SignUpPage onNavigatePath={navigateToPath} onSuccess={handleAuthSuccess} />;
  }
  if (currentRoute === 'forgot-password') {
    return <ForgotPasswordPage onNavigatePath={navigateToPath} />;
  }
  if (currentRoute === 'reset-password') {
    return <ResetPasswordPage onNavigatePath={navigateToPath} onSuccess={handleAuthSuccess} />;
  }
  if (currentRoute === 'auth-callback') {
    return <AuthCallbackPage onNavigatePath={navigateToPath} onSuccess={handleAuthSuccess} />;
  }

  // Route 1: Public Landing Page (no authentication required)
  if (currentRoute === 'home') {
    return (
      <HomePage
        onNavigate={(dest) => {
          if (dest === 'dashboard') navigateTo('workbench', 'dashboard');
        }}
        onSignIn={() => navigateToPath('/signin')}
      />
    );
  }

  // Signed in, but not (yet) a member of any organization.
  if (orgAccessPending) {
    return <OrganizationPendingScreen userEmail={user?.email ?? null} onSignOut={handleSignOut} />;
  }

  // Route 2: Private Industrial Workbench (authentication required)
  return (
    <RequireAuth onBlocked={handleAuthBlocked}>
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
          userEmail={user?.email ?? null}
          onSignOut={handleSignOut}
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
    </RequireAuth>
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

