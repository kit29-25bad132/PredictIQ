import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { MachineSimulationConfig, DEFAULT_SIMULATION_CONFIG, SimulationMode } from '../types';
import api from '../services/api';

export interface SimulatedTelemetryPoint {
  index: number;
  time: string;
  timestamp: string;
  temperature: number;
  current: number;
  rpm: number;
  vibration: number;
  source: 'SIMULATED / DYNAMIC_CONFIG';
  status_temp: 'NORMAL' | 'WARNING' | 'CRITICAL';
  status_current: 'NORMAL' | 'WARNING' | 'CRITICAL';
  status_rpm: 'NORMAL' | 'WARNING' | 'CRITICAL';
  status_vibration: 'NORMAL' | 'WARNING' | 'CRITICAL';
}

export type TimeWindow = '1m' | '5m' | '10m';

export interface SimulationContextType {
  configs: Record<string, MachineSimulationConfig>;
  activeMachineId: string;
  setActiveMachineId: (id: string) => void;
  activeConfig: MachineSimulationConfig;
  isLoadingConfig: boolean;
  hasUnsavedChanges: boolean;
  lastSavedAt: string | null;
  updateDraftConfig: (updates: Partial<MachineSimulationConfig>) => void;
  saveActiveConfig: () => Promise<{ success: boolean; message?: string }>;
  resetActiveConfig: () => Promise<void>;
  toggleMotorPower: () => Promise<void>;
  setSimulationMode: (mode: SimulationMode) => Promise<void>;

  // Live Simulated State
  instantaneous: {
    temperature: number;
    current: number;
    rpm: number;
    vibration: number;
    motor_powered: boolean;
    timestamp: string;
    status_temp: 'NORMAL' | 'WARNING' | 'CRITICAL';
    status_current: 'NORMAL' | 'WARNING' | 'CRITICAL';
    status_rpm: 'NORMAL' | 'WARNING' | 'CRITICAL';
    status_vibration: 'NORMAL' | 'WARNING' | 'CRITICAL';
  };

  // Time-series history for graphs
  historyBuffer: SimulatedTelemetryPoint[];
  timeWindow: TimeWindow;
  setTimeWindow: (w: TimeWindow) => void;
  clearHistory: () => void;

