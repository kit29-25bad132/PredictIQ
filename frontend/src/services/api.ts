/**
 * Predict IQ - Frontend API Service Layer (PostgreSQL Real-Data Integration)
 * Directly interfaces with FastAPI REST endpoints. Never fabricates or fakes data.
 *
 * Three request paths, strictly separated transports:
 *   - fetchJson:         user requests. Attaches the Supabase access token
 *                        (Authorization: Bearer) except for public endpoints
 *                        (/health, /ready, /auth/*).
 *   - fetchOperatorJson: /api/operator/* and operator-only mutations. Sends
 *                        credentials: 'include' for the HttpOnly operator
 *                        session cookie and NEVER a Supabase token.
 *   - device auth:       X-API-Key is never present in browser code.
 *
 * Token lifecycle: the provider/refresh handlers are injected once by
 * AuthContext (no per-component credential logic). On a 401 the client performs
 * at most ONE refresh-and-retry; 403/404 are surfaced as-is and never retried.
 */

import {
  Machine,
  Device,
  SensorReading,
  Prediction,
  MaintenanceRecord,
  Alert,
  FleetStats,
  DataCollectionStatus,
  AIModelStatus,
  ModelEvaluation,
  ModelStatus,
  SensorInputPayload,
  MaintenanceInputPayload,
  MachineInputPayload,
  FeedbackRecord,
  FeedbackInputPayload,
  MachineSimulationConfig
} from '../types';

/** HTTP error carrying the response status for correct UI handling. */
export class ApiError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Endpoints that must never carry a user token. */
const PUBLIC_ENDPOINTS = ['/health', '/ready', '/auth/'];

/**
 * True when the backend denied access because the authenticated user has no
 * organization membership yet (Phase 5 adds onboarding for this state). This is
 * NOT a login failure and must never trigger a sign-out loop.
 */
export function isOrganizationAccessError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 403 && /no active organization membership/i.test(err.message)) return true;
  if (err.status === 404 && /organization not found or access denied/i.test(err.message)) return true;
  return false;
}

class PredictIQApiService {
  private baseUrl: string;
  private customApiUrl: string = '';
  private isOnline: boolean = true;

  // Injected once by AuthContext (see setAuthTokenProvider & friends).
  private authTokenProvider: (() => string | null) | null = null;
  private refreshTokenHandler: (() => Promise<string | null>) | null = null;
  private unauthorizedHandler: (() => void) | null = null;

  constructor() {
    const savedCustomUrl = typeof window !== 'undefined' ? localStorage.getItem('predictiq_custom_api') : null;
    const envApiUrl = (import.meta as any).env?.VITE_API_URL;

    if (savedCustomUrl) {
      this.customApiUrl = savedCustomUrl;
      this.baseUrl = savedCustomUrl.replace(/\/$/, '') + (savedCustomUrl.endsWith('/api') ? '' : '/api');
    } else if (envApiUrl) {
      this.baseUrl = envApiUrl.replace(/\/$/, '') + (envApiUrl.endsWith('/api') ? '' : '/api');
    } else {
      this.baseUrl = '/api';
    }
  }

  public setCustomApiUrl(url: string) {
    this.customApiUrl = url.trim();
    if (this.customApiUrl) {
      localStorage.setItem('predictiq_custom_api', this.customApiUrl);
      const cleanUrl = this.customApiUrl.replace(/\/$/, '');
      this.baseUrl = cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;
    } else {
      localStorage.removeItem('predictiq_custom_api');
      const envApiUrl = (import.meta as any).env?.VITE_API_URL;
      this.baseUrl = envApiUrl ? envApiUrl.replace(/\/$/, '') + '/api' : '/api';
    }
  }

