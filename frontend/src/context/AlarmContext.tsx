import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Machine,
  SensorReading,
  AlarmThresholds,
  AlarmAudioSettings,
  ActiveCriticalAlarm,
  ActiveWarningAlarm,
  AlarmIncidentRecord,
} from '../types';
import audioAlarmService, { AudioState } from '../services/audioAlarmService';
import api from '../services/api';

export const DEFAULT_THRESHOLDS: AlarmThresholds = {
  tempWarning: 45.0,    // °C (Normal: 25–45°C, Warning: 45–60°C)
  tempCritical: 60.0,   // °C (Critical: >60°C)
  vibWarning: 1.5,      // m/s² (Normal: 0–1.5 m/s², Warning: 1.5–3.0 m/s²)
  vibCritical: 3.0,     // m/s² (Critical: >3.0 m/s²)
  currentWarning: 2.0,  // A (Normal: 0.2–2.0 A, Warning: 2.0–3.0 A)
  currentCritical: 3.0, // A (Critical: >3.0 A)
  ratedRpm: 1500,       // Configurable RATED_RPM (default: 1500)
};

export interface AlarmContextType {
  thresholds: AlarmThresholds;
  audioSettings: AlarmAudioSettings;
  updateThresholds: (newThresholds: Partial<AlarmThresholds>) => { success: boolean; errors?: string[] };
  updateAudioSettings: (newSettings: Partial<AlarmAudioSettings>) => void;
  resetThresholdsToDefaults: () => void;
  activeCriticalAlarms: ActiveCriticalAlarm[];
  activeWarnings: ActiveWarningAlarm[];
  isAlarmActive: boolean;
  isAudioPlaying: boolean;
  isAudioMuted: boolean;
  audioState: AudioState;
  muteAlarm: () => void;
  unmuteAlarm: () => void;
  enableAudio: () => Promise<boolean>;
  playTestBeep: (freq?: number, durationMs?: number) => void;
  alarmIncidents: AlarmIncidentRecord[];
  acknowledgeIncident: (id: string) => Promise<void>;
  resolveIncident: (id: string) => Promise<void>;
  evaluateFleetTelemetry: (machines: Machine[]) => void;
  clearAllAlarms: () => void;
}

const AlarmContext = createContext<AlarmContextType | undefined>(undefined);

const THRESHOLDS_STORAGE_KEY = 'predictiq_alarm_thresholds';
const AUDIO_SETTINGS_STORAGE_KEY = 'predictiq_alarm_audio_settings';
const INCIDENTS_STORAGE_KEY = 'predictiq_alarm_incidents_v1';

