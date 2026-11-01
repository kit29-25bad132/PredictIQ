export type MachineStatus = 'Healthy' | 'Warning' | 'Critical' | 'Maintenance';

export type MachineType = 
  | 'Centrifugal Pump' 
  | 'Induction Motor' 
  | 'CNC Spindle' 
  | 'Screw Compressor' 
  | 'Cooling Tower Fan' 
  | 'Industrial Gearbox';

export type DataSource = 'WOKWI' | 'REAL_HARDWARE';

export interface MachineSpecifications {
  ratedRPM?: number | null;
  ratedCurrent?: number | null;
  maxTemp?: number | null;
  maxVibration?: number | null;
}

export interface Device {
  id?: number;
  device_id: string;
  machine_id: string;
  device_type: string;
  firmware_version: string;
  status: 'ONLINE' | 'OFFLINE';
  source?: DataSource;
  last_seen?: string | null;
  created_at: string;
}

export interface Machine {
  id?: number;
  machine_id: string;
  name: string;
  type: MachineType | string;
  location: string;
  status: MachineStatus;
  specifications?: MachineSpecifications | null;
  created_at: string;
  devices?: Device[];
  latest_reading?: SensorReading;
}

export interface SensorReading {
  id: number | string;
  machine_id: string;
  device_id: string;
  timestamp: string;
  temperature: number; // °C
  vibration: number; // mm/s RMS
  current: number; // A
  rpm: number; // RPM
  created_at?: string;
  source?: DataSource;
}

export interface ContributingFactor {
  factor: 'Temperature' | 'Vibration' | 'Current' | 'RPM' | 'Thermal Drift' | string;
  impact: 'Critical' | 'Very High' | 'High' | 'Above Normal' | 'Normal' | 'Low' | string;
  /**
   * Legacy API field name (kept for contract compatibility). Semantics:
   * a genuine SHAP attribution when a governed trained model exists; otherwise
   * a normalized physics-heuristic attribution from the prototype engine —
   * NOT a SHAP value. See ml/explainability.py.
   */
  shap_value: number;
  value_observed: string;
  threshold_reference: string;
  description: string;
}

export interface Prediction {
  id?: number | string;
  machine_id: string;
  timestamp: string;
  failure_probability?: number | null;
  failure_percentage?: number | null;
  component?: string | null;
  explanation?: string | null;
  recommended_action?: string | null;
  model_version?: string | null;
  is_prototype?: boolean;
  prediction_available?: boolean;
  feature_importance?: Record<string, number>;
  contributing_factors?: ContributingFactor[];
  reasons?: string[];
  created_at?: string;
}

export interface MaintenanceRecord {
  id: number | string;
  machine_id: string;
  component: string;
  failure_type?: string | null;
  issue_description: string;
  maintenance_action: string;
  technician: string;
  status: 'Completed' | 'In Progress' | 'Scheduled' | string;
  failure_date?: string | null;
  maintenance_date: string;
  created_at: string;
}

export type AlertSeverity = 'Critical' | 'Warning' | 'Info';

export interface Alert {
  id: number | string;
  machine_id: string;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | string;
  created_at: string;
  resolved_at?: string | null;
}

export interface FleetStats {
  total_machines: number;
  total_devices: number;
  connected_devices: number;
  total_sensor_readings: number;
  total_maintenance_records: number;
  active_alerts: number;
  data_collection_status: 'ACTIVE' | 'WAITING' | string;
}

export interface DataCollectionStatus {
  sensor_status: 'CONNECTED' | 'OFFLINE';
  last_reading?: string | null;
  total_readings: number;
  data_collection: 'ACTIVE' | 'WAITING';
  active_devices_count: number;
  message: string;
}

export interface AIModelStatus {
  status: string;
  prediction: string;
  remaining_useful_life: string;
  confidence: string;
  trained_model_exists: boolean;
  message: string;
}

