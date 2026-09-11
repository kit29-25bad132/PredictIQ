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
  remaining_life_days?: number | null;
  confidence?: number | null;
  explanation?: string | null;
  recommended_action?: string | null;
  model_version?: string | null;
  status?: string;
  trained_model_exists?: boolean;
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
