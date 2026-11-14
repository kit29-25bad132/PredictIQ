/**
 * Predict IQ - Shared read interface for dashboard data.
 *
 * The authenticated service (`services/api.ts`) is the default implementation.
 * The public demo passes the same-shaped `demoApi` implementation instead, so
 * pages keep a single implementation while the transport, credentials and
 * dataset differ. Pages must never call `fetch` directly for fleet data.
 */

import type {
  Alert,
  AIModelStatus,
  DataCollectionStatus,
  FleetStats,
  Machine,
  MaintenanceRecord,
  ModelEvaluation,
  ModelStatus,
  Prediction,
  SensorReading,
} from '../types';

export interface FleetDataService {
  getMachines(): Promise<Machine[]>;
  getMachineDetails(machineId: string): Promise<Machine>;
  getFleetStats(): Promise<FleetStats>;
  getDataStatus(): Promise<DataCollectionStatus>;
  getAIModelStatus(): Promise<AIModelStatus>;
  getModelStatus(): Promise<ModelStatus>;
  /** Operator-only on the authenticated API; absent from the demo service. */
  getModelEvaluation?(): Promise<ModelEvaluation>;

  getSensorHistory(machineId: string, limit?: number): Promise<SensorReading[]>;
  getSensorData(
    machineId: string,
    limit?: number,
    startTime?: string,
    endTime?: string
  ): Promise<SensorReading[]>;
  getLatestSensorData(machineId: string): Promise<SensorReading>;

  getPrediction(machineId: string): Promise<Prediction>;
  getPredictions(machineId?: string): Promise<Prediction[]>;

  getMaintenance(machineId?: string): Promise<MaintenanceRecord[]>;
  getMaintenanceHistory(machineId?: string): Promise<MaintenanceRecord[]>;

  getAlerts(machineId?: string, statusFilter?: string): Promise<Alert[]>;
}
