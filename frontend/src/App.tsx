import React, { useState, useEffect, useCallback } from 'react';
import { Machine, FleetStats } from './types';
import api from './services/api';
import Sidebar, { NavTab } from './components/Sidebar';
import Header from './components/Header';
import DashboardPage from './pages/DashboardPage';
import MachinesPage from './pages/MachinesPage';
import MachineDetailsPage from './pages/MachineDetailsPage';
import LiveMonitoringPage from './pages/LiveMonitoringPage';
import PredictionsPage from './pages/PredictionsPage';
import MaintenancePage from './pages/MaintenancePage';
import AlertsPage from './pages/AlertsPage';
import SensorDataPage from './pages/SensorDataPage';
import SettingsPage from './pages/SettingsPage';
import ManualSensorModal from './components/ManualSensorModal';
import AddMachineModal from './components/AddMachineModal';
import { Menu, AlertOctagon, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedMachineId, setSelectedMachineId] = useState<string>('M001');
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

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'alert'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'alert' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Primary Data Fetcher
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

  // Navigation handlers
  const handleSelectMachine = (machineId: string) => {
    setSelectedMachineId(machineId);
    setActiveTab('machine-details');
  };

  const handleOpenManualModal = (machineId?: string) => {
    setModalTargetMachineId(machineId || selectedMachineId || 'M001');
    setIsManualModalOpen(true);
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

  return (
    <div id="predictiq-root" className="flex min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-cyan-500 selection:text-slate-950">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        activeAlertsCount={fleetStats.active_alerts}
        criticalMachinesCount={0}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
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
          onNavigateToAlerts={() => setActiveTab('alerts')}
          backendOnline={backendOnline}
          onRetryBackend={handleRetryBackend}
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
                    {backendError ? ` (${backendError})` : ''} Start backend with <code className="font-mono bg-slate-900/80 px-1 py-0.5 rounded text-white">python -m uvicorn backend.main:app --reload</code>.
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
              onBackToDashboard={() => setActiveTab('dashboard')}
              onOpenManualModal={handleOpenManualModal}
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
            <SettingsPage />
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

export default App;
