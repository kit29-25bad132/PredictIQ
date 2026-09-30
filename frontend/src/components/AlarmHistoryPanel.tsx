import React, { useState } from 'react';
import { useAlarm } from '../context/AlarmContext';
import {
  History,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  VolumeX,
  Volume2,
  Clock,
  ShieldCheck,
  Search,
  Filter,
  Check,
} from 'lucide-react';

export const AlarmHistoryPanel: React.FC = () => {
  const { alarmIncidents, acknowledgeIncident, resolveIncident } = useAlarm();
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filtered = alarmIncidents.filter((inc) => {
    const matchesSev =
      filterSeverity === 'ALL' ||
      (filterSeverity === 'ACTIVE' && inc.status === 'ACTIVE') ||
      (filterSeverity === 'CRITICAL' && inc.severity === 'Critical') ||
      (filterSeverity === 'WARNING' && inc.severity === 'Warning') ||
      (filterSeverity === 'RESOLVED' && inc.status === 'RESOLVED');

    const matchesSearch =
      inc.machineId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.machineName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.alarmType.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.id.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesSev && matchesSearch;
  });

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <History className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
              Alarm Incident &amp; Audio Event History
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Verified chronological record of all telemetry threshold exceptions and operator audio mute actions
            </p>
          </div>
        </div>

        <span className="font-mono text-xs font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2.5 py-1 rounded-lg self-start sm:self-center">
          {alarmIncidents.length} Total Incidents Logged
        </span>
      </div>

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search incident by Machine ID, Name, or Alarm Type..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-slate-700/80 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
          />
        </div>

        <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs">
          {['ALL', 'ACTIVE', 'CRITICAL', 'WARNING', 'RESOLVED'].map((key) => (
            <button
              key={key}
              onClick={() => setFilterSeverity(key)}
              className={`rounded px-2.5 py-1 font-mono text-[11px] transition-all ${
                filterSeverity === key
                  ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
              <th className="pb-2.5 pl-2">Incident / Machine</th>
              <th className="pb-2.5">Alarm Type</th>
              <th className="pb-2.5">Reading / Threshold</th>
              <th className="pb-2.5">Severity</th>
              <th className="pb-2.5">Audio State</th>
              <th className="pb-2.5">Timestamp</th>
              <th className="pb-2.5">Status</th>
              <th className="pb-2.5 text-right pr-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">
                  <ShieldCheck className="h-7 w-7 mx-auto mb-2 text-emerald-500/60" />
                  <span>No alarm incidents recorded matching criteria.</span>
                </td>
              </tr>
            ) : (
              filtered.map((inc) => {
                const isCrit = inc.severity === 'Critical';
                const isResolved = inc.status === 'RESOLVED';
                const isAck = inc.status === 'ACKNOWLEDGED';

                return (
                  <tr key={inc.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Machine */}
                    <td className="py-3 pl-2">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        <span className="text-cyan-400">{inc.machineId}</span>
                        <span className="text-slate-400 text-[11px] font-sans">({inc.machineName})</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {inc.deviceId} &middot; {inc.source}
                      </div>
                    </td>

                    {/* Alarm Type */}
                    <td className="py-3">
                      <span className="font-semibold text-slate-200">{inc.alarmType}</span>
                    </td>

                    {/* Reading / Threshold */}
                    <td className="py-3">
                      {inc.sensorReading > 0 ? (
                        <div>
                          <span className={isCrit ? 'text-rose-400 font-bold' : 'text-amber-400 font-bold'}>
                            {inc.sensorReading.toFixed(inc.unit.includes('°C') ? 1 : 2)} {inc.unit}
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Limit: &ge; {inc.configuredThreshold.toFixed(inc.unit.includes('°C') ? 1 : 2)} {inc.unit}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Threshold breach</span>
                      )}
                    </td>

                    {/* Severity */}
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                          isCrit
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {isCrit ? <AlertOctagon className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {inc.severity.toUpperCase()}
                      </span>
                    </td>

                    {/* Audio State */}
                    <td className="py-3">
                      {inc.isAudioMuted ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-bold">
                          <VolumeX className="h-3.5 w-3.5" />
                          <span>Muted</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-bold">
                          <Volume2 className="h-3.5 w-3.5" />
                          <span>Audible</span>
                        </span>
                      )}
                    </td>

                    {/* Timestamp */}
                    <td className="py-3 text-slate-300 text-[11px]">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-500" />
                        <span>{new Date(inc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {new Date(inc.timestamp).toLocaleDateString()}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3">
                      {isResolved ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold">
                          <CheckCircle2 className="h-3 w-3" /> RESOLVED
                        </span>
                      ) : isAck ? (
                        <span className="rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 text-[10px] font-bold">
                          ACKNOWLEDGED
                        </span>
                      ) : (
                        <span className="rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 text-[10px] font-bold animate-pulse">
                          ACTIVE
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-3 text-right pr-2">
                      {!isResolved && (
                        <div className="flex items-center justify-end gap-1.5">
                          {!isAck && (
                            <button
                              onClick={() => acknowledgeIncident(inc.id)}
                              className="rounded bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-700"
                            >
                              Ack
                            </button>
                          )}
                          <button
                            onClick={() => resolveIncident(inc.id)}
                            className="flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40"
                          >
                            <Check className="h-3 w-3" />
                            <span>Resolve</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AlarmHistoryPanel;
