import React from 'react';
import { Machine } from '../types';
import { Activity, Flame, Zap, Clock, Cpu, ChevronRight, AlertTriangle, CheckCircle2, AlertOctagon, Radio } from 'lucide-react';

interface MachineCardProps {
  machine: Machine;
  onSelect: (machineId: string) => void;
  onOpenManualInput?: (machineId: string) => void;
}

export const MachineCard: React.FC<MachineCardProps> = ({
  machine,
  onSelect,
  onOpenManualInput,
}) => {
  const reading = machine.latest_reading;
  const hasReading = reading !== undefined && reading !== null;

  const temp = hasReading ? reading.temperature.toFixed(1) : '--';
  const vib = hasReading ? reading.vibration.toFixed(2) : '--';
  const current = hasReading ? reading.current.toFixed(1) : '--';

  const devices = machine.devices || [];
  const isAnyDeviceConnected = devices.some((d) => d.status === 'ONLINE');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Critical':
        return {
          bg: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
          dot: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse',
          icon: <AlertOctagon className="h-3.5 w-3.5" />,
          label: 'CRITICAL',
        };
      case 'Warning':
        return {
          bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
          dot: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]',
          icon: <AlertTriangle className="h-3.5 w-3.5" />,
          label: 'WARNING',
        };
      case 'Maintenance':
        return {
          bg: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
          dot: 'bg-blue-500',
          icon: <AlertTriangle className="h-3.5 w-3.5" />,
          label: 'MAINTENANCE',
        };
      default:
        return {
          bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
          dot: 'bg-emerald-500',
          icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          label: 'HEALTHY',
        };
    }
  };

  const badge = getStatusBadge(machine.status);

  return (
    <div
      id={`machine-card-${machine.machine_id}`}
      className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-lg backdrop-blur-md transition-all duration-200 hover:border-slate-700 hover:shadow-cyan-500/5 hover:-translate-y-0.5"
    >
      {/* Top Header with Machine ID & Status */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-cyan-400 border border-cyan-500/20">
              {machine.machine_id}
            </span>
            <span className="text-xs text-slate-400 font-medium truncate max-w-[140px]">
              {machine.type}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                isAnyDeviceConnected
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <Radio className="h-3 w-3" />
              <span>{isAnyDeviceConnected ? 'ESP32 ONLINE' : 'ESP32 OFFLINE'}</span>
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold ${badge.bg}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
          </div>
        </div>

        {/* Machine Name & Location */}
        <h3 className="mt-2.5 text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
          {machine.name}
        </h3>
        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
          <span>{machine.location}</span>
        </p>

        {/* Real-time Telemetry Readouts */}
        <div className="mt-4 grid grid-cols-4 gap-2 rounded-lg bg-slate-950/60 p-2.5 border border-slate-800/80 text-center">
          <div className="flex flex-col">
            <span className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-400">
              <Flame className="h-3 w-3 text-amber-400" /> Temp
            </span>
            <span className="font-mono text-sm font-semibold text-slate-100 mt-0.5">
              {temp !== '--' ? `${temp}°C` : '--'}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-400">
              <span className="text-purple-400">RPM</span>
            </span>
            <span className="font-mono text-sm font-semibold text-slate-100 mt-0.5">
              {hasReading ? Math.round(reading.rpm) : '--'}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-400">
              <Activity className="h-3 w-3 text-rose-400" /> Vib
            </span>
            <span className="font-mono text-sm font-semibold text-slate-100 mt-0.5">
              {vib !== '--' ? `${vib}` : '--'} <span className="text-[9px] text-slate-400">mm/s</span>
            </span>
          </div>

          <div className="flex flex-col">
            <span className="flex items-center justify-center gap-1 text-[11px] font-medium text-slate-400">
              <Zap className="h-3 w-3 text-cyan-400" /> Current
            </span>
            <span className="font-mono text-sm font-semibold text-slate-100 mt-0.5">
              {current !== '--' ? `${current}A` : '--'}
            </span>
          </div>
        </div>

        {/* Telemetry Source & Health Info */}
        <div className="mt-4 space-y-2 border-t border-slate-800/80 pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Source:</span>
            <span className="font-mono text-[11px] text-cyan-400">
              {reading?.source === 'WOKWI' ? 'WOKWI SIMULATION' : reading?.source || 'NO READINGS'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 text-slate-400">
            <span className="flex items-center gap-1 font-medium">
              <Clock className="h-3.5 w-3.5 text-cyan-400" /> Last Reading:
            </span>
            <span className="font-mono text-xs font-semibold text-slate-300">
              {reading ? new Date(reading.timestamp).toLocaleTimeString() : 'No data yet'}
            </span>
          </div>
          {reading?.source === 'WOKWI' && (
            <div className="text-[10px] text-amber-400">Simulation data - not for ML training.</div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <span className="text-[11px] truncate max-w-[130px] font-mono">
          {hasReading ? (
            <span className="text-emerald-400">📡 Real Reading</span>
          ) : (
            <span className="text-slate-500">Waiting for data</span>
          )}
        </span>

        <div className="flex items-center gap-2">
          {onOpenManualInput && (
            <button
              id={`btn-manual-${machine.machine_id}`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenManualInput(machine.machine_id);
              }}
              className="rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Manual Input
            </button>
          )}

          <button
            id={`btn-view-${machine.machine_id}`}
            onClick={() => onSelect(machine.machine_id)}
            className="flex items-center gap-1 rounded-lg bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500 hover:text-slate-950 transition-all"
          >
            <span>Inspect</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
export default MachineCard;
