import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Server,
  Activity,
  BrainCircuit,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Flame,
  Zap,
  Gauge,
  Sliders,
  Play,
  Save,
  RotateCcw,
  Power,
  SlidersHorizontal,
  Info,
  Layers,
  AlertTriangle,
  Radio,
  Check,
  Cpu,
} from 'lucide-react';
import api from '../services/api';
import { Machine, SimulationMode } from '../types';
import { useAlarm } from '../context/AlarmContext';
import { useSimulation } from '../context/SimulationContext';
import AlarmSettingsModal from '../components/AlarmSettingsModal';

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

interface SettingsPageProps {
  machines?: Machine[];
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ machines = [] }) => {
  const {
    thresholds,
    audioSettings,
    audioState,
    enableAudio,
    playTestBeep,
  } = useAlarm();

  const {
    activeMachineId,
    setActiveMachineId,
    activeConfig,
    isLoadingConfig,
    hasUnsavedChanges,
    lastSavedAt,
    updateDraftConfig,
    saveActiveConfig,
    resetActiveConfig,
    toggleMotorPower,
    setSimulationMode,
    instantaneous,
    isSimulationMode,
    setIsSimulationMode,
  } = useSimulation();

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // System Health Status State
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

  // Validation checks for current draft inputs
  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    const cfg = activeConfig;

    if (cfg.temp_min >= cfg.temp_max) {
      errs.push(`Temperature Min (${cfg.temp_min}°C) must be strictly less than Max (${cfg.temp_max}°C)`);
    }
    if (cfg.temp_warning >= cfg.temp_critical) {
      errs.push(`Temperature Warning (${cfg.temp_warning}°C) must be less than Critical (${cfg.temp_critical}°C)`);
    }
    if (cfg.current_min >= cfg.current_max) {
      errs.push(`Current Min (${cfg.current_min}A) must be strictly less than Max (${cfg.current_max}A)`);
    }
    if (cfg.current_warning >= cfg.current_critical) {
      errs.push(`Current Warning (${cfg.current_warning}A) must be less than Critical (${cfg.current_critical}A)`);
    }
    if (cfg.rpm_min >= cfg.rpm_max) {
      errs.push(`RPM Min (${cfg.rpm_min}) must be strictly less than Max (${cfg.rpm_max})`);
    }
    if (cfg.rpm_critical >= cfg.rpm_warning) {
      errs.push(`RPM Critical stall (${cfg.rpm_critical}) must be less than Warning (${cfg.rpm_warning})`);
    }
    if (cfg.vib_min >= cfg.vib_max) {
      errs.push(`Vibration Min (${cfg.vib_min} m/s²) must be strictly less than Max (${cfg.vib_max} m/s²)`);
    }
    if (cfg.vib_warning >= cfg.vib_critical) {
      errs.push(`Vibration Warning (${cfg.vib_warning} m/s²) must be less than Critical (${cfg.vib_critical} m/s²)`);
    }
    if (cfg.update_interval_ms < 100 || cfg.update_interval_ms > 10000) {
      errs.push('Simulation update interval must be between 100ms and 10,000ms');
    }
    return errs;
  }, [activeConfig]);

  const isValid = validationErrors.length === 0;

  // Handle Save
  const handleSave = async () => {
    if (!isValid) return;
    setIsSaving(true);
    setSaveFeedback(null);
    try {
      const res = await saveActiveConfig();
      if (res.success) {
        setSaveFeedback({ type: 'success', message: 'Simulation settings saved to PostgreSQL database!' });
        setTimeout(() => setSaveFeedback(null), 4000);
      } else {
        setSaveFeedback({ type: 'error', message: res.message || 'Failed to save configuration' });
      }
    } catch (err: any) {
      setSaveFeedback({ type: 'error', message: err.message || 'Error occurred while saving' });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Reset
  const handleReset = async () => {
    if (window.confirm(`Reset simulation parameters for machine ${activeMachineId} back to factory defaults?`)) {
      await resetActiveConfig();
      setSaveFeedback({ type: 'success', message: 'Parameters reset to factory defaults!' });
      setTimeout(() => setSaveFeedback(null), 3500);
    }
  };

  return (
    <div id="settings-page" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. TOP HEADER & MACHINE SELECTOR */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-cyan-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">
              Digital Twin Simulation Configuration
            </h2>
            <span className="text-[10px] font-mono uppercase bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">
              Dynamic Physics Engine
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure dynamic range, increment steps, update intervals, and alert thresholds for Temperature, Motor Current, RPM, and Vibration.
          </p>
        </div>

        {/* Action Controls & Machine Selector */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Machine Asset Picker */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 shadow-sm">
            <Cpu className="h-4 w-4 text-cyan-400 shrink-0" />
            <span className="text-xs font-bold text-slate-400">Target Asset:</span>
            <select
              value={activeMachineId}
              onChange={(e) => setActiveMachineId(e.target.value)}
              className="bg-transparent text-xs font-mono font-bold text-white focus:outline-none cursor-pointer"
            >
              {machines.length > 0 ? (
                machines.map((m) => (
                  <option key={m.machine_id} value={m.machine_id} className="bg-slate-900 text-white">
                    {m.machine_id} - {m.name}
                  </option>
                ))
              ) : (
                <option value="M001" className="bg-slate-900 text-white">M001 - Induction Motor</option>
              )}
            </select>
          </div>

          {/* Reset Defaults Button */}
          <button
            onClick={handleReset}
            disabled={isLoadingConfig || isSaving}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-600 transition-all shadow-sm disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
            <span>Reset Defaults</span>
          </button>

          {/* Save Configuration Button */}
          <button
            onClick={handleSave}
            disabled={!isValid || isSaving || isLoadingConfig}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-bold text-slate-950 hover:brightness-110 active:scale-[0.98] transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50"
          >
            {isSaving ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span>Save Configuration</span>
          </button>
        </div>
      </div>

      {/* Unsaved Changes & Last Saved Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs">
        <div className="flex items-center gap-3">
          {hasUnsavedChanges ? (
            <span className="flex items-center gap-1.5 font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/30 animate-pulse">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Unsaved Changes Detected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
              <Check className="h-3.5 w-3.5 shrink-0" />
              Configuration Synchronized
            </span>
          )}
          {lastSavedAt && (
            <span className="text-slate-400 font-mono text-[11px]">
              Last persistent save: {new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>

        {/* Mode active toggle */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">Engine State:</span>
          <button
            onClick={() => setIsSimulationMode(!isSimulationMode)}
            className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all border ${
              isSimulationMode
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {isSimulationMode ? '● SIMULATION RUNNING' : '○ SIMULATION PAUSED'}
          </button>
        </div>
      </div>

      {/* Validation Errors Display */}
      {validationErrors.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300 space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-rose-400">
            <AlertCircle className="h-4 w-4" /> Please resolve configuration constraints:
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-rose-200/90 pl-1">
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Save Feedback Banner */}
      {saveFeedback && (
        <div
          className={`rounded-xl border p-3 text-xs flex items-center gap-2 transition-all ${
            saveFeedback.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-semibold'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300 font-semibold'
          }`}
        >
          {saveFeedback.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          )}
          <span>{saveFeedback.message}</span>
        </div>
      )}

      {/* 2. GLOBAL SIMULATION MODE & TIMING CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl backdrop-blur-md space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Simulation Algorithm & Tick Timing
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Current Interval: <strong className="text-cyan-400">{activeConfig.update_interval_ms}ms</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Simulation Mode Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300">Simulation Wave Pattern</label>
            <select
              value={activeConfig.simulation_mode}
              onChange={(e) => updateDraftConfig({ simulation_mode: e.target.value as SimulationMode })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-cyan-400 transition-all cursor-pointer"
            >
              <option value="cycling">🔄 Natural Cycling (Oscillates within configured range)</option>
              <option value="increasing">📈 Increasing (Monotonic climb toward Max)</option>
              <option value="decreasing">📉 Decreasing (Monotonic drop toward Min)</option>
              <option value="harmonic">🌊 Harmonic Resonance (Multi-frequency vibration wave)</option>
              <option value="bearing_fault">⚠️ Bearing Fault Injection (Impulse spikes & thermal rise)</option>
              <option value="random_walk">🎲 Random Walk (Stochastic industrial drift)</option>
            </select>
            <p className="text-[11px] text-slate-500">
              Determines how values progress over time towards configured targets.
            </p>
          </div>

          {/* Update Interval Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300">Simulation Update Interval (ms)</label>
            <div className="grid grid-cols-4 gap-1.5">
              {[250, 500, 1000, 2000].map((ms) => (
                <button
                  key={ms}
                  type="button"
                  onClick={() => updateDraftConfig({ update_interval_ms: ms })}
                  className={`py-2 text-xs font-mono font-bold rounded-xl border transition-all ${
                    activeConfig.update_interval_ms === ms
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/20'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Refresh frequency of simulated telemetry clock ticks.
            </p>
          </div>

          {/* Motor Main Power State Switch */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-300">Motor Main Contactor (Simulation Control)</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateDraftConfig({ motor_powered: true })}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                  activeConfig.motor_powered
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                    : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                <Power className="h-3.5 w-3.5 text-emerald-400" />
                <span>POWER ON</span>
              </button>
              <button
                type="button"
                onClick={() => updateDraftConfig({ motor_powered: false })}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                  !activeConfig.motor_powered
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm shadow-rose-500/20'
                    : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'
                }`}
              >
                <Power className="h-3.5 w-3.5 text-rose-400" />
                <span>POWER OFF</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              When OFF, RPM smoothly decelerates to zero and current drops.
            </p>
          </div>
        </div>
      </div>

      {/* 3. FOUR CORE TELEMETRY CONFIGURATION CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* =========================================================================
            CARD 1: TEMPERATURE CONFIGURATION
            ========================================================================= */}
        <div className="rounded-2xl border border-amber-500/20 bg-slate-900/90 p-5 shadow-xl space-y-4 relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Temperature Simulation</h3>
            </div>
            <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/30">
              Live: {instantaneous.temperature.toFixed(1)}°C ({instantaneous.status_temp})
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Min Temp */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Min Temp (°C)</label>
              <input
                type="number"
                step="0.5"
                value={activeConfig.temp_min}
                onChange={(e) => updateDraftConfig({ temp_min: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Max Temp */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Max Temp (°C)</label>
              <input
                type="number"
                step="0.5"
                value={activeConfig.temp_max}
                onChange={(e) => updateDraftConfig({ temp_max: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Target Temp */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Target Temp (°C)</label>
              <input
                type="number"
                step="0.5"
                value={activeConfig.temp_target}
                onChange={(e) => updateDraftConfig({ temp_target: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Step Size */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Increment Step (°C)</label>
              <input
                type="number"
                step="0.05"
                value={activeConfig.temp_step}
                onChange={(e) => updateDraftConfig({ temp_step: parseFloat(e.target.value) || 0.1 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Warning Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-amber-400">Warning Limit (°C)</label>
              <input
                type="number"
                step="0.5"
                value={activeConfig.temp_warning}
                onChange={(e) => updateDraftConfig({ temp_warning: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Critical Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-rose-400">Critical Limit (°C)</label>
              <input
                type="number"
                step="0.5"
                value={activeConfig.temp_critical}
                onChange={(e) => updateDraftConfig({ temp_critical: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-rose-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-rose-300 focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span>Operating Range: <strong className="text-white">{activeConfig.temp_min}°C – {activeConfig.temp_max}°C</strong></span>
            <span>Alerts: <strong className="text-amber-400">&ge;{activeConfig.temp_warning}°C</strong> | <strong className="text-rose-400">&ge;{activeConfig.temp_critical}°C</strong></span>
          </div>
        </div>

        {/* =========================================================================
            CARD 2: MOTOR CURRENT CONFIGURATION
            ========================================================================= */}
        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/90 p-5 shadow-xl space-y-4 relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">Motor Current Simulation</h3>
            </div>
            <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/30">
              Live: {instantaneous.current.toFixed(2)} A ({instantaneous.status_current})
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Min Current */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Min Current (A)</label>
              <input
                type="number"
                step="0.1"
                value={activeConfig.current_min}
                onChange={(e) => updateDraftConfig({ current_min: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400 transition-all"
              />
            </div>

            {/* Max Current */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Max Limit (A)</label>
              <input
                type="number"
                step="0.1"
                value={activeConfig.current_max}
                onChange={(e) => updateDraftConfig({ current_max: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400 transition-all"
              />
            </div>

            {/* Target Current */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Target Current (A)</label>
              <input
                type="number"
                step="0.1"
                value={activeConfig.current_target}
                onChange={(e) => updateDraftConfig({ current_target: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400 transition-all"
              />
            </div>

            {/* Step Size */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Increment Step (A)</label>
              <input
                type="number"
                step="0.02"
                value={activeConfig.current_step}
                onChange={(e) => updateDraftConfig({ current_step: parseFloat(e.target.value) || 0.05 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400 transition-all"
              />
            </div>

            {/* Warning Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-amber-400">Warning Limit (A)</label>
              <input
                type="number"
                step="0.1"
                value={activeConfig.current_warning}
                onChange={(e) => updateDraftConfig({ current_warning: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Critical Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-rose-400">Critical Limit (A)</label>
              <input
                type="number"
                step="0.1"
                value={activeConfig.current_critical}
                onChange={(e) => updateDraftConfig({ current_critical: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-rose-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-rose-300 focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span>Operating Range: <strong className="text-white">{activeConfig.current_min}A – {activeConfig.current_max}A</strong></span>
            <span>Alerts: <strong className="text-amber-400">&ge;{activeConfig.current_warning}A</strong> | <strong className="text-rose-400">&ge;{activeConfig.current_critical}A</strong></span>
          </div>
        </div>

        {/* =========================================================================
            CARD 3: RPM SIMULATION CONFIGURATION
            ========================================================================= */}
        <div className="rounded-2xl border border-purple-500/20 bg-slate-900/90 p-5 shadow-xl space-y-4 relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-purple-400" />
              <h3 className="text-sm font-bold text-white">Shaft Velocity (RPM) Simulation</h3>
            </div>
            <span className="text-xs font-mono font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md border border-purple-500/30">
              Live: {instantaneous.rpm} RPM ({instantaneous.status_rpm})
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Min RPM */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Min RPM</label>
              <input
                type="number"
                step="50"
                value={activeConfig.rpm_min}
                onChange={(e) => updateDraftConfig({ rpm_min: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-400 transition-all"
              />
            </div>

            {/* Max RPM */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Physical Max RPM</label>
              <input
                type="number"
                step="50"
                value={activeConfig.rpm_max}
                onChange={(e) => updateDraftConfig({ rpm_max: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-400 transition-all"
              />
            </div>

            {/* Target RPM */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Target Operating RPM</label>
              <input
                type="number"
                step="50"
                value={activeConfig.rpm_target}
                onChange={(e) => updateDraftConfig({ rpm_target: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-400 transition-all"
              />
            </div>

            {/* Step Size */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Step Acceleration (RPM)</label>
              <input
                type="number"
                step="10"
                value={activeConfig.rpm_step}
                onChange={(e) => updateDraftConfig({ rpm_step: parseFloat(e.target.value) || 20 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-purple-400 transition-all"
              />
            </div>

            {/* Warning Low-Speed Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-amber-400">Low RPM Warning</label>
              <input
                type="number"
                step="50"
                value={activeConfig.rpm_warning}
                onChange={(e) => updateDraftConfig({ rpm_warning: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Critical Stall Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-rose-400">Stall Critical RPM</label>
              <input
                type="number"
                step="50"
                value={activeConfig.rpm_critical}
                onChange={(e) => updateDraftConfig({ rpm_critical: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-rose-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-rose-300 focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span>Target: <strong className="text-white">{activeConfig.rpm_target} RPM</strong> (Rated: {activeConfig.rpm_rated} RPM)</span>
            <span>Alerts: <strong className="text-amber-400">&lt;{activeConfig.rpm_warning}</strong> | <strong className="text-rose-400">&lt;{activeConfig.rpm_critical} RPM</strong></span>
          </div>
        </div>

        {/* =========================================================================
            CARD 4: VIBRATION SIMULATION CONFIGURATION
            ========================================================================= */}
        <div className="rounded-2xl border border-rose-500/20 bg-slate-900/90 p-5 shadow-xl space-y-4 relative overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-rose-400" />
              <h3 className="text-sm font-bold text-white">Vibration Simulation (ISO 10816)</h3>
            </div>
            <span className="text-xs font-mono font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-md border border-rose-500/30">
              Live: {instantaneous.vibration.toFixed(2)} m/s² ({instantaneous.status_vibration})
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {/* Min Vibration */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Min Baseline (m/s²)</label>
              <input
                type="number"
                step="0.05"
                value={activeConfig.vib_min}
                onChange={(e) => updateDraftConfig({ vib_min: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>

            {/* Max Vibration */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Max Limit (m/s²)</label>
              <input
                type="number"
                step="0.1"
                value={activeConfig.vib_max}
                onChange={(e) => updateDraftConfig({ vib_max: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>

            {/* Target Vibration */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Target Vib (m/s²)</label>
              <input
                type="number"
                step="0.05"
                value={activeConfig.vib_target}
                onChange={(e) => updateDraftConfig({ vib_target: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>

            {/* Step Size */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400">Increment Step (m/s²)</label>
              <input
                type="number"
                step="0.01"
                value={activeConfig.vib_step}
                onChange={(e) => updateDraftConfig({ vib_step: parseFloat(e.target.value) || 0.02 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>

            {/* Warning Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-amber-400">Warning Limit (m/s²)</label>
              <input
                type="number"
                step="0.05"
                value={activeConfig.vib_warning}
                onChange={(e) => updateDraftConfig({ vib_warning: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-400 transition-all"
              />
            </div>

            {/* Critical Threshold */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-rose-400">Critical Limit (m/s²)</label>
              <input
                type="number"
                step="0.05"
                value={activeConfig.vib_critical}
                onChange={(e) => updateDraftConfig({ vib_critical: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-rose-500/40 rounded-xl px-3 py-1.5 text-xs font-mono text-rose-300 focus:outline-none focus:border-rose-400 transition-all"
              />
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span>Operating Range: <strong className="text-white">{activeConfig.vib_min} – {activeConfig.vib_max} m/s²</strong></span>
            <span>Alerts: <strong className="text-amber-400">&ge;{activeConfig.vib_warning}</strong> | <strong className="text-rose-400">&ge;{activeConfig.vib_critical} m/s²</strong></span>
          </div>
        </div>
      </div>

      {/* 4. PRESERVED SYSTEM STATUS & AUDIO ALARM DIAGNOSTICS */}
      <div className="pt-6 border-t border-slate-800 space-y-6">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight">System Infrastructure & Audio Synthesizer</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Backend FastAPI service health, PostgreSQL state, and Web Audio API tone synthesizer.
          </p>
        </div>

        {/* Backend Status */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Server className="h-4 w-4 text-cyan-400" /> Backend Service Health
            </h4>
            <button
              onClick={fetchStatus}
              disabled={status.backend === 'loading'}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${status.backend === 'loading' ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              {status.backend === 'online' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
              ) : status.backend === 'offline' ? (
                <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
              ) : (
                <RefreshCw className="h-5 w-5 text-slate-500 shrink-0 animate-spin" />
              )}
              <div>
                <div className="text-xs font-bold text-slate-300">FastAPI Backend</div>
                <div className={`text-xs font-mono font-bold ${status.backend === 'online' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {status.backend === 'loading' ? 'Checking...' : status.backend === 'online' ? 'Online & Responsive' : 'Offline'}
                </div>
                {status.backendInfo && (
                  <div className="text-[11px] text-slate-500 mt-0.5">{status.backendInfo}</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <Database className={`h-5 w-5 shrink-0 ${status.database === 'PostgreSQL' ? 'text-emerald-400' : 'text-slate-500'}`} />
              <div>
                <div className="text-xs font-bold text-slate-300">Relational Database</div>
                <div className={`text-xs font-mono font-bold ${status.database === 'PostgreSQL' ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {status.database}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">Persistent Storage Active</div>
              </div>
            </div>
          </div>
        </div>

        {/* Audio Alarm Synthesizer */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-rose-400" /> Industrial Audio Alarm Synthesizer
            </h4>
            <div className="flex items-center gap-2">
              <button
                onClick={() => playTestBeep()}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-all shadow-sm"
              >
                <Play className="h-3.5 w-3.5 text-cyan-400" />
                <span>Test Audio Beep</span>
              </button>
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-cyan-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>Alarm Audio Modal</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <Volume2 className={`h-5 w-5 shrink-0 ${audioState === 'running' ? 'text-emerald-400' : 'text-amber-400'}`} />
              <div>
                <div className="text-xs font-bold text-slate-300">Web Audio API</div>
                <div className={`text-xs font-mono font-bold ${audioState === 'running' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {audioState === 'running' ? 'ACTIVE & READY' : audioState.toUpperCase()}
                </div>
                {audioState === 'suspended' && (
                  <button
                    onClick={enableAudio}
                    className="mt-1 text-[11px] font-bold text-yellow-400 underline hover:text-yellow-300"
                  >
                    Enable Audio Output
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <Sliders className="h-5 w-5 text-cyan-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-slate-300">Tone Synthesis</div>
                <div className="text-xs font-mono text-slate-200">
                  {audioSettings.frequency}Hz &middot; {audioSettings.intervalMs}ms &middot; {Math.round(audioSettings.volume * 100)}% vol
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <BrainCircuit className="h-5 w-5 text-purple-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-slate-300">AI Model Status</div>
                <div className="text-xs font-mono text-slate-200">
                  {status.aiStatus} ({status.aiTrained ? 'Trained Model' : 'Physics Prototype'})
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AlarmSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
};

export default SettingsPage;
