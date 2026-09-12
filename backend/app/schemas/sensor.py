"""
Predict IQ - Pydantic Request & Response Schemas (PostgreSQL Architecture)
Validates real IoT sensor telemetry, machine asset profiles, ESP32 devices,
maintenance records, and alerts. Strictly rejects invalid, NaN, or infinite numbers.
"""

from __future__ import annotations

from typing import List, Optional, Literal, Dict, Any
from datetime import datetime, timezone
import math
from pydantic import BaseModel, Field, field_validator

# ============================================================================
# 1. SENSOR TELEMETRY SCHEMAS
# ============================================================================

class SensorDataInput(BaseModel):
    device_id: str = Field(..., example="ESP32_001", min_length=1, max_length=100, description="Unique ESP32 Node ID")
    machine_id: str = Field(..., example="M001", min_length=1, max_length=50, description="Unique Machine Asset ID")
    timestamp: datetime = Field(..., description="Observation timestamp")
    temperature: Optional[float] = Field(default=None, example=72.4, description="Temperature in Celsius (°C)")
    vibration: Optional[float] = Field(default=None, example=3.8, description="Vibration velocity RMS in mm/s")
    current: Optional[float] = Field(default=None, example=8.7, description="Phase current in Amperes (A)")
    rpm: Optional[float] = Field(default=None, example=1450.0, description="Rotational speed in RPM")
    source: Literal["WOKWI", "REAL_HARDWARE"] = Field(..., example="REAL_HARDWARE")

    @field_validator("temperature", "vibration", "current", "rpm")
    @classmethod
    def validate_finite_numbers(cls, v: Optional[float], info) -> Optional[float]:
        if v is not None and (math.isnan(v) or math.isinf(v)):
            raise ValueError(f"Sensor field '{info.field_name}' must be a finite numerical value, got {v}")
        return v

    @field_validator("temperature")
    @classmethod
    def validate_temp_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v < -50.0 or v > 300.0):
            raise ValueError(f"Temperature value {v}°C is out of allowable physical range [-50, 300]")
        return v

    @field_validator("vibration")
    @classmethod
    def validate_vib_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v < 0.0 or v > 100.0):
            raise ValueError(f"Vibration value {v} mm/s RMS cannot be negative or exceed 100 mm/s")
        return v

    @field_validator("current")
    @classmethod
    def validate_current_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v < 0.0 or v > 1000.0):
            raise ValueError(f"Current value {v} A cannot be negative or exceed 1000 A")
        return v

    @field_validator("rpm")
    @classmethod
    def validate_rpm_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and (v < 0.0 or v > 60000.0):
            raise ValueError(f"RPM value {v} cannot be negative or exceed 60,000 RPM")
        return v

class SensorDataResponse(BaseModel):
    success: bool = Field(default=True, example=True)
    id: int = Field(..., example=1)

class SensorReadingResponse(BaseModel):
    id: int
    machine_id: str
    device_id: str
    timestamp: datetime
    temperature: Optional[float] = None
    vibration: Optional[float] = None
    current: Optional[float] = None
    rpm: Optional[float] = None
    source: str
    created_at: datetime

    class Config:
        from_attributes = True

class MachineSensorDataListResponse(BaseModel):
    data: List[SensorReadingResponse] = []
    message: Optional[str] = None
    count: int = 0

# ============================================================================
# 2. DEVICE SCHEMAS (ESP32 IoT Nodes)
# ============================================================================

class DeviceCreate(BaseModel):
    device_id: str = Field(..., example="ESP32_001")
    machine_id: str = Field(..., example="M001")
    device_type: Optional[str] = Field(default="ESP32", example="ESP32")
    firmware_version: Optional[str] = Field(default="1.0.0", example="1.0.0")

class DeviceHeartbeatInput(BaseModel):
    device_id: str = Field(..., example="ESP32_001")
    machine_id: str = Field(..., example="M001")
    device_type: Optional[str] = Field(default="ESP32", example="ESP32")
    firmware_version: Optional[str] = Field(default="1.0.0", example="1.0.0")
    source: Literal["WOKWI", "REAL_HARDWARE"] = Field(..., example="WOKWI")
    timestamp: Optional[datetime] = Field(default_factory=lambda: datetime.now(timezone.utc))
    temperature_status: Optional[str] = Field(default="NOT_CONFIGURED", example="NOT_CONFIGURED")
    vibration_status: Optional[str] = Field(default="NOT_CONFIGURED", example="NOT_CONFIGURED")
    current_status: Optional[str] = Field(default="NOT_CONFIGURED", example="NOT_CONFIGURED")
    rpm_status: Optional[str] = Field(default="NOT_CONFIGURED", example="NOT_CONFIGURED")

class DeviceHeartbeatResponse(BaseModel):
    success: bool = True
    message: str = "Heartbeat acknowledged"
    device_id: str
    machine_id: str
    status: str  # ONLINE / OFFLINE
    last_seen: datetime

class DeviceResponse(BaseModel):
    id: Optional[int] = None
    device_id: str
    machine_id: str
    device_type: str
    firmware_version: str
    status: str  # CONNECTED / OFFLINE
    last_seen: Optional[datetime] = None
    source: str = "REAL_HARDWARE"
    created_at: datetime

    class Config:
        from_attributes = True

