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
  shap_value: number; // relative attribution
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
