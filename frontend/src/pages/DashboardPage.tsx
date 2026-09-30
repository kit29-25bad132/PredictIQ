import React, { useState, useEffect, useMemo } from 'react';
import { Machine, FleetStats, DataCollectionStatus, AIModelStatus, SensorReading } from '../types';
import MetricCard from '../components/MetricCard';
import MachineCard from '../components/MachineCard';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
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
  BrainCircuit,
  Flame,
  Zap,
  User,
  LogOut,
  Signal,
  Layers,
  History,
  Info,
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
  const { user, greeting, userName, initials, photoURL, logout } = useAuth();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'WOKWI' | 'REAL_HARDWARE'>('ALL');
  const [dataStatus, setDataStatus] = useState<DataCollectionStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AIModelStatus | null>(null);
  const [primaryMachineId, setPrimaryMachineId] = useState<string>('');
  const [recentTelemetry, setRecentTelemetry] = useState<SensorReading[]>([]);
  const [telemetryLoading, setTelemetryLoading] = useState<boolean>(false);

  // Set initial selected primary machine
  useEffect(() => {
    if (machines.length > 0 && !primaryMachineId) {
      setPrimaryMachineId(machines[0].machine_id);
    }
  }, [machines, primaryMachineId]);

  const fetchStatuses = async () => {
    try {
      const [ds, ais] = await Promise.all([
        api.getDataStatus().catch(() => null),
        api.getAIModelStatus().catch(() => null),
      ]);
      if (ds) setDataStatus(ds);
      if (ais) setAiStatus(ais);
    } catch (err) {
      console.warn('Status fetch error:', err);
    }
  };

  const fetchRecentTelemetry = async (machineId: string) => {
    if (!machineId) return;
    try {
      setTelemetryLoading(true);
      const history = await api.getSensorHistory(machineId, 10);
      setRecentTelemetry(history);
    } catch (err) {
      console.warn('Telemetry fetch error:', err);
    } finally {
      setTelemetryLoading(false);
    }
  };

  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (primaryMachineId) {
      fetchRecentTelemetry(primaryMachineId);
    }
  }, [primaryMachineId]);

  const activePrimaryMachine = useMemo(() => {
    return machines.find((m) => m.machine_id === primaryMachineId) || machines[0] || null;
  }, [machines, primaryMachineId]);

  const latestReading = activePrimaryMachine?.latest_reading || (recentTelemetry.length > 0 ? recentTelemetry[recentTelemetry.length - 1] : null);

  const filteredMachines = machines.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.machine_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || m.status.toUpperCase() === statusFilter.toUpperCase();
    const machineSources = [
      m.latest_reading?.source,
      ...(m.devices || []).map((device) => device.source).filter(Boolean),
    ] as Array<'WOKWI' | 'REAL_HARDWARE'>;
    const matchesSource =
      sourceFilter === 'ALL' ||
      machineSources.includes(sourceFilter);
    return matchesSearch && matchesStatus && matchesSource;
  });

  // Calculate actual device connectivity state
  const deviceConnectionState: 'ONLINE' | 'OFFLINE' | 'WAITING' = useMemo(() => {
    if (!backendOnline) return 'OFFLINE';
    if (!dataStatus) return 'WAITING';
    if (dataStatus.sensor_status === 'CONNECTED') return 'ONLINE';
    if (dataStatus.total_readings > 0) return 'OFFLINE';
    return 'WAITING';
  }, [backendOnline, dataStatus]);

  const totalReadings = backendOnline ? (dataStatus?.total_readings ?? stats.total_sensor_readings ?? 0) : 0;
  const lastReadingTime = backendOnline && (latestReading?.timestamp || dataStatus?.last_reading)
    ? new Date(latestReading?.timestamp || dataStatus!.last_reading!).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'No readings recorded';

  return (
    <div id="dashboard-page" className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. PERSONALIZED GREETING & OPERATOR BANNER                                */}
      {/* ========================================================================= */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/95 to-blue-950/40 p-5 sm:p-6 shadow-xl backdrop-blur-md">
        {/* Subtle accent glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
          <div className="flex items-start sm:items-center gap-4">
            {/* User Avatar / Initials */}
            {photoURL ? (
              <img
                src={photoURL}
                alt={userName}
                className="h-14 w-14 rounded-2xl border-2 border-cyan-500/40 object-cover shadow-lg shadow-cyan-500/10"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-slate-950 font-black text-xl shadow-lg shadow-cyan-500/20 border border-cyan-400/40">
                {initials}
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Personalized Greeting */}
                <h2 id="user-greeting-heading" className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {greeting}
                </h2>
                <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-[11px] font-bold text-cyan-300 border border-cyan-500/30">
                  Industrial Operator
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-1">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-slate-500" />
                  <strong className="text-slate-300">{user?.email || 'Authenticated Session'}</strong>
                </span>
                <span>&bull;</span>
                <span className="flex items-center gap-1 font-mono text-cyan-400">
                  <Radio className="h-3 w-3" />
                  Predict IQ Fleet Station
                </span>
              </div>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              id="btn-dash-refresh"
              onClick={() => {
                onRefresh();
                fetchStatuses();
                if (primaryMachineId) fetchRecentTelemetry(primaryMachineId);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-all shadow-sm"
            >
              <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
              <span>Sync Fleet</span>
            </button>

            <button
              id="btn-dash-add-machine"
              onClick={onOpenAddMachineModal}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-all shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Asset</span>
            </button>

            <button
              id="btn-dash-manual-entry"
              onClick={() => onOpenManualModal(primaryMachineId)}
              className="flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
            >
              <Plus className="h-3.5 w-3.5 stroke-[3]" />
              <span>Manual Real Input</span>
            </button>

            <button
              id="btn-dash-signout"
              onClick={logout}
              title="Sign Out"
              className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 transition-all"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. REAL-TIME SENSOR TELEMETRY CARDS (DS18B20, MPU6050, ACS712, RPM)       */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Signal className="h-4 w-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Real-Time Multi-Sensor Telemetry
                </h3>
                {/* Source Badge */}
                {latestReading?.source === 'REAL_HARDWARE' ? (
                  <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="h-3 w-3" /> REAL ESP32 HARDWARE
                  </span>
                ) : latestReading?.source === 'WOKWI' ? (
                  <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    SIMULATED (WOKWI)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                    NO ACTIVE SENSOR TELEMETRY
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Live sensor bus readings for active equipment &middot; Never synthesized or fabricated
              </p>
            </div>
          </div>

          {/* Machine Selector for Primary Readout */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 hidden sm:inline">Active Asset:</span>
            <select
              id="select-primary-machine"
              value={primaryMachineId}
              onChange={(e) => setPrimaryMachineId(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-cyan-300 focus:border-cyan-500 focus:outline-none"
            >
              {machines.map((m) => (
                <option key={m.machine_id} value={m.machine_id}>
                  {m.machine_id} - {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 4 Sensor Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Temperature Sensor (DS18B20) */}
          <div className="rounded-xl border border-amber-500/20 bg-slate-950/80 p-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                  <Flame className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Temperature
                  </span>
                  <div className="text-[10px] font-mono text-amber-400/80">DS18B20 1-Wire</div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                latestReading && latestReading.temperature !== undefined && latestReading.temperature !== null
                  ? latestReading.temperature > 80
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : latestReading.temperature > 70
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {latestReading && latestReading.temperature !== undefined && latestReading.temperature !== null
                  ? latestReading.temperature > 80 ? 'CRITICAL' : latestReading.temperature > 70 ? 'WARNING' : 'NORMAL'
                  : 'NOT CONFIGURED'}
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold text-white">
                {latestReading && latestReading.temperature !== undefined && latestReading.temperature !== null
                  ? `${latestReading.temperature.toFixed(1)}`
                  : 'NULL'}
              </span>
              <span className="font-mono text-sm text-amber-400 font-bold">°C</span>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-900 pt-2 font-mono">
              <span>Threshold: &le; 75.0°C</span>
              <span className="text-slate-500">
                {latestReading ? latestReading.source || 'REAL' : 'No Data'}
              </span>
            </div>
          </div>

          {/* 2. Vibration Sensor (MPU6050) */}
          <div className="rounded-xl border border-rose-500/20 bg-slate-950/80 p-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Vibration
                  </span>
                  <div className="text-[10px] font-mono text-rose-400/80">MPU6050 3-Axis</div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                latestReading && latestReading.vibration !== undefined && latestReading.vibration !== null
                  ? latestReading.vibration > 6
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : latestReading.vibration > 4
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {latestReading && latestReading.vibration !== undefined && latestReading.vibration !== null
                  ? latestReading.vibration > 6 ? 'CRITICAL' : latestReading.vibration > 4 ? 'WARNING' : 'NORMAL'
                  : 'NOT CONFIGURED'}
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold text-white">
                {latestReading && latestReading.vibration !== undefined && latestReading.vibration !== null
                  ? `${latestReading.vibration.toFixed(2)}`
                  : 'NULL'}
              </span>
              <span className="font-mono text-sm text-rose-400 font-bold">mm/s RMS</span>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-900 pt-2 font-mono">
              <span>ISO Limit: &le; 4.5 mm/s</span>
              <span className="text-slate-500">
                {latestReading ? latestReading.source || 'REAL' : 'No Data'}
              </span>
            </div>
          </div>

          {/* 3. Current Sensor (ACS712) */}
          <div className="rounded-xl border border-blue-500/20 bg-slate-950/80 p-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-cyan-400">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Current
                  </span>
                  <div className="text-[10px] font-mono text-cyan-400/80">ACS712 Hall Sensor</div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                latestReading && latestReading.current !== undefined && latestReading.current !== null
                  ? latestReading.current > 18
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    : latestReading.current > 14
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {latestReading && latestReading.current !== undefined && latestReading.current !== null
                  ? latestReading.current > 18 ? 'CRITICAL' : latestReading.current > 14 ? 'WARNING' : 'NORMAL'
                  : 'NOT CONFIGURED'}
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold text-white">
                {latestReading && latestReading.current !== undefined && latestReading.current !== null
                  ? `${latestReading.current.toFixed(1)}`
                  : 'NULL'}
              </span>
              <span className="font-mono text-sm text-cyan-400 font-bold">Amperes</span>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-900 pt-2 font-mono">
              <span>Rated: &le; 15.0 A</span>
              <span className="text-slate-500">
                {latestReading ? latestReading.source || 'REAL' : 'No Data'}
              </span>
            </div>
          </div>

          {/* 4. Speed Sensor (Hall-Effect RPM) */}
          <div className="rounded-xl border border-purple-500/20 bg-slate-950/80 p-4 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                  <Gauge className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Rotational Speed
                  </span>
                  <div className="text-[10px] font-mono text-purple-400/80">Hall-Effect Tach</div>
                </div>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                latestReading && latestReading.rpm !== undefined && latestReading.rpm !== null
                  ? latestReading.rpm < 800
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}>
                {latestReading && latestReading.rpm !== undefined && latestReading.rpm !== null
                  ? latestReading.rpm < 800 ? 'SLIP/LOW' : 'NORMAL'
                  : 'NOT CONFIGURED'}
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-3xl font-extrabold text-white">
                {latestReading && latestReading.rpm !== undefined && latestReading.rpm !== null
                  ? `${Math.round(latestReading.rpm)}`
                  : 'NULL'}
              </span>
              <span className="font-mono text-sm text-purple-400 font-bold">RPM</span>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-900 pt-2 font-mono">
              <span>Target: 1450 &plusmn; 50 RPM</span>
              <span className="text-slate-500">
                {latestReading ? latestReading.source || 'REAL' : 'No Data'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. HARDWARE CONNECTIVITY & SYSTEM STATUS BAR                               */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
        {/* Connectivity Status */}
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            deviceConnectionState === 'ONLINE'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : deviceConnectionState === 'OFFLINE'
              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              : 'bg-slate-800 text-slate-400'
          }`}>
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              ESP32 Device Status
            </div>
            <div className={`font-mono text-xs font-bold ${
              deviceConnectionState === 'ONLINE'
                ? 'text-emerald-400'
                : deviceConnectionState === 'OFFLINE'
                ? 'text-rose-400'
                : 'text-amber-400'
            }`}>
              {deviceConnectionState === 'ONLINE' ? 'ONLINE (HEARTBEAT VERIFIED)' : deviceConnectionState === 'OFFLINE' ? 'OFFLINE (STALE)' : 'WAITING FOR HARDWARE'}
            </div>
          </div>
        </div>

        {/* Total Time-Series Readings */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              PostgreSQL Telemetry Count
            </div>
            <div className="font-mono text-xs font-bold text-white">
              {totalReadings.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">verified records</span>
            </div>
          </div>
        </div>

        {/* Last Successful Update Time */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Last Telemetry Sync
            </div>
            <div className="font-mono text-xs font-bold text-slate-200 truncate max-w-[170px]" title={lastReadingTime}>
              {lastReadingTime}
            </div>
          </div>
        </div>

        {/* AI & Physics Model Status */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              AI Diagnostic State
            </div>
            <div className="text-xs font-bold text-amber-400 truncate max-w-[170px]" title={aiStatus?.status || 'Prototype Physics Engine'}>
              {aiStatus?.status || 'Prototype Physics Engine'}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. EXECUTIVE FLEET KPI CARDS                                              */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        <MetricCard
          id="kpi-total-machines"
          title="Total Assets"
          value={stats.total_machines}
          subValue="Registered machines"
          icon={Cpu}
          accentColor="blue"
        />
        <MetricCard
          id="kpi-total-devices"
          title="ESP32 Nodes"
          value={stats.total_devices}
          subValue="Sensor hardware"
          icon={Radio}
          accentColor="cyan"
        />
        <MetricCard
          id="kpi-connected-devices"
          title="Active Nodes"
          value={stats.connected_devices}
          subValue="Streaming now"
          icon={CheckCircle2}
          accentColor="emerald"
        />
        <MetricCard
          id="kpi-total-readings"
          title="Total Telemetry"
          value={stats.total_sensor_readings}
          subValue="Time-series rows"
          icon={Database}
          accentColor="purple"
        />
        <MetricCard
          id="kpi-active-alerts"
          title="Active Alerts"
          value={stats.active_alerts}
          subValue="Unresolved events"
          icon={Bell}
          accentColor="rose"
        />
        <MetricCard
          id="kpi-maint-records"
          title="Maintenance"
          value={stats.total_maintenance_records}
          subValue="Ground truth logs"
          icon={AlertTriangle}
          accentColor="amber"
        />
      </div>

      {/* ========================================================================= */}
      {/* 5. RECENT TELEMETRY HISTORY (POSTGRESQL TIME-SERIES AUDIT)                */}
      {/* ========================================================================= */}
      {recentTelemetry.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Recent Telemetry Ingest ({activePrimaryMachine?.name || primaryMachineId})
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              PostgreSQL Verified Frames
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="pb-2">Timestamp</th>
                  <th className="pb-2">Node ID</th>
                  <th className="pb-2">Temp (°C)</th>
                  <th className="pb-2">Vib (mm/s)</th>
                  <th className="pb-2">Current (A)</th>
                  <th className="pb-2">RPM</th>
                  <th className="pb-2 text-right">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recentTelemetry.slice(-6).reverse().map((r, i) => (
                  <tr key={r.id || i} className="hover:bg-slate-800/40">
                    <td className="py-2 text-slate-300">
                      {new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2 text-cyan-400 font-semibold">{r.device_id}</td>
                    <td className="py-2 text-amber-400">{r.temperature !== undefined ? `${r.temperature.toFixed(1)}°C` : 'NULL'}</td>
                    <td className="py-2 text-rose-400">{r.vibration !== undefined ? `${r.vibration.toFixed(2)}` : 'NULL'}</td>
                    <td className="py-2 text-cyan-300">{r.current !== undefined ? `${r.current.toFixed(1)}A` : 'NULL'}</td>
                    <td className="py-2 text-purple-300">{r.rpm !== undefined ? `${Math.round(r.rpm)}` : 'NULL'}</td>
                    <td className="py-2 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        r.source === 'REAL_HARDWARE' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-purple-500/20 text-purple-300'
                      }`}>
                        {r.source || 'REAL_HARDWARE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. FLEET FILTER & MACHINE ASSET GRID                                      */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              id="input-fleet-search"
              type="text"
              placeholder="Search equipment by Asset ID, Name, Location or Type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-700/80 bg-slate-950 py-2 pl-9 pr-3 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400 hidden sm:inline" />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
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
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1">
                {(['ALL', 'WOKWI', 'REAL_HARDWARE'] as const).map((source) => (
                  <button
                    key={source}
                    id={`filter-source-${source.toLowerCase()}`}
                    onClick={() => setSourceFilter(source)}
                    className={`rounded px-2.5 py-1 font-medium transition-all ${
                      sourceFilter === source
                        ? 'bg-violet-500/20 text-violet-300 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {source === 'ALL' ? 'ALL SOURCES' : source}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Machine Cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              Industrial Fleet Overview ({filteredMachines.length} of {machines.length})
            </h3>
            <span className="text-xs text-slate-400">
              PostgreSQL Asset Condition Index
            </span>
          </div>

          {filteredMachines.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 py-16 text-center">
              <Database className="h-10 w-10 text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">No real machine assets found.</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Waiting for real ESP32 sensor telemetry or registered equipment in PostgreSQL.
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
                  Manual Real Input
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
    </div>
  );
};
export default DashboardPage;