export interface ModelMetrics {
  accuracy?: number | null;
  precision?: number | null;
  recall?: number | null;
  f1?: number | null;
  confusion_matrix?: { labels: number[]; matrix: number[][] } | null;
  support?: number | null;
}

export interface ModelStatus {
  source: 'prototype' | 'trained' | 'trained-unevaluated' | string;
  trained: boolean;
  evaluated: boolean;
  model_version?: string | null;
  status: string;
  message: string;
  dataset_version?: string | null;
  features?: string[] | null;
  metrics?: ModelMetrics | null;
  eval_date?: string | null;
  deployment_status?: string | null;
  dataset_size?: number | null;
  evaluation_dataset_size?: number | null;
}

export interface ModelEvaluation {
  evaluated: boolean;
  reason?: string | null;
  message: string;
  ground_truth_count: number;
  evaluated_count: number;
  correct_count: number;
  incorrect_count: number;
  prototype_accuracy?: number | null;
  labeled_count: number;
  positive_count: number;
  negative_count: number;
  excluded_ambiguous_label: number;
  excluded_non_finite: number;
  excluded_unknown_outcome: number;
  model_status: ModelStatus;
}

export interface SensorInputPayload {
  device_id: string;
  machine_id: string;
  timestamp?: string;
  temperature: number;
  vibration: number;
  current: number;
  rpm: number;
  source?: DataSource;
}

export interface MachineInputPayload {
  machine_id: string;
  name: string;
  type: MachineType | string;
  location: string;
  specifications: MachineSpecifications;
}

export interface MaintenanceInputPayload {
  machine_id: string;
  component: string;
  failure_type?: string;
  issue_description: string;
  maintenance_action: string;
  technician: string;
  status?: 'Completed' | 'In Progress' | 'Scheduled';
  failure_date?: string;
  maintenance_date?: string;
}

export type FeedbackSeverity = 'Critical' | 'Warning' | 'Info';
export type FeedbackOutcome = 'Confirmed' | 'Not Confirmed' | 'Cancelled';

export interface FeedbackRecord {
  id: number | string;
  machine_id: string;
  prediction_id?: number | null;
  alert_id?: number | null;
  maintenance_record_id?: number | null;
  observed_condition: string;
  actual_fault?: string | null;
  root_cause?: string | null;
  symptoms?: string | null;
  action_taken?: string | null;
  parts_replaced?: string | null;
  severity: FeedbackSeverity;
  outcome: FeedbackOutcome;
  technician_notes?: string | null;
  prediction_correct?: boolean | null;
  feedback_source: 'MANUAL' | 'INSPECTION';
  created_at: string;
}

export interface FeedbackInputPayload {
  machine_id: string;
  prediction_id?: number | null;
  alert_id?: number | null;
  maintenance_record_id?: number | null;
  observed_condition: string;
  actual_fault?: string | null;
  root_cause?: string | null;
  symptoms?: string | null;
  action_taken?: string | null;
  parts_replaced?: string | null;
  severity: FeedbackSeverity;
  outcome: FeedbackOutcome;
  technician_notes?: string | null;
  prediction_correct?: boolean | null;
  feedback_source: 'MANUAL' | 'INSPECTION';
}

export interface FeedbackContext {
  machine_id: string;
  prediction_id?: number | null;
  alert_id?: number | null;
}

// ============================================================================
// 10. REAL-TIME AUDIO ALARM SYSTEM TYPES
// ============================================================================

export type AlarmSeverity = 'NORMAL' | 'WARNING' | 'CRITICAL';
export type TelemetryChannel = 'temperature' | 'vibration' | 'current' | 'rpm';

export interface AlarmThresholds {
  tempWarning: number;       // °C (default: 45.0, range: 45–60°C)
  tempCritical: number;      // °C (default: 60.0, critical: >60°C)
  vibWarning: number;        // m/s² (default: 1.5, range: 1.5–3.0 m/s²)
  vibCritical: number;       // m/s² (default: 3.0, critical: >3.0 m/s²)
  currentWarning?: number;   // A (default: 2.0, range: 2.0–3.0 A)
  currentCritical?: number;  // A (default: 3.0, critical: >3.0 A)
  ratedRpm?: number;         // Configurable RATED_RPM (default: 1500 RPM)
}

