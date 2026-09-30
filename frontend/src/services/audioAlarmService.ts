/**
 * Predict IQ - Web Audio API Industrial Alarm Service
 * Generates an authentic, continuous, low-latency repeating beep alarm
 * for critical hardware telemetry threshold breaches.
 *
 * Fully compliant with browser autoplay policies:
 * - Graceful user-interaction unlock
 * - Zero memory leaks or duplicate AudioContext / Oscillator instances
 * - Precision timing and clean gain ramping to avoid audio pops/clicks
 */

export interface AudioAlarmConfig {
  frequency: number;       // Hz (e.g., 880Hz or 960Hz)
  pulseDurationMs: number; // Duration of active beep (e.g., 180ms)
  intervalMs: number;      // Repeating interval period (e.g., 700ms)
  volume: number;          // 0.0 to 1.0 (e.g., 0.8)
  soundEnabled: boolean;   // Global sound enable toggle
}

export const DEFAULT_AUDIO_CONFIG: AudioAlarmConfig = {
  frequency: 880,          // A5 tone - clear, standard industrial alert
  pulseDurationMs: 180,
  intervalMs: 700,
  volume: 0.75,
  soundEnabled: true,
};

export type AudioState = 'unsupported' | 'suspended' | 'running' | 'muted';

class AudioAlarmService {
  private audioCtx: AudioContext | null = null;
  private isAlarmPlaying: boolean = false;
  private isMuted: boolean = false;
  private intervalTimerId: number | null = null;
  private config: AudioAlarmConfig = { ...DEFAULT_AUDIO_CONFIG };
  private stateListeners: Set<(state: AudioState, isPlaying: boolean, isMuted: boolean) => void> = new Set();

  constructor() {
    // Attempt lazy initialization
    if (typeof window !== 'undefined') {
      const savedConfig = localStorage.getItem('predictiq_audio_config');
      if (savedConfig) {
        try {
          const parsed = JSON.parse(savedConfig);
          this.config = { ...DEFAULT_AUDIO_CONFIG, ...parsed };
        } catch (e) {
          console.warn('[AudioAlarmService] Failed to parse saved audio config:', e);
        }
      }
    }
  }

