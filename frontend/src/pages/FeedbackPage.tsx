import React, { useState, useEffect, useRef } from 'react';
import { Machine, Prediction, Alert, MaintenanceRecord, FeedbackRecord, FeedbackContext, FeedbackSeverity, FeedbackOutcome } from '../types';
import api from '../services/api';
import {
  ClipboardCheck,
  Send,
  RefreshCw,
  Database,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft,
  Info,
  Scale
} from 'lucide-react';

interface FeedbackPageProps {
  machines: Machine[];
  initialContext?: FeedbackContext | null;
  onClearInitialContext?: () => void;
}

const EMPTY_FORM = {
  machine_id: '',
  prediction_id: '',
  alert_id: '',
  maintenance_record_id: '',
  observed_condition: '',
  actual_fault: '',
  root_cause: '',
  symptoms: '',
  action_taken: '',
  parts_replaced: '',
  severity: 'Warning' as FeedbackSeverity,
  outcome: 'Confirmed' as FeedbackOutcome,
  technician_notes: '',
  prediction_correct: '',
  feedback_source: 'MANUAL' as 'MANUAL' | 'INSPECTION',
};

export const FeedbackPage: React.FC<FeedbackPageProps> = ({
  machines,
  initialContext,
  onClearInitialContext,
}) => {
  const [feedbackRecords, setFeedbackRecords] = useState<FeedbackRecord[]>([]);
  const [allPredictions, setAllPredictions] = useState<Prediction[]>([]);
  const [machineMaintenance, setMachineMaintenance] = useState<MaintenanceRecord[]>([]);
  const [machineAlerts, setMachineAlerts] = useState<Alert[]>([]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const contextApplied = useRef<boolean>(false);

  // Apply the pre-linked context (from an alert or prediction) exactly once.
  useEffect(() => {
    if (contextApplied.current) return;
    if (initialContext && initialContext.machine_id) {
      setForm((prev) => ({
        ...prev,
        machine_id: initialContext.machine_id,
        prediction_id: initialContext.prediction_id != null ? String(initialContext.prediction_id) : '',
        alert_id: initialContext.alert_id != null ? String(initialContext.alert_id) : '',
      }));
      contextApplied.current = true;
      if (onClearInitialContext) onClearInitialContext();
    }
  }, [initialContext, onClearInitialContext]);

  const loadFeedback = async () => {
    try {
      const [records, predictions] = await Promise.all([
        api.getFeedback().catch(() => []),
        api.getPredictions().catch(() => []),
      ]);
      setFeedbackRecords(records);
      setAllPredictions(predictions);
    } catch (err) {
      console.warn('Failed to load feedback records:', err);
    }
  };

  const loadMachineRefs = async (machineId: string) => {
    if (!machineId) {
      setMachineMaintenance([]);
      setMachineAlerts([]);
      return;
    }
    try {
      const [maintenance, alerts] = await Promise.all([
        api.getMaintenance(machineId).catch(() => []),
        api.getAlerts(machineId).catch(() => []),
      ]);
      setMachineMaintenance(maintenance);
      setMachineAlerts(alerts);
    } catch (err) {
      console.warn('Failed to load machine references:', err);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    Promise.all([loadFeedback(), loadMachineRefs(form.machine_id)]).finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.machine_id) loadMachineRefs(form.machine_id);
    // Reset links that no longer apply to the selected machine.
    setForm((prev) => ({ ...prev, prediction_id: '', alert_id: '', maintenance_record_id: '', prediction_correct: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.machine_id]);

  const machinePredictions = form.machine_id
    ? allPredictions.filter((p) => p.machine_id === form.machine_id)
    : [];

  const updateField = (field: keyof typeof EMPTY_FORM, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitMessage(null);
    if (!form.machine_id) {
      setSubmitMessage({ type: 'error', text: 'Select a machine to record feedback for.' });
      return;
    }
    if (!form.observed_condition.trim()) {
      setSubmitMessage({ type: 'error', text: 'Observed condition is required.' });
      return;
    }

    const predictionId = form.prediction_id ? Number(form.prediction_id) : null;
    const alertId = form.alert_id ? Number(form.alert_id) : null;
    const maintenanceId = form.maintenance_record_id ? Number(form.maintenance_record_id) : null;
    const predictionCorrect =
      predictionId != null && form.prediction_correct !== '' ? form.prediction_correct === 'true' : null;

    const payload = {
      machine_id: form.machine_id,
      prediction_id: predictionId,
      alert_id: alertId,
      maintenance_record_id: maintenanceId,
      observed_condition: form.observed_condition,
      actual_fault: form.actual_fault || null,
      root_cause: form.root_cause || null,
      symptoms: form.symptoms || null,
      action_taken: form.action_taken || null,
      parts_replaced: form.parts_replaced || null,
      severity: form.severity,
      outcome: form.outcome,
      technician_notes: form.technician_notes || null,
      prediction_correct: predictionCorrect,
      feedback_source: form.feedback_source,
    };

    setIsSubmitting(true);
    try {
      await api.addFeedback(payload);
      setSubmitMessage({ type: 'success', text: 'Feedback and ground-truth outcome stored in PostgreSQL.' });
      setForm((prev) => ({ ...EMPTY_FORM, machine_id: prev.machine_id }));
      await loadFeedback();
    } catch (err: any) {
      setSubmitMessage({ type: 'error', text: `Failed to save feedback: ${err.message || err}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500/60 focus:outline-none';
  const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400';

  return (
    <div id="feedback-page" className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Technician Feedback &amp; Ground Truth</h2>
          <p className="text-xs text-slate-400 mt-1">
            Record what was actually found and done so predictions can be compared with reality.
          </p>
        </div>
        <button
          onClick={loadFeedback}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Submission message */}
      {submitMessage && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold ${
            submitMessage.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
              : 'border-rose-500/40 bg-rose-950/60 text-rose-300'
          }`}
        >
          {submitMessage.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <span>{submitMessage.text}</span>
        </div>
      )}

      {/* Feedback form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg"
      >
        <div className="flex items-center gap-2 mb-4">
          <ClipboardCheck className="h-4 w-4 text-cyan-400" />
          <h4 className="text-sm font-bold text-white">Record technician feedback</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">


          <div>
            <label className={labelCls}>Machine</label>
            <select
              value={form.machine_id}
              onChange={(e) => updateField('machine_id', e.target.value)}
              className={inputCls}
            >
              <option value="">Select machine…</option>
              {machines.map((m) => (
                <option key={m.machine_id} value={m.machine_id}>
                  {m.machine_id} — {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Prediction (pre-linked)</label>
            <select
              value={form.prediction_id}
              onChange={(e) => updateField('prediction_id', e.target.value)}
              className={inputCls}
              disabled={!form.machine_id}
            >
              <option value="">No prediction linked</option>
              {machinePredictions.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  #{p.id} — {p.component || 'component'} ({Math.round((p.failure_probability || 0) * 100)}%)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Alert (optional)</label>
            <select
              value={form.alert_id}
              onChange={(e) => updateField('alert_id', e.target.value)}
              className={inputCls}
              disabled={!form.machine_id}
            >
              <option value="">No alert linked</option>
              {machineAlerts.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  #{a.id} — {a.severity} — {a.message.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Maintenance record (optional)</label>
            <select
              value={form.maintenance_record_id}
              onChange={(e) => updateField('maintenance_record_id', e.target.value)}
              className={inputCls}
              disabled={!form.machine_id}
            >
              <option value="">No maintenance linked</option>
              {machineMaintenance.map((mr) => (
                <option key={mr.id} value={String(mr.id)}>
                  #{mr.id} — {mr.component} — {mr.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>Severity</label>
            <select
              value={form.severity}
              onChange={(e) => updateField('severity', e.target.value)}
              className={inputCls}
            >
              <option value="Critical">Critical</option>
              <option value="Warning">Warning</option>
              <option value="Info">Info</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Outcome</label>
            <select
              value={form.outcome}
              onChange={(e) => updateField('outcome', e.target.value)}
              className={inputCls}
            >
              <option value="Confirmed">Confirmed</option>
              <option value="Not Confirmed">Not Confirmed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Prediction correct?</label>
            <select
              value={form.prediction_correct}
              onChange={(e) => updateField('prediction_correct', e.target.value)}
              className={inputCls}
              disabled={!form.prediction_id}
            >
              <option value="">Not evaluated</option>
              <option value="true">Yes — matched reality</option>
              <option value="false">No — did not match</option>
            </select>
            {!form.prediction_id && (
              <p className="mt-1 text-[10px] text-slate-500">Link a prediction to mark it correct/incorrect.</p>
            )}
          </div>

          <div>
            <label className={labelCls}>Feedback source</label>
            <select
              value={form.feedback_source}
              onChange={(e) => updateField('feedback_source', e.target.value)}
              className={inputCls}
            >
              <option value="MANUAL">MANUAL</option>
              <option value="INSPECTION">INSPECTION</option>
            </select>
          </div>
        </div>


        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Observed condition *</label>
            <textarea
              value={form.observed_condition}
              onChange={(e) => updateField('observed_condition', e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="What the technician observed at inspection"
            />
          </div>
          <div>
            <label className={labelCls}>Actual fault / root cause</label>
            <input
              value={form.actual_fault}
              onChange={(e) => updateField('actual_fault', e.target.value)}
              className={inputCls}
              placeholder="e.g. Bearing spalling"
            />
          </div>
          <div>
            <label className={labelCls}>Root cause</label>
            <textarea
              value={form.root_cause}
              onChange={(e) => updateField('root_cause', e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="Identified root cause"
            />
          </div>
          <div>
            <label className={labelCls}>Symptoms</label>
            <textarea
              value={form.symptoms}
              onChange={(e) => updateField('symptoms', e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="Observed symptoms"
            />
          </div>
          <div>
            <label className={labelCls}>Action taken</label>
            <textarea
              value={form.action_taken}
              onChange={(e) => updateField('action_taken', e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="Maintenance action actually performed"
            />
          </div>
          <div>
            <label className={labelCls}>Parts replaced</label>
            <input
              value={form.parts_replaced}
              onChange={(e) => updateField('parts_replaced', e.target.value)}
              className={inputCls}
              placeholder="Parts replaced"
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Technician notes</label>
            <textarea
              value={form.technician_notes}
              onChange={(e) => updateField('technician_notes', e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="Free-form notes"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            <span>{isSubmitting ? 'Saving…' : 'Save feedback'}</span>
          </button>
        </div>
      </form>


      {/* Prediction vs Reality */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <Scale className="h-4 w-4 text-purple-400" />
          <h4 className="text-sm font-bold text-white">Prediction vs Reality</h4>
          <span className="ml-auto rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-300">
            {feedbackRecords.length} record{feedbackRecords.length === 1 ? '' : 's'}
          </span>
        </div>

        {feedbackRecords.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Database className="h-6 w-6 text-slate-600" />
            <p className="text-xs text-slate-400">
              No feedback or ground-truth records stored yet. Use the form above to record the first technician outcome.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {feedbackRecords.map((record) => {
              const prediction = record.prediction_id
                ? allPredictions.find((p) => Number(p.id) === Number(record.prediction_id))
                : undefined;
              return (
                <div key={record.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-cyan-400">{record.machine_id}</span>
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                        record.severity === 'Critical'
                          ? 'bg-rose-500/20 text-rose-300'
                          : record.severity === 'Warning'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-blue-500/20 text-blue-300'
                      }`}
                    >
                      {record.severity.toUpperCase()}
                    </span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-300">
                      {record.outcome.toUpperCase()}
                    </span>
                    {record.prediction_correct != null && (
                      <span
                        className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                          record.prediction_correct
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {record.prediction_correct ? 'PREDICTION CORRECT' : 'PREDICTION WRONG'}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-slate-500 font-mono">
                      {new Date(record.created_at).toLocaleString()}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-slate-300">{record.observed_condition}</p>

                  {prediction ? (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-purple-500/20 bg-purple-950/30 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Info className="h-3 w-3 text-purple-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                            Predicted (prediction #{prediction.id})
                          </span>
                        </div>
                        <dl className="space-y-1 text-[11px]">
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Component</dt>
                            <dd className="font-mono text-slate-200">{prediction.component || '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Failure probability</dt>
                            <dd className="font-mono text-slate-200">
                              {prediction.failure_probability != null
                                ? `${(prediction.failure_probability * 100).toFixed(1)}%`
                                : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Predicted at</dt>
                            <dd className="font-mono text-slate-200">
                              {prediction.timestamp ? new Date(prediction.timestamp).toLocaleString() : '—'}
                            </dd>
                          </div>
                          {prediction.explanation && (
                            <div className="pt-1 text-slate-400 leading-relaxed">{prediction.explanation}</div>
                          )}
                        </dl>
                      </div>


                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                            Found (actual outcome)
                          </span>
                        </div>
                        <dl className="space-y-1 text-[11px]">
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Actual fault</dt>
                            <dd className="font-mono text-slate-200">{record.actual_fault || '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Root cause</dt>
                            <dd className="font-mono text-slate-200">{record.root_cause || '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Action taken</dt>
                            <dd className="font-mono text-slate-200">{record.action_taken || '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Parts replaced</dt>
                            <dd className="font-mono text-slate-200">{record.parts_replaced || '—'}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] text-slate-500">
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      No prediction linked to this record — nothing to compare against yet.
                    </div>
                  )}

                  {(record.symptoms || record.technician_notes) && (
                    <div className="mt-3 space-y-1 text-[11px] text-slate-400">
                      {record.symptoms && <p><span className="text-slate-500">Symptoms:</span> {record.symptoms}</p>}
                      {record.technician_notes && (
                        <p><span className="text-slate-500">Notes:</span> {record.technician_notes}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedbackPage;