export const AlarmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Thresholds state
  const [thresholds, setThresholds] = useState<AlarmThresholds>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(THRESHOLDS_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return { ...DEFAULT_THRESHOLDS, ...parsed };
        } catch {
          // Ignore parse errors
        }
      }
    }
    return { ...DEFAULT_THRESHOLDS };
  });

  // 2. Audio Settings state
  const [audioSettings, setAudioSettings] = useState<AlarmAudioSettings>(() => {
    const config = audioAlarmService.getConfig();
    return {
      frequency: config.frequency,
      pulseDurationMs: config.pulseDurationMs,
      intervalMs: config.intervalMs,
      volume: config.volume,
      soundEnabled: config.soundEnabled,
    };
  });

  // 3. Alarm State
  const [activeCriticalAlarms, setActiveCriticalAlarms] = useState<ActiveCriticalAlarm[]>([]);
  const [activeWarnings, setActiveWarnings] = useState<ActiveWarningAlarm[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState<boolean>(false);
  const [audioState, setAudioState] = useState<AudioState>(audioAlarmService.getAudioState());
  const [alarmIncidents, setAlarmIncidents] = useState<AlarmIncidentRecord[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(INCIDENTS_STORAGE_KEY);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    return [];
  });

  // Ref to track active alarms across asynchronous evaluations
  const activeCriticalAlarmsRef = useRef<ActiveCriticalAlarm[]>([]);
  activeCriticalAlarmsRef.current = activeCriticalAlarms;

  const activeWarningsRef = useRef<ActiveWarningAlarm[]>([]);
  activeWarningsRef.current = activeWarnings;

  const isAudioMutedRef = useRef<boolean>(false);
  isAudioMutedRef.current = isAudioMuted;

  // Subscribe to audio service state
  useEffect(() => {
    const unsubscribe = audioAlarmService.subscribe((state, isPlaying, muted) => {
      setAudioState(state);
      setIsAudioPlaying(isPlaying && !muted);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Save incidents to localStorage on change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(INCIDENTS_STORAGE_KEY, JSON.stringify(alarmIncidents.slice(0, 50)));
    }
  }, [alarmIncidents]);

  // Validation & Threshold update
  const updateThresholds = useCallback((newThresholds: Partial<AlarmThresholds>) => {
    const merged = { ...thresholds, ...newThresholds };
    const errors: string[] = [];

    if (isNaN(merged.tempWarning) || merged.tempWarning <= 0) {
      errors.push('Temperature warning threshold must be a positive number.');
    }
    if (isNaN(merged.tempCritical) || merged.tempCritical <= 0) {
      errors.push('Temperature critical threshold must be a positive number.');
    }
    if (merged.tempWarning >= merged.tempCritical) {
      errors.push(`Temperature warning threshold (${merged.tempWarning}°C) must be lower than critical threshold (${merged.tempCritical}°C).`);
    }

    if (isNaN(merged.vibWarning) || merged.vibWarning <= 0) {
      errors.push('Vibration warning threshold must be a positive number.');
    }
    if (isNaN(merged.vibCritical) || merged.vibCritical <= 0) {
      errors.push('Vibration critical threshold must be a positive number.');
    }
    if (merged.vibWarning >= merged.vibCritical) {
      errors.push(`Vibration warning threshold (${merged.vibWarning} m/s²) must be lower than critical threshold (${merged.vibCritical} m/s²).`);
    }

    if (merged.currentWarning && merged.currentCritical && merged.currentWarning >= merged.currentCritical) {
      errors.push(`Current warning threshold (${merged.currentWarning} A) must be lower than critical threshold (${merged.currentCritical} A).`);
    }

    if (merged.ratedRpm && (isNaN(merged.ratedRpm) || merged.ratedRpm <= 0)) {
      errors.push('Rated RPM must be a positive number.');
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    setThresholds(merged);
    if (typeof window !== 'undefined') {
      localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(merged));
    }
    return { success: true };
  }, [thresholds]);

  const resetThresholdsToDefaults = useCallback(() => {
    setThresholds({ ...DEFAULT_THRESHOLDS });
    if (typeof window !== 'undefined') {
      localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(DEFAULT_THRESHOLDS));
    }
  }, []);

  const updateAudioSettings = useCallback((newSettings: Partial<AlarmAudioSettings>) => {
    const merged = { ...audioSettings, ...newSettings };
    setAudioSettings(merged);
    audioAlarmService.updateConfig(merged);
    if (typeof window !== 'undefined') {
      localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(merged));
    }
  }, [audioSettings]);

  // Mute / Unmute handlers
  const muteAlarm = useCallback(() => {
    setIsAudioMuted(true);
    isAudioMutedRef.current = true;
    audioAlarmService.muteAlarm();

    // Mark current active incidents as muted in history
    setAlarmIncidents(prev =>
      prev.map(inc => (inc.status === 'ACTIVE' ? { ...inc, isAudioMuted: true } : inc))
    );
  }, []);

  const unmuteAlarm = useCallback(() => {
    setIsAudioMuted(false);
    isAudioMutedRef.current = false;
    audioAlarmService.unmuteAlarm();
  }, []);

  const enableAudio = useCallback(async () => {
    const success = await audioAlarmService.enableAudio();
    if (success && !isAudioMutedRef.current) {
      if (activeCriticalAlarmsRef.current.length > 0) {
        audioAlarmService.startAlarm('critical');
      } else if (activeWarningsRef.current.length > 0 && audioSettings.alarmOnWarning !== false) {
        audioAlarmService.startAlarm('warning');
      }
    }
    return success;
  }, [audioSettings.alarmOnWarning]);

  const playTestBeep = useCallback((freq?: number, durationMs?: number) => {
    audioAlarmService.playTestBeep(freq, durationMs);
  }, []);

  const acknowledgeIncident = useCallback(async (id: string) => {
    setAlarmIncidents(prev =>
      prev.map(inc => (inc.id === id ? { ...inc, status: 'ACKNOWLEDGED' } : inc))
    );
    // If backend integer ID, attempt acknowledging via API
    const numId = Number(id);
    if (!isNaN(numId) && numId > 0) {
      try {
        await api.acknowledgeAlert(numId);
      } catch (e) {
        // Continue with local acknowledgement
      }
    }
  }, []);

  const resolveIncident = useCallback(async (id: string) => {
    setAlarmIncidents(prev =>
      prev.map(inc => (inc.id === id ? { ...inc, status: 'RESOLVED', resolvedAt: new Date().toISOString() } : inc))
    );
    const numId = Number(id);
    if (!isNaN(numId) && numId > 0) {
      try {
        await api.resolveAlert(numId);
      } catch (e) {
        // Continue with local resolution
      }
    }
  }, []);

  const clearAllAlarms = useCallback(() => {
    audioAlarmService.stopAlarm();
    setActiveCriticalAlarms([]);
    setActiveWarnings([]);
    setIsAudioMuted(false);
    isAudioMutedRef.current = false;
  }, []);

  /**
   * Primary Telemetry Evaluation Engine
   * Inspects all incoming verified telemetry against configured thresholds.
   */
  const evaluateFleetTelemetry = useCallback((machines: Machine[]) => {
    if (!machines || machines.length === 0) {
      if (activeCriticalAlarmsRef.current.length > 0 || activeWarningsRef.current.length > 0) {
        audioAlarmService.stopAlarm();
        setActiveCriticalAlarms([]);
        setActiveWarnings([]);
      }
      return;
    }

    const currentCritical: ActiveCriticalAlarm[] = [];
    const currentWarnings: ActiveWarningAlarm[] = [];

    const ratedRpm = thresholds.ratedRpm || 1500;
    const currWarn = thresholds.currentWarning || 2.0;
    const currCrit = thresholds.currentCritical || 3.0;

    machines.forEach((machine) => {
      const reading = machine.latest_reading;
      if (!reading) return;

      // Skip invalid, stale or null values
      const temp = typeof reading.temperature === 'number' && isFinite(reading.temperature) ? reading.temperature : null;
      const vib = typeof reading.vibration === 'number' && isFinite(reading.vibration) ? reading.vibration : null;
      const curr = typeof reading.current === 'number' && isFinite(reading.current) ? reading.current : null;
      const rpm = typeof reading.rpm === 'number' && isFinite(reading.rpm) ? reading.rpm : null;
      const timestamp = reading.timestamp || new Date().toISOString();

      // 1. Evaluate Temperature (NORMAL: 25-45°C, WARNING: 45-60°C, CRITICAL: >60°C)
      if (temp !== null) {
        if (temp >= thresholds.tempCritical) {
          currentCritical.push({
            id: `${machine.machine_id}-temp-crit-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'temperature',
            channelLabel: 'Temperature',
            currentValue: temp,
            threshold: thresholds.tempCritical,
            unit: '°C',
            timestamp,
            severity: 'CRITICAL',
            source: reading.source,
          });
        } else if (temp >= thresholds.tempWarning) {
          currentWarnings.push({
            id: `${machine.machine_id}-temp-warn-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'temperature',
            channelLabel: 'Temperature',
            currentValue: temp,
            threshold: thresholds.tempWarning,
            unit: '°C',
            timestamp,
            severity: 'WARNING',
            source: reading.source,
          });
        }
      }

      // 2. Evaluate Vibration (NORMAL: 0-1.5 m/s², WARNING: 1.5-3.0 m/s², CRITICAL: >3.0 m/s²)
      if (vib !== null) {
        if (vib >= thresholds.vibCritical) {
          currentCritical.push({
            id: `${machine.machine_id}-vib-crit-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'vibration',
            channelLabel: 'Vibration',
            currentValue: vib,
            threshold: thresholds.vibCritical,
            unit: 'm/s²',
            timestamp,
            severity: 'CRITICAL',
            source: reading.source,
          });
        } else if (vib >= thresholds.vibWarning) {
          currentWarnings.push({
            id: `${machine.machine_id}-vib-warn-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'vibration',
            channelLabel: 'Vibration',
            currentValue: vib,
            threshold: thresholds.vibWarning,
            unit: 'm/s²',
            timestamp,
            severity: 'WARNING',
            source: reading.source,
          });
        }
      }

      // 3. Evaluate Current (NORMAL: 0.2-2.0A, WARNING: 2.0-3.0A, CRITICAL: >3.0A)
      if (curr !== null) {
        if (curr >= currCrit) {
          currentCritical.push({
            id: `${machine.machine_id}-curr-crit-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'current',
            channelLabel: 'Current',
            currentValue: curr,
            threshold: currCrit,
            unit: 'A',
            timestamp,
            severity: 'CRITICAL',
            source: reading.source,
          });
        } else if (curr >= currWarn) {
          currentWarnings.push({
            id: `${machine.machine_id}-curr-warn-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'current',
            channelLabel: 'Current',
            currentValue: curr,
            threshold: currWarn,
            unit: 'A',
            timestamp,
            severity: 'WARNING',
            source: reading.source,
          });
        }
      }

      // 4. Evaluate RPM (NORMAL: 70-100% rated, WARNING: 50-70% rated, CRITICAL: <50% rated)
      if (rpm !== null && ratedRpm > 0) {
        const rpmPercent = (rpm / ratedRpm) * 100;
        if (rpmPercent < 50) {
          currentCritical.push({
            id: `${machine.machine_id}-rpm-crit-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'rpm',
            channelLabel: 'RPM',
            currentValue: rpm,
            threshold: Math.round(ratedRpm * 0.5),
            unit: 'RPM',
            timestamp,
            severity: 'CRITICAL',
            source: reading.source,
          });
        } else if (rpmPercent < 70) {
          currentWarnings.push({
            id: `${machine.machine_id}-rpm-warn-${timestamp}`,
            machineId: machine.machine_id,
            machineName: machine.name,
            channel: 'rpm',
            channelLabel: 'RPM',
            currentValue: rpm,
            threshold: Math.round(ratedRpm * 0.7),
            unit: 'RPM',
            timestamp,
            severity: 'WARNING',
            source: reading.source,
          });
        }
      }
    });

    const hadPreviousCritical = activeCriticalAlarmsRef.current.length > 0;
    const hasCurrentCritical = currentCritical.length > 0;
    const hadPreviousWarning = activeWarningsRef.current.length > 0;
    const hasCurrentWarning = currentWarnings.length > 0;
    const alarmOnWarning = audioSettings.alarmOnWarning !== false;

    setActiveCriticalAlarms(currentCritical);
    setActiveWarnings(currentWarnings);

    // =========================================================================
    // STATE MACHINE TRANSITIONS
    // =========================================================================
    if (hasCurrentCritical) {
      if (!hadPreviousCritical) {
        // 1. TRANSITION: Normal/Warning -> CRITICAL (NEW CRITICAL INCIDENT)
        setIsAudioMuted(false);
        isAudioMutedRef.current = false;
        audioAlarmService.startAlarm('critical');

        // Log new incident records
        const newIncidents: AlarmIncidentRecord[] = currentCritical.map((alarm) => ({
          id: `INC-${Date.now()}-${alarm.machineId}-${alarm.channel}`,
          machineId: alarm.machineId,
          machineName: alarm.machineName || alarm.machineId,
          deviceId: `NODE-${alarm.machineId}`,
          source: alarm.source || 'REAL_HARDWARE',
          alarmType: `${alarm.channelLabel} Critical Breach`,
          sensorReading: alarm.currentValue,
          configuredThreshold: alarm.threshold,
          unit: alarm.unit,
          severity: 'Critical',
          timestamp: alarm.timestamp,
          status: 'ACTIVE',
          isAudioMuted: false,
        }));

        setAlarmIncidents(prev => [...newIncidents, ...prev.slice(0, 45)]);
      } else {
        // Continuing Critical incident
        if (!isAudioMutedRef.current && !audioAlarmService.isPlaying()) {
          audioAlarmService.startAlarm('critical');
        }
      }
    } else if (hasCurrentWarning && alarmOnWarning) {
      if (!hadPreviousWarning && !hadPreviousCritical) {
        // Transition to Warning with audio enabled
        setIsAudioMuted(false);
        isAudioMutedRef.current = false;
        audioAlarmService.startAlarm('warning');
      } else if (hadPreviousCritical) {
        // De-escalated from Critical to Warning
        audioAlarmService.startAlarm('warning');
        // Mark critical incidents as resolved
        setAlarmIncidents(prev =>
          prev.map(inc =>
            inc.status === 'ACTIVE' && inc.severity === 'Critical'
              ? { ...inc, status: 'RESOLVED', resolvedAt: new Date().toISOString() }
              : inc
          )
        );
      } else {
        // Continuing Warning
        if (!isAudioMutedRef.current && !audioAlarmService.isPlaying()) {
          audioAlarmService.startAlarm('warning');
        }
      }
    } else {
      // 3. TRANSITION: Normal / Cleared
      if (hadPreviousCritical || hadPreviousWarning) {
        audioAlarmService.stopAlarm();
        setIsAudioMuted(false);
        isAudioMutedRef.current = false;

        // Automatically mark previous active incidents as RESOLVED
        setAlarmIncidents(prev =>
          prev.map(inc =>
            inc.status === 'ACTIVE'
              ? { ...inc, status: 'RESOLVED', resolvedAt: new Date().toISOString() }
              : inc
          )
        );
      }
    }
  }, [thresholds, audioSettings.alarmOnWarning]);

  // Load backend alerts into incidents history
  useEffect(() => {
    const syncBackendAlerts = async () => {
      try {
        const backendAlerts = await api.getAlerts();
        if (backendAlerts && backendAlerts.length > 0) {
          setAlarmIncidents(prev => {
            const existingIds = new Set(prev.map(p => String(p.id)));
            const transformed: AlarmIncidentRecord[] = backendAlerts
              .filter(a => !existingIds.has(String(a.id)))
              .map(a => ({
                id: String(a.id),
                machineId: a.machine_id,
                machineName: `Asset ${a.machine_id}`,
                deviceId: `NODE-${a.machine_id}`,
                source: 'REAL_HARDWARE',
                alarmType: a.alert_type.replace(/_/g, ' '),
                sensorReading: 0,
                configuredThreshold: a.severity === 'Critical' ? thresholds.tempCritical : thresholds.tempWarning,
                unit: a.alert_type.includes('TEMPERATURE') ? '°C' : 'mm/s',
                severity: a.severity === 'Critical' ? 'Critical' : 'Warning',
                timestamp: a.created_at,
                status: a.status as any,
                isAudioMuted: false,
                resolvedAt: a.resolved_at,
              }));
            return [...prev, ...transformed].slice(0, 50);
          });
        }
      } catch (e) {
        // Non-fatal if backend alerts cannot be fetched immediately
      }
    };
    syncBackendAlerts();
  }, [thresholds]);

  const value: AlarmContextType = {
    thresholds,
    audioSettings,
    updateThresholds,
    updateAudioSettings,
    resetThresholdsToDefaults,
    activeCriticalAlarms,
    activeWarnings,
    isAlarmActive: activeCriticalAlarms.length > 0,
    isAudioPlaying,
    isAudioMuted,
    audioState,
    muteAlarm,
    unmuteAlarm,
    enableAudio,
    playTestBeep,
    alarmIncidents,
    acknowledgeIncident,
    resolveIncident,
    evaluateFleetTelemetry,
    clearAllAlarms,
  };

  return <AlarmContext.Provider value={value}>{children}</AlarmContext.Provider>;
};

export const useAlarm = (): AlarmContextType => {
  const context = useContext(AlarmContext);
  if (!context) {
    throw new Error('useAlarm must be used within an AlarmProvider');
  }
  return context;
};

export default AlarmContext;
