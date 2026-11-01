import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Machine, SensorReading, Alert } from '../types';
import api from '../services/api';
import {
  Activity,
  Flame,
  Zap,
  Gauge,
  Radio,
  RefreshCw,
  Cpu,
  Play,
  Pause,
  Terminal,
  Signal,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Database,
  BarChart2,
  Layers,
  TrendingUp,
  Sparkles,
  SlidersHorizontal,
  RotateCcw,
  Power,
  Sliders,
  Check,
  XCircle,
  Eye,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { useAlarm } from '../context/AlarmContext';
import { useSimulation, TimeWindow } from '../context/SimulationContext';

interface LiveMonitoringPageProps {
  machines: Machine[];
  onSelectMachine: (id: string) => void;
  onOpenManualModal: (id: string) => void;
}

type ActiveChannel = 'all' | 'vibration' | 'temperature' | 'current' | 'rpm';

// Safe number formatter
const fmt = (val: number | null | undefined, decimals = 1, fallback = '--'): string => {
  if (val === null || val === undefined || isNaN(Number(val))) return fallback;
  return Number(val).toFixed(decimals);
};

export const LiveMonitoringPage: React.FC<LiveMonitoringPageProps> = ({
  machines,
  onSelectMachine,
  onOpenManualModal,
}) => {
  const { thresholds } = useAlarm();
  const {
    activeMachineId,
    setActiveMachineId,
    activeConfig,
    instantaneous,
    historyBuffer,
    timeWindow,
    setTimeWindow,
    clearHistory,
    isSimulationMode,
    setIsSimulationMode,
    toggleMotorPower,
    setSimulationMode,
  } = useSimulation();

  // Selected Machine State
  const activeMachine = useMemo(() => {
    return machines.find((m) => m.machine_id === activeMachineId) || machines[0] || null;
  }, [machines, activeMachineId]);

  // UI state
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>('all');
  const [chartType, setChartType] = useState<'area' | 'line'>('area');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [packetLogs, setPacketLogs] = useState<
    Array<{ id: string; time: string; text: string; source: string; status: 'CRITICAL' | 'WARNING' | 'OK' }>
  >([]);

  // Telemetry buffer: frozen snapshot if paused, otherwise live buffer from SimulationContext
  const activeWaveBuffer = useMemo(() => {
    return historyBuffer;
  }, [historyBuffer]);

  // Periodic simulated packet logs in the terminal
  useEffect(() => {
    if (activeWaveBuffer.length === 0) return;
    const latest = activeWaveBuffer[activeWaveBuffer.length - 1];
    const isCrit =
      latest.status_temp === 'CRITICAL' ||
      latest.status_vibration === 'CRITICAL' ||
      latest.status_current === 'CRITICAL' ||
      latest.status_rpm === 'CRITICAL';
    const isWarn =
      latest.status_temp === 'WARNING' ||
      latest.status_vibration === 'WARNING' ||
      latest.status_current === 'WARNING' ||
      latest.status_rpm === 'WARNING';

    setPacketLogs((prev) => [
      {
        id: `PKT-${Date.now()}-${latest.index}`,
        time: latest.time,
        text: `[${isSimulationMode ? 'SIMULATION' : 'POSTGRESQL'}] ${activeMachineId} -> Temp: ${latest.temperature}°C, Vib: ${latest.vibration} m/s², Curr: ${latest.current}A, RPM: ${latest.rpm} (${activeConfig.simulation_mode.toUpperCase()})`,
        source: isSimulationMode ? 'SIMULATED / DYNAMIC_CONFIG' : 'ESP32_HARDWARE',
        status: isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'OK',
      },
      ...prev.slice(0, 25),
    ]);
  }, [activeWaveBuffer, activeMachineId, activeConfig.simulation_mode, isSimulationMode]);

  // Compute live waveform analysis metrics from the active rolling buffer
  const analysisMetrics = useMemo(() => {
    if (activeWaveBuffer.length === 0) {
      return {
        vibrationRms: instantaneous.vibration,
        vibrationPeak: instantaneous.vibration,
        vibrationMin: instantaneous.vibration,
        crestFactor: 1.41,
        tempAvg: instantaneous.temperature,
        tempTrend: 0,
        isoZone: 'Zone A (Excellent)',
        isoColor: 'text-emerald-400',
        isoBg: 'bg-emerald-500/10 border-emerald-500/30',
      };
    }

    const vibs = activeWaveBuffer.map((p) => p.vibration);
    const temps = activeWaveBuffer.map((p) => p.temperature);

    const vibMax = Math.max(...vibs);
    const vibMin = Math.min(...vibs);
    const vibSumSquares = vibs.reduce((acc, v) => acc + v * v, 0);
    const vibRms = Math.sqrt(vibSumSquares / vibs.length);
    const crestFactor = vibRms > 0 ? vibMax / vibRms : 1.41;

    const tempAvg = temps.reduce((acc, t) => acc + t, 0) / temps.length;
    const tempTrend = temps.length >= 2 ? temps[temps.length - 1] - temps[0] : 0;

    // ISO 10816-3 Vibration Severity Classification based on configured thresholds
    let isoZone = 'Zone A (Excellent / Nominal)';
    let isoColor = 'text-emerald-400';
    let isoBg = 'bg-emerald-500/10 border-emerald-500/30';

    if (vibMax >= activeConfig.vib_critical || vibRms >= activeConfig.vib_critical) {
      isoZone = 'Zone D (Critical Danger / Shutdown)';
      isoColor = 'text-rose-400';
      isoBg = 'bg-rose-500/20 border-rose-500/40';
    } else if (vibMax >= activeConfig.vib_warning || vibRms >= activeConfig.vib_warning) {
      isoZone = 'Zone C (Warning / Alarm Threshold)';
      isoColor = 'text-amber-400';
      isoBg = 'bg-amber-500/20 border-amber-500/40';
    } else if (vibRms >= activeConfig.vib_warning * 0.7) {
      isoZone = 'Zone B (Acceptable Continuous Operation)';
      isoColor = 'text-cyan-400';
      isoBg = 'bg-cyan-500/10 border-cyan-500/30';
    }

    return {
      vibrationRms: vibRms,
      vibrationPeak: vibMax,
      vibrationMin: vibMin,
      crestFactor,
      tempAvg,
      tempTrend,
      isoZone,
      isoColor,
      isoBg,
    };
  }, [activeWaveBuffer, instantaneous, activeConfig]);

  // Overall system dynamic status
  const isCurrentlyCritical =
    instantaneous.status_temp === 'CRITICAL' ||
    instantaneous.status_vibration === 'CRITICAL' ||
    instantaneous.status_current === 'CRITICAL' ||
    instantaneous.status_rpm === 'CRITICAL';

  const isCurrentlyWarning =
    instantaneous.status_temp === 'WARNING' ||
    instantaneous.status_vibration === 'WARNING' ||
    instantaneous.status_current === 'WARNING' ||
    instantaneous.status_rpm === 'WARNING';

  const currentStatus = isCurrentlyCritical ? 'CRITICAL' : isCurrentlyWarning ? 'WARNING' : 'NORMAL';

  return (
    <div id="live-monitoring-page" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* ========================================================================= */}
      {/* 1. TOP CONTROLLER & STREAMING DASHBOARD BAR */}
      {/* ========================================================================= */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-inner">
            <Activity className={`h-6 w-6 ${isSimulationMode && !isPaused ? 'animate-pulse' : ''}`} />
            {isSimulationMode && !isPaused && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Real-Time Telemetry & Oscilloscope</h2>
              
              {/* Simulation Mode Badge */}
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                <Sparkles className="h-3 w-3" />
                {isSimulationMode ? 'SIMULATION MODE (DYNAMIC CONFIG)' : 'REAL ESP32 HARDWARE'}
              </span>

              {/* Overall Status Badge */}
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold border ${
                  currentStatus === 'CRITICAL'
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                    : currentStatus === 'WARNING'
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                }`}
              >
                {currentStatus === 'CRITICAL' ? (
                  <AlertOctagon className="h-3 w-3" />
                ) : currentStatus === 'WARNING' ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                {currentStatus}
              </span>

              {/* Motor Power Status Badge */}
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold border ${
                  instantaneous.motor_powered
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}
              >
                <Power className="h-3 w-3" />
                {instantaneous.motor_powered ? 'MOTOR ENERGIZED' : 'MOTOR STOPPED / DE-ENERGIZED'}
              </span>
            </div>

            <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
              <span>Asset: <strong className="text-white font-mono">{activeMachine ? `${activeMachine.machine_id} (${activeMachine.name})` : activeMachineId}</strong></span>
              <span>•</span>
              <span>Tick Interval: <strong className="text-cyan-400 font-mono">{activeConfig.update_interval_ms}ms</strong></span>
              <span>•</span>
              <span>Buffer: <strong className="text-white font-mono">{activeWaveBuffer.length} pts</strong></span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Machine Selection Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
            <Radio className="h-3.5 w-3.5 text-cyan-400" />
            <select
              value={activeMachineId}
              onChange={(e) => {
                setActiveMachineId(e.target.value);
                onSelectMachine(e.target.value);
              }}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-2"
            >
              {machines.map((m) => (
                <option key={m.machine_id} value={m.machine_id} className="bg-slate-900 text-white">
                  {m.machine_id} — {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Motor Power Quick Switch */}
          <button
            onClick={toggleMotorPower}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all border ${
              instantaneous.motor_powered
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
            }`}
            title="Toggle Motor Main Power Contactor"
          >
            <Power className="h-3.5 w-3.5" />
            <span>{instantaneous.motor_powered ? 'Motor ON' : 'Motor OFF'}</span>
          </button>

          {/* Simulation Mode Toggle Button */}
          <button
            onClick={() => setIsSimulationMode(!isSimulationMode)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all border ${
              isSimulationMode
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            <span>{isSimulationMode ? 'Simulation Active' : 'ESP32 Hardware'}</span>
          </button>

          {/* Manual Input Trigger */}
          <button
            onClick={() => onOpenManualModal(activeMachineId)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:brightness-110 transition-all shadow-md shadow-cyan-500/20"
          >
            <span>+ Inject Sensor Data</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. DYNAMIC LIVE SENSOR TELEMETRY CARDS (IMAGE MATCHING STYLE) */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CARD 1: TEMPERATURE */}
        <div className="rounded-2xl border border-amber-500/20 bg-slate-900/90 p-4 shadow-xl backdrop-blur-md space-y-2 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase font-bold tracking-wider text-amber-400 flex items-center gap-1.5">
              <Flame className="h-4 w-4" /> TEMPERATURE
            </div>
            {/* Dynamic Status Badge */}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border ${
                instantaneous.status_temp === 'CRITICAL'
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                  : instantaneous.status_temp === 'WARNING'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {instantaneous.status_temp === 'CRITICAL' ? (
                <>✖ CRITICAL</>
              ) : instantaneous.status_temp === 'WARNING' ? (
                <>⚠ WARNING</>
              ) : (
                <>✓ NORMAL</>
              )}
            </span>
          </div>

          <div>
            <div className="text-3xl font-black font-mono text-amber-300 tracking-tight">
              {fmt(instantaneous.temperature)}°C
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Limit: {activeConfig.temp_warning.toFixed(1)}° / {activeConfig.temp_critical.toFixed(1)}°C
            </div>
          </div>

          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/80 flex justify-between">
            <span>Range: {activeConfig.temp_min}° – {activeConfig.temp_max}°C</span>
            <span>Target: {activeConfig.temp_target}°C</span>
          </div>
        </div>

        {/* CARD 2: VIBRATION */}
        <div className="rounded-2xl border border-rose-500/20 bg-slate-900/90 p-4 shadow-xl backdrop-blur-md space-y-2 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase font-bold tracking-wider text-rose-400 flex items-center gap-1.5">
              <Activity className="h-4 w-4" /> VIBRATION
            </div>
            {/* Dynamic Status Badge */}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border ${
                instantaneous.status_vibration === 'CRITICAL'
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                  : instantaneous.status_vibration === 'WARNING'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {instantaneous.status_vibration === 'CRITICAL' ? (
                <>✖ CRITICAL</>
              ) : instantaneous.status_vibration === 'WARNING' ? (
                <>⚠ WARNING</>
              ) : (
                <>✓ NORMAL</>
              )}
            </span>
          </div>

          <div>
            <div className="text-3xl font-black font-mono text-rose-300 tracking-tight">
              {fmt(instantaneous.vibration, 2)} m/s²
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Limit: {activeConfig.vib_warning.toFixed(2)} / {activeConfig.vib_critical.toFixed(2)} m/s²
            </div>
          </div>

          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/80 flex justify-between">
            <span>Range: {activeConfig.vib_min} – {activeConfig.vib_max} m/s²</span>
            <span>Target: {activeConfig.vib_target} m/s²</span>
          </div>
        </div>

        {/* CARD 3: MOTOR CURRENT */}
        <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/90 p-4 shadow-xl backdrop-blur-md space-y-2 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase font-bold tracking-wider text-cyan-400 flex items-center gap-1.5">
              <Zap className="h-4 w-4" /> MOTOR CURRENT
            </div>
            {/* Dynamic Status Badge */}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border ${
                instantaneous.status_current === 'CRITICAL'
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                  : instantaneous.status_current === 'WARNING'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {instantaneous.status_current === 'CRITICAL' ? (
                <>✖ CRITICAL</>
              ) : instantaneous.status_current === 'WARNING' ? (
                <>⚠ WARNING</>
              ) : (
                <>✓ NORMAL</>
              )}
            </span>
          </div>

          <div>
            <div className="text-3xl font-black font-mono text-cyan-300 tracking-tight">
              {fmt(instantaneous.current, 2)} A
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Limit: {activeConfig.current_warning.toFixed(1)} / {activeConfig.current_critical.toFixed(1)} A
            </div>
          </div>

          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/80 flex justify-between">
            <span>Safety Max: {activeConfig.current_max} A</span>
            <span>Target: {activeConfig.current_target} A</span>
          </div>
        </div>

        {/* CARD 4: SHAFT VELOCITY (RPM) */}
        <div className="rounded-2xl border border-purple-500/20 bg-slate-900/90 p-4 shadow-xl backdrop-blur-md space-y-2 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase font-bold tracking-wider text-purple-400 flex items-center gap-1.5">
              <Gauge className="h-4 w-4" /> SHAFT VELOCITY
            </div>
            {/* Dynamic Status Badge */}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border ${
                instantaneous.status_rpm === 'CRITICAL'
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                  : instantaneous.status_rpm === 'WARNING'
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
              }`}
            >
              {instantaneous.status_rpm === 'CRITICAL' ? (
                <>✖ STALL / CRIT</>
              ) : instantaneous.status_rpm === 'WARNING' ? (
                <>⚠ LOW SPEED</>
              ) : (
                <>✓ NORMAL</>
              )}
            </span>
          </div>

          <div>
            <div className="text-3xl font-black font-mono text-purple-300 tracking-tight">
              {fmt(instantaneous.rpm, 0)} RPM
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Rated: {activeConfig.rpm_rated || 1500} RPM
            </div>
          </div>

          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/80 flex justify-between">
            <span>Target: {activeConfig.rpm_target} RPM</span>
            <span>Step: {activeConfig.rpm_step} RPM/tick</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. DYNAMIC TIME-SERIES GRAPHS WITH CONFIGURABLE TIME WINDOWS */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl space-y-4">
        {/* Header with Channel Selectors and Time Windows */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <Signal className="h-5 w-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>Dynamic Real-Time Waveform Graph</span>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Driven by real-time simulation engine time-series data reflecting configured ranges and thresholds.
              </p>
            </div>
          </div>

          {/* Time Window Buttons & Channel Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Time Window Selector (1m / 5m / 10m) */}
            <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
              {(['1m', '5m', '10m'] as TimeWindow[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setTimeWindow(w)}
                  className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold transition-all ${
                    timeWindow === w
                      ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {w === '1m' ? '1 Min' : w === '5m' ? '5 Min' : '10 Min'}
                </button>
              ))}
            </div>

            {/* Channel Filters */}
            <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
              <button
                onClick={() => setActiveChannel('all')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                  activeChannel === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveChannel('temperature')}
                className={`rounded-lg px-2 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'temperature'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Flame className="h-3 w-3 text-amber-400" />
                Temp
              </button>
              <button
                onClick={() => setActiveChannel('vibration')}
                className={`rounded-lg px-2 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'vibration'
                    ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="h-3 w-3 text-rose-400" />
                Vib
              </button>
              <button
                onClick={() => setActiveChannel('current')}
                className={`rounded-lg px-2 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'current'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="h-3 w-3 text-cyan-400" />
                Curr
              </button>
              <button
                onClick={() => setActiveChannel('rpm')}
                className={`rounded-lg px-2 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'rpm'
                    ? 'bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Gauge className="h-3 w-3 text-purple-400" />
                RPM
              </button>
            </div>

            {/* Line / Area Toggle */}
            <button
              onClick={() => setChartType(chartType === 'area' ? 'line' : 'area')}
              className="rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-1"
            >
              <BarChart2 className="h-3.5 w-3.5 text-cyan-400" />
              <span className="capitalize">{chartType}</span>
            </button>

            {/* Clear History */}
            <button
              onClick={clearHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white transition-all flex items-center gap-1"
              title="Clear Graph History"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Live Flowing Waveform Graph Canvas */}
        <div className="h-80 w-full rounded-xl bg-slate-950/80 p-3 border border-slate-800/80 relative">
          <ResponsiveContainer width="100%" height={290}>
            {chartType === 'area' ? (
              <AreaChart data={activeWaveBuffer} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="vibGradLive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="tempGradLive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="currGradLive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="rpmGradLive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                
                {/* Left Y Axis for Vibration (m/s²) & Current (A) */}
                <YAxis
                  yAxisId="left"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  domain={[0, (dataMax: number) => Math.max(dataMax * 1.2, 5.0)]}
                  unit=" m/s²"
                />
                
                {/* Right Y Axis for Temperature (°C) and RPM */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#f59e0b"
                  fontSize={11}
                  tickLine={false}
                  domain={[
                    (dataMin: number) => Math.max(0, Math.floor(dataMin * 0.8)),
                    (dataMax: number) => Math.ceil(dataMax * 1.15)
                  ]}
                  unit="°C"
                />

                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '12px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  }}
                />

                {/* Reference Threshold Lines */}
                {(activeChannel === 'all' || activeChannel === 'vibration') && (
                  <>
                    <ReferenceLine
                      yAxisId="left"
                      y={activeConfig.vib_warning}
                      stroke="#eab308"
                      strokeDasharray="3 3"
                      label={{ value: `Warn Vib (${activeConfig.vib_warning} m/s²)`, fill: '#eab308', fontSize: 10 }}
                    />
                    <ReferenceLine
                      yAxisId="left"
                      y={activeConfig.vib_critical}
                      stroke="#ef4444"
                      strokeDasharray="4 4"
                      label={{ value: `Crit Vib (${activeConfig.vib_critical} m/s²)`, fill: '#ef4444', fontSize: 10 }}
                    />
                  </>
                )}
                {(activeChannel === 'all' || activeChannel === 'temperature') && (
                  <>
                    <ReferenceLine
                      yAxisId="right"
                      y={activeConfig.temp_warning}
                      stroke="#f59e0b"
                      strokeDasharray="3 3"
                      label={{ value: `Warn Temp (${activeConfig.temp_warning}°C)`, fill: '#f59e0b', fontSize: 10 }}
                    />
                    <ReferenceLine
                      yAxisId="right"
                      y={activeConfig.temp_critical}
                      stroke="#f97316"
                      strokeDasharray="4 4"
                      label={{ value: `Crit Temp (${activeConfig.temp_critical}°C)`, fill: '#f97316', fontSize: 10 }}
                    />
                  </>
                )}

                {/* Vibration Wave */}
                {(activeChannel === 'all' || activeChannel === 'vibration') && (
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="vibration"
                    name="Vibration (m/s²)"
                    stroke="#f43f5e"
                    strokeWidth={2.5}
                    fill="url(#vibGradLive)"
                    dot={{ r: 2.5, fill: '#f43f5e' }}
                    isAnimationActive={false}
                  />
                )}

                {/* Temperature Wave */}
                {(activeChannel === 'all' || activeChannel === 'temperature') && (
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="temperature"
                    name="Temperature (°C)"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    fill="url(#tempGradLive)"
                    dot={{ r: 2.5, fill: '#f59e0b' }}
                    isAnimationActive={false}
                  />
                )}

                {/* Current Wave */}
                {(activeChannel === 'all' || activeChannel === 'current') && (
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="current"
                    name="Current (A)"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    fill="url(#currGradLive)"
                    dot={{ r: 2, fill: '#06b6d4' }}
                    isAnimationActive={false}
                  />
                )}

                {/* RPM Wave */}
                {activeChannel === 'rpm' && (
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="rpm"
                    name="RPM (Speed)"
                    stroke="#a855f7"
                    strokeWidth={2.5}
                    fill="url(#rpmGradLive)"
                    dot={{ r: 2, fill: '#a855f7' }}
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            ) : (
              <LineChart data={activeWaveBuffer} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} domain={[0, 6]} unit=" m/s²" />
                <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} unit="°C" />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }} />

                {(activeChannel === 'all' || activeChannel === 'vibration') && (
                  <Line yAxisId="left" type="monotone" dataKey="vibration" stroke="#f43f5e" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                )}
                {(activeChannel === 'all' || activeChannel === 'temperature') && (
                  <Line yAxisId="right" type="monotone" dataKey="temperature" stroke="#f59e0b" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                )}
                {(activeChannel === 'all' || activeChannel === 'current') && (
                  <Line yAxisId="left" type="monotone" dataKey="current" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} />
                )}
                {activeChannel === 'rpm' && (
                  <Line yAxisId="right" type="monotone" dataKey="rpm" stroke="#a855f7" strokeWidth={2} dot={false} isAnimationActive={false} />
                )}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. ISO 10816 SPECTRUM & TERMINAL PACKET STREAM */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ISO 10816-3 Severity Assessment Card */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-cyan-400" /> ISO 10816-3 Diagnostic Zone
            </h3>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${analysisMetrics.isoBg} ${analysisMetrics.isoColor}`}>
              {analysisMetrics.isoZone.split(' ')[0]} {analysisMetrics.isoZone.split(' ')[1]}
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-slate-800/50">
              <span className="text-slate-400">Vibration RMS:</span>
              <span className="font-mono font-bold text-white">{analysisMetrics.vibrationRms.toFixed(2)} mm/s</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-800/50">
              <span className="text-slate-400">Peak Vibration:</span>
              <span className="font-mono font-bold text-rose-400">{analysisMetrics.vibrationPeak.toFixed(2)} mm/s</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-slate-800/50">
              <span className="text-slate-400">Crest Factor:</span>
              <span className="font-mono font-bold text-cyan-400">{analysisMetrics.crestFactor.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-slate-400">Average Temp:</span>
              <span className="font-mono font-bold text-amber-400">{analysisMetrics.tempAvg.toFixed(1)}°C</span>
            </div>
          </div>
        </div>

        {/* Live Packet Logs Terminal */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl font-mono text-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-slate-400">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span className="font-bold text-slate-200">Simulation Packet Stream Log</span>
            </div>
            <span className="text-[10px] text-slate-500">Auto-scrolling stream</span>
          </div>

          <div className="h-40 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-slate-800 text-[11px]">
            {packetLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 py-0.5 leading-tight">
                <span className="text-slate-600 shrink-0">{log.time}</span>
                <span
                  className={`px-1 rounded text-[9px] font-bold shrink-0 ${
                    log.status === 'CRITICAL'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : log.status === 'WARNING'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}
                >
                  {log.status}
                </span>
                <span className="text-slate-300 truncate">{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveMonitoringPage;
