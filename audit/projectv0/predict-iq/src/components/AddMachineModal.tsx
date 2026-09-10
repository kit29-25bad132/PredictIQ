import React, { useState } from 'react';
import { MachineType } from '../types';
import api from '../services/api';
import { X, Plus, Cpu } from 'lucide-react';

interface AddMachineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMachineAdded: () => void;
}

export const AddMachineModal: React.FC<AddMachineModalProps> = ({
  isOpen,
  onClose,
  onMachineAdded,
}) => {
  const [machineId, setMachineId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<MachineType>('Induction Motor');
  const [location, setLocation] = useState('');
  const [ratedRpm, setRatedRpm] = useState(1450);
  const [ratedCurrent, setRatedCurrent] = useState(10.0);
  const [maxTemp, setMaxTemp] = useState(75.0);
  const [maxVibration, setMaxVibration] = useState(4.5);
  const [bearingType, setBearingType] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!machineId.trim() || !name.trim()) {
      setErrorMsg('Machine ID and Name are required.');
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);

    try {
      await api.registerMachine({
        machine_id: machineId.trim().toUpperCase(),
        name: name.trim(),
        type,
        location: location.trim() || 'Factory Main Floor',
        specifications: {
          ratedRPM: Number(ratedRpm),
          ratedCurrent: Number(ratedCurrent),
          maxTemp: Number(maxTemp),
          criticalTemp: Number(maxTemp) + 12,
          maxVibration: Number(maxVibration),
          criticalVibration: Number(maxVibration) + 2,
          bearingType: bearingType.trim() || 'Deep Groove Ball Bearing',
        },
      } as any);

      onMachineAdded();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to register machine asset.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="add-machine-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        id="add-machine-modal-content"
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Provision New Machine Asset</h2>
              <p className="text-xs text-slate-400">Register industrial equipment with baseline thresholds.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300">
                Machine ID <span className="text-rose-400">*</span>
              </label>
              <input
                id="input-new-machine-id"
                type="text"
                required
                placeholder="e.g. M006"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300">
                Asset Name <span className="text-rose-400">*</span>
              </label>
              <input
                id="input-new-machine-name"
                type="text"
                required
                placeholder="e.g. Primary Water Chiller Pump"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300">
                Equipment Category
              </label>
              <select
                id="select-new-machine-type"
                value={type}
                onChange={(e) => setType(e.target.value as MachineType)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value="Centrifugal Pump">Centrifugal Pump</option>
                <option value="Induction Motor">Induction Motor</option>
                <option value="CNC Spindle">CNC Spindle</option>
                <option value="Screw Compressor">Screw Compressor</option>
                <option value="Cooling Tower Fan">Cooling Tower Fan</option>
                <option value="Industrial Gearbox">Industrial Gearbox</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300">
                Plant Location / Line
              </label>
              <input
                id="input-new-machine-location"
                type="text"
                placeholder="e.g. Wing B - Packaging Area"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div>
              <label className="text-[11px] font-semibold text-slate-400">Rated RPM</label>
              <input
                id="input-new-machine-rpm"
                type="number"
                value={ratedRpm}
                onChange={(e) => setRatedRpm(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400">Rated Current (A)</label>
              <input
                id="input-new-machine-current"
                type="number"
                step="0.1"
                value={ratedCurrent}
                onChange={(e) => setRatedCurrent(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400">Max Temp (°C)</label>
              <input
                id="input-new-machine-temp"
                type="number"
                step="0.5"
                value={maxTemp}
                onChange={(e) => setMaxTemp(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400">Max Vib (mm/s)</label>
              <input
                id="input-new-machine-vib"
                type="number"
                step="0.1"
                value={maxVibration}
                onChange={(e) => setMaxVibration(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300">
              Bearing Specification (Optional)
            </label>
            <input
              id="input-new-machine-bearing"
              type="text"
              placeholder="e.g. SKF Explorer 6310-2RS1/C3"
              value={bearingType}
              onChange={(e) => setBearingType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Cancel
            </button>
            <button
              id="btn-confirm-add-machine"
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              <span>{isLoading ? 'Saving...' : 'Register Machine'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default AddMachineModal;
