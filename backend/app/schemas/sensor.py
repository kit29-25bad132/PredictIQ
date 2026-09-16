"""
Predict IQ - Pydantic Request & Response Schemas (PostgreSQL Architecture)
Validates real IoT sensor telemetry, machine asset profiles, ESP32 devices,
maintenance records, and alerts. Strictly rejects invalid, NaN, or infinite numbers.
"""

from __future__ import annotations

from typing import List, Optional, Literal, Dict, Any
from datetime import datetime, timezone
import math
from pydantic import BaseModel, Field, field_validator, model_validator

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
    explanation: Optional[str] = None
    recommended_action: Optional[str] = None
    model_version: Optional[str] = None
    is_prototype: bool = True
    feature_importance: Dict[str, float] = Field(default_factory=dict)
    contributing_factors: List[Dict[str, Any]] = Field(default_factory=list)
    reasons: List[str] = Field(default_factory=list)
    prediction_available: bool = True
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PredictionAnalyzeRequest(BaseModel):
    """Request for external-AI analysis: identity only, never telemetry values.

    The analyzed telemetry is always the latest REAL database reading for the
    exact device+machine pair; accepting values here would bypass that rule.
    """

    device_id: str = Field(..., min_length=1, max_length=100, example="ESP32_001")
    machine_id: str = Field(..., min_length=1, max_length=50, example="TEST-001")


class PredictionAnalyzeResponse(BaseModel):
    """Validated external-AI assessment persisted with full provenance."""

    id: int
    machine_id: str
    device_id: str
    timestamp: datetime  # the analyzed telemetry's exact timestamp
    failure_probability: float
    health_status: str
    likely_component: str
    severity: str
    explanation: str
    recommended_action: str
    confidence: float
    model_version: str  # 'gemini:<actual-model>'
    source: str  # 'external_ai'
    provider: str  # 'gemini'
    input_timestamp: datetime
    inference_input_hash: str  # SHA-256 of the real inference input
    created_at: Optional[datetime] = None


class PredictionInput(BaseModel):
    machine_id: str = Field(..., min_length=1, max_length=50)
    temperature: float = Field(..., ge=-50, le=300)
    vibration: float = Field(..., ge=0, le=100)
    current: float = Field(..., ge=0, le=1000)
    rpm: float = Field(..., ge=0, le=60000)

    @field_validator("temperature", "vibration", "current", "rpm")
    @classmethod
    def validate_finite_prediction_features(cls, value: float, info) -> float:
        if not math.isfinite(value):
            raise ValueError(f"Prediction field '{info.field_name}' must be finite")
        return value

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
# 6b. FEEDBACK / GROUND-TRUTH SCHEMAS
# ============================================================================
class FeedbackCreate(BaseModel):
    machine_id: str = Field(..., min_length=1, max_length=50)
    prediction_id: Optional[int] = Field(default=None, description="Links to a persisted prediction for prediction-vs-reality tracking")
    alert_id: Optional[int] = Field(default=None, description="Links to the originating alert, if any")
    maintenance_record_id: Optional[int] = Field(default=None, description="Links to the associated maintenance work order, if any")
    observed_condition: str = Field(..., min_length=1, description="Technician-observed equipment condition at inspection")
    actual_fault: Optional[str] = Field(default=None, max_length=200, description="Confirmed root-cause fault (e.g. Bearing spalling)")
    root_cause: Optional[str] = Field(default=None, description="Identified root cause of the fault")
    symptoms: Optional[str] = Field(default=None, description="Observed symptoms matching alert/prediction")
    action_taken: Optional[str] = Field(default=None, description="Maintenance action actually performed")
    parts_replaced: Optional[str] = Field(default=None, description="Parts replaced during the action")
    severity: str = Field(default="Warning", description="Critical, Warning, or Info")
    outcome: str = Field(default="Confirmed", description="Confirmed, Not Confirmed, or Cancelled")
    technician_notes: Optional[str] = Field(default=None, description="Free-form technician notes")
    prediction_correct: Optional[bool] = Field(default=None, description="Whether the linked prediction matched the actual fault")
    feedback_source: str = Field(default="MANUAL", description="MANUAL or INSPECTION")

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        allowed = {"Critical", "Warning", "Info"}
        if v not in allowed:
            raise ValueError(f"severity must be one of {allowed}, got {v!r}")
        return v

    @field_validator("outcome")
    @classmethod
    def validate_outcome(cls, v: str) -> str:
        allowed = {"Confirmed", "Not Confirmed", "Cancelled"}
        if v not in allowed:
            raise ValueError(f"outcome must be one of {allowed}, got {v!r}")
        return v

    @field_validator("feedback_source")
    @classmethod
    def validate_feedback_source(cls, v: str) -> str:
        allowed = {"MANUAL", "INSPECTION"}
        if v not in allowed:
            raise ValueError(f"feedback_source must be one of {allowed}, got {v!r}")
        return v

    @model_validator(mode="after")
    def validate_prediction_link(self) -> "FeedbackCreate":
        if self.prediction_correct is True and self.prediction_id is None:
            raise ValueError("prediction_correct=True requires a prediction_id link")
        return self


