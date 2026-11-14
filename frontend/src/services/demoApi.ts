/**
 * Predict IQ - Public demo data service.
 *
 * Reads the dedicated demo dataset from `GET /api/public/demo/*`. This service
 * is intentionally separate from `services/api.ts` because its security model
 * is different:
 *
 *   - it never attaches an Authorization header, an organization header, an
 *     operator cookie, or a device API key (no credentials exist to attach);
 *   - it only exposes read methods; every write helper throws
 *     `DemoReadOnlyError` so a stray caller cannot mutate a record;
 *   - failures surface as real errors (ApiError / network error) so the demo
 *     UI can render an honest error state instead of zeros.
 *
 * The backend enforces the same rules: the demo routes are read-only and bound
 * to one demo organization that no visitor can select.
 */

import api, { ApiError } from './api';
import type { FleetDataService } from './dataService';
import type {
  Alert,
  AIModelStatus,
  DataCollectionStatus,
  FleetStats,
  Machine,
  MaintenanceRecord,
  ModelStatus,
  Prediction,
  SensorReading,
} from '../types';
import { DemoReadOnlyError } from '../lib/demoMode';

export interface DemoDatasetInfo {
  label: string;
  organization_name: string;
  organization_slug: string;
  provenance: 'MANUAL_DEMO';
  hardware_telemetry: boolean;
  read_only: boolean;
  notice: string;
}

export interface DemoOverview {
  mode: 'PUBLIC_DEMO';
  dataset: DemoDatasetInfo;
  stats: FleetStats;
  generated_at: string;
}

/** Pagination envelope returned by every demo list endpoint. */
export interface DemoEnvelope<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const MAX_PAGE_SIZE = 200;

class PredictIQDemoApiService implements FleetDataService {
  /** Demo endpoints live under the same /api base as the rest of the product. */
  private endpoint(path: string): string {
    return `${api.getBaseUrl()}/public/demo${path}`;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = this.endpoint(path);
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err: any) {
      // Network-level failure: surface it (the UI renders an error state).
      throw new Error(
        `Could not reach the PredictIQ demo API at ${url}. ${
          err?.message ? String(err.message) : ''
        }`.trim()
      );
    }

    if (!response.ok) {
      const body: any = await response.json().catch(() => ({}));
      const detail =
        typeof body?.detail === 'string'
          ? body.detail
          : `HTTP Error ${response.status}: ${response.statusText}`;
      throw new ApiError(detail, response.status);
    }

    return (await response.json()) as T;
  }

  public async getOverview(): Promise<DemoOverview> {
    return this.fetchJson<DemoOverview>('/overview');
  }

  public async getMachines(): Promise<Machine[]> {
    const page = await this.fetchJson<DemoEnvelope<Machine>>(
      `/machines?limit=${MAX_PAGE_SIZE}`
    );
    return page.items;
  }

  public async getMachineDetails(machineId: string): Promise<Machine> {
    return this.fetchJson<Machine>(`/machines/${encodeURIComponent(machineId)}`);
  }

  public async getFleetStats(): Promise<FleetStats> {
    const overview = await this.getOverview();
    return overview.stats;
  }

  public async getDataStatus(): Promise<DataCollectionStatus> {
    const status = await this.fetchJson<DataCollectionStatus & { demo_mode?: boolean }>(
      '/data-status'
    );
    return status;
  }

  public async getAIModelStatus(): Promise<AIModelStatus> {
    const status = await this.getModelStatus();
    return {
      status: status.status,
      prediction: status.trained ? 'Available (governed model)' : 'Prototype only',
      remaining_useful_life: 'Not available',
      confidence: 'Not available',
      trained_model_exists: status.trained === true,
      message: status.message,
    };
  }

  public async getModelStatus(): Promise<ModelStatus> {
    return this.fetchJson<ModelStatus>('/model-status');
  }

  public async getSensorHistory(
    machineId: string,
    limit: number = 100
  ): Promise<SensorReading[]> {
    return this.getSensorData(machineId, limit);
  }

  public async getSensorData(
    machineId: string,
    limit: number = 50
  ): Promise<SensorReading[]> {
    const pageSize = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
    const page = await this.fetchJson<DemoEnvelope<SensorReading>>(
      `/readings?machine_id=${encodeURIComponent(machineId)}&limit=${pageSize}`
    );
    return page.items;
  }

  public async getLatestSensorData(machineId: string): Promise<SensorReading> {
    return this.fetchJson<SensorReading>(
      `/machines/${encodeURIComponent(machineId)}/latest`
    );
  }

  public async getPrediction(machineId: string): Promise<Prediction> {
    return this.fetchJson<Prediction>(
      `/machines/${encodeURIComponent(machineId)}/prediction`
    );
  }

  public async getPredictions(machineId?: string): Promise<Prediction[]> {
    const query = machineId
      ? `?machine_id=${encodeURIComponent(machineId)}`
      : '';
    const page = await this.fetchJson<DemoEnvelope<Prediction>>(
      `/predictions${query}`
    );
    return page.items;
  }

  public async getMaintenance(machineId?: string): Promise<MaintenanceRecord[]> {
    const query = machineId
      ? `?machine_id=${encodeURIComponent(machineId)}`
      : '';
    const page = await this.fetchJson<DemoEnvelope<MaintenanceRecord>>(
      `/maintenance${query}`
    );
    return page.items;
  }

  public async getMaintenanceHistory(
    machineId?: string
  ): Promise<MaintenanceRecord[]> {
    return this.getMaintenance(machineId);
  }

  public async getAlerts(
    machineId?: string,
    statusFilter?: string
  ): Promise<Alert[]> {
    const params: string[] = [];
    if (machineId) params.push(`machine_id=${encodeURIComponent(machineId)}`);
    if (statusFilter) {
      params.push(`status_filter=${encodeURIComponent(statusFilter.toUpperCase())}`);
    }
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    const page = await this.fetchJson<DemoEnvelope<Alert>>(`/alerts${query}`);
    return page.items;
  }

  // -------------------------------------------------------------------------
  // Write actions are impossible in demo mode. The UI hides these controls and
  // the backend exposes no write routes; these guards are defense in depth.
  // -------------------------------------------------------------------------
  public rejectWrite(action: string): never {
    throw new DemoReadOnlyError(action);
  }
}

export const demoApi = new PredictIQDemoApiService();
export default demoApi;
