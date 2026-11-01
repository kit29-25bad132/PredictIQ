import React, { useState } from 'react';
import { useAlarm, DEFAULT_THRESHOLDS } from '../context/AlarmContext';
import {
  X,
  Sliders,
  Flame,
  Activity,
  Volume2,
  Play,
  RotateCcw,
  Check,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';

interface AlarmSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const AlarmSettingsModal: React.FC<AlarmSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const {
    thresholds,
    audioSettings,
    updateThresholds,
    updateAudioSettings,
    resetThresholdsToDefaults,
    playTestBeep,
  } = useAlarm();

  // Local state for editing
  const [tempWarn, setTempWarn] = useState<number>(thresholds.tempWarning);
  const [tempCrit, setTempCrit] = useState<number>(thresholds.tempCritical);
  const [vibWarn, setVibWarn] = useState<number>(thresholds.vibWarning);
  const [vibCrit, setVibCrit] = useState<number>(thresholds.vibCritical);
  const [currWarn, setCurrWarn] = useState<number>(thresholds.currentWarning || 2.0);
  const [currCrit, setCurrCrit] = useState<number>(thresholds.currentCritical || 3.0);
  const [ratedRpm, setRatedRpm] = useState<number>(thresholds.ratedRpm || 1500);

  const [frequency, setFrequency] = useState<number>(audioSettings.frequency);
  const [intervalMs, setIntervalMs] = useState<number>(audioSettings.intervalMs);
  const [volume, setVolume] = useState<number>(audioSettings.volume);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(audioSettings.soundEnabled);
  const [alarmOnWarning, setAlarmOnWarning] = useState<boolean>(audioSettings.alarmOnWarning !== false);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Sync state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setTempWarn(thresholds.tempWarning);
      setTempCrit(thresholds.tempCritical);
      setVibWarn(thresholds.vibWarning);
      setVibCrit(thresholds.vibCritical);
      setCurrWarn(thresholds.currentWarning || 2.0);
      setCurrCrit(thresholds.currentCritical || 3.0);
      setRatedRpm(thresholds.ratedRpm || 1500);
      setFrequency(audioSettings.frequency);
      setIntervalMs(audioSettings.intervalMs);
      setVolume(audioSettings.volume);
      setSoundEnabled(audioSettings.soundEnabled);
      setAlarmOnWarning(audioSettings.alarmOnWarning !== false);
      setValidationErrors([]);
      setSaveSuccess(false);
    }
  }, [isOpen, thresholds, audioSettings]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErrors([]);

    const result = updateThresholds({
      tempWarning: Number(tempWarn),
      tempCritical: Number(tempCrit),
      vibWarning: Number(vibWarn),
      vibCritical: Number(vibCrit),
      currentWarning: Number(currWarn),
      currentCritical: Number(currCrit),
      ratedRpm: Number(ratedRpm),
    });

    if (!result.success) {
      setValidationErrors(result.errors || ['Invalid threshold parameters.']);
      return;
    }

    updateAudioSettings({
      frequency: Number(frequency),
      intervalMs: Number(intervalMs),
      volume: Number(volume),
      soundEnabled: Boolean(soundEnabled),
      alarmOnWarning: Boolean(alarmOnWarning),
    });

    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      if (onSaved) onSaved();
      onClose();
    }, 600);
  };

  const handleResetDefaults = () => {
    resetThresholdsToDefaults();
    setTempWarn(DEFAULT_THRESHOLDS.tempWarning);
    setTempCrit(DEFAULT_THRESHOLDS.tempCritical);
    setVibWarn(DEFAULT_THRESHOLDS.vibWarning);
    setVibCrit(DEFAULT_THRESHOLDS.vibCritical);
    setCurrWarn(DEFAULT_THRESHOLDS.currentWarning || 2.0);
    setCurrCrit(DEFAULT_THRESHOLDS.currentCritical || 3.0);
    setRatedRpm(DEFAULT_THRESHOLDS.ratedRpm || 1500);
    setFrequency(880);
    setIntervalMs(700);
    setVolume(0.75);
    setSoundEnabled(true);
    setAlarmOnWarning(true);
    setValidationErrors([]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="alarm-settings-modal-title"
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/95 shadow-2xl backdrop-blur-2xl">
        {/* Subtle accent glow */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-56 w-56 rounded-full bg-rose-500/10 blur-3xl" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <h2 id="alarm-settings-modal-title" className="text-lg font-bold text-white tracking-tight">
                Predict IQ Alarm &amp; Audio Configuration
              </h2>
              <p className="text-xs text-slate-400">
                Set hardware telemetry safety boundaries and customize audible alert tones
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close Modal"
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSave} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-300 space-y-1">
              <div className="flex items-center gap-2 font-bold text-rose-200">
                <AlertCircle className="h-4 w-4" />
                <span>Please correct threshold configuration errors:</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 pl-2 font-mono">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Section 1: Temperature Thresholds */}
          <div className="rounded-2xl border border-amber-500/20 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Flame className="h-4 w-4" />
                <span>Temperature Thresholds (Normal: 25–45°C)</span>
              </div>
              <span className="text-xs font-mono text-slate-400">Unit: °C</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Temp Warning */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Warning Threshold (45–60°C)
                </label>
                <div className="relative">
                  <input
                    id="input-temp-warning"
                    type="number"
                    step="0.5"
                    min="1"
                    max="150"
                    required
                    value={tempWarn}
                    onChange={(e) => setTempWarn(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-amber-500/30 bg-slate-900 px-3.5 py-2.5 font-mono text-sm font-bold text-amber-300 focus:border-amber-400 focus:outline-none"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
                    °C
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Triggers amber visual warning &amp; warning audio tone
                </span>
              </div>

              {/* Temp Critical */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Critical Threshold (&gt;60°C)
                </label>
                <div className="relative">
                  <input
                    id="input-temp-critical"
                    type="number"
                    step="0.5"
                    min="1"
                    max="150"
                    required
                    value={tempCrit}
                    onChange={(e) => setTempCrit(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-rose-500/40 bg-slate-900 px-3.5 py-2.5 font-mono text-sm font-bold text-rose-400 focus:border-rose-400 focus:outline-none"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
                    °C
                  </span>
                </div>
                <span className="text-[10px] text-rose-400/80 mt-1 block">
                  Triggers urgent repeating critical beep alarm
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Vibration Thresholds */}
          <div className="rounded-2xl border border-rose-500/20 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                <Activity className="h-4 w-4" />
                <span>Vibration Thresholds (Normal: 0–1.5 m/s²)</span>
              </div>
              <span className="text-xs font-mono text-slate-400">Unit: m/s²</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Vib Warning */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Warning Threshold (1.5–3.0 m/s²)
                </label>
                <div className="relative">
                  <input
                    id="input-vib-warning"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="50"
                    required
                    value={vibWarn}
                    onChange={(e) => setVibWarn(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-amber-500/30 bg-slate-900 px-3.5 py-2.5 font-mono text-sm font-bold text-amber-300 focus:border-amber-400 focus:outline-none"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
                    m/s²
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Warning threshold boundary (1.5–3.0 m/s²)
                </span>
              </div>

              {/* Vib Critical */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Critical Threshold (&gt;3.0 m/s²)
                </label>
                <div className="relative">
                  <input
                    id="input-vib-critical"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="50"
                    required
                    value={vibCrit}
                    onChange={(e) => setVibCrit(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-rose-500/40 bg-slate-900 px-3.5 py-2.5 font-mono text-sm font-bold text-rose-400 focus:border-rose-400 focus:outline-none"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
                    m/s²
                  </span>
                </div>
                <span className="text-[10px] text-rose-400/80 mt-1 block">
                  Critical damage threshold (repeating audio alarm)
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Current & Rated RPM Configuration */}
          <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                <Sliders className="h-4 w-4" />
                <span>Current &amp; Configurable Rated RPM</span>
              </div>
              <span className="text-xs font-mono text-slate-400">ACS712 &amp; Speed</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Current Warning */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Current Warning (2.0–3.0A)
                </label>
                <div className="relative">
                  <input
                    id="input-curr-warning"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="50"
                    required
                    value={currWarn}
                    onChange={(e) => setCurrWarn(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-amber-500/30 bg-slate-900 px-3 py-2.5 font-mono text-xs font-bold text-amber-300 focus:border-amber-400 focus:outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
                    A
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">Normal: 0.2–2.0 A</span>
              </div>

              {/* Current Critical */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Current Critical (&gt;3.0A)
                </label>
                <div className="relative">
                  <input
                    id="input-curr-critical"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="50"
                    required
                    value={currCrit}
                    onChange={(e) => setCurrCrit(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-xl border border-rose-500/40 bg-slate-900 px-3 py-2.5 font-mono text-xs font-bold text-rose-400 focus:border-rose-400 focus:outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
                    A
                  </span>
                </div>
                <span className="text-[10px] text-rose-400/80 mt-1 block">Overload: &gt;3.0 A</span>
              </div>

              {/* Configurable Rated RPM */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Configurable RATED_RPM
                </label>
                <div className="relative">
                  <input
                    id="input-rated-rpm"
                    type="number"
                    step="50"
                    min="100"
                    max="10000"
                    required
                    value={ratedRpm}
                    onChange={(e) => setRatedRpm(parseFloat(e.target.value) || 1500)}
                    className="w-full rounded-xl border border-purple-500/40 bg-slate-900 px-3 py-2.5 font-mono text-xs font-bold text-purple-300 focus:border-purple-400 focus:outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500 font-bold">
                    RPM
                  </span>
                </div>
                <span className="text-[10px] text-purple-400/80 mt-1 block">
                  70-100%: Normal | 50-70%: Warn | &lt;50%: Crit
                </span>
              </div>
            </div>
          </div>

          {/* Section 3: Web Audio Alarm Tone Settings */}
          <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/60 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                <Volume2 className="h-4 w-4" />
                <span>Audible Beep Synthesizer (Web Audio API)</span>
              </div>
              <button
                type="button"
                onClick={() => playTestBeep(frequency, 180)}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all"
              >
                <Play className="h-3 w-3" />
                <span>Preview Tone</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Frequency */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Beep Frequency (Hz)
                </label>
                <input
                  id="input-beep-freq"
                  type="number"
                  step="20"
                  min="300"
                  max="3500"
                  value={frequency}
                  onChange={(e) => setFrequency(parseInt(e.target.value) || 880)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs font-bold text-white focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Pitch tone (880Hz = standard alert)
                </span>
              </div>

              {/* Repeating Interval */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Interval (ms)
                </label>
                <input
                  id="input-beep-interval"
                  type="number"
                  step="50"
                  min="200"
                  max="3000"
                  value={intervalMs}
                  onChange={(e) => setIntervalMs(parseInt(e.target.value) || 700)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs font-bold text-white focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Pulse period (700ms = 1.4 bps)
                </span>
              </div>

              {/* Volume Slider */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Alarm Volume: {Math.round(volume * 100)}%
                </label>
                <input
                  id="input-beep-volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full h-2 rounded-lg bg-slate-800 accent-cyan-400 cursor-pointer mt-2"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Output gain intensity
                </span>
              </div>
            </div>

            {/* Warning Alarm Toggle Option */}
            <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <label htmlFor="toggle-alarm-on-warning" className="text-xs font-bold text-white flex items-center gap-2 cursor-pointer">
                  <input
                    id="toggle-alarm-on-warning"
                    type="checkbox"
                    checked={alarmOnWarning}
                    onChange={(e) => setAlarmOnWarning(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/20 cursor-pointer"
                  />
                  <span>Play Audible Alert on Warning Threshold (e.g. Temp &gt; 70°C)</span>
                </label>
                <p className="text-[11px] text-slate-400 mt-0.5 pl-6">
                  Sounds a distinct moderate warning pulse tone as soon as temperature or vibration rises above the warning threshold.
                </p>
              </div>

              <button
                type="button"
                onClick={() => playTestBeep(Math.round(frequency * 0.75), 220)}
                className="self-end sm:self-auto flex items-center gap-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 transition-colors"
              >
                <Play className="h-3 w-3" />
                <span>Test Warning Tone</span>
              </button>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset to Recommended Standards</span>
            </button>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 sm:flex-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                id="btn-save-alarm-settings"
                type="submit"
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-xl bg-cyan-500 px-5 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all shadow-md shadow-cyan-500/20"
              >
                {saveSuccess ? (
                  <>
                    <Check className="h-4 w-4 stroke-[3]" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Apply Alarm Settings</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AlarmSettingsModal;
