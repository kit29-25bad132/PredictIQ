import React, { useState, useEffect } from 'react';
import {
  Database,
  Server,
  Activity,
  BrainCircuit,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Radio,
} from 'lucide-react';
import api from '../services/api';

interface SystemStatus {
  backend: 'loading' | 'online' | 'offline';
  backendInfo: string;
  database: string;
  activeMachines: number;
  registeredDevices: number;
  totalReadings: number;
  aiStatus: string;
  aiTrained: boolean;
}

export const SettingsPage: React.FC = () => {
  const [status, setStatus] = useState<SystemStatus>({
    backend: 'loading',
    backendInfo: '',
    database: '—',
    activeMachines: 0,
    registeredDevices: 0,
    totalReadings: 0,
    aiStatus: '—',
    aiTrained: false,
  });

  const fetchStatus = async () => {
    setStatus((s) => ({ ...s, backend: 'loading' }));
    try {
      const [health, modelStatus] = await Promise.all([
        api.getHealth(),
        api.getAIModelStatus().catch(() => ({ status: 'Unknown', trained_model_exists: false })),
      ]);
      setStatus({
        backend: 'online',
        backendInfo: `${health.system} v${health.version}`,
        database: health.database,
        activeMachines: health.active_machines,
        registeredDevices: health.registered_devices,
        totalReadings: health.total_sensor_readings,
        aiStatus: modelStatus.status || 'Unknown',
        aiTrained: modelStatus.trained_model_exists || false,
      });
    } catch {
      setStatus((s) => ({
        ...s,
        backend: 'offline',
        backendInfo: 'Unreachable',
        database: 'Unknown',
        aiStatus: 'Unknown',
      }));
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div id="settings-page" className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">System Status</h2>
        <p className="text-xs text-slate-400 mt-1">
          Backend connectivity and component health overview
        </p>
      </div>

      {/* Backend Status */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Server className="h-5 w-5 text-cyan-400" /> Backend Service
          </h3>
          <button
            onClick={fetchStatus}
            disabled={status.backend === 'loading'}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-600 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status.backend === 'loading' ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Backend */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
            {status.backend === 'online' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            ) : status.backend === 'offline' ? (
              <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
            ) : (
              <RefreshCw className="h-5 w-5 text-slate-500 shrink-0 animate-spin" />
            )}
            <div>
              <div className="text-xs font-bold text-slate-300">Backend</div>
              <div className={`text-xs font-mono ${status.backend === 'online' ? 'text-emerald-400' : status.backend === 'offline' ? 'text-rose-400' : 'text-slate-500'}`}>
                {status.backend === 'loading' ? 'Checking...' : status.backend === 'online' ? 'Online' : 'Offline'}
              </div>
              {status.backendInfo && (
                <div className="text-[11px] text-slate-500 mt-0.5">{status.backendInfo}</div>
              )}
            </div>
          </div>

          {/* Database */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
            <Database className={`h-5 w-5 shrink-0 ${status.database === 'PostgreSQL' ? 'text-emerald-400' : 'text-slate-500'}`} />
            <div>
              <div className="text-xs font-bold text-slate-300">Database</div>
              <div className={`text-xs font-mono ${status.database === 'PostgreSQL' ? 'text-emerald-400' : 'text-slate-500'}`}>
                {status.database}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fleet Summary */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-400" /> Fleet Summary
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">
            <div className="text-2xl font-black text-cyan-400 font-mono">{status.activeMachines}</div>
            <div className="text-xs text-slate-400 mt-1">Active Machines</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">
            <div className="text-2xl font-black text-cyan-400 font-mono">{status.registeredDevices}</div>
            <div className="text-xs text-slate-400 mt-1">Registered Devices</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-center">
            <div className="text-2xl font-black text-cyan-400 font-mono">{status.totalReadings.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">Sensor Readings</div>
          </div>
        </div>
      </div>

      {/* AI Model Status */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-purple-400" /> AI Model
        </h3>
        <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
          {status.aiTrained ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-slate-500 shrink-0" />
          )}
          <div>
            <div className="text-xs font-bold text-slate-300">Model Status</div>
            <div className="text-xs font-mono text-slate-400">{status.aiStatus}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