class DeviceStatusDetailResponse(BaseModel):
    device_id: str
    machine_id: str
    device_type: str
    firmware_version: str
    status: str  # CONNECTED / OFFLINE
    last_seen: Optional[datetime] = None
    temperature_status: str = "NOT_CONFIGURED"
    vibration_status: str = "NOT_CONFIGURED"
    current_status: str = "NOT_CONFIGURED"
    rpm_status: str = "NOT_CONFIGURED"
    last_reading: Optional[SensorReadingResponse] = None

# ============================================================================
# 3. MACHINE ASSET SCHEMAS
# ============================================================================

class MachineCreate(BaseModel):
    machine_id: str = Field(..., example="M001")
    name: str = Field(..., example="Hydraulic Pump Alpha")
    type: str = Field(..., example="Centrifugal Pump")
    location: str = Field(..., example="Bay 3 - Fluid Systems")
    status: Optional[str] = Field(default="Healthy", example="Healthy")
    specifications: Optional["MachineSpecifications"] = None

class MachineSpecifications(BaseModel):
    rated_rpm: Optional[float] = Field(default=None, alias="ratedRPM", ge=0, le=60000)
    rated_current: Optional[float] = Field(default=None, alias="ratedCurrent", ge=0, le=1000)
    max_temp: Optional[float] = Field(default=None, alias="maxTemp", ge=-50, le=300)
    max_vibration: Optional[float] = Field(default=None, alias="maxVibration", ge=0, le=100)

    model_config = {"populate_by_name": True}

class MachineResponse(BaseModel):
    id: Optional[int] = None
    machine_id: str
    name: str
    type: str
    location: str
    status: str
    specifications: Optional[MachineSpecifications] = None
    created_at: datetime
    devices: Optional[List[DeviceResponse]] = None
    latest_reading: Optional[SensorReadingResponse] = None

    class Config:
        from_attributes = True

# ============================================================================
# 4. MAINTENANCE & GROUND-TRUTH RECORD SCHEMAS
# ============================================================================

class MaintenanceCreate(BaseModel):
    machine_id: str = Field(..., example="M001")
    component: str = Field(..., example="Bearing")
    failure_type: Optional[str] = Field(default=None, example="Subsurface Fatigue Spalling")
    issue_description: str = Field(..., example="Elevated vibration and race temperature")
    maintenance_action: str = Field(..., example="Replaced drive-end spherical roller bearing and seal")
    technician: str = Field(..., example="David Zhang")
    status: Optional[str] = Field(default="Scheduled", example="Completed")
    failure_date: Optional[datetime] = Field(default=None)
    maintenance_date: Optional[datetime] = Field(default_factory=lambda: datetime.now(timezone.utc))

class MaintenanceResponse(BaseModel):
    id: int
    machine_id: str
    component: str
    failure_type: Optional[str] = None
    issue_description: str
    maintenance_action: str
    technician: str
    status: str
    failure_date: Optional[datetime] = None
    maintenance_date: datetime
    created_at: datetime

    class Config:
        from_attributes = True

# ============================================================================
# 5. PREDICTION & AI STATUS SCHEMAS (Real-Data Architecture)
# ============================================================================

class AIModelStatusResponse(BaseModel):
    status: str = Field(default="Waiting for real historical data", example="Waiting for real historical data")
    prediction: str = Field(default="Not available", example="Not available")
    remaining_useful_life: str = Field(default="Not available", example="Not available")
    confidence: str = Field(default="Not available", example="Not available")
    trained_model_exists: bool = Field(default=False, example=False)
    message: str = Field(
        default="Predictive model training will occur once sufficient real historical sensor and failure data is collected in PostgreSQL.",
        example="Predictive model training will occur once sufficient real historical sensor and failure data is collected in PostgreSQL."
    )

class PredictionResponse(BaseModel):
    id: Optional[int] = None
    machine_id: str
    timestamp: datetime
    failure_probability: Optional[float] = None
    component: Optional[str] = None
    remaining_life_days: Optional[int] = None
    confidence: Optional[float] = None
    explanation: Optional[str] = None
    recommended_action: Optional[str] = None
    model_version: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ============================================================================
# 6. ALERT SCHEMAS
# ============================================================================

class AlertResponse(BaseModel):
    id: int
    machine_id: str
    alert_type: str
    severity: str
    message: str
    status: str
    created_at: datetime
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ============================================================================
# 7. DATA COLLECTION STATUS & FLEET STATS SCHEMAS
# ============================================================================

class DataCollectionStatusResponse(BaseModel):
    sensor_status: str = Field(..., example="ONLINE")  # ONLINE / OFFLINE
    last_reading: Optional[datetime] = None
    total_readings: int = Field(default=0, example=150)
    data_collection: str = Field(default="ACTIVE", example="ACTIVE")  # ACTIVE / WAITING
    active_devices_count: int = Field(default=0, example=1)
    message: str = Field(default="Data collection active", example="Data collection active")

class FleetStatsResponse(BaseModel):
    total_machines: int = 0
    total_devices: int = 0
    connected_devices: int = 0
    total_sensor_readings: int = 0
    total_maintenance_records: int = 0
    active_alerts: int = 0
    data_collection_status: str = "WAITING"
