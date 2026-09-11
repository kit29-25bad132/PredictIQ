import React, { useState, useEffect } from 'react';
import { Machine, FleetStats, DataCollectionStatus, AIModelStatus } from '../types';
import MetricCard from '../components/MetricCard';
import MachineCard from '../components/MachineCard';
import api from '../services/api';
import {
  Cpu,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Bell,
  Gauge,
  Plus,
  Radio,
  Search,
  Filter,
  RefreshCw,
  Database,
  Activity,
  Clock,
  BrainCircuit
} from 'lucide-react';

interface DashboardPageProps {
  machines: Machine[];
  stats: FleetStats;
  backendOnline: boolean;
  onSelectMachine: (machineId: string) => void;
  onOpenManualModal: (machineId?: string) => void;
  onOpenAddMachineModal: () => void;
  onRefresh: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  machines,
  stats,
  backendOnline,
  onSelectMachine,
  onOpenManualModal,
  onOpenAddMachineModal,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dataStatus, setDataStatus] = useState<DataCollectionStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AIModelStatus | null>(null);

  const fetchStatuses = async () => {
    try {
      const [ds, ais] = await Promise.all([
        api.getDataStatus(),
        api.getAIModelStatus()
      ]);
      setDataStatus(ds);
      setAiStatus(ais);
    } catch (err) {
      console.warn('Status fetch error:', err);
    }
  };

  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 4000);
    return () => clearInterval(interval);
  }, []);

  const filteredMachines = machines.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.machine_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || m.status.toUpperCase() === statusFilter.toUpperCase();
    return matchesSearch && matchesStatus;
  });

  const isConnected = backendOnline && dataStatus?.sensor_status === 'ONLINE';
  const totalReadings = backendOnline ? (dataStatus?.total_readings ?? stats.total_sensor_readings ?? 0) : 0;
  const lastReadingTime = backendOnline && dataStatus?.last_reading
    ? new Date(dataStatus.last_reading).toLocaleTimeString() 
    : 'No readings yet';

  return (
    <div id="dashboard-page" className="space-y-6">
      {/* Top Banner: Real PostgreSQL & ESP32 Data Collection Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/90 to-blue-950/40 p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Plant Health & IoT Condition Intelligence</h2>
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${
                isConnected
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-700/40 text-slate-300 border border-slate-600/30'
              }`}>
                <Radio className="h-3 w-3" />
                {!backendOnline ? 'API UNAVAILABLE' : isConnected ? 'ESP32 SENSORS CONNECTED' : 'WAITING FOR REAL SENSORS'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Powered by PostgreSQL • Real-Time ESP32 IoT Telemetry • Zero Synthetic Data
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            id="btn-dash-refresh"
            onClick={() => {
              onRefresh();
              fetchStatuses();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync DB</span>
          </button>

          <button
            id="btn-dash-add-machine"
            onClick={onOpenAddMachineModal}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Asset</span>
          </button>

          <button
            id="btn-dash-manual-entry"
            onClick={() => onOpenManualModal()}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
          >
            <Plus className="h-3.5 w-3.5 stroke-[3]" />
            <span>Manual Real Input</span>
          </button>
        </div>
      </div>

      {/* Real Data Collection & AI Readiness Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            isConnected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
          }`}>
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sensor Status</div>
            <div className={`font-mono text-sm font-bold ${isConnected ? 'text-emerald-400' : 'text-slate-400'}`}>
              {!backendOnline ? 'API UNAVAILABLE' : isConnected ? 'ONLINE' : 'OFFLINE'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total PostgreSQL Readings</div>
            <div className="font-mono text-sm font-bold text-white">
              {totalReadings} <span className="text-xs font-normal text-slate-400">records</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Last Telemetry Timestamp</div>
            <div className="font-mono text-xs font-bold text-slate-200 truncate max-w-[170px]">
              {lastReadingTime}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">AI Model Status</div>
            <div className="text-xs font-bold text-amber-400 truncate max-w-[170px]">
              {aiStatus?.status || 'Waiting for real historical data'}
            </div>
          </div>
        </div>
      </div>

      {/* 6 Executive KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <MetricCard
          id="kpi-total-machines"
          title="Total Machines"
          value={stats.total_machines}
          subValue="In PostgreSQL"
          icon={Cpu}
          accentColor="blue"
        />
        <MetricCard
          id="kpi-total-devices"
          title="ESP32 Devices"
          value={stats.total_devices}
          subValue="Registered nodes"
          icon={Radio}
          accentColor="cyan"
        />
        <MetricCard
          id="kpi-connected-devices"
          title="Active ESP32"
          value={stats.connected_devices}
          subValue="Online now"
          icon={CheckCircle2}
          accentColor="emerald"
        />
        <MetricCard
          id="kpi-total-readings"
          title="Sensor Readings"
          value={stats.total_sensor_readings}
          subValue="Real time-series"
          icon={Database}
          accentColor="purple"
        />
        <MetricCard
          id="kpi-active-alerts"
          title="Active Alerts"
          value={stats.active_alerts}
          subValue="Unresolved"
          icon={Bell}
          accentColor="rose"
        />
        <MetricCard
          id="kpi-maint-records"
          title="Maintenance Logs"
          value={stats.total_maintenance_records}
          subValue="Ground truth records"
          icon={AlertTriangle}
          accentColor="amber"
        />
      </div>

      {/* Fleet Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="input-fleet-search"
            type="text"
            placeholder="Search by Machine ID, Name, Category or Bay location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-700/80 bg-slate-950 py-2 pl-9 pr-3 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400 hidden sm:inline" />
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs">
            {['ALL', 'HEALTHY', 'WARNING', 'CRITICAL'].map((st) => (
              <button
                key={st}
                id={`filter-status-${st.toLowerCase()}`}
                onClick={() => setStatusFilter(st)}
                className={`rounded px-2.5 py-1 font-medium transition-all ${
                  statusFilter === st
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Machine Fleet Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Industrial Machine Fleet ({filteredMachines.length} of {machines.length})
          </h3>
          <span className="text-xs text-slate-400">
            PostgreSQL Real-Time Asset Stream
          </span>
        </div>

        {filteredMachines.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 py-16 text-center">
            <Database className="h-10 w-10 text-slate-600 mb-3" />
            <p className="text-sm font-medium text-slate-300">No real machine data available.</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Waiting for real ESP32 sensor data or registered machine assets in PostgreSQL.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={onOpenAddMachineModal}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                Register Asset
              </button>
              <button
                onClick={() => onOpenManualModal()}
                className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400"
              >
                Manual Real Measurement
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredMachines.map((m) => (
              <MachineCard
                key={m.machine_id}
                machine={m}
                onSelect={onSelectMachine}
                onOpenManualInput={(id) => onOpenManualModal(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
export default DashboardPage;
