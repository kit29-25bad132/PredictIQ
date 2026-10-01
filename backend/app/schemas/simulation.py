"""
Predict IQ - Simulation Configuration Pydantic Schemas
Validates all user-defined digital twin simulation settings (bounds, thresholds, intervals, step sizes).
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel, Field, model_validator, field_validator


class SimulationConfigBase(BaseModel):
    # Motor Power & Simulation Mode
    motor_powered: bool = Field(default=True, description="Motor power state (ON / OFF)")
    simulation_mode: Literal["cycling", "increasing", "decreasing", "harmonic", "bearing_fault", "random_walk"] = Field(
        default="cycling", description="Dynamic simulation algorithm"
    )
    update_interval_ms: int = Field(default=1000, ge=100, le=10000, description="Tick update interval (ms)")

    # 1. Temperature parameters (°C)
    temp_min: float = Field(default=22.0, ge=-50.0, le=300.0, description="Minimum operating temperature (°C)")
    temp_max: float = Field(default=45.0, ge=-50.0, le=300.0, description="Maximum operating temperature (°C)")
    temp_target: float = Field(default=32.0, ge=-50.0, le=300.0, description="Target operating temperature (°C)")
    temp_step: float = Field(default=0.2, gt=0.0, le=50.0, description="Temperature increment per tick (°C)")
    temp_warning: float = Field(default=45.0, ge=-50.0, le=300.0, description="Temperature warning threshold (°C)")
    temp_critical: float = Field(default=60.0, ge=-50.0, le=300.0, description="Temperature critical threshold (°C)")

    # 2. Motor Current parameters (A)
    current_min: float = Field(default=0.2, ge=0.0, le=1000.0, description="Minimum motor current (A)")
    current_max: float = Field(default=3.0, ge=0.0, le=1000.0, description="Maximum safe current limit (A)")
    current_target: float = Field(default=1.2, ge=0.0, le=1000.0, description="Target nominal current (A)")
    current_step: float = Field(default=0.1, gt=0.0, le=100.0, description="Current increment per tick (A)")
    current_warning: float = Field(default=2.0, ge=0.0, le=1000.0, description="Current warning threshold (A)")
    current_critical: float = Field(default=3.0, ge=0.0, le=1000.0, description="Current critical threshold (A)")

    # 3. RPM parameters (RPM)
    rpm_min: float = Field(default=0.0, ge=0.0, le=60000.0, description="Minimum RPM")
    rpm_max: float = Field(default=1800.0, ge=0.0, le=60000.0, description="Maximum physical RPM limit")
    rpm_target: float = Field(default=1450.0, ge=0.0, le=60000.0, description="Target operating RPM")
    rpm_step: float = Field(default=50.0, gt=0.0, le=5000.0, description="RPM increment/decrement per tick")
    rpm_rated: float = Field(default=1500.0, gt=0.0, le=60000.0, description="Nameplate rated RPM")
    rpm_warning: float = Field(default=1050.0, ge=0.0, le=60000.0, description="RPM low-speed warning threshold")
    rpm_critical: float = Field(default=750.0, ge=0.0, le=60000.0, description="RPM critical stall threshold")

    # 4. Vibration parameters (m/s² RMS)
    vib_min: float = Field(default=0.1, ge=0.0, le=100.0, description="Minimum baseline vibration (m/s²)")
    vib_max: float = Field(default=5.0, ge=0.0, le=100.0, description="Maximum allowable vibration (m/s²)")
    vib_target: float = Field(default=0.8, ge=0.0, le=100.0, description="Target baseline vibration (m/s²)")
    vib_step: float = Field(default=0.05, gt=0.0, le=20.0, description="Vibration increment per tick (m/s²)")
    vib_warning: float = Field(default=1.5, ge=0.0, le=100.0, description="Vibration warning threshold (m/s²)")
    vib_critical: float = Field(default=3.0, ge=0.0, le=100.0, description="Vibration critical threshold (m/s²)")

    @field_validator(
        "temp_min", "temp_max", "temp_target", "temp_step", "temp_warning", "temp_critical",
        "current_min", "current_max", "current_target", "current_step", "current_warning", "current_critical",
        "rpm_min", "rpm_max", "rpm_target", "rpm_step", "rpm_rated", "rpm_warning", "rpm_critical",
        "vib_min", "vib_max", "vib_target", "vib_step", "vib_warning", "vib_critical"
    )
    @classmethod
    def check_finite(cls, v: float, info) -> float:
        if math.isnan(v) or math.isinf(v):
            raise ValueError(f"Field '{info.field_name}' must be a finite numerical value, got {v}")
        return v

    @model_validator(mode="after")
    def validate_bounds(self) -> "SimulationConfigBase":
        # Temperature bounds
        if self.temp_min >= self.temp_max:
            raise ValueError(f"temp_min ({self.temp_min}°C) must be strictly less than temp_max ({self.temp_max}°C)")
        if self.temp_target < self.temp_min or self.temp_target > self.temp_max:
            raise ValueError(f"temp_target ({self.temp_target}°C) must be within [{self.temp_min}, {self.temp_max}]")
        if self.temp_warning >= self.temp_critical:
            raise ValueError(f"temp_warning ({self.temp_warning}°C) must be strictly less than temp_critical ({self.temp_critical}°C)")

        # Current bounds
        if self.current_min >= self.current_max:
            raise ValueError(f"current_min ({self.current_min}A) must be strictly less than current_max ({self.current_max}A)")
        if self.current_target < self.current_min or self.current_target > self.current_max:
            raise ValueError(f"current_target ({self.current_target}A) must be within [{self.current_min}, {self.current_max}]")
        if self.current_warning >= self.current_critical:
            raise ValueError(f"current_warning ({self.current_warning}A) must be strictly less than current_critical ({self.current_critical}A)")

        # RPM bounds
        if self.rpm_min >= self.rpm_max:
            raise ValueError(f"rpm_min ({self.rpm_min}) must be strictly less than rpm_max ({self.rpm_max})")
        if self.rpm_target < self.rpm_min or self.rpm_target > self.rpm_max:
            raise ValueError(f"rpm_target ({self.rpm_target}) must be within [{self.rpm_min}, {self.rpm_max}]")
        if self.rpm_critical >= self.rpm_warning:
            raise ValueError(f"rpm_critical ({self.rpm_critical}) must be strictly less than rpm_warning ({self.rpm_warning})")

        # Vibration bounds
        if self.vib_min >= self.vib_max:
            raise ValueError(f"vib_min ({self.vib_min}) must be strictly less than vib_max ({self.vib_max})")
        if self.vib_target < self.vib_min or self.vib_target > self.vib_max:
            raise ValueError(f"vib_target ({self.vib_target}) must be within [{self.vib_min}, {self.vib_max}]")
        if self.vib_warning >= self.vib_critical:
            raise ValueError(f"vib_warning ({self.vib_warning}) must be strictly less than vib_critical ({self.vib_critical})")

        return self


class SimulationConfigUpdate(SimulationConfigBase):
    pass


class SimulationConfigResponse(SimulationConfigBase):
    id: Optional[int] = None
    machine_id: str
    updated_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SimulationTickPayload(BaseModel):
    temperature: float
    current: float
    rpm: float
    vibration: float
    motor_powered: bool
    status_temp: Literal["NORMAL", "WARNING", "CRITICAL"]
    status_current: Literal["NORMAL", "WARNING", "CRITICAL"]
    status_rpm: Literal["NORMAL", "WARNING", "CRITICAL"]
    status_vibration: Literal["NORMAL", "WARNING", "CRITICAL"]
    timestamp: str
    machine_id: str
