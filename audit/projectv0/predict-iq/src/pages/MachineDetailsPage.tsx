import React, { useState, useEffect } from 'react';
import { Machine, SensorReading, Prediction, MaintenanceRecord, AIModelStatus } from '../types';
import api from '../services/api';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
} from 'recharts';
import {
  Cpu,
  Flame,
  Activity,
  Zap,
  Gauge,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Wrench,
  Sparkles,
  ArrowLeft,
  RefreshCw,
  Plus,
  Radio,
  Database,
  Info
} from 'lucide-react';

interface MachineDetailsPageProps {
  machineId: string;
  machines: Machine[];
  onSelectMachine: (id: string) => void;
  onBackToDashboard: () => void;
  onOpenManualModal: (machineId: string) => void;
}

export const MachineDetailsPage: React.FC<MachineDetailsPageProps> = ({
  machineId,
  machines,
  onSelectMachine,
  onBackToDashboard,
  onOpenManualModal,
}) => {
  const [machine, setMachine] = useState<Machine | null>(null);
  const [sensorHistory, setSensorHistory] = useState<SensorReading[]>([]);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [aiStatus, setAiStatus] = useState<AIModelStatus | null>(null);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeChartTab, setActiveChartTab] = useState<'all' | 'temp' | 'vib' | 'current'>('all');

  const fetchMachineData = async () => {
    try {
      const [m, history, pred, maint, ais] = await Promise.all([
        api.getMachineDetails(machineId).catch(() => null),
        api.getSensorData(machineId, 50).catch(() => []),
        api.getPrediction(machineId).catch(() => null),
        api.getMaintenanceHistory(machineId).catch(() => []),
        api.getAIModelStatus().catch(() => null)
      ]);

      if (m) setMachine(m);
      setSensorHistory(history);
      if (pred) setPrediction(pred);
      setMaintenanceRecords(maint);
      if (ais) setAiStatus(ais);
    } catch (err) {
      console.error('Failed to load machine details:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    fetchMachineData();
    const interval = setInterval(fetchMachineData, 4000);
    return () => clearInterval(interval);
  }, [machineId]);

  const currentReading = machine?.latest_reading || (sensorHistory.length > 0 ? sensorHistory[sensorHistory.length - 1] : null);

  // Prepare chart dataset from real readings
  const chartData = sensorHistory.map((r, index) => {
    const timeStr = new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return {
      time: timeStr,
      index,
      temperature: r.temperature,
      vibration: r.vibration,
      current: r.current,
      rpm: r.rpm,
    };
  });

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'Critical':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 px-3 py-1 text-xs font-bold text-rose-300">
            <AlertOctagon className="h-4 w-4" /> CRITICAL STATE
          </span>
        );
      case 'Warning':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-bold text-amber-300">
            <AlertTriangle className="h-4 w-4" /> ELEVATED PARAMETERS
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> NOMINAL HEALTH
          </span>
        );
    }
  };

  const isConnected = machine?.devices?.some(d => d.status === 'ONLINE');

  return (
    <div id="machine-details-page" className="space-y-6">
      {/* Top Header Navigation & Machine Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToDashboard}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-slate-800 px-2.5 py-0.5 font-mono text-xs font-bold text-cyan-400 border border-cyan-500/30">
                {machineId}
              </span>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {machine?.name || `Machine Asset ${machineId}`}
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {machine?.type} • {machine?.location}
            </p>
          </div>
        </div>

        {/* Machine Switcher & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="select-active-machine-inspect"
            value={machineId}
            onChange={(e) => onSelectMachine(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            {machines.map((m) => (
              <option key={m.machine_id} value={m.machine_id}>
                {m.machine_id} - {m.name} ({m.status})
              </option>
            ))}
          </select>

          <button
            onClick={() => onOpenManualModal(machineId)}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
          >
            <Plus className="h-3.5 w-3.5 stroke-[3]" />
            <span>Manual Input</span>
          </button>

          <button
            onClick={fetchMachineData}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 4 Core Real Telemetry Gauges */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Temperature */}
        <div className="rounded-xl border border-amber-500/20 bg-slate-900/80 p-4 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Temperature
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <Flame className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white">
              {currentReading ? currentReading.temperature.toFixed(1) : '--'}
            </span>
            <span className="text-xs font-medium text-amber-400">°C</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800 pt-2">
            <span>Status:</span>
            <span className={currentReading ? 'text-emerald-400 font-mono' : 'text-slate-500 font-mono'}>
              {currentReading ? 'Real Sensor Data' : 'Waiting for Data'}
            </span>
          </div>
        </div>

        {/* Vibration */}
        <div className="rounded-xl border border-rose-500/20 bg-slate-900/80 p-4 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Vibration RMS
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white">
              {currentReading ? currentReading.vibration.toFixed(2) : '--'}
            </span>
            <span className="text-xs font-medium text-rose-400">mm/s</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800 pt-2">
            <span>Status:</span>
            <span className={currentReading ? 'text-emerald-400 font-mono' : 'text-slate-500 font-mono'}>
              {currentReading ? 'Real Sensor Data' : 'Waiting for Data'}
            </span>
          </div>
        </div>

        {/* Current */}
        <div className="rounded-xl border border-cyan-500/20 bg-slate-900/80 p-4 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Phase Current
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <Zap className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white">
              {currentReading ? currentReading.current.toFixed(1) : '--'}
            </span>
            <span className="text-xs font-medium text-cyan-400">A</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800 pt-2">
            <span>Status:</span>
            <span className={currentReading ? 'text-emerald-400 font-mono' : 'text-slate-500 font-mono'}>
              {currentReading ? 'Real Sensor Data' : 'Waiting for Data'}
            </span>
          </div>
        </div>

        {/* RPM */}
        <div className="rounded-xl border border-purple-500/20 bg-slate-900/80 p-4 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Rotational Speed
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <Gauge className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-white">
              {currentReading ? Math.round(currentReading.rpm) : '--'}
            </span>
            <span className="text-xs font-medium text-purple-400">RPM</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800 pt-2">
            <span>Status:</span>
            <span className={currentReading ? 'text-emerald-400 font-mono' : 'text-slate-500 font-mono'}>
              {currentReading ? 'Real Sensor Data' : 'Waiting for Data'}
            </span>
          </div>
        </div>
      </div>

      {/* AI Readiness Card */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900/90 to-blue-950/40 p-5 sm:p-6 shadow-xl backdrop-blur-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <Sparkles className="h-4 w-4" />
              </span>
              <h3 className="text-lg font-bold text-white">
                Predictive AI Diagnostics & RUL Status
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              AI Status: <span className="text-amber-400 font-mono">{aiStatus?.status || 'Waiting for real historical data'}</span>
            </p>
          </div>
          <div>{getStatusBadge(machine?.status)}</div>
        </div>

        {/* 4 Outcome Cards */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 text-center">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs font-medium text-slate-400">Failure Risk</div>
            <div className="font-mono text-lg font-bold text-slate-300 mt-2">
              Not available
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Awaiting real data</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs font-medium text-slate-400">Critical Component</div>
            <div className="font-mono text-lg font-bold text-slate-300 mt-2">
              Not available
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Requires trained model</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs font-medium text-slate-400">Remaining Life</div>
            <div className="font-mono text-lg font-bold text-slate-300 mt-2">
              Not available
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Empirical degradation</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs font-medium text-slate-400">Confidence Score</div>
            <div className="font-mono text-lg font-bold text-slate-300 mt-2">
              Not available
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Validation metric</div>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300 flex items-start gap-2.5">
          <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Predict IQ strictly operates on real historical data. Once sufficient sensor telemetry ({sensorHistory.length} readings stored for this asset) and maintenance logs are stored in PostgreSQL, the ML training pipeline will generate genuine predictive models with SHAP explanations.
          </p>
        </div>
      </div>

      {/* Real-time Telemetry Charts Section */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-400" /> PostgreSQL Historical Telemetry Stream
            </h3>
            <p className="text-xs text-slate-400">
              Showing {chartData.length} genuine readings stored for {machineId}
            </p>
          </div>

          {/* Chart View Switcher */}
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs">
            {[
              { id: 'all', label: 'All Telemetry' },
              { id: 'temp', label: 'Temperature' },
              { id: 'vib', label: 'Vibration' },
              { id: 'current', label: 'Current' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveChartTab(tab.id as any)}
                className={`rounded px-2.5 py-1 font-medium transition-all ${
                  activeChartTab === tab.id
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Charts Container */}
        <div className="mt-4 h-72 sm:h-80 w-full">
          {chartData.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
              <Database className="h-8 w-8 mb-2 text-slate-600" />
              <p className="text-sm font-medium text-slate-400">No sensor data available in PostgreSQL.</p>
              <p className="text-xs text-slate-500 mt-1">Ingest readings via ESP32 Wi-Fi or the Manual Input modal.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {activeChartTab === 'temp' ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} unit="°C" />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="temperature" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#tempGrad)" name="Temperature (°C)" />
                </AreaChart>
              ) : activeChartTab === 'vib' ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="vibGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} unit="mm/s" />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="vibration" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#vibGrad)" name="Vibration (mm/s)" />
                </AreaChart>
              ) : activeChartTab === 'current' ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="currGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} unit="A" />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="current" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#currGrad)" name="Current (A)" />
                </AreaChart>
              ) : (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={11} />
                  <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                  <Line yAxisId="left" type="monotone" dataKey="temperature" stroke="#f59e0b" strokeWidth={2} dot={false} name="Temp (°C)" />
                  <Line yAxisId="left" type="monotone" dataKey="vibration" stroke="#f43f5e" strokeWidth={2} dot={false} name="Vibration (mm/s)" />
                  <Line yAxisId="right" type="monotone" dataKey="current" stroke="#06b6d4" strokeWidth={2} dot={false} name="Current (A)" />
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Asset Maintenance Records Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Wrench className="h-4 w-4 text-cyan-400" /> PostgreSQL Maintenance Records for {machineId}
            </h3>
            <p className="text-xs text-slate-400">Ground-truth maintenance and failure events</p>
          </div>
        </div>

        {maintenanceRecords.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">No maintenance records logged in PostgreSQL for this equipment.</p>
        ) : (
          <div className="space-y-3">
            {maintenanceRecords.map((rec) => (
              <div
                key={rec.id}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs text-slate-300"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">{rec.issue_description}</span>
                  <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                    rec.status === 'Completed'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : rec.status === 'In Progress'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-blue-500/20 text-blue-300'
                  }`}>
                    {rec.status}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">{rec.maintenance_action}</p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800 pt-2">
                  <span>Tech: {rec.technician} • Component: {rec.component}</span>
                  <span>{new Date(rec.maintenance_date).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MachineDetailsPage;
