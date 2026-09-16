import React, { useState } from 'react';
import {
  Cpu,
  Radio,
  Copy,
  Check,
  Terminal,
  Server,
  Activity,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Database
} from 'lucide-react';
import api from '../services/api';

export const SettingsPage: React.FC = () => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [customApiUrl, setCustomApiUrl] = useState<string>(api.getCustomApiUrl() || '');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string>('');

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveApiUrl = () => {
    api.setCustomApiUrl(customApiUrl);
    testConnection();
  };

  const testConnection = async () => {
    setTestStatus('testing');
    setTestMessage('Pinging FastAPI /api/health endpoint...');
    try {
      const res = await api.getHealth();
      setTestStatus('success');
      setTestMessage(`Connected to ${res.system || 'FastAPI'} (DB: ${res.database || 'PostgreSQL'}, Total Readings: ${res.total_sensor_readings})`);
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(`Connection failed: ${err.message || 'Server unreachable at ' + api.getBaseUrl()}`);
    }
  };

  const sampleSensorCurl = `curl -X POST http://localhost:8000/api/sensor-data \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <DEVICE_API_KEY>" \\
  -d '{
    "device_id": "ESP32_001",
    "machine_id": "<MACHINE_ID>",
    "timestamp": "${new Date().toISOString()}",
    "temperature": 72.4,
    "vibration": 3.8,
    "current": 8.7,
    "rpm": 1450.0,
    "source": "REAL_HARDWARE"
  }'`;

  const sampleHeartbeatCurl = `curl -X POST http://localhost:8000/api/devices/heartbeat \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <DEVICE_API_KEY>" \\
  -d '{
    "device_id": "ESP32_001",
    "machine_id": "<MACHINE_ID>",
    "firmware_version": "1.0.0",
    "temperature_status": "NOT_CONFIGURED",
    "vibration_status": "NOT_CONFIGURED",
    "current_status": "NOT_CONFIGURED",
    "rpm_status": "NOT_CONFIGURED"
  }'`;

  const sampleRegisterDeviceCurl = `curl -X POST http://localhost:8000/api/devices \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <DEVICE_API_KEY>" \\
  -d '{
    "device_id": "ESP32_001",
    "machine_id": "<MACHINE_ID>",
    "device_type": "ESP32",
    "firmware_version": "1.0.0"
  }'`;

  return (
    <div id="settings-page" className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          FastAPI Backend & ESP32 IoT Architecture Settings
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          PostgreSQL Database Integration • Real-Data Telemetry Pipeline • Zero Synthetic Data
        </p>
      </div>

      {/* Architecture Highlights Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Database className="h-5 w-5 text-cyan-400" /> PostgreSQL & ESP32 Live Telemetry Pipeline
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          Predict IQ operates exclusively on authentic IoT signals. Physical ESP32 microcontrollers transmit sensor readings to FastAPI over Wi-Fi, storing immutable time-series data in indexed PostgreSQL tables.
        </p>
      </div>

      {/* FastAPI Endpoint Connection Manager */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Server className="h-5 w-5 text-cyan-400" /> FastAPI Server Connection
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Configure the REST backend URL that the React frontend queries.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="http://localhost:8000/docs"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 hover:border-cyan-500/50 transition-all"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Swagger Docs (/docs)</span>
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <label className="block text-xs font-semibold text-slate-300">
              FastAPI Base URL / Endpoint Prefix
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customApiUrl}
                onChange={(e) => setCustomApiUrl(e.target.value)}
                placeholder="http://localhost:8000 (leave blank to use /api proxy)"
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs font-mono text-white placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
              <button
                onClick={handleSaveApiUrl}
                className="rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all"
              >
                Save URL
              </button>
              <button
                onClick={testConnection}
                disabled={testStatus === 'testing'}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${testStatus === 'testing' ? 'animate-spin' : ''}`} />
                <span>Test Ping</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Active endpoint prefix: <code className="font-mono text-cyan-400">{api.getBaseUrl()}</code>
            </p>
          </div>

          {/* Test Status Feedback Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 flex flex-col justify-center">
            <div className="text-xs font-bold text-slate-400 mb-1">Health Probe Status</div>
            {testStatus === 'idle' && (
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <Activity className="h-4 w-4" /> Ready to ping server
              </div>
            )}
            {testStatus === 'testing' && (
              <div className="text-xs text-cyan-400 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" /> {testMessage}
              </div>
            )}
            {testStatus === 'success' && (
              <div className="text-xs text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{testMessage}</span>
              </div>
            )}
            {testStatus === 'error' && (
              <div className="text-xs text-rose-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="break-all">{testMessage}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* REST API & cURL Testing Guide */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Terminal className="h-5 w-5 text-emerald-400" /> Real Hardware REST API Verification
        </h3>
        <p className="text-xs text-slate-400">
          Verify device registration, heartbeat, and real telemetry ingestion:
        </p>

        {/* cURL 1: POST /api/devices */}
        <div>
          <div className="flex items-center justify-between bg-slate-950 px-4 py-2 rounded-t-xl border border-slate-800">
            <span className="text-xs font-mono text-cyan-400 font-bold">
              1. POST /api/devices (Register ESP32 Node)
            </span>
            <button
              onClick={() => copyToClipboard(sampleRegisterDeviceCurl, 'curl1')}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
            >
              {copiedKey === 'curl1' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedKey === 'curl1' ? 'Copied' : 'Copy cURL'}</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded-b-xl border-x border-b border-slate-800 bg-slate-950/90 p-3 font-mono text-[11px] text-slate-300">
            {sampleRegisterDeviceCurl}
          </pre>
        </div>

        {/* cURL 2: POST /api/devices/heartbeat */}
        <div>
          <div className="flex items-center justify-between bg-slate-950 px-4 py-2 rounded-t-xl border border-slate-800">
            <span className="text-xs font-mono text-purple-400 font-bold">
              2. POST /api/devices/heartbeat (ESP32 Periodic Heartbeat)
            </span>
            <button
              onClick={() => copyToClipboard(sampleHeartbeatCurl, 'curl2')}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
            >
              {copiedKey === 'curl2' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedKey === 'curl2' ? 'Copied' : 'Copy cURL'}</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded-b-xl border-x border-b border-slate-800 bg-slate-950/90 p-3 font-mono text-[11px] text-slate-300">
            {sampleHeartbeatCurl}
          </pre>
        </div>

        {/* cURL 3: POST /api/sensor-data */}
        <div>
          <div className="flex items-center justify-between bg-slate-950 px-4 py-2 rounded-t-xl border border-slate-800">
            <span className="text-xs font-mono text-emerald-400 font-bold">
              3. POST /api/sensor-data (Real Sensor Telemetry Ingestion)
            </span>
            <button
              onClick={() => copyToClipboard(sampleSensorCurl, 'curl3')}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
            >
              {copiedKey === 'curl3' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedKey === 'curl3' ? 'Copied' : 'Copy cURL'}</span>
            </button>
          </div>
          <pre className="overflow-x-auto rounded-b-xl border-x border-b border-slate-800 bg-slate-950/90 p-3 font-mono text-[11px] text-slate-300">
            {sampleSensorCurl}
          </pre>
        </div>
      </div>
    </div>
  );
};
export default SettingsPage;
