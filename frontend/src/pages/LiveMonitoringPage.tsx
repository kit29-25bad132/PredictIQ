import React, { useState, useEffect, useMemo } from 'react';
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

// Safe number formatter to guarantee zero crashes on null/undefined
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

  // Sync selected machine if machines array loads later
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

  // Telemetry stream state
  const [liveStream, setLiveStream] = useState<SensorReading[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [streamIntervalMs, setStreamIntervalMs] = useState<number>(2000);
  const [sampleLimit, setSampleLimit] = useState<number>(30);
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>('all');
  const [chartType, setChartType] = useState<'line' | 'area'>('area');
  const [packetLogs, setPacketLogs] = useState<
    Array<{ id: string; time: string; text: string; source: string; status: 'CRITICAL' | 'WARNING' | 'OK' }>
  >([]);
  const [lastPacketTime, setLastPacketTime] = useState<string>('');

  // Poll real sensor data from FastAPI / PostgreSQL
  const fetchLiveTick = async () => {
    if (!selectedMachineId) return;
    try {
      const data = await api.getSensorData(selectedMachineId, sampleLimit).catch(() => []);

      if (Array.isArray(data)) {
        setLiveStream(data);
        if (data.length > 0) {
          const latest = data[data.length - 1];
          const latestTime = new Date(latest.timestamp || Date.now()).toLocaleTimeString();
          setLastPacketTime(latestTime);

          const temp = latest.temperature ?? 0;
          const vib = latest.vibration ?? 0;
          const isCrit = temp >= thresholds.tempCritical || vib >= thresholds.vibCritical;
          const isWarn = temp >= thresholds.tempWarning || vib >= thresholds.vibWarning;

          setPacketLogs((prev) => [
            {
              id: `${latest.id || Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              time: latestTime,
              text: `[POSTGRESQL] ${latest.machine_id} (Node: ${latest.device_id || 'ESP32'}) -> Temp: ${fmt(
                latest.temperature
              )}°C, Vib: ${fmt(latest.vibration, 2)} mm/s, Curr: ${fmt(latest.current)}A, RPM: ${fmt(latest.rpm, 0)}`,
              source: `${latest.source || 'ESP32'} / REAL_DATA`,
              status: isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'OK',
            },
            ...prev.slice(0, 30),
          ]);
        }
      }
    } catch (err) {
      console.warn('Live telemetry poll error:', err);
    }
  };

  useEffect(() => {
    fetchLiveTick();
    if (!isStreaming) return;
    const timer = setInterval(fetchLiveTick, streamIntervalMs);
    return () => clearInterval(timer);
  }, [selectedMachineId, isStreaming, streamIntervalMs, sampleLimit]);

  // Formatted data points for the oscilloscope chart
  const waveformPoints = useMemo(() => {
    return liveStream.map((r, i) => {
      const d = new Date(r.timestamp);
      const timeStr = isNaN(d.getTime())
        ? `Pt ${i + 1}`
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      return {
        index: i + 1,
        time: timeStr,
        temperature: typeof r.temperature === 'number' ? r.temperature : null,
        vibration: typeof r.vibration === 'number' ? r.vibration : null,
        current: typeof r.current === 'number' ? r.current : null,
        rpm: typeof r.rpm === 'number' ? r.rpm : null,
        source: r.source || 'HARDWARE',
      };
    });
  }, [liveStream]);

  const latestReading = liveStream.length > 0 ? liveStream[liveStream.length - 1] : null;

  // Waveform Analysis Metrics (RMS, Peak, Crest Factor, Rate of Change)
  const analysisMetrics = useMemo(() => {
    if (waveformPoints.length === 0) {
      return {
        vibrationRms: 0,
        vibrationPeak: 0,
        vibrationMin: 0,
        crestFactor: 0,
        tempAvg: 0,
        tempTrend: 0,
        isoZone: 'Zone A - Normal',
        isoColor: 'text-emerald-400',
      };
    }

    const vibValues = waveformPoints
      .map((p) => p.vibration)
      .filter((v): v is number => v !== null && isFinite(v));
    const tempValues = waveformPoints
      .map((p) => p.temperature)
      .filter((t): t is number => t !== null && isFinite(t));

    const vibMax = vibValues.length > 0 ? Math.max(...vibValues) : 0;
    const vibMin = vibValues.length > 0 ? Math.min(...vibValues) : 0;
    const vibPeak = vibMax;
    const vibSumSquares = vibValues.reduce((acc, v) => acc + v * v, 0);
    const vibRms = vibValues.length > 0 ? Math.sqrt(vibSumSquares / vibValues.length) : 0;
    const crestFactor = vibRms > 0 ? vibPeak / vibRms : 0;

    const tempAvg =
      tempValues.length > 0 ? tempValues.reduce((acc, t) => acc + t, 0) / tempValues.length : 0;
    const tempTrend =
      tempValues.length >= 2 ? (tempValues[tempValues.length - 1] ?? 0) - (tempValues[0] ?? 0) : 0;

    // ISO 10816-3 Vibration Severity Zones
    let isoZone = 'Zone A (Excellent)';
    let isoColor = 'text-emerald-400';

    if (vibRms >= thresholds.vibCritical || vibMax >= thresholds.vibCritical) {
      isoZone = 'Zone D (Danger / Critical)';
      isoColor = 'text-rose-400';
    } else if (vibRms >= thresholds.vibWarning || vibMax >= thresholds.vibWarning) {
      isoZone = 'Zone C (Warning / Alert)';
      isoColor = 'text-amber-400';
    } else if (vibRms >= 2.8) {
      isoZone = 'Zone B (Acceptable)';
      isoColor = 'text-cyan-400';
    }

    return {
      vibrationRms: vibRms,
      vibrationPeak: vibPeak,
      vibrationMin: vibMin,
      crestFactor,
      tempAvg,
      tempTrend,
      isoZone,
      isoColor,
    };
  }, [waveformPoints, thresholds]);

  // Overall status
  const currentCritical = activeCriticalAlarms.filter((a) => a.machineId === selectedMachineId);
  const currentWarnings = activeWarnings.filter((a) => a.machineId === selectedMachineId);
  const systemStatus =
    currentCritical.length > 0
      ? 'CRITICAL'
      : currentWarnings.length > 0
      ? 'WARNING'
      : latestReading
      ? 'NORMAL'
      : 'WAITING';

  const statusBadge =
    systemStatus === 'CRITICAL'
      ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
      : systemStatus === 'WARNING'
      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
      : systemStatus === 'NORMAL'
      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
      : 'bg-slate-800 border-slate-700 text-slate-400';

  return (
    <div id="live-monitoring-page" className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOP LIVE CONTROLLER BAR & MACHINE SELECTOR */}
      {/* ========================================================================= */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3">
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
              <h2 className="text-xl font-bold text-white tracking-tight">Real-Time Telemetry & Waveform Oscilloscope</h2>
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <Database className="h-3 w-3" />
                POSTGRESQL SYNC
              </span>
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold border ${statusBadge}`}>
                {systemStatus === 'CRITICAL' ? <AlertOctagon className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                {systemStatus}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
              <span>Streaming: <strong className="text-cyan-400 font-mono">{streamIntervalMs / 1000}s</strong> interval</span>
              <span>•</span>
              <span>Window: <strong className="text-white font-mono">{sampleLimit} samples</strong></span>
              {lastPacketTime && (
                <>
                  <span>•</span>
                  <span>Last update: <strong className="text-slate-200 font-mono">{lastPacketTime}</strong></span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Target Machine Selection */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800">
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
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Resume Live</span>
              </>
            )}
          </button>

          {/* Polling Speed Selector */}
          <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
            {[1000, 2000, 5000].map((ms) => (
              <button
                key={ms}
                onClick={() => setStreamIntervalMs(ms)}
                className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition-all ${
                  streamIntervalMs === ms
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {ms / 1000}s
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
      {/* 2. REAL-TIME WAVEFORM SIGNAL ANALYZER & OSCILLOSCOPE */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl space-y-4">
        {/* Header with Channel Selectors */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <Signal className="h-5 w-5 text-cyan-400 animate-pulse" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {activeMachine ? `${activeMachine.machine_id}: ${activeMachine.name}` : selectedMachineId} — Multi-Channel Oscilloscope
              </h3>
              <p className="text-xs text-slate-400">
                Continuous high-precision telemetry wave ingestion directly from authentic IoT hardware sensors.
              </p>
            </div>
          </div>

          {/* Channel Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
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
              {[15, 30, 60].map((lim) => (
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

        {/* Live Instantaneous KPI Readouts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Temperature */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-amber-400/80 flex items-center gap-1">
                <Flame className="h-3 w-3" /> Temperature
              </div>
              <div className="text-xl font-mono font-bold text-amber-300">
                {latestReading ? `${fmt(latestReading.temperature)}°C` : '--'}
              </div>
              <div className="text-[10px] text-slate-400">
                Limit: {thresholds.tempWarning.toFixed(1)}° / {thresholds.tempCritical.toFixed(1)}°C
              </div>
            </div>
          </div>

          {/* Vibration */}
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-rose-400/80 flex items-center gap-1">
                <Activity className="h-3 w-3" /> Vibration RMS
              </div>
              <div className="text-xl font-mono font-bold text-rose-300">
                {latestReading ? `${fmt(latestReading.vibration, 2)} mm/s` : '--'}
              </div>
              <div className="text-[10px] text-slate-400">
                Limit: {thresholds.vibWarning.toFixed(2)} / {thresholds.vibCritical.toFixed(2)} mm/s
              </div>
            </div>
          </div>

          {/* Current */}
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-cyan-400/80 flex items-center gap-1">
                <Zap className="h-3 w-3" /> Motor Current
              </div>
              <div className="text-xl font-mono font-bold text-cyan-300">
                {latestReading ? `${fmt(latestReading.current)} A` : '--'}
              </div>
              <div className="text-[10px] text-slate-400">ACS712 Sensor Bus</div>
            </div>
          </div>

          {/* Rotational Speed */}
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-purple-400/80 flex items-center gap-1">
                <Gauge className="h-3 w-3" /> Shaft Velocity
              </div>
              <div className="text-xl font-mono font-bold text-purple-300">
                {latestReading ? `${fmt(latestReading.rpm, 0)} RPM` : '--'}
              </div>
              <div className="text-[10px] text-slate-400">Target 1450 RPM</div>
            </div>
          </div>
        </div>

        {/* Live Chart Canvas */}
        <div className="h-80 w-full rounded-xl bg-slate-950/70 p-3 border border-slate-800/80 relative">
          {waveformPoints.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500 text-center">
              <Database className="h-10 w-10 mb-2 text-slate-600 animate-pulse" />
              <p className="text-sm font-semibold text-slate-300">Connecting to PostgreSQL Sensor Feed...</p>
              <p className="text-xs text-slate-500 mt-1">Waiting for telemetry packets for asset {selectedMachineId}.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={290}>
              {chartType === 'area' ? (
                <AreaChart data={waveformPoints} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vibGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="currGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="rpmGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                  
                  {/* Left Y Axis for Vibration & Current */}
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} />
                  {/* Right Y Axis for Temperature */}
                  <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} unit="°C" />

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

                  {/* Channels */}
                  {(activeChannel === 'all' || activeChannel === 'vibration') && (
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="vibration"
                      name="Vibration (mm/s)"
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      fill="url(#vibGrad)"
                      dot={{ r: 2, fill: '#f43f5e' }}
                      isAnimationActive={false}
                    />
                  )}
                  {(activeChannel === 'all' || activeChannel === 'temperature') && (
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="temperature"
                      name="Temperature (°C)"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fill="url(#tempGrad)"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {(activeChannel === 'all' || activeChannel === 'current') && (
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="current"
                      name="Current (A)"
                      stroke="#06b6d4"
                      strokeWidth={1.5}
                      fill="url(#currGrad)"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  {activeChannel === 'rpm' && (
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="rpm"
                      name="RPM"
                      stroke="#a855f7"
                      strokeWidth={2}
                      fill="url(#rpmGrad)"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </AreaChart>
              ) : (
                <LineChart data={waveformPoints} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={11} tickLine={false} unit="°C" />
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
                      dot={{ r: 2, fill: '#f43f5e' }}
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
          )}
        </div>

        {/* Waveform Signal Diagnostics Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Vibration Severity Assessment</div>
            <div className={`text-xs font-bold mt-1 ${analysisMetrics.isoColor}`}>
              {analysisMetrics.isoZone}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Standard: ISO 10816-3 Class II</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Crest Factor (Cf)</div>
            <div className="text-xs font-bold text-white font-mono mt-1">
              {analysisMetrics.crestFactor.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {analysisMetrics.crestFactor > 3.5 ? '⚠️ High impulse peak detected' : '✅ Nominal harmonic wave'}
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
            const r = m.latest_reading;
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
                    {m.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-1 text-center font-mono text-xs bg-slate-900/90 rounded-xl p-2.5 border border-slate-800">
                  <div>
                    <div className="text-[9px] text-slate-400">TEMP</div>
                    <div className="text-amber-400 font-bold">{r ? `${fmt(r.temperature)}°` : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400">VIB</div>
                    <div className="text-rose-400 font-bold">{r ? fmt(r.vibration, 2) : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400">CURR</div>
                    <div className="text-cyan-400 font-bold">{r ? `${fmt(r.current)}A` : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400">RPM</div>
                    <div className="text-purple-400 font-bold">{r ? fmt(r.rpm, 0) : '--'}</div>
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