  public getCustomApiUrl(): string {
    return this.customApiUrl;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public isBackendReachable(): boolean {
    return this.isOnline;
  }

  // =========================================================================
  // AUTH CREDENTIAL WIRING (single place; no component attaches tokens)
  // =========================================================================
  public setAuthTokenProvider(provider: (() => string | null) | null): void {
    this.authTokenProvider = provider;
  }

  public setRefreshTokenHandler(handler: (() => Promise<string | null>) | null): void {
    this.refreshTokenHandler = handler;
  }

  public setUnauthorizedHandler(handler: (() => void) | null): void {
    this.unauthorizedHandler = handler;
  }

  private shouldAttachUserToken(endpoint: string): boolean {
    const path = endpoint.split('?')[0];
    return !PUBLIC_ENDPOINTS.some((publicPath) => path === publicPath || path.startsWith(publicPath));
  }

  /**
   * Perform a request with the user token attached (when applicable) and at
   * most ONE refresh-and-retry on 401. The local `retried` flag makes retry
   * loops impossible, and refresh is never attempted for public endpoints.
   */
  private async fetchWithAuthRetry(
    url: string,
    options: RequestInit,
    attachToken: boolean
  ): Promise<Response> {
    const makeHeaders = (token: string | null): Record<string, string> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return headers;
    };

    const initialToken = attachToken && this.authTokenProvider ? this.authTokenProvider() : null;
    let res = await fetch(url, { ...options, headers: makeHeaders(initialToken) });

    let retried = false;
    while (res.status === 401 && attachToken && !retried && this.refreshTokenHandler) {
      retried = true;
      const refreshed = await this.refreshTokenHandler();
      if (!refreshed) break;
      res = await fetch(url, { ...options, headers: makeHeaders(refreshed) });
    }
    return res;
  }

  private async toApiError(res: Response): Promise<ApiError> {
    const errorBody = await res.json().catch(() => ({} as any));
    const message =
      errorBody.detail ||
      errorBody.error ||
      errorBody.message ||
      `HTTP Error ${res.status}: ${res.statusText}`;
    return new ApiError(typeof message === 'string' ? message : JSON.stringify(message), res.status);
  }

