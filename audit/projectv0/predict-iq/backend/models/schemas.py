"""
Predict IQ - Industrial AI Predictive Maintenance Platform
Data Models & Pydantic Schemas
"""

from typing import List, Optional, Literal, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field

class SensorReadingBase(BaseModel):
    machine_id: str = Field(..., description="Target Machine ID, e.g. M001")
    temperature: float = Field(..., description="Operating temperature in degrees Celsius (°C)")
    vibration: float = Field(..., description="Vibration velocity RMS in mm/s or g")
    current: float = Field(..., description="Drawn phase current in Amperes (A)")
    rpm: float = Field(..., description="Rotational speed in Revolutions Per Minute (RPM)")
    source: Optional[Literal["DEMO", "ESP32", "MANUAL"]] = "MANUAL"
    esp32_token: Optional[str] = None

class SensorReadingCreate(SensorReadingBase):
    pass

class SensorReadingResponse(SensorReadingBase):
    id: str
    timestamp: datetime
    raw_payload: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class ContributingFactor(BaseModel):
    factor: str
    impact: str # "Critical", "Very High", "High", "Above Normal", "Normal", "Low"
    shap_value: float # relative attribution weight
    value_observed: str
    threshold_reference: str
    description: str

class PredictionResponse(BaseModel):
    machine_id: str
    failure_probability: float = Field(..., description="Estimated failure probability (0.0 to 1.0)")
    component: str = Field(..., description="Most critical failing component")
    remaining_life_days: int = Field(..., description="Remaining Useful Life (RUL) in days")
    confidence: float = Field(..., description="Model confidence score (0.0 to 1.0)")
    reasons: List[str] = Field(..., description="Key driving diagnostic symptoms")
    contributing_factors: Optional[List[ContributingFactor]] = None
    explanation: str = Field(..., description="Human-readable plain English explanation for field technicians")
    recommended_action: str = Field(..., description="Actionable maintenance guidance")
    anomaly_level: Optional[str] = "Normal"
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class MachineBase(BaseModel):
    machine_id: str
    name: str
    type: str
    location: str
    status: Literal["Healthy", "Warning", "Critical", "Maintenance"] = "Healthy"
    rated_rpm: Optional[float] = 1450.0
    rated_current: Optional[float] = 10.0
    max_temp: Optional[float] = 75.0
    max_vibration: Optional[float] = 4.5

class MachineCreate(MachineBase):
    pass

class MachineResponse(MachineBase):
    last_updated: datetime
    current_reading: Optional[SensorReadingResponse] = None
    latest_prediction: Optional[PredictionResponse] = None
    esp32_online: Optional[bool] = False

    class Config:
        from_attributes = True

class MaintenanceCreate(BaseModel):
    machine_id: str
    issue: str
    action: str
    technician: str
    status: Literal["Completed", "In Progress", "Scheduled"] = "Scheduled"
    notes: Optional[str] = None
    downtime_hours: Optional[float] = 0.0

class MaintenanceResponse(MaintenanceCreate):
    id: str
    date: datetime

    class Config:
        from_attributes = True

class AlertResponse(BaseModel):
    id: str
    machine_id: str
    machine_name: str
    timestamp: datetime
    alert_type: str
    severity: Literal["Critical", "Warning", "Info"]
    metric: str
    value: float
    threshold: float
    recommended_action: str
    acknowledged: bool = False
    resolved: bool = False

    class Config:
        from_attributes = True

class HealthResponse(BaseModel):
    status: str
    system: str
    version: str
    timestamp: datetime
    connected_esp32_devices: int
    active_machines: int
