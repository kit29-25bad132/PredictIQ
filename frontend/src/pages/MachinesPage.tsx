import React, { useState } from 'react';
import { Machine } from '../types';
import {
  Cpu,
  Plus,
  Search,
  ChevronRight,
  Activity,
  Flame,
  Zap,
  Gauge,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Layers,
  MapPin
} from 'lucide-react';

interface MachinesPageProps {
  machines: Machine[];
  onSelectMachine: (machineId: string) => void;
  onOpenManualModal: (machineId?: string) => void;
  onOpenAddMachineModal: () => void;
}

export const MachinesPage: React.FC<MachinesPageProps> = ({
  machines,
  onSelectMachine,
  onOpenManualModal,
  onOpenAddMachineModal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');

  const uniqueTypes = Array.from(new Set(machines.map((m) => m.type)));

  const filteredMachines = machines.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.machine_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'ALL' || m.type === typeFilter;
    const matchesStatus = statusFilter === 'ALL' || m.status.toUpperCase() === statusFilter.toUpperCase();
    return matchesSearch && matchesType && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Critical':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-xs font-bold text-rose-400">
            <AlertOctagon className="h-3 w-3" /> Critical
          </span>
        );
      case 'Warning':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs font-bold text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Warning
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-bold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Healthy
          </span>
        );
    }
  };

  return (
    <div id="machines-page" className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Machine Asset Fleet Registry</h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage monitored equipment specifications, operational thresholds, and IoT sensor assignments.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs">
            <button
              onClick={() => setViewMode('table')}
              className={`rounded px-2.5 py-1 font-medium transition-all ${
                viewMode === 'table' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Table View
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`rounded px-2.5 py-1 font-medium transition-all ${
                viewMode === 'grid' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Grid View
            </button>
          </div>

          <button
            id="btn-add-machine-top"
            onClick={onOpenAddMachineModal}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
          >
            <Plus className="h-3.5 w-3.5 stroke-[3]" />
            <span>Add Equipment</span>
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Machine ID, Name, or Location..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-700/80 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="ALL">All Asset Types</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="HEALTHY">Healthy</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'table' ? (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Asset / ID</th>
                  <th className="py-3.5 px-4">Category & Location</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Live Telemetry</th>
                  <th className="py-3.5 px-4">AI Failure Risk</th>
                  <th className="py-3.5 px-4">RUL</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
                {filteredMachines.map((m) => {
                  const reading = m.current_reading;
                  const pred = m.latest_prediction;
                  const riskPercent = pred?.failure_probability == null ? null : Math.round(pred.failure_probability * 100);

                  return (
                    <tr
                      key={m.machine_id}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                      onClick={() => onSelectMachine(m.machine_id)}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 font-mono font-bold text-cyan-400 border border-cyan-500/20">
                            {m.machine_id}
                          </div>
                          <div>
                            <div className="font-bold text-white text-sm hover:text-cyan-300">
                              {m.name}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              {m.esp32_device_id || 'ESP32-GEN-01'}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="text-slate-200">{m.type}</div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3 text-slate-500" />
                          <span>{m.location}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {getStatusBadge(m.status)}
                      </td>

                      <td className="py-3.5 px-4">
                        {reading ? (
                          <div className="flex items-center gap-3 font-mono text-[11px]">
                            <span className="flex items-center gap-1 text-amber-300">
                              <Flame className="h-3 w-3 text-amber-400" />
                              {reading.temperature.toFixed(1)}°C
                            </span>
                            <span className="flex items-center gap-1 text-rose-300">
                              <Activity className="h-3 w-3 text-rose-400" />
                              {reading.vibration.toFixed(2)} mm/s
                            </span>
                            <span className="flex items-center gap-1 text-cyan-300">
                              <Zap className="h-3 w-3 text-cyan-400" />
                              {reading.current.toFixed(1)} A
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500">No telemetry</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-800">
                            {riskPercent !== null && <div
                              className={`h-full ${
                                riskPercent >= 80
                                  ? 'bg-rose-500'
                                  : riskPercent >= 50
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${riskPercent}%` }}
                            />}
                          </div>
                          <span
                            className={`font-mono font-bold ${
                              riskPercent >= 80
                                ? 'text-rose-400'
                                : riskPercent >= 50
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {riskPercent === null ? 'Not available' : `${riskPercent}%`}
                          </span>
                        </div>
                        {pred?.component && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {pred.component}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-200">
                        {pred ? `${pred.remaining_life_days} Days` : '150 Days'}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => onOpenManualModal(m.machine_id)}
                            className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white"
                          >
                            Inject
                          </button>
                          <button
                            onClick={() => onSelectMachine(m.machine_id)}
                            className="flex items-center gap-1 rounded bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500 hover:text-slate-950"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Grid Cards View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMachines.map((m) => {
            const reading = m.current_reading;
            const pred = m.latest_prediction;
                  const riskPercent = pred?.failure_probability == null ? null : Math.round(pred.failure_probability * 100);

            return (
              <div
                key={m.machine_id}
                onClick={() => onSelectMachine(m.machine_id)}
                className="group rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-lg hover:border-slate-700 cursor-pointer transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-cyan-400 border border-cyan-500/20">
                    {m.machine_id}
                  </span>
                  {getStatusBadge(m.status)}
                </div>

                <h3 className="mt-3 font-bold text-white group-hover:text-cyan-300 text-base">
                  {m.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{m.location}</p>

                <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-950 p-2.5 font-mono text-xs text-center border border-slate-800">
                  <div>
                    <div className="text-[10px] text-slate-400">Temp</div>
                    <div className="font-bold text-amber-400 mt-0.5">
                      {reading ? `${reading.temperature.toFixed(1)}°C` : '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Vibration</div>
                    <div className="font-bold text-rose-400 mt-0.5">
                      {reading ? reading.vibration.toFixed(2) : '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Risk</div>
                    <div className="font-bold mt-0.5 text-slate-400">
                      {riskPercent === null ? 'Not available' : `${riskPercent}%`}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800 pt-3">
                  <span>RUL: <strong className="text-slate-200">{pred?.remaining_life_days == null ? 'Not available' : `${pred.remaining_life_days} Days`}</strong></span>
                  <span className="flex items-center gap-1 text-cyan-400 font-semibold group-hover:translate-x-0.5 transition-transform">
                    View Diagnostics <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
export default MachinesPage;