  /**
   * Initializes or returns the existing AudioContext.
   */
  private getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('[AudioAlarmService] Web Audio API is not supported in this browser.');
      return null;
    }

    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      try {
        this.audioCtx = new AudioContextClass();
        this.audioCtx.onstatechange = () => {
          this.notifyListeners();
        };
      } catch (err) {
        console.warn('[AudioAlarmService] AudioContext creation failed:', err);
      }
    }

    return this.audioCtx;
  }

  /**
   * Subscribes a listener to audio state changes.
   */
  public subscribe(listener: (state: AudioState, isPlaying: boolean, isMuted: boolean) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getAudioState(), this.isAlarmPlaying, this.isMuted);
    return () => this.stateListeners.delete(listener);
  }

  private notifyListeners() {
    const state = this.getAudioState();
    this.stateListeners.forEach(listener => {
      try {
        listener(state, this.isAlarmPlaying, this.isMuted);
      } catch (err) {
        console.error('[AudioAlarmService] Listener notification error:', err);
      }
    });
  }

  /**
   * Returns current audio state.
   */
  public getAudioState(): AudioState {
    if (!this.audioCtx) {
      if (typeof window === 'undefined' || !(window.AudioContext || (window as any).webkitAudioContext)) {
        return 'unsupported';
      }
      return 'suspended';
    }
    if (this.isMuted) return 'muted';
    return this.audioCtx.state === 'running' ? 'running' : 'suspended';
  }

  public isPlaying(): boolean {
    return this.isAlarmPlaying;
  }

  public isMutedState(): boolean {
    return this.isMuted;
  }

  public getConfig(): AudioAlarmConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<AudioAlarmConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (typeof window !== 'undefined') {
      localStorage.setItem('predictiq_audio_config', JSON.stringify(this.config));
    }
    // If interval or frequency changed while playing, restart loop with new params
    if (this.isAlarmPlaying && !this.isMuted) {
      this.stopAlarmLoopOnly();
      this.startAlarmLoop();
    }
    this.notifyListeners();
  }

  /**
   * Explicit user action to unlock AudioContext and enable alarm audio.
   */
  public async enableAudio(): Promise<boolean> {
    const ctx = this.getOrCreateAudioContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('[AudioAlarmService] Failed to resume AudioContext:', err);
        return false;
      }
    }

    this.notifyListeners();
    return ctx.state === 'running';
  }

  /**
   * Plays a single synthetic beep pulse without continuous repeating.
   * Useful for user audio output testing.
   */
  public playTestBeep(freq = this.config.frequency, durationMs = this.config.pulseDurationMs): void {
    const ctx = this.getOrCreateAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    this.emitSingleBeepPulse(ctx, freq, durationMs, this.config.volume);
  }

  /**
   * Synthesizes one clean beep tone with anti-pop envelope shaping.
   */
  private emitSingleBeepPulse(ctx: AudioContext, frequency: number, durationMs: number, volume: number): void {
    try {
      const now = ctx.currentTime;
      const durationSec = durationMs / 1000;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Dual harmonic alert tone for maximum clarity and industrial urgency
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency, now);

      // Envelope: Instant attack with slight fade to prevent DC offset clicks
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, Math.min(1.0, volume)), now + 0.02);
      gain.gain.setValueAtTime(Math.max(0.001, Math.min(1.0, volume)), now + durationSec - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + durationSec + 0.02);

      // Auto-cleanup nodes after playback
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // Ignore disconnection cleanup errors
        }
      };
    } catch (err) {
      console.warn('[AudioAlarmService] Error emitting beep pulse:', err);
    }
  }

  /**
   * Starts the continuous repeating beep alarm loop.
   * Idempotent: Does not create duplicate loops if already active.
   */
  public startAlarm(): void {
    if (!this.config.soundEnabled) {
      return;
    }

    this.isAlarmPlaying = true;
    this.isMuted = false;

    const ctx = this.getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {
        // Autoplay policy may block until user interaction
      });
    }

    this.startAlarmLoop();
    this.notifyListeners();
  }

  private startAlarmLoop(): void {
    if (this.intervalTimerId !== null) {
      clearInterval(this.intervalTimerId);
      this.intervalTimerId = null;
    }

    // Play immediate first pulse
    const ctx = this.getOrCreateAudioContext();
    if (ctx && ctx.state === 'running' && !this.isMuted) {
      this.emitSingleBeepPulse(ctx, this.config.frequency, this.config.pulseDurationMs, this.config.volume);
    }

    // Schedule continuous repeating pulses
    this.intervalTimerId = window.setInterval(() => {
      if (!this.isAlarmPlaying || this.isMuted) {
        this.stopAlarmLoopOnly();
        return;
      }
      const activeCtx = this.getOrCreateAudioContext();
      if (activeCtx && activeCtx.state === 'running') {
        this.emitSingleBeepPulse(activeCtx, this.config.frequency, this.config.pulseDurationMs, this.config.volume);
      }
    }, Math.max(200, this.config.intervalMs));
  }

  private stopAlarmLoopOnly(): void {
    if (this.intervalTimerId !== null) {
      clearInterval(this.intervalTimerId);
      this.intervalTimerId = null;
    }
  }

  /**
   * Mutes the current alarm sound immediately while keeping the alarm playing state.
   */
  public muteAlarm(): void {
    this.isMuted = true;
    this.stopAlarmLoopOnly();
    this.notifyListeners();
  }

  /**
   * Unmutes the alarm and resumes audible sound if an alarm condition is active.
   */
  public unmuteAlarm(): void {
    this.isMuted = false;
    if (this.isAlarmPlaying) {
      this.startAlarmLoop();
    }
    this.notifyListeners();
  }

  /**
   * Fully stops the alarm (both state and sound).
   */
  public stopAlarm(): void {
    this.isAlarmPlaying = false;
    this.isMuted = false;
    this.stopAlarmLoopOnly();
    this.notifyListeners();
  }

  /**
   * Releases all audio resources and closes the AudioContext.
   */
  public dispose(): void {
    this.stopAlarm();
    this.stateListeners.clear();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close().catch(() => {});
      } catch {}
      this.audioCtx = null;
    }
  }
}

export const audioAlarmService = new AudioAlarmService();
export default audioAlarmService;