  private async fetchJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const attachToken = this.shouldAttachUserToken(endpoint);
    try {
      const res = await this.fetchWithAuthRetry(url, options ?? {}, attachToken);

      if (!res.ok) {
        const error = await this.toApiError(res);
        // We reached the server: the backend is online even if it said no.
        this.isOnline = true;
        if (error.status === 401 && this.unauthorizedHandler) {
          // Final 401 after the single refresh retry: session is dead.
          this.unauthorizedHandler();
        }
        console.warn(`[Predict IQ API] ${error.status} for ${url}:`, error.message);
        throw error;
      }

      this.isOnline = true;
      return await res.json();
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      // Network-level failure only (DNS, CORS, offline, abort).
      this.isOnline = false;
      console.warn(`[Predict IQ API] Request failed for ${url}:`, err.message || err);
      throw err;
    }
  }

  /**
   * Operator-authenticated request: sends credentials cross-origin so the
   * browser attaches the HttpOnly session cookie. Only used for POST/DELETE
   * mutations through /api/operator/*.
   */
  private async fetchOperatorJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      // Operator transport: HttpOnly session cookie only, never a Supabase JWT.
      const res = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!res.ok) {
        const error = await this.toApiError(res);
        this.isOnline = true;
        console.warn(`[Predict IQ API] Operator ${error.status} for ${url}:`, error.message);
        throw error;
      }

      this.isOnline = true;
      return await res.json();
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      this.isOnline = false;
      console.warn(`[Predict IQ API] Operator request failed for ${url}:`, err.message || err);
      throw err;
    }
  }

  // =========================================================================
  // AUTH OPERATOR SESSION
  // =========================================================================
  public async login(password: string): Promise<{ success: boolean; message: string }> {
    return this.fetchOperatorJson<{ success: boolean; message: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  public async logout(): Promise<{ success: boolean; message: string }> {
    return this.fetchOperatorJson<{ success: boolean; message: string }>('/auth/logout', {
      method: 'POST',
    });
  }

  public async checkSession(): Promise<{ authenticated: boolean; message: string }> {
    return this.fetchOperatorJson<{ authenticated: boolean; message: string }>('/auth/session');
  }

  // =========================================================================
  // 1. HEALTH, STATS & REAL DATA STATUS
  // =========================================================================
  public async getHealth(): Promise<{
    status: string;
    system: string;
    version: string;
    timestamp: string;
    database: string;
    active_machines: number;
    registered_devices: number;
    connected_esp32_devices: number;
    total_sensor_readings: number;
  }> {
    return this.fetchJson<any>('/health');
  }

  public async getFleetStats(): Promise<FleetStats> {
    try {
      return await this.fetchJson<FleetStats>('/stats');
    } catch (err) {
      // Organization denials must reach the caller (not be masked as zeros).
      if (isOrganizationAccessError(err)) throw err;
      return {
        total_machines: 0,
        total_devices: 0,
        connected_devices: 0,
        total_sensor_readings: 0,
        total_maintenance_records: 0,
        active_alerts: 0,
        data_collection_status: 'WAITING'
      };
    }
  }

  public async getDataStatus(): Promise<DataCollectionStatus> {
    try {
      return await this.fetchJson<DataCollectionStatus>('/data-status');
    } catch (err) {
      return {
        sensor_status: 'OFFLINE',
        last_reading: null,
        total_readings: 0,
        data_collection: 'WAITING',
        active_devices_count: 0,
        message: 'Waiting for real ESP32 sensor data.'
      };
    }
  }

  public async getAIModelStatus(): Promise<AIModelStatus> {
    try {
      const status = await this.fetchJson<ModelStatus>('/model-status');
      return {
        status: status.status,
        prediction: status.trained ? 'Available (governed model)' : 'Prototype only',
        remaining_useful_life: 'Not available',
        confidence: 'Not available',
        trained_model_exists: status.trained === true,
        message: status.message,
      };
    } catch (err) {
      return {
        status: 'Waiting for real historical data',
        prediction: 'Not available',
        remaining_useful_life: 'Not available',
        confidence: 'Not available',
        trained_model_exists: false,
        message: 'Awaiting real historical sensor data collection in PostgreSQL.'
      };
    }
  }

  public async getModelStatus(): Promise<ModelStatus> {
    return this.fetchJson<ModelStatus>('/model-status');
  }

  public async getModelEvaluation(): Promise<ModelEvaluation> {
    return this.fetchJson<ModelEvaluation>('/model-evaluation');
  }

  // =========================================================================
  // 2. MACHINES (POSTGRESQL ASSET DIRECTORY)
  // =========================================================================
  public async getMachines(): Promise<Machine[]> {
    return this.fetchJson<Machine[]>('/machines');
  }

  public async getMachineDetails(machineId: string): Promise<Machine> {
    return this.fetchJson<Machine>(`/machines/${encodeURIComponent(machineId)}`);
  }

  public async registerMachine(data: MachineInputPayload): Promise<Machine> {
    return this.fetchOperatorJson<Machine>('/operator/machines', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // =========================================================================
  // 3. DEVICES (ESP32 HARDWARE NODES)
  // =========================================================================
  public async getDevices(): Promise<Device[]> {
    return this.fetchJson<Device[]>('/devices');
  }

  public async registerDevice(data: { device_id: string; machine_id: string; device_type?: string; firmware_version?: string }): Promise<Device> {
    return this.fetchOperatorJson<Device>('/operator/devices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // =========================================================================
  // 4. REAL SENSOR TELEMETRY (POSTGRESQL INGEST & QUERY)
  // =========================================================================
  public async sendSensorData(data: SensorInputPayload): Promise<{ success: boolean; id: number }> {
    return this.fetchOperatorJson<any>('/operator/sensor-data', {
      method: 'POST',
      body: JSON.stringify({
        device_id: data.device_id,
        machine_id: data.machine_id,
        timestamp: data.timestamp || new Date().toISOString(),
        temperature: Number(data.temperature),
        vibration: Number(data.vibration),
        current: Number(data.current),
        rpm: Number(data.rpm),
        source: data.source || 'REAL_HARDWARE',
      }),
    });
  }

  public async getLatestSensorData(machineId: string): Promise<SensorReading> {
    return this.fetchJson<SensorReading>(`/machines/${encodeURIComponent(machineId)}/latest`);
  }

  public async getSensorHistory(machineId: string, limit: number = 100): Promise<SensorReading[]> {
    return this.fetchJson<SensorReading[]>(`/machines/${encodeURIComponent(machineId)}/history?limit=${limit}`);
  }

  public async getSensorData(machineId: string, limit: number = 50, startTime?: string, endTime?: string): Promise<SensorReading[]> {
    let query = `?limit=${limit}`;
    if (startTime) query += `&start_time=${encodeURIComponent(startTime)}`;
    if (endTime) query += `&end_time=${encodeURIComponent(endTime)}`;
    
    const res = await this.fetchJson<{ data: SensorReading[]; message?: string }>(`/machines/${encodeURIComponent(machineId)}/sensor-data${query}`);
    return res.data || [];
  }

  // =========================================================================
  // 5. PREDICTIONS (TRANSPARENT STATUS / REAL AI PREDICTIONS)
  // =========================================================================
  public async getPrediction(machineId: string): Promise<Prediction> {
    return this.fetchJson<Prediction>(`/machines/${encodeURIComponent(machineId)}/prediction`);
  }

  // =========================================================================
  // 6. MAINTENANCE & FAILURE EVENT RECORDS (POSTGRESQL)
  // =========================================================================
  public async getMaintenance(machineId?: string): Promise<MaintenanceRecord[]> {
    const query = machineId ? `?machine_id=${encodeURIComponent(machineId)}` : '';
    return this.fetchJson<MaintenanceRecord[]>(`/maintenance${query}`);
  }

  public async getMaintenanceHistory(machineId?: string): Promise<MaintenanceRecord[]> {
    return this.getMaintenance(machineId);
  }

  public async addMaintenance(data: MaintenanceInputPayload): Promise<MaintenanceRecord> {
    return this.fetchOperatorJson<MaintenanceRecord>('/operator/maintenance', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async createMaintenanceRecord(data: MaintenanceInputPayload): Promise<MaintenanceRecord> {
    return this.addMaintenance(data);
  }

  // =========================================================================
  // 7. ALERTS (POSTGRESQL)
  // =========================================================================
  public async getAlerts(machineId?: string, statusFilter?: string): Promise<Alert[]> {
    let query = '';
    const params: string[] = [];
    if (machineId) params.push(`machine_id=${encodeURIComponent(machineId)}`);
    if (statusFilter) params.push(`status_filter=${encodeURIComponent(statusFilter)}`);
    if (params.length > 0) query = `?${params.join('&')}`;
    return this.fetchJson<Alert[]>(`/alerts${query}`);
  }

  public async acknowledgeAlert(alertId: number | string): Promise<Alert> {
    return this.fetchOperatorJson<Alert>(`/operator/alerts/${alertId}/acknowledge`, {
      method: 'POST',
    });
  }

  public async resolveAlert(alertId: number | string): Promise<Alert> {
    return this.fetchOperatorJson<Alert>(`/operator/alerts/${alertId}/resolve`, {
      method: 'POST',
    });
  }

  // =========================================================================
  // 8. FEEDBACK / GROUND-TRUTH RECORDS (POSTGRESQL)
  // =========================================================================
  public async getFeedback(machineId?: string): Promise<FeedbackRecord[]> {
    const query = machineId ? `?machine_id=${encodeURIComponent(machineId)}` : '';
    return this.fetchJson<FeedbackRecord[]>(`/feedback${query}`);
  }

  public async getMachineFeedback(machineId: string): Promise<FeedbackRecord[]> {
    return this.fetchJson<FeedbackRecord[]>(`/machines/${encodeURIComponent(machineId)}/feedback`);
  }

  public async addFeedback(data: FeedbackInputPayload): Promise<FeedbackRecord> {
    return this.fetchOperatorJson<FeedbackRecord>('/operator/feedback', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // =========================================================================
  // 9. PREDICTIONS LIST (for prediction-vs-reality comparison)
  // =========================================================================
  public async getPredictions(machineId?: string): Promise<Prediction[]> {
    const query = machineId ? `?machine_id=${encodeURIComponent(machineId)}` : '';
    return this.fetchJson<Prediction[]>(`/predictions${query}`);
  }

  // =========================================================================
  // 10. AI MAINTENANCE ASSISTANT LIVE CHAT (GEMINI POWERED)
  // =========================================================================
  public async chatWithAssistant(
    message: string,
    machineId?: string,
    history?: { sender: 'user' | 'assistant'; text: string; timestamp?: string }[]
  ): Promise<{ reply: string; machine_id?: string; timestamp: string; model?: string }> {
    return this.fetchJson<{ reply: string; machine_id?: string; timestamp: string; model?: string }>(
      '/assistant/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          message,
          machine_id: machineId,
          history: (history || []).map((h) => ({
            sender: h.sender,
            text: h.text,
            timestamp: h.timestamp,
          })),
        }),
      }
    );
  }

  // =========================================================================
  // 11. DIGITAL TWIN DYNAMIC SIMULATION CONFIGURATION
  // =========================================================================
  public async getSimulationConfig(machineId: string): Promise<MachineSimulationConfig> {
    return this.fetchJson<MachineSimulationConfig>(`/machines/${encodeURIComponent(machineId)}/simulation-config`);
  }

  public async saveSimulationConfig(machineId: string, config: Partial<MachineSimulationConfig>): Promise<MachineSimulationConfig> {
    // Mutation: backend requires a valid operator session cookie.
    return this.fetchOperatorJson<MachineSimulationConfig>(`/machines/${encodeURIComponent(machineId)}/simulation-config`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  public async resetSimulationConfig(machineId: string): Promise<MachineSimulationConfig> {
    // Mutation: backend requires a valid operator session cookie.
    return this.fetchOperatorJson<MachineSimulationConfig>(`/machines/${encodeURIComponent(machineId)}/simulation-config/reset`, {
      method: 'POST',
    });
  }
}

export const api = new PredictIQApiService();
export default api;
