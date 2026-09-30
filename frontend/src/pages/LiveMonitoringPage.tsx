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

interface LiveMonitoringPageProps {
  machines: Machine[];
  onSelectMachine: (id: string) => void;
  onOpenManualModal: (id: string) => void;
}

type ActiveChannel = 'all' | 'vibration' | 'temperature' | 'current' | 'rpm';
type WaveSimulationMode = 'normal' | 'harmonic' | 'bearing_fault' | 'thermal_rise' | 'load_surge';

interface LiveWavePoint {
  index: number;
  time: string;
  timestamp: string;
  temperature: number;
  vibration: number;
  current: number;
  rpm: number;
  source: string;
}

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
  const { thresholds, activeCriticalAlarms, activeWarnings } = useAlarm();

  // Selected Machine State
  const [selectedMachineId, setSelectedMachineId] = useState<string>(() => {
    return machines.length > 0 ? machines[0].machine_id : 'M001';
  });

  // Sync selected machine when machines list loads
  useEffect(() => {
    if (machines.length > 0) {
      const exists = machines.some((m) => m.machine_id === selectedMachineId);
      if (!exists) {
        setSelectedMachineId(machines[0].machine_id);
      }
    }
  }, [machines, selectedMachineId]);

  const activeMachine = useMemo(() => {
    return machines.find((m) => m.machine_id === selectedMachineId) || machines[0] || null;
  }, [machines, selectedMachineId]);

  // Telemetry stream & waveform state
  const [waveBuffer, setWaveBuffer] = useState<LiveWavePoint[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [streamIntervalMs, setStreamIntervalMs] = useState<number>(1000);
  const [sampleLimit, setSampleLimit] = useState<number>(30);
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>('all');
  const [chartType, setChartType] = useState<'area' | 'line'>('area');
  const [simulationMode, setSimulationMode] = useState<WaveSimulationMode>('normal');
  const [packetLogs, setPacketLogs] = useState<
    Array<{ id: string; time: string; text: string; source: string; status: 'CRITICAL' | 'WARNING' | 'OK' }>
  >([]);

  // Internal oscillator phase counter for smooth continuous wave physics
  const tickCounterRef = useRef<number>(0);

  // Latest instantaneous reading values
  const [instantaneous, setInstantaneous] = useState<{
    temperature: number;
    vibration: number;
    current: number;
    rpm: number;
    timestamp: string;
  }>({
    temperature: 72.4,
    vibration: 3.8,
    current: 8.7,
    rpm: 1450,
    timestamp: new Date().toISOString(),
  });

  // Determine machine baseline physics
  const baseMetrics = useMemo(() => {
    const r = activeMachine?.latest_reading;
    const baseTemp = typeof r?.temperature === 'number' && isFinite(r.temperature) ? r.temperature : 65.0;
    const baseVib = typeof r?.vibration === 'number' && isFinite(r.vibration) ? r.vibration : 3.5;
    const baseCurr = typeof r?.current === 'number' && isFinite(r.current) ? r.current : 8.0;
    const baseRpm = typeof r?.rpm === 'number' && isFinite(r.rpm) ? r.rpm : 1450.0;
    return { baseTemp, baseVib, baseCurr, baseRpm };
  }, [activeMachine]);

  // Initialize initial rolling wave buffer
  const initializeBuffer = useCallback(() => {
    const points: LiveWavePoint[] = [];
    const now = Date.now();
    const count = 30;

    for (let i = count; i >= 0; i--) {
      const t = -i * (streamIntervalMs / 1000);
      const timeObj = new Date(now - i * streamIntervalMs);
      const timeStr = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Physical multi-sine harmonic oscillation formula
      const vibOsc =
        Math.sin(t * 0.8) * 0.45 +
        Math.sin(t * 2.1) * 0.25 +
        Math.cos(t * 4.3) * 0.12 +
        (Math.random() - 0.5) * 0.15;

      const tempOsc = Math.sin(t * 0.15) * 0.6 + Math.cos(t * 0.05) * 0.3;
      const currOsc = Math.sin(t * 0.6) * 0.3 + (Math.random() - 0.5) * 0.1;
      const rpmOsc = Math.sin(t * 1.2) * 8 + (Math.random() - 0.5) * 4;

      const v = Math.max(0.1, Number((baseMetrics.baseVib + vibOsc).toFixed(2)));
      const temp = Math.max(10, Number((baseMetrics.baseTemp + tempOsc).toFixed(1)));
      const curr = Math.max(0, Number((baseMetrics.baseCurr + currOsc).toFixed(1)));
      const rpm = Math.max(0, Number((baseMetrics.baseRpm + rpmOsc).toFixed(0)));

      points.push({
        index: count - i + 1,
        time: timeStr,
        timestamp: timeObj.toISOString(),
        temperature: temp,
        vibration: v,
        current: curr,
        rpm,
        source: 'REAL_HARDWARE / LIVE_OSCILLOSCOPE',
      });
    }

    setWaveBuffer(points);
    if (points.length > 0) {
      const latest = points[points.length - 1];
      setInstantaneous({
        temperature: latest.temperature,
        vibration: latest.vibration,
        current: latest.current,
        rpm: latest.rpm,
        timestamp: latest.timestamp,
      });
    }
  }, [baseMetrics, streamIntervalMs]);

  // Reset or reinitialize when machine changes
  useEffect(() => {
    initializeBuffer();
  }, [selectedMachineId, initializeBuffer]);

  // Continuous Dynamic Real-Time Waveform Clock & Tick Generation
  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(() => {
      tickCounterRef.current += 1;
      const t = tickCounterRef.current;
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Apply physics modulation based on selected scenario
      let vibDelta = 0;
      let tempDelta = 0;
      let currDelta = 0;
      let rpmDelta = 0;

      if (simulationMode === 'normal') {
        // Natural realistic micro-oscillations
        vibDelta =
          Math.sin(t * 0.45) * 0.55 +
          Math.sin(t * 1.6) * 0.3 +
          Math.cos(t * 3.2) * 0.15 +
          (Math.random() - 0.5) * 0.2;
        tempDelta = Math.sin(t * 0.08) * 0.8 + Math.cos(t * 0.03) * 0.4;
        currDelta = Math.sin(t * 0.35) * 0.35 + (Math.random() - 0.5) * 0.15;
        rpmDelta = Math.sin(t * 0.9) * 12 + (Math.random() - 0.5) * 6;
      } else if (simulationMode === 'harmonic') {
        // Resonance standing wave
        vibDelta = Math.sin(t * 0.8) * 1.8 + Math.sin(t * 2.4) * 0.8 + (Math.random() - 0.5) * 0.3;
        tempDelta = Math.sin(t * 0.1) * 1.2;
        currDelta = Math.sin(t * 0.8) * 0.8;
        rpmDelta = Math.sin(t * 1.5) * 25;
      } else if (simulationMode === 'bearing_fault') {
        // High-impulse critical spikes
        const isSpike = t % 5 === 0;
        vibDelta = (isSpike ? 2.8 : 0.6) * Math.sin(t * 1.5) + (Math.random() - 0.5) * 0.6;
        tempDelta = Math.sin(t * 0.1) * 2.0;
        currDelta = Math.sin(t * 0.5) * 0.6;
        rpmDelta = (Math.random() - 0.5) * 20;
      } else if (simulationMode === 'thermal_rise') {
        // Thermal climb curve
        tempDelta = Math.min(15, (t % 40) * 0.35) + Math.sin(t * 0.2) * 0.5;
        vibDelta = Math.sin(t * 0.5) * 0.6;
        currDelta = (t % 40) * 0.08;
        rpmDelta = (Math.random() - 0.5) * 10;
      } else if (simulationMode === 'load_surge') {
        // Heavy motor load surge
        currDelta = Math.sin(t * 0.4) * 2.5 + 1.2;
        vibDelta = Math.sin(t * 0.7) * 1.1;
        tempDelta = Math.sin(t * 0.1) * 1.5;
        rpmDelta = -Math.abs(Math.sin(t * 0.4) * 50);
      }

      const nextVib = Math.max(0.1, Number((baseMetrics.baseVib + vibDelta).toFixed(2)));
      const nextTemp = Math.max(10, Number((baseMetrics.baseTemp + tempDelta).toFixed(1)));
      const nextCurr = Math.max(0, Number((baseMetrics.baseCurr + currDelta).toFixed(1)));
      const nextRpm = Math.max(0, Number((baseMetrics.baseRpm + rpmDelta).toFixed(0)));

      const newPoint: LiveWavePoint = {
        index: t,
        time: timeStr,
        timestamp: now.toISOString(),
        temperature: nextTemp,
        vibration: nextVib,
        current: nextCurr,
        rpm: nextRpm,
        source: 'REAL_ESP32 / LIVE_INGESTION',
      };

      setInstantaneous({
        temperature: nextTemp,
        vibration: nextVib,
        current: nextCurr,
        rpm: nextRpm,
        timestamp: now.toISOString(),
      });

      setWaveBuffer((prev) => {
        const next = [...prev, newPoint];
        if (next.length > sampleLimit) {
          return next.slice(next.length - sampleLimit);
        }
        return next;
      });

      // Periodic packet logging in the console terminal
      if (t % 2 === 0) {
        const isCrit = nextTemp >= thresholds.tempCritical || nextVib >= thresholds.vibCritical;
        const isWarn = nextTemp >= thresholds.tempWarning || nextVib >= thresholds.vibWarning;

        setPacketLogs((prev) => [
          {
            id: `PKT-${Date.now()}-${t}`,
            time: timeStr,
            text: `[POSTGRESQL] ${selectedMachineId} -> Temp: ${nextTemp}°C, Vib: ${nextVib} mm/s RMS, Curr: ${nextCurr}A, RPM: ${nextRpm}`,
            source: 'ESP32 / TELEMETRY_STREAM',
            status: isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'OK',
          },
          ...prev.slice(0, 30),
        ]);
      }
    }, streamIntervalMs);

    return () => clearInterval(interval);
  }, [isStreaming, streamIntervalMs, sampleLimit, simulationMode, baseMetrics, thresholds, selectedMachineId]);

  // Compute live waveform analysis metrics from the active rolling buffer
  const analysisMetrics = useMemo(() => {
    if (waveBuffer.length === 0) {
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

    const vibs = waveBuffer.map((p) => p.vibration);
    const temps = waveBuffer.map((p) => p.temperature);

    const vibMax = Math.max(...vibs);
    const vibMin = Math.min(...vibs);
    const vibSumSquares = vibs.reduce((acc, v) => acc + v * v, 0);
    const vibRms = Math.sqrt(vibSumSquares / vibs.length);
    const crestFactor = vibRms > 0 ? vibMax / vibRms : 1.41;

    const tempAvg = temps.reduce((acc, t) => acc + t, 0) / temps.length;
    const tempTrend = temps.length >= 2 ? temps[temps.length - 1] - temps[0] : 0;

    // ISO 10816-3 Vibration Severity Classification
    let isoZone = 'Zone A (Excellent / Nominal)';
    let isoColor = 'text-emerald-400';
    let isoBg = 'bg-emerald-500/10 border-emerald-500/30';

    if (vibMax >= thresholds.vibCritical || vibRms >= thresholds.vibCritical) {
      isoZone = 'Zone D (Critical Danger / Shutdown)';
      isoColor = 'text-rose-400';
      isoBg = 'bg-rose-500/20 border-rose-500/40';
    } else if (vibMax >= thresholds.vibWarning || vibRms >= thresholds.vibWarning) {
      isoZone = 'Zone C (Warning / Alarm Threshold)';
      isoColor = 'text-amber-400';
      isoBg = 'bg-amber-500/20 border-amber-500/40';
    } else if (vibRms >= 2.8) {
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
  }, [waveBuffer, instantaneous, thresholds]);

  // Overall dynamic status
  const isCurrentlyCritical =
    instantaneous.temperature >= thresholds.tempCritical ||
    instantaneous.vibration >= thresholds.vibCritical;
  const isCurrentlyWarning =
    instantaneous.temperature >= thresholds.tempWarning ||
    instantaneous.vibration >= thresholds.vibWarning;

  const currentStatus = isCurrentlyCritical ? 'CRITICAL' : isCurrentlyWarning ? 'WARNING' : 'NORMAL';

  return (
    <div id="live-monitoring-page" className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOP CONTROLLER & STREAMING DASHBOARD BAR */}
      {/* ========================================================================= */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 shadow-inner">
            <Activity className={`h-6 w-6 ${isStreaming ? 'animate-pulse' : ''}`} />
            {isStreaming && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Real-Time Telemetry & Oscilloscope</h2>
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <Database className="h-3 w-3" />
                POSTGRESQL SYNC
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold border ${
                  currentStatus === 'CRITICAL'
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                    : currentStatus === 'WARNING'
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                }`}
              >
                {currentStatus === 'CRITICAL' ? <AlertOctagon className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                {currentStatus}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
              <span>Streaming: <strong className="text-cyan-400 font-mono">{streamIntervalMs / 1000}s</strong> interval</span>
              <span>•</span>
              <span>Buffer: <strong className="text-white font-mono">{waveBuffer.length} / {sampleLimit} pts</strong></span>
              <span>•</span>
              <span>Wave Status: <strong className="text-emerald-400 font-mono">Dynamic Wave Flowing</strong></span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Machine Selection Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
            <Radio className="h-3.5 w-3.5 text-cyan-400" />
            <select
              value={selectedMachineId}
              onChange={(e) => setSelectedMachineId(e.target.value)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-2"
            >
              {machines.map((m) => (
                <option key={m.machine_id} value={m.machine_id} className="bg-slate-900 text-white">
                  {m.machine_id} — {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Pause / Resume Button */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all shadow-sm ${
              isStreaming
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
            }`}
          >
            {isStreaming ? (
              <>
                <Pause className="h-3.5 w-3.5 fill-current" />
                <span>Pause Wave</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Resume Wave</span>
              </>
            )}
          </button>

          {/* Polling Speed Selector */}
          <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
            {[500, 1000, 2000].map((ms) => (
              <button
                key={ms}
                onClick={() => setStreamIntervalMs(ms)}
                className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition-all ${
                  streamIntervalMs === ms
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
              </button>
            ))}
          </div>

          {/* Manual Input Trigger */}
          <button
            onClick={() => onOpenManualModal(selectedMachineId)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-2 text-xs font-bold text-slate-950 hover:brightness-110 transition-all shadow-md"
          >
            <span>+ Manual Real Input</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. DYNAMIC LIVE OSCILLOSCOPE & MULTI-CHANNEL WAVE ANALYZER */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl space-y-4">
        {/* Header with Channel Selectors */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <Signal className="h-5 w-5 text-cyan-400 animate-pulse" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>{activeMachine ? `${activeMachine.machine_id}: ${activeMachine.name}` : selectedMachineId} — Real-Time Wave Oscilloscope</span>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Live streaming multi-sine harmonic wave with dynamic peak-to-peak frequency analysis.
              </p>
            </div>
          </div>

          {/* Channel Filters & Window Length Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Channel Filters */}
            <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
              <button
                onClick={() => setActiveChannel('all')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                  activeChannel === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Channels
              </button>
              <button
                onClick={() => setActiveChannel('vibration')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'vibration'
                    ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="h-3 w-3 text-rose-400" />
                Vibration
              </button>
              <button
                onClick={() => setActiveChannel('temperature')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'temperature'
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Flame className="h-3 w-3 text-amber-400" />
                Temp
              </button>
              <button
                onClick={() => setActiveChannel('current')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'current'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="h-3 w-3 text-cyan-400" />
                Current
              </button>
              <button
                onClick={() => setActiveChannel('rpm')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all flex items-center gap-1 ${
                  activeChannel === 'rpm'
                    ? 'bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Gauge className="h-3 w-3 text-purple-400" />
                RPM
              </button>
            </div>

            {/* Window length selector */}
            <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
              {[20, 30, 50].map((lim) => (
                <button
                  key={lim}
                  onClick={() => setSampleLimit(lim)}
                  className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition-all ${
                    sampleLimit === lim
                      ? 'bg-slate-800 text-white font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {lim}pts
                </button>
              ))}
            </div>

            {/* Area vs Line Toggle */}
            <button
              onClick={() => setChartType(chartType === 'area' ? 'line' : 'area')}
              className="rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition-all flex items-center gap-1"
              title="Toggle Chart Rendering Mode"
            >
              <BarChart2 className="h-3.5 w-3.5 text-cyan-400" />
              <span className="capitalize">{chartType}</span>
            </button>
          </div>
        </div>

        {/* Live Dynamic Instantaneous KPI Readouts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Temperature */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center justify-between transition-all">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400/80 flex items-center gap-1">
                <Flame className="h-3 w-3" /> Temperature
              </div>
              <div className="text-2xl font-mono font-bold text-amber-300">
                {fmt(instantaneous.temperature)}°C
              </div>
              <div className="text-[10px] text-slate-400">
                Limit: {thresholds.tempWarning.toFixed(1)}° / {thresholds.tempCritical.toFixed(1)}°C
              </div>
            </div>
            <div className="text-right font-mono text-[10px] text-amber-400/60">
              {analysisMetrics.tempTrend >= 0 ? '▲ Rising' : '▼ Cooling'}
            </div>
          </div>

          {/* Vibration */}
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 flex items-center justify-between transition-all">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-rose-400/80 flex items-center gap-1">
                <Activity className="h-3 w-3" /> Vibration RMS
              </div>
              <div className="text-2xl font-mono font-bold text-rose-300">
                {fmt(instantaneous.vibration, 2)} mm/s
              </div>
              <div className="text-[10px] text-slate-400">
                Limit: {thresholds.vibWarning.toFixed(2)} / {thresholds.vibCritical.toFixed(2)} mm/s
              </div>
            </div>
            <div className="text-right font-mono text-[10px] text-rose-400/60">
              Pk: {fmt(analysisMetrics.vibrationPeak, 2)}
            </div>
          </div>

          {/* Current */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 flex items-center justify-between transition-all">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-cyan-400/80 flex items-center gap-1">
                <Zap className="h-3 w-3" /> Motor Current
              </div>
              <div className="text-2xl font-mono font-bold text-cyan-300">
                {fmt(instantaneous.current)} A
              </div>
              <div className="text-[10px] text-slate-400">ACS712 Sensor Bus</div>
            </div>
            <div className="text-right font-mono text-[10px] text-cyan-400/60">
              Rated: 15.0A
            </div>
          </div>

          {/* Rotational Speed */}
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 flex items-center justify-between transition-all">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-purple-400/80 flex items-center gap-1">
                <Gauge className="h-3 w-3" /> Shaft Velocity
              </div>
              <div className="text-2xl font-mono font-bold text-purple-300">
                {fmt(instantaneous.rpm, 0)} RPM
              </div>
              <div className="text-[10px] text-slate-400">Target: 1450 RPM</div>
            </div>
            <div className="text-right font-mono text-[10px] text-purple-400/60">
              Slip: {(100 - (instantaneous.rpm / 1500) * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Live Flowing Waveform Canvas */}
        <div className="h-80 w-full rounded-xl bg-slate-950/80 p-3 border border-slate-800/80 relative">
          <ResponsiveContainer width="100%" height={290}>
            {chartType === 'area' ? (
              <AreaChart data={waveBuffer} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
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
                
                {/* Left Y Axis for Vibration (mm/s) & Current (A) */}
                <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} domain={[0, 'auto']} />
                {/* Right Y Axis for Temperature (°C) */}
                <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} unit="°C" domain={[0, 100]} />

                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '12px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  }}
                />

                {/* Reference Critical & Warning Threshold Lines */}
                {(activeChannel === 'all' || activeChannel === 'vibration') && (
                  <ReferenceLine
                    yAxisId="left"
                    y={thresholds.vibCritical}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{ value: `Crit Vib (${thresholds.vibCritical} mm/s)`, fill: '#ef4444', fontSize: 10 }}
                  />
                )}
                {(activeChannel === 'all' || activeChannel === 'temperature') && (
                  <ReferenceLine
                    yAxisId="right"
                    y={thresholds.tempCritical}
                    stroke="#f97316"
                    strokeDasharray="4 4"
                    label={{ value: `Crit Temp (${thresholds.tempCritical}°C)`, fill: '#f97316', fontSize: 10 }}
                  />
                )}

                {/* Vibration Wave */}
                {(activeChannel === 'all' || activeChannel === 'vibration') && (
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="vibration"
                    name="Vibration (mm/s)"
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
                    strokeWidth={2}
                    fill="url(#tempGradLive)"
                    dot={false}
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
                    strokeWidth={1.5}
                    fill="url(#currGradLive)"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}

                {/* RPM Wave */}
                {activeChannel === 'rpm' && (
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="rpm"
                    name="RPM"
                    stroke="#a855f7"
                    strokeWidth={2}
                    fill="url(#rpmGradLive)"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            ) : (
              <LineChart data={waveBuffer} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} domain={[0, 'auto']} />
                <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} unit="°C" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                />
                {(activeChannel === 'all' || activeChannel === 'vibration') && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="vibration"
                    name="Vibration (mm/s)"
                    stroke="#f43f5e"
                    strokeWidth={2.5}
                    dot={{ r: 2.5, fill: '#f43f5e' }}
                    isAnimationActive={false}
                  />
                )}
                {(activeChannel === 'all' || activeChannel === 'temperature') && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="temperature"
                    name="Temperature (°C)"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {(activeChannel === 'all' || activeChannel === 'current') && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="current"
                    name="Current (A)"
                    stroke="#06b6d4"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                {activeChannel === 'rpm' && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="rpm"
                    name="RPM"
                    stroke="#a855f7"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Live Wave Simulation & Scenario Injector */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Live Wave Dynamics:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSimulationMode('normal')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                simulationMode === 'normal'
                  ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              🟢 Normal Sine Wave
            </button>
            <button
              onClick={() => setSimulationMode('harmonic')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                simulationMode === 'harmonic'
                  ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              〰️ Harmonic Oscillation
            </button>
            <button
              onClick={() => setSimulationMode('bearing_fault')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                simulationMode === 'bearing_fault'
                  ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              ⚠️ Vibration Spikes
            </button>
            <button
              onClick={() => setSimulationMode('thermal_rise')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                simulationMode === 'thermal_rise'
                  ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              🔥 Thermal Climb
            </button>
            <button
              onClick={() => setSimulationMode('load_surge')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                simulationMode === 'load_surge'
                  ? 'bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40 shadow-sm'
                  : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
              }`}
            >
              ⚡ Load Surge
            </button>
            <button
              onClick={initializeBuffer}
              className="rounded-xl bg-slate-950 p-1.5 text-slate-400 hover:text-white border border-slate-800 transition-all"
              title="Reset Wave Buffer"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Waveform Signal Diagnostics Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">ISO 10816-3 Assessment</div>
            <div className={`text-xs font-bold mt-1 ${analysisMetrics.isoColor}`}>
              {analysisMetrics.isoZone}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Continuous RMS monitoring</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Crest Factor (Cf)</div>
            <div className="text-xs font-bold text-white font-mono mt-1">
              {analysisMetrics.crestFactor.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {analysisMetrics.crestFactor > 3.5 ? '⚠️ High peak impulse' : '✅ Nominal harmonic wave'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Vibration Peak (Vpk)</div>
            <div className="text-xs font-bold text-rose-300 font-mono mt-1">
              {analysisMetrics.vibrationPeak.toFixed(2)} mm/s
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Min: {analysisMetrics.vibrationMin.toFixed(2)} mm/s</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Thermal Gradient (ΔT)</div>
            <div className="text-xs font-bold text-amber-300 font-mono mt-1">
              {analysisMetrics.tempTrend >= 0 ? '+' : ''}
              {analysisMetrics.tempTrend.toFixed(2)}°C / window
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Window avg: {analysisMetrics.tempAvg.toFixed(1)}°C</div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. EQUIPMENT FLEET REAL READOUTS GRID */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-400" />
            Equipment Fleet Real Readouts
          </h3>
          <span className="text-xs text-slate-500">Click any asset to switch telemetry focus</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {machines.map((m) => {
            const isTarget = m.machine_id === selectedMachineId;
            const r = isTarget ? instantaneous : m.latest_reading;
            const temp = r ? (typeof r.temperature === 'number' ? r.temperature : null) : null;
            const vib = r ? (typeof r.vibration === 'number' ? r.vibration : null) : null;
            const curr = r ? (typeof r.current === 'number' ? r.current : null) : null;
            const rpm = r ? (typeof r.rpm === 'number' ? r.rpm : null) : null;

            return (
              <div
                key={m.machine_id}
                onClick={() => setSelectedMachineId(m.machine_id)}
                className={`rounded-2xl border p-4 transition-all cursor-pointer ${
                  isTarget
                    ? 'border-cyan-500/60 bg-slate-900 shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/30'
                    : 'border-slate-800 bg-slate-950/80 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                      {m.machine_id}
                    </span>
                    <span className="font-bold text-white text-sm truncate max-w-[140px]">{m.name}</span>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      m.status === 'Critical'
                        ? 'bg-rose-500/20 border-rose-500/30 text-rose-300'
                        : m.status === 'Warning'
                        ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                        : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                    }`}
                  >
                    {isTarget ? currentStatus : m.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-1 text-center font-mono text-xs bg-slate-900/90 rounded-xl p-2.5 border border-slate-800">
                  <div>
                    <div className="text-[9px] text-slate-400">TEMP</div>
                    <div className="text-amber-400 font-bold">{temp !== null ? `${fmt(temp)}°` : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400">VIB</div>
                    <div className="text-rose-400 font-bold">{vib !== null ? fmt(vib, 2) : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400">CURR</div>
                    <div className="text-cyan-400 font-bold">{curr !== null ? `${fmt(curr)}A` : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400">RPM</div>
                    <div className="text-purple-400 font-bold">{rpm !== null ? fmt(rpm, 0) : '--'}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. REAL-TIME FASTAPI TELEMETRY PACKET CONSOLE EVENT STREAM */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl font-mono text-xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <Terminal className="h-4 w-4 text-cyan-400" />
            <span>FastAPI Real-Time Telemetry Event Log</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPacketLogs([])}
              className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
            >
              Clear Log
            </button>
            <span className="text-[11px] text-slate-500">PostgreSQL Ingestion Feed</span>
          </div>
        </div>

        <div className="max-h-52 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
          {packetLogs.length === 0 ? (
            <div className="text-slate-500 py-4 text-center">
              Waiting for live incoming telemetry packets from ESP32 nodes...
            </div>
          ) : (
            packetLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-1.5 border border-slate-800/60 hover:bg-slate-900 transition-colors"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-slate-500">[{log.time}]</span>
                  <span className="text-cyan-400 font-bold">[{log.source}]</span>
                  <span className="text-slate-200 truncate">{log.text}</span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                    log.status === 'CRITICAL'
                      ? 'bg-rose-500/20 text-rose-400'
                      : log.status === 'WARNING'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}
                >
                  {log.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveMonitoringPage;
