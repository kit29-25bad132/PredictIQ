/**
 * Predict IQ - Frontend API Service Layer (PostgreSQL Real-Data Integration)
 * Directly interfaces with FastAPI REST endpoints. Never fabricates or fakes data.
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
  SensorInputPayload,
  MaintenanceInputPayload,
  MachineInputPayload,
  FeedbackRecord,
  FeedbackInputPayload
} from '../types';

class PredictIQApiService {
  private baseUrl: string;
  private customApiUrl: string = '';
  private isOnline: boolean = true;

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

  private async fetchJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const message = errorBody.detail || errorBody.error || errorBody.message || `HTTP Error ${res.status}: ${res.statusText}`;
        throw new Error(message);
      }

      this.isOnline = true;
      return await res.json();
    } catch (err: any) {
      this.isOnline = false;
      console.warn(`[Predict IQ API] Request failed for ${url}:`, err.message || err);
      throw err;
    }
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
      return await this.fetchJson<AIModelStatus>('/model-status');
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
    return this.fetchJson<Machine>('/machines', {
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
    return this.fetchJson<Device>('/devices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // =========================================================================
  // 4. REAL SENSOR TELEMETRY (POSTGRESQL INGEST & QUERY)
  // =========================================================================
  public async sendSensorData(data: SensorInputPayload): Promise<{ success: boolean; id: number }> {
    return this.fetchJson<any>('/sensor-data', {
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

  public async runDirectPrediction(data: SensorInputPayload): Promise<Prediction> {
    return this.fetchJson<Prediction>('/predict', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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
    return this.fetchJson<MaintenanceRecord>('/maintenance', {
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
    return this.fetchJson<Alert>(`/alerts/${alertId}/acknowledge`, {
      method: 'POST',
    });
  }

  public async resolveAlert(alertId: number | string): Promise<Alert> {
    return this.fetchJson<Alert>(`/alerts/${alertId}/resolve`, {
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
    return this.fetchJson<FeedbackRecord>('/feedback', {
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
}

export const api = new PredictIQApiService();
export default api;
