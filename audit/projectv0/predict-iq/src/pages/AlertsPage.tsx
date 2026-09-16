import React, { useState, useEffect } from 'react';
import { Machine, Alert } from '../types';
import api from '../services/api';
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  ShieldCheck,
  Search,
  Check,
  RefreshCw,
  Clock,
  Database
} from 'lucide-react';

interface AlertsPageProps {
  machines: Machine[];
  onSelectMachine: (id: string) => void;
  onRefreshAlerts?: () => void;
}

export const AlertsPage: React.FC<AlertsPageProps> = ({
  machines,
  onSelectMachine,
  onRefreshAlerts,
}) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchAlerts = async () => {
    setIsLoading(true);
    try {
      const data = await api.getAlerts();
      setAlerts(data);
      if (onRefreshAlerts) onRefreshAlerts();
    } catch (err) {
      console.error('Failed to fetch alerts from PostgreSQL:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const timer = setInterval(fetchAlerts, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleAcknowledge = async (alertId: number | string) => {
    try {
      await api.acknowledgeAlert(alertId);
      fetchAlerts();
    } catch (err) {
      console.error('Acknowledge alert failed:', err);
    }
  };

  const handleResolve = async (alertId: number | string) => {
    try {
      await api.resolveAlert(alertId);
      fetchAlerts();
    } catch (err) {
      console.error('Resolve alert failed:', err);
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    const matchesSev =
      severityFilter === 'ALL' ||
      (severityFilter === 'ACTIVE' && a.status === 'ACTIVE') ||
      (severityFilter === 'RESOLVED' && a.status === 'RESOLVED') ||
      a.severity.toUpperCase() === severityFilter.toUpperCase();
    const matchesSearch =
      (a.message || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.machine_id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSev && matchesSearch;
  });

  const activeCount = alerts.filter((a) => a.status === 'ACTIVE').length;
  const criticalCount = alerts.filter((a) => a.severity === 'Critical' && a.status === 'ACTIVE').length;
  const warningCount = alerts.filter((a) => a.severity === 'Warning' && a.status === 'ACTIVE').length;

  return (
    <div id="alerts-page" className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Anomaly Alarms & PostgreSQL Incident Registry
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Real-time automated threshold exceptions stored in PostgreSQL.
          </p>
        </div>

        <button
          onClick={fetchAlerts}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh DB</span>
        </button>
      </div>

      {/* KPI Alert Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-rose-300">
            <span>Critical Active</span>
            <AlertOctagon className="h-4 w-4 text-rose-400" />
          </div>
          <div className="font-mono text-3xl font-bold text-rose-400 mt-1">{criticalCount}</div>
          <span className="text-[11px] text-rose-300/80">Immediate machine inspection required</span>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-amber-300">
            <span>Warning Active</span>
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="font-mono text-3xl font-bold text-amber-400 mt-1">{warningCount}</div>
          <span className="text-[11px] text-amber-300/80">Telemetry trending above normal operating range</span>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-emerald-300">
            <span>Active Alerts Total</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="font-mono text-3xl font-bold text-emerald-400 mt-1">
            {activeCount}
          </div>
          <span className="text-[11px] text-emerald-300/80">Unresolved events in PostgreSQL alerts table</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search alerts by message or machine ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-700/80 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs">
          {['ALL', 'ACTIVE', 'CRITICAL', 'WARNING', 'RESOLVED'].map((filterKey) => (
            <button
              key={filterKey}
              onClick={() => setSeverityFilter(filterKey)}
              className={`rounded px-2.5 py-1 font-medium transition-all ${
                severityFilter === filterKey
                  ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {filterKey}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts Feed */}
      <div className="space-y-3">
        {filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
            <p className="text-sm font-medium text-slate-300">No active alerts in PostgreSQL matching your filter.</p>
            <span className="text-xs text-slate-500 mt-1">Real telemetry channels operating within nominal parameters.</span>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isCrit = alert.severity === 'Critical';
            const isResolved = alert.status === 'RESOLVED';
            const isAck = alert.status === 'ACKNOWLEDGED';

            return (
              <div
                key={alert.id}
                className={`rounded-xl border p-4 transition-all shadow-md ${
                  isResolved
                    ? 'border-slate-800/80 bg-slate-950/50 opacity-70'
                    : isCrit
                    ? 'border-rose-500/40 bg-gradient-to-r from-rose-950/30 to-slate-900'
                    : 'border-amber-500/40 bg-gradient-to-r from-amber-950/30 to-slate-900'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      isCrit ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {isCrit ? <AlertOctagon className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => onSelectMachine(alert.machine_id)}
                          className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-cyan-400 border border-cyan-500/20 hover:bg-slate-700"
                        >
                          {alert.machine_id}
                        </button>
                        <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                          isCrit ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          {alert.severity.toUpperCase()}
                        </span>
                        {isResolved ? (
                          <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                            RESOLVED
                          </span>
                        ) : isAck ? (
                          <span className="rounded bg-blue-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-300">
                            ACKNOWLEDGED
                          </span>
                        ) : (
                          <span className="rounded bg-rose-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-200 animate-pulse">
                            ACTIVE
                          </span>
                        )}
                        <span className="text-[11px] text-slate-500 flex items-center gap-1 font-mono">
                          <Clock className="h-3 w-3" />
                          {new Date(alert.created_at).toLocaleString()}
                        </span>
                      </div>

                      <p className="mt-2 text-sm font-semibold text-white">
                        {alert.message}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  {!isResolved && (
                    <div className="flex items-center gap-2 self-end md:self-center">
                      {!isAck && (
                        <button
                          onClick={() => handleAcknowledge(alert.id)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white"
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => handleResolve(alert.id)}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 transition-all"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Mark Resolved</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
export default AlertsPage;
