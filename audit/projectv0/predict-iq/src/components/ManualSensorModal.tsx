import React, { useState } from 'react';
import { Machine, SensorInputPayload } from '../types';
import api from '../services/api';
import { X, Flame, Activity, Zap, Gauge, Play, CheckCircle, Database } from 'lucide-react';

interface ManualSensorModalProps {
  isOpen: boolean;
  onClose: () => void;
  machines: Machine[];
  initialMachineId?: string;
  onDataSubmitted: () => void;
}

export const ManualSensorModal: React.FC<ManualSensorModalProps> = ({
  isOpen,
  onClose,
  machines,
  initialMachineId,
  onDataSubmitted,
}) => {
  const [selectedMachineId, setSelectedMachineId] = useState<string>(
    initialMachineId || (machines.length > 0 ? machines[0].machine_id : 'M001')
  );
  const [temperature, setTemperature] = useState<number>(72.4);
  const [vibration, setVibration] = useState<number>(3.8);
  const [current, setCurrent] = useState<number>(8.7);
  const [rpm, setRpm] = useState<number>(1450);
  const [deviceId, setDeviceId] = useState<string>('ESP32_001');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payload: SensorInputPayload = {
      device_id: deviceId || `ESP32_${selectedMachineId}`,
      machine_id: selectedMachineId,
      temperature: Number(temperature),
      vibration: Number(vibration),
      current: Number(current),
      rpm: Number(rpm),
    };

    try {
      const response = await api.sendSensorData(payload);
      setSuccessMsg(`Sensor data stored in PostgreSQL successfully (Reading ID: ${response.id})`);
      onDataSubmitted();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to dispatch sensor telemetry to backend API.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="manual-sensor-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        id="manual-sensor-modal-content"
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                <Database className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-bold text-white">
                Real Manual Telemetry Measurement
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Submit physical test readings directly to PostgreSQL via <code className="text-cyan-400 font-mono">POST /api/sensor-data</code>.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Machine Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-300">
                Target Machine Asset
              </label>
              <select
                id="select-manual-machine"
                value={selectedMachineId}
                onChange={(e) => {
                  setSelectedMachineId(e.target.value);
                  setDeviceId(`ESP32_${e.target.value}`);
                }}
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                {machines.map((m) => (
                  <option key={m.machine_id} value={m.machine_id}>
                    {m.machine_id} - {m.name} ({m.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Device ID */}
            <div>
              <label className="text-xs font-semibold text-slate-300">
                ESP32 Device Node ID
              </label>
              <input
                id="input-device-id"
                type="text"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="ESP32_001"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Sensor Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {/* Temperature */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Flame className="h-4 w-4 text-amber-400" /> Temperature (°C)
                </span>
                <span className="font-mono text-sm font-bold text-amber-400">
                  {temperature.toFixed(1)} °C
                </span>
              </div>
              <input
                id="input-temperature"
                type="range"
                min="30"
                max="120"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="mt-3 w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* Vibration */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Activity className="h-4 w-4 text-rose-400" /> Vibration RMS (mm/s)
                </span>
                <span className="font-mono text-sm font-bold text-rose-400">
                  {vibration.toFixed(2)} mm/s
                </span>
              </div>
              <input
                id="input-vibration"
                type="range"
                min="0.0"
                max="20.0"
                step="0.05"
                value={vibration}
                onChange={(e) => setVibration(parseFloat(e.target.value))}
                className="mt-3 w-full accent-rose-500 cursor-pointer"
              />
            </div>

            {/* Current */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Zap className="h-4 w-4 text-cyan-400" /> Current (A)
                </span>
                <span className="font-mono text-sm font-bold text-cyan-400">
                  {current.toFixed(1)} A
                </span>
              </div>
              <input
                id="input-current"
                type="range"
                min="0.0"
                max="40.0"
                step="0.1"
                value={current}
                onChange={(e) => setCurrent(parseFloat(e.target.value))}
                className="mt-3 w-full accent-cyan-500 cursor-pointer"
              />
            </div>

            {/* RPM */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Gauge className="h-4 w-4 text-purple-400" /> Speed (RPM)
                </span>
                <span className="font-mono text-sm font-bold text-purple-400">
                  {Math.round(rpm)} RPM
                </span>
              </div>
              <input
                id="input-rpm"
                type="range"
                min="0"
                max="4000"
                step="10"
                value={rpm}
                onChange={(e) => setRpm(parseInt(e.target.value))}
                className="mt-3 w-full accent-purple-500 cursor-pointer"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Close
            </button>
            <button
              id="btn-submit-manual-sensor"
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{isLoading ? 'Storing in PostgreSQL...' : 'Store Real Measurement'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
export default ManualSensorModal;
