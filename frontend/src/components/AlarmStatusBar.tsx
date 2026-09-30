import React from 'react';
import { useAlarm } from '../context/AlarmContext';
import {
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Play,
  Flame,
  Activity,
  ShieldCheck,
  Radio,
} from 'lucide-react';

interface AlarmStatusBarProps {
  onOpenSettings: () => void;
}

export const AlarmStatusBar: React.FC<AlarmStatusBarProps> = ({ onOpenSettings }) => {
  const {
    thresholds,
    activeCriticalAlarms,
    activeWarnings,
    isAlarmActive,
    isAudioPlaying,
    isAudioMuted,
    audioState,
    muteAlarm,
    unmuteAlarm,
    enableAudio,
    playTestBeep,
  } = useAlarm();

  const isAudioBlocked = audioState === 'suspended';
  const hasWarningsOnly = !isAlarmActive && activeWarnings.length > 0;

  return (
    <div
      id="predictiq-alarm-status-bar"
      role="region"
      aria-label="Alarm Status and Controls"
      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 shadow-xl backdrop-blur-md ${
        isAlarmActive
          ? isAudioMuted
            ? 'border-amber-500/60 bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/40 shadow-amber-500/10'
            : 'border-rose-500/80 bg-gradient-to-r from-rose-950/80 via-slate-900 to-rose-950/60 shadow-rose-500/20 animate-pulse-border'
          : hasWarningsOnly
          ? 'border-amber-500/40 bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-900 shadow-amber-500/5'
          : 'border-emerald-500/30 bg-gradient-to-r from-emerald-950/20 via-slate-900/90 to-slate-900'
      }`}
    >
      <div className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Left: Main Status & Badge */}
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform ${
                isAlarmActive
                  ? isAudioMuted
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/50 scale-105 animate-bounce-subtle'
                  : hasWarningsOnly
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {isAlarmActive ? (
                isAudioMuted ? (
                  <BellOff className="h-6 w-6" />
                ) : (
                  <AlertOctagon className="h-6 w-6 text-rose-400 animate-pulse" />
                )
              ) : hasWarningsOnly ? (
                <AlertTriangle className="h-6 w-6 text-amber-400" />
              ) : (
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  id="alarm-global-status-badge"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black tracking-wide uppercase font-mono ${
                    isAlarmActive
                      ? isAudioMuted
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                        : 'bg-rose-600 text-white shadow-lg shadow-rose-600/30 animate-pulse'
                      : hasWarningsOnly
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isAlarmActive
                        ? isAudioMuted
                          ? 'bg-slate-950'
                          : 'bg-white animate-ping'
                        : hasWarningsOnly
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                  />
                  {isAlarmActive
                    ? isAudioMuted
                      ? 'CRITICAL ALARM (AUDIO MUTED)'
                      : 'CRITICAL ALARM ACTIVE'
                    : hasWarningsOnly
                    ? 'WARNING THRESHOLD EXCEEDED'
                    : 'NORMAL — ALL SENSORS NOMINAL'}
                </span>

                {/* Audio Status Pill */}
                <span
                  id="audio-status-pill"
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono font-bold ${
                    isAudioPlaying
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                      : isAudioMuted
                      ? 'bg-slate-800 text-amber-300 border border-amber-500/30'
                      : isAudioBlocked
                      ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                  }`}
                >
                  {isAudioPlaying ? (
                    <>
                      <Volume2 className="h-3 w-3 text-rose-400" />
                      <span>BEEP ALARM AUDIBLE</span>
                    </>
                  ) : isAudioMuted ? (
                    <>
                      <VolumeX className="h-3 w-3 text-amber-400" />
                      <span>MUTED (VISUAL ACTIVE)</span>
                    </>
                  ) : isAudioBlocked ? (
                    <>
                      <VolumeX className="h-3 w-3 text-yellow-400" />
                      <span>AUDIO BLOCKED (ENABLE)</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3 w-3 text-emerald-400" />
                      <span>AUDIO READY</span>
                    </>
                  )}
                </span>
              </div>

              {/* Status Explanation */}
              <div className="mt-1 text-xs text-slate-300">
                {isAlarmActive ? (
                  <span>
                    Hardware telemetry exceeds critical limits!{' '}
                    <strong className="text-white">
                      {activeCriticalAlarms.length} critical breach{activeCriticalAlarms.length > 1 ? 'es' : ''} detected.
                    </strong>
                  </span>
                ) : hasWarningsOnly ? (
                  <span>
                    Telemetry trending high ({activeWarnings.length} warning{activeWarnings.length > 1 ? 's' : ''}). Equipment inspection recommended.
                  </span>
                ) : (
                  <span className="text-slate-400">
                    Continuous real-time temperature &amp; vibration audio surveillance running.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Controls (Mute, Enable Audio, Settings, Test Sound) */}
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
            {/* 1. Browser Autoplay Unlock Button */}
            {isAudioBlocked && (
              <button
                id="btn-enable-alarm-audio"
                onClick={enableAudio}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3.5 py-2 text-xs font-black text-slate-950 hover:from-amber-400 hover:to-yellow-400 transition-all shadow-md shadow-amber-500/20 animate-pulse"
              >
                <Volume2 className="h-4 w-4" />
                <span>Enable Alarm Audio</span>
              </button>
            )}

            {/* 2. Primary MUTE / STOP ALARM Button */}
            {isAlarmActive && (
              <>
                {isAudioMuted ? (
                  <button
                    id="btn-unmute-alarm"
                    onClick={unmuteAlarm}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/30 transition-all"
                  >
                    <Volume2 className="h-4 w-4" />
                    <span>Unmute Sound</span>
                  </button>
                ) : (
                  <button
                    id="btn-mute-stop-alarm"
                    onClick={muteAlarm}
                    className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-black text-white hover:bg-rose-500 transition-all shadow-lg shadow-rose-600/30 focus:ring-2 focus:ring-rose-400 focus:outline-none"
                    aria-label="Mute Audible Alarm"
                  >
                    <VolumeX className="h-4 w-4 stroke-[2.5]" />
                    <span>MUTE / STOP ALARM</span>
                  </button>
                )}
              </>
            )}

            {/* 3. Test Beep Sound */}
            <button
              id="btn-test-beep"
              onClick={() => playTestBeep()}
              title="Test beep sound output without triggering faults"
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:bg-slate-700 hover:text-white transition-all shadow-sm"
            >
              <Play className="h-3.5 w-3.5 text-cyan-400 fill-cyan-400/20" />
              <span className="hidden sm:inline">Test Sound</span>
            </button>

            {/* 4. Configure Alarm Thresholds Button */}
            <button
              id="btn-open-alarm-settings"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-bold text-cyan-300 hover:border-cyan-500/40 hover:bg-slate-700 transition-all shadow-sm"
            >
              <Sliders className="h-3.5 w-3.5 text-cyan-400" />
              <span>Alarm Settings</span>
            </button>
          </div>
        </div>

        {/* Active Critical Breaches List Breakdown */}
        {isAlarmActive && (
          <div className="mt-4 border-t border-rose-500/30 pt-3">
            <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-rose-300 mb-2 flex items-center gap-1.5">
              <AlertOctagon className="h-3.5 w-3.5" />
              <span>Active Threshold Breaches Requiring Attention:</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {activeCriticalAlarms.map((alarm) => (
                <div
                  key={alarm.id}
                  className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-slate-950/80 p-2.5 text-xs font-mono shadow-inner"
                >
                  <div className="flex items-center gap-2">
                    {alarm.channel === 'temperature' ? (
                      <Flame className="h-4 w-4 text-amber-400" />
                    ) : (
                      <Activity className="h-4 w-4 text-rose-400" />
                    )}
                    <div>
                      <span className="font-bold text-white">{alarm.machineId}</span> &middot;{' '}
                      <span className="text-rose-300">{alarm.channelLabel}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-extrabold text-rose-400">
                      {alarm.currentValue.toFixed(alarm.channel === 'temperature' ? 1 : 2)} {alarm.unit}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      Limit: &ge; {alarm.threshold} {alarm.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warning Breaches (When not critical) */}
        {!isAlarmActive && activeWarnings.length > 0 && (
          <div className="mt-3 border-t border-amber-500/30 pt-2.5">
            <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-amber-300 mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Active Warnings (Below Critical):</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {activeWarnings.map((warn) => (
                <div
                  key={warn.id}
                  className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-slate-950/60 p-2 text-xs font-mono"
                >
                  <span className="font-semibold text-slate-300">
                    {warn.machineId} &middot; {warn.channelLabel}
                  </span>
                  <span className="font-bold text-amber-400">
                    {warn.currentValue.toFixed(warn.channel === 'temperature' ? 1 : 2)} {warn.unit} (Warn: &ge; {warn.threshold})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AlarmStatusBar;