  // Simulation mode active toggle (Simulation vs Real ESP32 Hardware)
  isSimulationMode: boolean;
  setIsSimulationMode: (active: boolean) => void;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [configs, setConfigs] = useState<Record<string, MachineSimulationConfig>>({});
  const [activeMachineId, setActiveMachineId] = useState<string>('M001');
  const [draftConfig, setDraftConfig] = useState<MachineSimulationConfig>(DEFAULT_SIMULATION_CONFIG);
  const [savedConfig, setSavedConfig] = useState<MachineSimulationConfig>(DEFAULT_SIMULATION_CONFIG);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isSimulationMode, setIsSimulationMode] = useState<boolean>(true);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1m');

  // Time-series history buffer
  const [historyBuffer, setHistoryBuffer] = useState<SimulatedTelemetryPoint[]>([]);

  // Simulation internal state variables (continuous physics tracker)
  const currentValuesRef = useRef({
    temperature: 32.0,
    current: 1.2,
    rpm: 1450.0,
    vibration: 0.8,
  });

  const tickIndexRef = useRef<number>(0);

  // Instantaneous state for React consumers
  const [instantaneous, setInstantaneous] = useState<{
    temperature: number;
    current: number;
    rpm: number;
    vibration: number;
    motor_powered: boolean;
    timestamp: string;
    status_temp: 'NORMAL' | 'WARNING' | 'CRITICAL';
    status_current: 'NORMAL' | 'WARNING' | 'CRITICAL';
    status_rpm: 'NORMAL' | 'WARNING' | 'CRITICAL';
    status_vibration: 'NORMAL' | 'WARNING' | 'CRITICAL';
  }>({
    temperature: 32.0,
    current: 1.2,
    rpm: 1450.0,
    vibration: 0.8,
    motor_powered: true,
    timestamp: new Date().toISOString(),
    status_temp: 'NORMAL',
    status_current: 'NORMAL',
    status_rpm: 'NORMAL',
    status_vibration: 'NORMAL',
  });

  // Fetch saved config from backend for active machine
  const fetchMachineConfig = useCallback(async (machineId: string) => {
    setIsLoadingConfig(true);
    try {
      const data = await api.getSimulationConfig(machineId);
      setConfigs((prev) => ({ ...prev, [machineId]: data }));
      setSavedConfig(data);
      setDraftConfig(data);
      setLastSavedAt(data.updated_at || new Date().toISOString());

      // Sync active simulation values smoothly to target/range
      currentValuesRef.current = {
        temperature: data.temp_target || 32.0,
        current: data.motor_powered ? (data.current_target || 1.2) : 0.0,
        rpm: data.motor_powered ? (data.rpm_target || 1450.0) : 0.0,
        vibration: data.motor_powered ? (data.vib_target || 0.8) : 0.05,
      };
    } catch (err) {
      console.warn('[SimulationContext] Failed to fetch backend config, using defaults:', err);
      const fallback = { ...DEFAULT_SIMULATION_CONFIG, machine_id: machineId };
      setSavedConfig(fallback);
      setDraftConfig(fallback);
    } finally {
      setIsLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    fetchMachineConfig(activeMachineId);
  }, [activeMachineId, fetchMachineConfig]);

  // Check for unsaved changes
  const hasUnsavedChanges = JSON.stringify(draftConfig) !== JSON.stringify(savedConfig);

  // Update draft config
  const updateDraftConfig = useCallback((updates: Partial<MachineSimulationConfig>) => {
    setDraftConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  // Save active configuration to backend
  const saveActiveConfig = useCallback(async (): Promise<{ success: boolean; message?: string }> => {
    try {
      const saved = await api.saveSimulationConfig(activeMachineId, draftConfig);
      setSavedConfig(saved);
      setDraftConfig(saved);
      setConfigs((prev) => ({ ...prev, [activeMachineId]: saved }));
      setLastSavedAt(saved.updated_at || new Date().toISOString());
      return { success: true, message: 'Simulation configuration saved successfully!' };
    } catch (err: any) {
      console.error('[SimulationContext] Save failed:', err);
      return { success: false, message: err.message || 'Failed to persist simulation settings' };
    }
  }, [activeMachineId, draftConfig]);

  // Reset active configuration to defaults
  const resetActiveConfig = useCallback(async () => {
    try {
      const reset = await api.resetSimulationConfig(activeMachineId);
      setSavedConfig(reset);
      setDraftConfig(reset);
      setConfigs((prev) => ({ ...prev, [activeMachineId]: reset }));
      setLastSavedAt(reset.updated_at || new Date().toISOString());
    } catch (err) {
      console.warn('[SimulationContext] Reset API failed, resetting locally:', err);
      const def = { ...DEFAULT_SIMULATION_CONFIG, machine_id: activeMachineId };
      setSavedConfig(def);
      setDraftConfig(def);
    }
  }, [activeMachineId]);

  // Toggle motor power switch
  const toggleMotorPower = useCallback(async () => {
    const nextPower = !draftConfig.motor_powered;
    const updated = { ...draftConfig, motor_powered: nextPower };
    setDraftConfig(updated);
    try {
      const saved = await api.saveSimulationConfig(activeMachineId, updated);
      setSavedConfig(saved);
      setConfigs((prev) => ({ ...prev, [activeMachineId]: saved }));
    } catch (e) {
      console.warn('Failed to update motor power state on backend:', e);
    }
  }, [activeMachineId, draftConfig]);

  // Switch simulation mode
  const setSimulationMode = useCallback(async (mode: SimulationMode) => {
    const updated = { ...draftConfig, simulation_mode: mode };
    setDraftConfig(updated);
    try {
      const saved = await api.saveSimulationConfig(activeMachineId, updated);
      setSavedConfig(saved);
      setConfigs((prev) => ({ ...prev, [activeMachineId]: saved }));
    } catch (e) {
      console.warn('Failed to update simulation mode on backend:', e);
    }
  }, [activeMachineId, draftConfig]);

  const clearHistory = useCallback(() => {
    setHistoryBuffer([]);
  }, []);

  // =========================================================================
  // DYNAMIC GRADUAL SIMULATION PHYSICS LOOP
  // Uses saved configuration values (and falls back gracefully)
  // =========================================================================
  useEffect(() => {
    if (!isSimulationMode) return;

    const intervalMs = Math.max(100, Math.min(10000, savedConfig.update_interval_ms || 1000));

    const timer = setInterval(() => {
      tickIndexRef.current += 1;
      const tick = tickIndexRef.current;
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const cfg = savedConfig;
      const motorPowered = cfg.motor_powered;
      const mode = cfg.simulation_mode || 'cycling';

      let { temperature, current, rpm, vibration } = currentValuesRef.current;

      // -----------------------------------------------------------------------
      // 1. RPM GRADUAL SIMULATION
      // -----------------------------------------------------------------------
      if (!motorPowered) {
        // Motor OFF: Smooth deceleration to 0 RPM
        rpm = Math.max(0, rpm - (cfg.rpm_step || 50));
      } else {
        // Motor ON: Gradual approach to configured target & realistic running oscillation
        const targetRpm = Math.min(cfg.rpm_max, Math.max(cfg.rpm_min, cfg.rpm_target));
        if (Math.abs(rpm - targetRpm) > (cfg.rpm_step || 50)) {
          rpm += (targetRpm > rpm ? 1 : -1) * (cfg.rpm_step || 50);
        } else {
          // Slight physical running jitter
          rpm = targetRpm + (Math.sin(tick * 0.4) * 8 + (Math.random() - 0.5) * 4);
        }
        rpm = Math.min(cfg.rpm_max, Math.max(cfg.rpm_min, rpm));
      }

      // -----------------------------------------------------------------------
      // 2. TEMPERATURE GRADUAL SIMULATION
      // -----------------------------------------------------------------------
      const tMin = cfg.temp_min;
      const tMax = cfg.temp_max;
      const tStep = cfg.temp_step || 0.2;
      const tTarget = cfg.temp_target;

      if (!motorPowered) {
        // Cool down towards ambient min temperature
        temperature = Math.max(tMin, temperature - (tStep * 0.5));
      } else if (mode === 'increasing') {
        // Monotonic increase up to max
        temperature = Math.min(tMax, temperature + tStep);
      } else if (mode === 'decreasing') {
        // Monotonic decrease down to min
        temperature = Math.max(tMin, temperature - tStep);
      } else if (mode === 'harmonic') {
        // Harmonic thermal wave
        const harmonicAmp = (tMax - tMin) * 0.4;
        const center = (tMax + tMin) / 2;
        temperature = center + Math.sin(tick * 0.1) * harmonicAmp + (Math.random() - 0.5) * 0.1;
      } else if (mode === 'bearing_fault') {
        // Elevated high-friction thermal rise
        temperature = Math.min(tMax + 10, temperature + tStep * 1.5);
      } else {
        // CYCLING (Default): Smooth sinusoidal wave spanning within [temp_min, temp_max]
        const range = tMax - tMin;
        const center = tMin + range * 0.5;
        const amp = range * 0.45;
        const osc = Math.sin(tick * 0.08) * amp;
        temperature = center + osc + (Math.random() - 0.5) * 0.1;
      }
      temperature = Math.min(Math.max(tMin, temperature), motorPowered ? (mode === 'bearing_fault' ? tMax + 15 : tMax) : tMax);

      // -----------------------------------------------------------------------
      // 3. MOTOR CURRENT GRADUAL SIMULATION
      // -----------------------------------------------------------------------
      const cMin = cfg.current_min;
      const cMax = cfg.current_max;
      const cStep = cfg.current_step || 0.1;
      const cTarget = cfg.current_target;

      if (!motorPowered) {
        // Residual de-energized current
        current = Math.max(0, current - cStep);
      } else {
        const loadRatio = rpm > 0 && cfg.rpm_rated > 0 ? (rpm / cfg.rpm_rated) : 0;
        if (mode === 'increasing') {
          current = Math.min(cMax, current + cStep);
        } else if (mode === 'decreasing') {
          current = Math.max(cMin, current - cStep);
        } else if (mode === 'bearing_fault') {
          current = Math.min(cMax, cTarget + 1.2 + (Math.random() - 0.5) * 0.3);
        } else {
          // Dynamic cycling proportional to load + small harmonics
          const baseCurr = cTarget * loadRatio;
          const currOsc = Math.sin(tick * 0.15) * (cStep * 2) + (Math.random() - 0.5) * 0.05;
          current = Math.min(cMax, Math.max(cMin, baseCurr + currOsc));
        }
      }

      // -----------------------------------------------------------------------
      // 4. VIBRATION GRADUAL SIMULATION
      // -----------------------------------------------------------------------
      const vMin = cfg.vib_min;
      const vMax = cfg.vib_max;
      const vStep = cfg.vib_step || 0.05;
      const vTarget = cfg.vib_target;

      if (!motorPowered || rpm <= 10) {
        vibration = Math.max(0.02, vibration - (vStep * 1.5));
      } else if (mode === 'bearing_fault') {
        // High spike bearing degradation pulses
        const isSpike = tick % 4 === 0;
        const spikeVal = isSpike ? 2.8 : 0.8;
        vibration = Math.min(vMax + 2.0, vTarget + spikeVal + Math.sin(tick * 0.6) * 0.5);
      } else if (mode === 'harmonic') {
        const hOsc = Math.sin(tick * 0.5) * 0.8 + Math.sin(tick * 1.7) * 0.3;
        vibration = Math.min(vMax, Math.max(vMin, vTarget + hOsc));
      } else if (mode === 'increasing') {
        vibration = Math.min(vMax, vibration + vStep);
      } else if (mode === 'decreasing') {
        vibration = Math.max(vMin, vibration - vStep);
      } else {
        // Cycling nominal vibration
        const vOsc = Math.sin(tick * 0.12) * ((vMax - vMin) * 0.3) + (Math.random() - 0.5) * 0.04;
        vibration = Math.min(vMax, Math.max(vMin, vTarget + vOsc));
      }

      // Format clean numerical values
      temperature = Number(temperature.toFixed(1));
      current = Number(current.toFixed(2));
      rpm = Number(Math.round(rpm));
      vibration = Number(vibration.toFixed(2));

      // Update current physics tracker ref
      currentValuesRef.current = { temperature, current, rpm, vibration };

      // Calculate dynamic channel statuses from configured thresholds
      const status_temp: 'NORMAL' | 'WARNING' | 'CRITICAL' =
        temperature >= cfg.temp_critical ? 'CRITICAL' : temperature >= cfg.temp_warning ? 'WARNING' : 'NORMAL';

      const status_current: 'NORMAL' | 'WARNING' | 'CRITICAL' =
        current >= cfg.current_critical ? 'CRITICAL' : current >= cfg.current_warning ? 'WARNING' : 'NORMAL';

      const status_rpm: 'NORMAL' | 'WARNING' | 'CRITICAL' =
        rpm < cfg.rpm_critical ? 'CRITICAL' : rpm < cfg.rpm_warning ? 'WARNING' : 'NORMAL';

      const status_vibration: 'NORMAL' | 'WARNING' | 'CRITICAL' =
        vibration >= cfg.vib_critical ? 'CRITICAL' : vibration >= cfg.vib_warning ? 'WARNING' : 'NORMAL';

      const newPoint: SimulatedTelemetryPoint = {
        index: tick,
        time: timeStr,
        timestamp: now.toISOString(),
        temperature,
        current,
        rpm,
        vibration,
        source: 'SIMULATED / DYNAMIC_CONFIG',
        status_temp,
        status_current,
        status_rpm,
        status_vibration,
      };

      setInstantaneous({
        temperature,
        current,
        rpm,
        vibration,
        motor_powered: motorPowered,
        timestamp: now.toISOString(),
        status_temp,
        status_current,
        status_rpm,
        status_vibration,
      });

      // Keep historical points according to selected timeWindow
      // 1m = 60s / interval, 5m = 300s / interval, 10m = 600s / interval
      const windowSeconds = timeWindow === '1m' ? 60 : timeWindow === '5m' ? 300 : 600;
      const maxPoints = Math.max(30, Math.round((windowSeconds * 1000) / intervalMs));

      setHistoryBuffer((prev) => {
        const next = [...prev, newPoint];
        if (next.length > maxPoints) {
          return next.slice(next.length - maxPoints);
        }
        return next;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [savedConfig, isSimulationMode, timeWindow]);

  const value: SimulationContextType = {
    configs,
    activeMachineId,
    setActiveMachineId,
    activeConfig: draftConfig,
    isLoadingConfig,
    hasUnsavedChanges,
    lastSavedAt,
    updateDraftConfig,
    saveActiveConfig,
    resetActiveConfig,
    toggleMotorPower,
    setSimulationMode,
    instantaneous,
    historyBuffer,
    timeWindow,
    setTimeWindow,
    clearHistory,
    isSimulationMode,
    setIsSimulationMode,
  };

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
};

export const useSimulation = (): SimulationContextType => {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('useSimulation must be used within a SimulationProvider');
  }
  return context;
};

export default SimulationContext;