class FeedbackResponse(BaseModel):
    id: int
    machine_id: str
    prediction_id: Optional[int] = None
    alert_id: Optional[int] = None
    maintenance_record_id: Optional[int] = None
    observed_condition: str
    actual_fault: Optional[str] = None
    root_cause: Optional[str] = None
    symptoms: Optional[str] = None
    action_taken: Optional[str] = None
    parts_replaced: Optional[str] = None
    severity: str
    outcome: str
    technician_notes: Optional[str] = None
    prediction_correct: Optional[bool] = None
    feedback_source: str
    created_at: datetime

    class Config:
        from_attributes = True


class FeedbackListEntry(BaseModel):
    id: int
    machine_id: str
    prediction_id: Optional[int] = None
    alert_id: Optional[int] = None
    maintenance_record_id: Optional[int] = None
    observed_condition: str
    actual_fault: Optional[str] = None
    root_cause: Optional[str] = None
    symptoms: Optional[str] = None
    action_taken: Optional[str] = None
    parts_replaced: Optional[str] = None
    severity: str
    outcome: str
    technician_notes: Optional[str] = None
    prediction_correct: Optional[bool] = None
    feedback_source: str
    created_at: datetime

    class Config:
        from_attributes = True

# ============================================================================
# 6c. MODEL EVALUATION / GOVERNED ML STATUS SCHEMAS (Phase 6)
# ============================================================================

class ModelMetricsResponse(BaseModel):
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1: Optional[float] = None
    confusion_matrix: Optional[Dict[str, Any]] = None
    support: Optional[int] = None


class ModelStatusResponse(BaseModel):
    source: str = Field(default="prototype")
    trained: bool = Field(default=False)
    evaluated: bool = Field(default=False)
    model_version: Optional[str] = Field(default="physics-rule-v1")
    status: str = Field(default="Prototype physics engine active")
    message: str = Field(default="")
    dataset_version: Optional[str] = None
    features: Optional[List[str]] = None
    metrics: Optional[ModelMetricsResponse] = None
    eval_date: Optional[datetime] = None
    deployment_status: Optional[str] = None
    dataset_size: Optional[int] = None
    evaluation_dataset_size: Optional[int] = None

    @field_validator("metrics", mode="before")
    @classmethod
    def validate_metrics(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, dict):
            for key in ("accuracy", "precision", "recall", "f1"):
                number = value.get(key)
                if number is not None and (not isinstance(number, (int, float)) or math.isnan(float(number)) or math.isinf(float(number))):
                    raise ValueError(f"Evaluation metric '{key}' must be finite, got {number!r}")
        return value


class ModelTrainRequest(BaseModel):
    dataset_version: str = Field(default="feedback-v1", min_length=1, max_length=100)
    test_size: float = Field(default=0.25, ge=0.1, le=0.5)
    random_state: int = Field(default=42)


class ModelTrainResponse(BaseModel):
    success: bool
    refusal: Optional[str] = None
    message: str
    model_version: Optional[str] = None
    dataset_version: Optional[str] = None
    metrics: Optional[ModelMetricsResponse] = None
    dataset_size: Optional[int] = None
    train_dataset_size: Optional[int] = None
    evaluation_dataset_size: Optional[int] = None
    labeled_count: Optional[int] = None
    positive_count: Optional[int] = None
    negative_count: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class ModelEvaluationResponse(BaseModel):
    evaluated: bool
    reason: Optional[str] = None
    message: str
    ground_truth_count: int = 0
    evaluated_count: int = 0
    correct_count: int = 0
    incorrect_count: int = 0
    prototype_accuracy: Optional[float] = None
    labeled_count: int = 0
    positive_count: int = 0
    negative_count: int = 0
    excluded_ambiguous_label: int = 0
    excluded_non_finite: int = 0
    excluded_unknown_outcome: int = 0
    model_status: ModelStatusResponse


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