export interface AlarmAudioSettings {
  frequency: number;       // Hz (e.g. 880)
  pulseDurationMs: number; // ms (e.g. 180)
  intervalMs: number;      // ms (e.g. 700)
  volume: number;          // 0.0 - 1.0 (e.g. 0.8)
  soundEnabled: boolean;   // global toggle
  alarmOnWarning?: boolean; // also play audible alert on warning threshold
}

export interface ActiveCriticalAlarm {
  id: string;
  machineId: string;
  machineName?: string;
  channel: TelemetryChannel;
  channelLabel: string;
  currentValue: number;
  threshold: number;
  unit: string;
  timestamp: string;
  severity: 'CRITICAL';
  source?: DataSource;
}

export interface ActiveWarningAlarm {
  id: string;
  machineId: string;
  machineName?: string;
  channel: TelemetryChannel;
  channelLabel: string;
  currentValue: number;
  threshold: number;
  unit: string;
  timestamp: string;
  severity: 'WARNING';
  source?: DataSource;
}

export interface AlarmIncidentRecord {
  id: string;
  machineId: string;
  machineName: string;
  deviceId: string;
  source: string;
  alarmType: string;
  sensorReading: number;
  configuredThreshold: number;
  unit: string;
  severity: 'Critical' | 'Warning';
  timestamp: string;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  isAudioMuted: boolean;
  resolvedAt?: string | null;
}

// ============================================================================
// DIGITAL TWIN DYNAMIC SIMULATION CONFIGURATION
// ============================================================================
export type SimulationMode = 'cycling' | 'increasing' | 'decreasing' | 'harmonic' | 'bearing_fault' | 'random_walk';

export interface MachineSimulationConfig {
  id?: number;
  machine_id: string;
  motor_powered: boolean;
  simulation_mode: SimulationMode;
  update_interval_ms: number;

  // 1. Temperature (°C)
  temp_min: number;
  temp_max: number;
  temp_target: number;
  temp_step: number;
  temp_warning: number;
  temp_critical: number;

  // 2. Motor Current (A)
  current_min: number;
  current_max: number;
  current_target: number;
  current_step: number;
  current_warning: number;
  current_critical: number;

  // 3. RPM (Rotational speed)
  rpm_min: number;
  rpm_max: number;
  rpm_target: number;
  rpm_step: number;
  rpm_rated: number;
  rpm_warning: number;
  rpm_critical: number;

  // 4. Vibration (m/s² RMS)
  vib_min: number;
  vib_max: number;
  vib_target: number;
  vib_step: number;
  vib_warning: number;
  vib_critical: number;

  updated_at?: string;
  created_at?: string;
}

export const DEFAULT_SIMULATION_CONFIG: MachineSimulationConfig = {
  machine_id: 'M001',
  motor_powered: true,
  simulation_mode: 'cycling',
  update_interval_ms: 1000,

  // Temperature (°C)
  temp_min: 22.0,
  temp_max: 45.0,
  temp_target: 32.0,
  temp_step: 0.2,
  temp_warning: 45.0,
  temp_critical: 60.0,

  // Current (A)
  current_min: 0.2,
  current_max: 3.0,
  current_target: 1.2,
  current_step: 0.1,
  current_warning: 2.0,
  current_critical: 3.0,

  // RPM
  rpm_min: 0.0,
  rpm_max: 1800.0,
  rpm_target: 1450.0,
  rpm_step: 50.0,
  rpm_rated: 1500.0,
  rpm_warning: 1050.0,
  rpm_critical: 750.0,

  // Vibration (m/s² RMS)
  vib_min: 0.1,
  vib_max: 5.0,
  vib_target: 0.8,
  vib_step: 0.05,
  vib_warning: 1.5,
  vib_critical: 3.0,
};


