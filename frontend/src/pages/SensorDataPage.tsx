import React, { useState, useEffect } from 'react';
import { Machine, SensorReading } from '../types';
import api from '../services/api';
import {
  Database,
  Download,
  Filter,
  Search,
  Plus,
  RefreshCw,
  Cpu,
  Radio,
  FileText
} from 'lucide-react';

interface SensorDataPageProps {
  machines: Machine[];
  onOpenManualModal: (id?: string) => void;
  onSelectMachine: (id: string) => void;
}

export const SensorDataPage: React.FC<SensorDataPageProps> = ({
  machines,
  onOpenManualModal,
  onSelectMachine,
}) => {
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [limit, setLimit] = useState<number>(50);

  const fetchReadings = async () => {
    setIsLoading(true);
    try {
      if (selectedMachine !== 'ALL') {
        const data = await api.getSensorData(selectedMachine, limit);
        setReadings(data);
      } else if (machines.length > 0) {
        // Fetch readings across machines
        const promises = machines.map((m) => api.getSensorData(m.machine_id, Math.floor(limit / machines.length)));
        const results = await Promise.all(promises);
        const combined = results.flat().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setReadings(combined);
      } else {
        setReadings([]);
      }
    } catch (err) {
      console.error('Failed to load sensor readings from PostgreSQL:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReadings();
  }, [selectedMachine, limit, machines]);

  const exportCSV = () => {
    if (readings.length === 0) return;
    const headers = ['ID', 'Machine ID', 'Device ID', 'Timestamp', 'Temperature_C', 'Vibration_mm_s', 'Current_A', 'RPM'];
    const rows = readings.map((r) => [
      r.id,
      r.machine_id,
      r.device_id,
      r.timestamp,
      r.temperature,
      r.vibration,
      r.current,
      r.rpm,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `predict_iq_telemetry_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="sensor-data-page" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            PostgreSQL Real Telemetry Warehouse
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Browse, inspect, and export authentic time-series telemetry ingested via REST API from ESP32 microcontrollers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => onOpenManualModal()}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
          >
            <Plus className="h-3.5 w-3.5 stroke-[3]" />
            <span>Manual Real Input</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Filter by Machine</label>
          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="ALL">All Machines (Fleet Wide)</option>
            {machines.map((m) => (
              <option key={m.machine_id} value={m.machine_id}>
                {m.machine_id} - {m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-400 block mb-1">Query Limit</label>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value={25}>Latest 25 records</option>
            <option value={50}>Latest 50 records</option>
            <option value={100}>Latest 100 records</option>
            <option value={200}>Latest 200 records</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={fetchReadings}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Query PostgreSQL</span>
          </button>
        </div>
      </div>

      {/* Raw Records Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider font-sans">
              <tr>
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4">Machine ID</th>
                <th className="py-3.5 px-4">Device Node</th>
                <th className="py-3.5 px-4">Temperature</th>
                <th className="py-3.5 px-4">Vibration RMS</th>
                <th className="py-3.5 px-4">Current</th>
                <th className="py-3.5 px-4">RPM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {readings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                    No real sensor records found in PostgreSQL.
                  </td>
                </tr>
              ) : (
                readings.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {new Date(r.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => onSelectMachine(r.machine_id)}
                        className="font-bold text-cyan-400 hover:underline"
                      >
                        {r.machine_id}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-slate-400">
                      {r.device_id || 'ESP32'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={r.temperature > 80 ? 'text-rose-400 font-bold' : r.temperature > 74 ? 'text-amber-400' : 'text-slate-200'}>
                        {r.temperature.toFixed(2)} °C
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={r.vibration > 6 ? 'text-rose-400 font-bold' : r.vibration > 4.5 ? 'text-amber-400' : 'text-slate-200'}>
                        {r.vibration.toFixed(3)} mm/s
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={r.current > 15 ? 'text-amber-400' : 'text-slate-200'}>
                        {r.current.toFixed(2)} A
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {Math.round(r.rpm)} RPM
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
export default SensorDataPage;
