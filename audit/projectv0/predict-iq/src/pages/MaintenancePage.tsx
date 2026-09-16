import React, { useState, useEffect } from 'react';
import { Machine, MaintenanceRecord } from '../types';
import api from '../services/api';
import {
  Wrench,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  User,
  X,
  Database
} from 'lucide-react';

interface MaintenancePageProps {
  machines: Machine[];
  onSelectMachine: (id: string) => void;
}

export const MaintenancePage: React.FC<MaintenancePageProps> = ({
  machines,
  onSelectMachine,
}) => {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [selectedMachineFilter, setSelectedMachineFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

  // New Record Form State
  const [formMachineId, setFormMachineId] = useState<string>(machines[0]?.machine_id || 'M001');
  const [formComponent, setFormComponent] = useState<string>('Bearing');
  const [formIssue, setFormIssue] = useState<string>('');
  const [formAction, setFormAction] = useState<string>('');
  const [formTech, setFormTech] = useState<string>('');
  const [formStatus, setFormStatus] = useState<string>('Completed');

  const fetchRecords = async () => {
    try {
      const data = await api.getMaintenanceHistory();
      setRecords(data);
    } catch (err) {
      console.error('Failed to fetch maintenance logs from PostgreSQL:', err);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formIssue.trim() || !formAction.trim()) return;

    try {
      await api.createMaintenanceRecord({
        machine_id: formMachineId,
        component: formComponent,
        issue_description: formIssue.trim(),
        maintenance_action: formAction.trim(),
        technician: formTech.trim() || 'Plant Maintenance Engineer',
        status: formStatus,
        maintenance_date: new Date().toISOString(),
      });

      setIsAddModalOpen(false);
      setFormIssue('');
      setFormAction('');
      fetchRecords();
    } catch (err) {
      console.error('Failed to save maintenance record:', err);
    }
  };

  const filteredRecords = records.filter((r) => {
    const matchesMachine = selectedMachineFilter === 'ALL' || r.machine_id === selectedMachineFilter;
    const matchesSearch =
      (r.issue_description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.maintenance_action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.technician || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.machine_id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesMachine && matchesSearch;
  });

  return (
    <div id="maintenance-page" className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Ground-Truth Maintenance & Failure Logs</h2>
          <p className="text-xs text-slate-400 mt-1">
            Store authentic maintenance events in PostgreSQL to train future condition monitoring ML models.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
        >
          <Plus className="h-3.5 w-3.5 stroke-[3]" />
          <span>Log Maintenance Event</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Ground-Truth Logs</span>
          <div className="font-mono text-2xl font-bold text-white mt-1">{filteredRecords.length}</div>
          <span className="text-[11px] text-slate-500">Stored in PostgreSQL maintenance_records table</span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ML Dataset Ground Truth</span>
          <div className="font-mono text-2xl font-bold text-emerald-400 mt-1">{filteredRecords.length} Events</div>
          <span className="text-[11px] text-slate-500">Real failure and overhaul labels ready for supervised learning</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="sm:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search work orders, technicians, or maintenance procedures..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-700/80 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div>
          <select
            value={selectedMachineFilter}
            onChange={(e) => setSelectedMachineFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="ALL">All Machines</option>
            {machines.map((m) => (
              <option key={m.machine_id} value={m.machine_id}>
                {m.machine_id} - {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Records Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-3.5 px-4">Date</th>
                <th className="py-3.5 px-4">Machine Asset</th>
                <th className="py-3.5 px-4">Component</th>
                <th className="py-3.5 px-4">Diagnostic Issue</th>
                <th className="py-3.5 px-4">Action Taken</th>
                <th className="py-3.5 px-4">Technician</th>
                <th className="py-3.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium text-slate-300">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No maintenance records found in PostgreSQL database.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(rec.maintenance_date).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        onClick={() => onSelectMachine(rec.machine_id)}
                        className="rounded bg-slate-800 px-2 py-0.5 font-mono text-cyan-400 font-bold hover:bg-slate-700 transition-colors"
                      >
                        {rec.machine_id}
                      </button>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-cyan-300">{rec.component}</td>
                    <td className="py-3.5 px-4 font-bold text-white max-w-xs">{rec.issue_description}</td>
                    <td className="py-3.5 px-4 text-slate-300 max-w-sm">{rec.maintenance_action}</td>
                    <td className="py-3.5 px-4 text-slate-400">{rec.technician}</td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                        rec.status === 'Completed'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : rec.status === 'In Progress'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {rec.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Work Order Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Log Ground-Truth Maintenance Record</h3>
              </div>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRecord} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="text-slate-300 font-semibold">Equipment Asset</label>
                <select
                  value={formMachineId}
                  onChange={(e) => setFormMachineId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                >
                  {machines.map((m) => (
                    <option key={m.machine_id} value={m.machine_id}>
                      {m.machine_id} - {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-semibold">Component</label>
                <select
                  value={formComponent}
                  onChange={(e) => setFormComponent(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                >
                  <option value="Bearing">Bearing</option>
                  <option value="Stator Winding">Stator Winding</option>
                  <option value="Shaft / Coupling">Shaft / Coupling</option>
                  <option value="Impeller / Rotor">Impeller / Rotor</option>
                  <option value="Cooling System">Cooling System</option>
                  <option value="Gearbox">Gearbox</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-semibold">Defect / Diagnostic Issue</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fluting wear and spalling on drive-end bearing"
                  value={formIssue}
                  onChange={(e) => setFormIssue(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold">Maintenance Action Taken</label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Replaced drive-end bearing with SKF Explorer 6310, refilled high-temp grease."
                  value={formAction}
                  onChange={(e) => setFormAction(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold">Technician</label>
                  <input
                    type="text"
                    placeholder="e.g. David Vance"
                    value={formTech}
                    onChange={(e) => setFormTech(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-semibold">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"
                  >
                    <option value="Completed">Completed</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Scheduled">Scheduled</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="rounded-lg px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-cyan-500 px-5 py-2 font-bold text-slate-950 hover:bg-cyan-400"
                >
                  Save to PostgreSQL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default MaintenancePage;
