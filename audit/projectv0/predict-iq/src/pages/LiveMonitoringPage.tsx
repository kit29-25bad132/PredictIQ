import React, { useState, useEffect } from 'react';
import { Machine, SensorReading } from '../types';
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
  Database
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

interface LiveMonitoringPageProps {
  machines: Machine[];
  onSelectMachine: (id: string) => void;
  onOpenManualModal: (id: string) => void;
}

export const LiveMonitoringPage: React.FC<LiveMonitoringPageProps> = ({
  machines,
  onSelectMachine,
  onOpenManualModal,
}) => {
  const [selectedMachineId, setSelectedMachineId] = useState<string>(
    machines.length > 0 ? machines[0].machine_id : 'M001'
  );
  const [liveStream, setLiveStream] = useState<SensorReading[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [streamIntervalMs, setStreamIntervalMs] = useState<number>(3000);
  const [packetLogs, setPacketLogs] = useState<Array<{ id: string; time: string; text: string; source: string; status: string }>>([]);

  const activeMachine = machines.find((m) => m.machine_id === selectedMachineId) || machines[0];

  const fetchLiveTick = async () => {
    try {
      const data = await api.getSensorData(selectedMachineId, 30);
      setLiveStream(data);

      if (data.length > 0) {
        const latest = data[data.length - 1];
        setPacketLogs((prev) => [
          {
            id: String(latest.id),
            time: new Date(latest.timestamp).toLocaleTimeString(),
            text: `[POSTGRESQL] Machine ${latest.machine_id} (Node: ${latest.device_id}) -> Temp: ${latest.temperature}°C, Vib: ${latest.vibration} mm/s, Current: ${latest.current}A, RPM: ${latest.rpm}`,
            source: 'ESP32 / REAL_DATA',
            status: latest.temperature > 80 || latest.vibration > 6 ? 'CRITICAL' : latest.temperature > 74 || latest.vibration > 4 ? 'WARNING' : 'OK',
          },
          ...prev.slice(0, 25),
        ]);
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
  }, [selectedMachineId, isStreaming, streamIntervalMs]);

  // Formatted chart points
  const waveformPoints = liveStream.map((r, i) => ({
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    temperature: r.temperature,
    vibration: r.vibration,
    current: r.current,
    rpm: r.rpm,
    index: i,
  }));

  const latestReading = liveStream.length > 0 ? liveStream[liveStream.length - 1] : null;

  return (
    <div id="live-monitoring-page" className="space-y-6">
      {/* Top Controller Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Activity className="h-5 w-5 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Real PostgreSQL Telemetry Stream</h2>
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <Database className="h-3 w-3" />
                POSTGRESQL SYNC ACTIVE
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Continuous live polling interval: <strong className="text-cyan-400 font-mono">{streamIntervalMs / 1000}s</strong>
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Target Machine Selection */}
          <select
            value={selectedMachineId}
            onChange={(e) => setSelectedMachineId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            {machines.map((m) => (
              <option key={m.machine_id} value={m.machine_id}>
                {m.machine_id} - {m.name}
              </option>
            ))}
          </select>

          {/* Pause / Resume Button */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
              isStreaming
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            }`}
          >
            {isStreaming ? (
              <>
                <Pause className="h-3.5 w-3.5 fill-current" />
                <span>Pause Stream</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Resume Stream</span>
              </>
            )}
          </button>

          {/* Interval Switcher */}
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs">
            {[1000, 3000, 5000].map((ms) => (
              <button
                key={ms}
                onClick={() => setStreamIntervalMs(ms)}
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-medium transition-all ${
                  streamIntervalMs === ms
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {ms / 1000}s
              </button>
            ))}
          </div>

          <button
            onClick={() => onOpenManualModal(selectedMachineId)}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all"
          >
            <span>Manual Real Input</span>
          </button>
        </div>
      </div>

      {/* Live Oscilloscope / Telemetry Waveform */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Signal className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              {activeMachine?.name} — Multi-Channel Telemetry Stream
            </h3>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="flex items-center gap-1 text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Temp: {latestReading ? `${latestReading.temperature.toFixed(1)}°C` : '--'}
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <span className="h-2 w-2 rounded-full bg-rose-400" /> Vib: {latestReading ? `${latestReading.vibration.toFixed(2)} mm/s` : '--'}
            </span>
            <span className="flex items-center gap-1 text-cyan-400">
              <span className="h-2 w-2 rounded-full bg-cyan-400" /> Curr: {latestReading ? `${latestReading.current.toFixed(1)} A` : '--'}
            </span>
          </div>
        </div>

        <div className="mt-4 h-72 sm:h-80 w-full">
          {waveformPoints.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500 text-center">
              <Database className="h-8 w-8 mb-2 text-slate-600" />
              <p className="text-sm font-medium text-slate-400">Waiting for real ESP32 sensor telemetry.</p>
              <p className="text-xs text-slate-500 mt-1">No fake synthetic waveforms are generated.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={waveformPoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                <YAxis yAxisId="vib" stroke="#f43f5e" fontSize={11} unit=" mm/s" />
                <YAxis yAxisId="temp" orientation="right" stroke="#f59e0b" fontSize={11} unit=" °C" />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} />
                <Line yAxisId="vib" type="monotone" dataKey="vibration" stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 2, fill: '#f43f5e' }} name="Vibration (mm/s)" isAnimationActive={false} />
                <Line yAxisId="temp" type="monotone" dataKey="temperature" stroke="#f59e0b" strokeWidth={2} dot={false} name="Temp (°C)" isAnimationActive={false} />
                <Line yAxisId="vib" type="monotone" dataKey="current" stroke="#06b6d4" strokeWidth={1.5} dot={false} name="Current (A)" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Grid of All Monitored Fleet Asset Quick Readouts */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-3">
          Equipment Fleet Real Readouts
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {machines.map((m) => {
            const isTarget = m.machine_id === selectedMachineId;
            const r = m.latest_reading;
            return (
              <div
                key={m.machine_id}
                onClick={() => setSelectedMachineId(m.machine_id)}
                className={`rounded-xl border p-4 transition-all cursor-pointer ${
                  isTarget
                    ? 'border-cyan-500/50 bg-slate-900 shadow-md shadow-cyan-500/10'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-cyan-400">
                      {m.machine_id}
                    </span>
                    <span className="font-bold text-white text-xs truncate max-w-[130px]">
                      {m.name}
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    m.status === 'Critical' ? 'bg-rose-500/20 text-rose-300' : m.status === 'Warning' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                  }`}>
                    {m.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-1 text-center font-mono text-xs bg-slate-900/90 rounded-lg p-2 border border-slate-800">
                  <div>
                    <div className="text-[9px] text-slate-500">TEMP</div>
                    <div className="text-amber-400 font-bold">{r ? `${r.temperature.toFixed(1)}°` : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">VIB</div>
                    <div className="text-rose-400 font-bold">{r ? r.vibration.toFixed(2) : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">CURR</div>
                    <div className="text-cyan-400 font-bold">{r ? `${r.current.toFixed(1)}A` : '--'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">RPM</div>
                    <div className="text-purple-400 font-bold">{r ? Math.round(r.rpm) : '--'}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Telemetry Packets Console Stream */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-xl font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-slate-300 font-semibold">
            <Terminal className="h-4 w-4 text-cyan-400" />
            <span>FastAPI Real-Time Telemetry Event Log</span>
          </div>
          <span className="text-[11px] text-slate-500">PostgreSQL Ingestion Feed</span>
        </div>

        <div className="mt-3 max-h-48 overflow-y-auto space-y-1.5 pr-2">
          {packetLogs.length === 0 ? (
            <div className="text-slate-500 py-3">Waiting for real ESP32 sensor telemetry...</div>
          ) : (
            packetLogs.map((log, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded bg-slate-900/60 px-2.5 py-1.5 border border-slate-800/60"
              >
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">[{log.time}]</span>
                  <span className="text-cyan-400 font-bold">[{log.source}]</span>
                  <span className="text-slate-200">{log.text}</span>
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                  log.status === 'CRITICAL' ? 'bg-rose-500/20 text-rose-400' : log.status === 'WARNING' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
                }`}>
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
