import React, { useState, useEffect } from 'react';
import { Machine, Prediction, ContributingFactor, FeedbackContext, ModelEvaluation, ModelStatus } from '../types';
import ShapAttributionBar from '../components/ShapAttributionBar';
import api from '../services/api';
import {
  BrainCircuit,
  Sparkles,
  Flame,
  Activity,
  Zap,
  Gauge,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Wrench,
  Sliders,
  Send,
  RefreshCw,
  Database,
  Info,
  ClipboardCheck,
} from 'lucide-react';

interface PredictionsPageProps {
  machines: Machine[];
  onSelectMachine: (id: string) => void;
  onOpenManualModal: (id: string) => void;
  onRecordFeedback?: (context: FeedbackContext) => void;
}

export const PredictionsPage: React.FC<PredictionsPageProps> = ({
  machines,
  onSelectMachine,
  onOpenManualModal,
  onRecordFeedback,
}) => {
  const [selectedMachineId, setSelectedMachineId] = useState<string>(
    machines.length > 0 ? machines[0].machine_id : 'M001'
  );
  const [activePrediction, setActivePrediction] = useState<Prediction | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [modelEvaluation, setModelEvaluation] = useState<ModelEvaluation | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitFeedback, setSubmitFeedback] = useState<string | null>(null);

  // Manual Real Sensor Measurement Inputs for Real Hardware Testing
  const [manualTemp, setManualTemp] = useState<number>(68.5);
  const [manualVib, setManualVib] = useState<number>(2.4);
  const [manualCurrent, setManualCurrent] = useState<number>(10.2);
  const [manualRpm, setManualRpm] = useState<number>(1450);

  const activeMachine = machines.find((m) => m.machine_id === selectedMachineId) || machines[0];

  const fetchStatusAndPrediction = async (id: string) => {
    setIsLoading(true);
    try {
      const [predRes, statusRes, evalRes] = await Promise.all([
        api.getPrediction(id).catch(() => null),
        api.getModelStatus().catch(() => null),
        api.getModelEvaluation().catch(() => null),
      ]);
      setActivePrediction(predRes);
      setModelStatus(statusRes);
      setModelEvaluation(evalRes);
    } catch (err) {
      console.warn('Failed to fetch prediction state:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedMachineId) {
      fetchStatusAndPrediction(selectedMachineId);
      if (activeMachine?.latest_reading) {
        setManualTemp(activeMachine.latest_reading.temperature);
        setManualVib(activeMachine.latest_reading.vibration);
        setManualCurrent(activeMachine.latest_reading.current);
        setManualRpm(activeMachine.latest_reading.rpm);
      }
    }
  }, [selectedMachineId]);

  const handleSaveMeasurement = async () => {
    setIsSubmitting(true);
    setSubmitFeedback(null);
    try {
      const res = await api.sendSensorData({
        device_id: activeMachine?.devices?.[0]?.device_id || `ESP32_${selectedMachineId}`,
        machine_id: selectedMachineId,
        temperature: manualTemp,
        vibration: manualVib,
        current: manualCurrent,
        rpm: manualRpm,
      });
      setSubmitFeedback(`Successfully stored real measurement into PostgreSQL (Reading ID: ${res.id})`);
      fetchStatusAndPrediction(selectedMachineId);
    } catch (err: any) {
      setSubmitFeedback(`Error saving measurement: ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="predictions-page" className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-gradient-to-r from-purple-950/40 via-slate-900 to-cyan-950/40 p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <BrainCircuit className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              AI Predictive Engine & Machine Learning Status
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-Data Architecture • PostgreSQL Telemetry Integration • Transparent Model Readiness
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedMachineId}
            onChange={(e) => setSelectedMachineId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
          >
            {machines.map((m) => (
              <option key={m.machine_id} value={m.machine_id}>
                {m.machine_id} - {m.name} ({m.status})
              </option>
            ))}
          </select>

          <button
            onClick={() => fetchStatusAndPrediction(selectedMachineId)}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Real Manual Sensor Measurement Injector */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Real Measurement Injection
                </h3>
              </div>
              <span className="text-[11px] font-mono text-cyan-400">
                MANUAL INPUT
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              For testing in environments without active ESP32 Wi-Fi hardware, enter real physical measurements to store in PostgreSQL.
            </p>

            {/* Input Controls */}
            <div className="mt-4 space-y-4">
              {/* Temperature */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Flame className="h-4 w-4 text-amber-400" /> Temperature (°C)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={manualTemp}
                    onChange={(e) => setManualTemp(parseFloat(e.target.value) || 0)}
                    className="w-24 rounded bg-slate-900 px-2 py-1 text-right font-mono text-xs font-bold text-amber-400 border border-slate-700 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Vibration */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Activity className="h-4 w-4 text-rose-400" /> Vibration RMS (mm/s)
                  </span>
                  <input
                    type="number"
                    step="0.05"
                    value={manualVib}
                    onChange={(e) => setManualVib(parseFloat(e.target.value) || 0)}
                    className="w-24 rounded bg-slate-900 px-2 py-1 text-right font-mono text-xs font-bold text-rose-400 border border-slate-700 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              {/* Current */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Zap className="h-4 w-4 text-cyan-400" /> Current Draw (A)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    value={manualCurrent}
                    onChange={(e) => setManualCurrent(parseFloat(e.target.value) || 0)}
                    className="w-24 rounded bg-slate-900 px-2 py-1 text-right font-mono text-xs font-bold text-cyan-400 border border-slate-700 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* RPM */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Gauge className="h-4 w-4 text-purple-400" /> Rotational Speed (RPM)
                  </span>
                  <input
                    type="number"
                    step="10"
                    value={manualRpm}
                    onChange={(e) => setManualRpm(parseFloat(e.target.value) || 0)}
                    className="w-24 rounded bg-slate-900 px-2 py-1 text-right font-mono text-xs font-bold text-purple-400 border border-slate-700 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </div>

            {submitFeedback && (
              <div className={`mt-3 rounded-lg p-2.5 text-xs font-medium border ${
                submitFeedback.startsWith('Successfully')
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
              }`}>
                {submitFeedback}
              </div>
            )}

            {/* Commit to Backend Database Button */}
            <div className="mt-5 border-t border-slate-800 pt-4">
              <button
                disabled={isSubmitting}
                onClick={handleSaveMeasurement}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-xs font-bold text-slate-950 hover:from-cyan-400 hover:to-blue-500 shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>{isSubmitting ? 'Storing in PostgreSQL...' : 'Store Real Measurement in PostgreSQL'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: AI Readiness & Model Status */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                  <BrainCircuit className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Predictive Model Readiness
                  </h3>
                  <p className="text-xs text-slate-400">
                    Target: <strong className="text-cyan-400">{activeMachine?.name} ({selectedMachineId})</strong>
                  </p>
                </div>
              </div>

              <span className="rounded bg-amber-500/20 px-2.5 py-1 font-mono text-xs font-bold text-amber-300 border border-amber-500/30">
                {activePrediction?.model_version
                  ? `${activePrediction.model_version}${activePrediction.is_prototype ? ' (prototype)' : ''}`
                  : 'Prototype physics engine'}
              </span>
            </div>

            {/* Honest ML source banner: prototype vs trained/evaluated vs insufficient */}
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-400" />
                <span className="font-bold uppercase tracking-wider text-slate-300">
                  Model source: {modelStatus ? (modelStatus.source === 'trained' ? 'Trained + evaluated' : modelStatus.source === 'trained-unevaluated' ? 'Trained (evaluation incomplete)' : 'Prototype') : 'Prototype'}
                </span>
              </div>
              <p className="mt-1 leading-relaxed text-slate-400">
                {modelStatus?.message || 'Deterministic prototype estimates are active; validated ML waits for curated ground truth.'}
              </p>
              {modelEvaluation && (
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  Ground truth: {modelEvaluation.ground_truth_count} record(s) • linked verdicts: {modelEvaluation.evaluated_count} • curated labels: {modelEvaluation.labeled_count} (faults {modelEvaluation.positive_count}, non-faults {modelEvaluation.negative_count})
                </p>
              )}
              {modelEvaluation && !modelEvaluation.evaluated && (
                <p className="mt-1 text-[11px] text-amber-300">
                  Insufficient evaluation data — prototype accuracy is unavailable, not zero. Record technician prediction-vs-reality feedback to enable evaluation.
                </p>
              )}
              {modelStatus?.metrics && (
                <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-300 sm:grid-cols-4">
                  <span>Accuracy: {modelStatus.metrics.accuracy ?? '—'}</span>
                  <span>Precision: {modelStatus.metrics.precision ?? '—'}</span>
                  <span>Recall: {modelStatus.metrics.recall ?? '—'}</span>
                  <span>F1: {modelStatus.metrics.f1 ?? '—'}</span>
                </div>
              )}
            </div>

            {/* Real Prediction Output — rendered only when persisted prediction exists */}
            {activePrediction && activePrediction.prediction_available ? (
              <>
                <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-[11px] font-medium text-slate-400">Failure Probability</div>
                    <div className="font-mono text-lg font-bold text-slate-300 mt-2">
                      {activePrediction.failure_probability != null
                        ? `${(activePrediction.failure_probability * 100).toFixed(1)}%`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Physics-prototype estimate</div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-[11px] font-medium text-slate-400">Component Diagnostic</div>
                    <div className="font-mono text-lg font-bold text-slate-300 mt-2">
                      {activePrediction.component || '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Highest-risk subsystem</div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-[11px] font-medium text-slate-400">Model Version</div>
                    <div className="font-mono text-lg font-bold text-slate-300 mt-2">
                      {activePrediction.model_version || '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {activePrediction.is_prototype ? 'Prototype engine' : 'Validated ML'}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-[11px] font-medium text-slate-400">Recommended Action</div>
                    <div className="font-mono text-lg font-bold text-slate-300 mt-2">
                      {activePrediction.recommended_action || '—'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Engine output</div>
                  </div>
                </div>

                {onRecordFeedback && activePrediction?.id != null && (
                  <div className="mt-6 flex items-center justify-end">
                    <button
                      onClick={() =>
                        onRecordFeedback({
                          machine_id: selectedMachineId,
                          prediction_id: Number(activePrediction.id),
                        })
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 transition-all"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      <span>Record Feedback for this Prediction</span>
                    </button>
                  </div>
                )}

                {(activePrediction.contributing_factors && activePrediction.contributing_factors.length > 0) && (
                  <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="h-4 w-4 text-purple-400" />
                      <h4 className="text-sm font-bold text-white">Explanation — Contributing Factors (XAI)</h4>
                    </div>
                    <ShapAttributionBar factors={activePrediction.contributing_factors as ContributingFactor[]} />
                  </div>
                )}

                {activePrediction.explanation && (
                  <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-5 text-xs text-slate-300 flex items-start gap-2.5">
                    <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{activePrediction.explanation}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-5 space-y-3">
                <div className="flex items-start gap-2.5">
                  <Info className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                      No Prediction Available
                    </h4>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {activePrediction?.explanation ||
                        'Predict IQ does not fabricate failure probabilities. A deterministic prototype prediction will be generated once a complete telemetry reading (temperature, vibration, current, RPM) is stored for this machine.'}
                    </p>
                  </div>
                </div>

                <div className="border-t border-slate-800/80 pt-3 text-[11px] text-slate-400 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
                    <span>1. ESP32 sends real temperature, vibration, current, and RPM readings to PostgreSQL.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
                    <span>2. A deterministic prototype engine produces an explainable prediction with SHAP attributions.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
                    <span>3. Validated ML training is deferred to Phase 6 after ground-truth labels are collected.</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export default PredictionsPage;
