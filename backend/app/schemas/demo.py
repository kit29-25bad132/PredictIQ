"""Schemas for controlled MANUAL_DEMO sessions and ingestion.

A demo session owns a dedicated demo machine. Demo readings never carry a
device id and are never accepted by the device ingestion schema, so they can
never impersonate WOKWI or REAL_HARDWARE provenance.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from backend.app.schemas.sensor import SensorChannelFields


class DemoSessionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, example="Bearing fault demo")
    machine_label: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Display name for the dedicated demo machine",
        example="Demo Rig 1",
    )


class DemoSessionMachine(BaseModel):
    machine_id: str
    name: str
    status: str
    is_demo: bool = True


class DemoSessionCounts(BaseModel):
    readings: int = 0
    alerts: int = 0
    predictions: int = 0


class DemoSessionResponse(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    machine: DemoSessionMachine
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    closed_at: Optional[datetime] = None
    counts: DemoSessionCounts = Field(default_factory=DemoSessionCounts)


class ManualDemoInput(SensorChannelFields):
    """Manual demo reading.

    ``extra="forbid"`` rejects any attempt to smuggle ``device_id``, ``source``
    or ``demo_session_id`` in the body: the session (from the path) and the
    source (MANUAL_DEMO) are server-derived only.
    """

    model_config = {"extra": "forbid"}

    timestamp: Optional[datetime] = Field(
        default=None, description="Observation timestamp (defaults to now, UTC)"
    )
    note: Optional[str] = Field(default=None, max_length=500, description="Free-form demo note")

    @model_validator(mode="after")
    def require_at_least_one_channel(self):
        if all(
            value is None
            for value in (self.temperature, self.vibration, self.current, self.rpm)
        ):
            raise ValueError("At least one sensor channel must be provided.")
        return self


class ManualDemoResponse(BaseModel):
    success: bool = True
    id: int
    source: str = "MANUAL_DEMO"
    demo_session_id: uuid.UUID
    machine_id: str
    timestamp: datetime


class DemoResetRequest(BaseModel):
    model_config = {"extra": "forbid"}

    confirm: bool = Field(..., description="Must be true to confirm the destructive reset")
    confirm_session_name: str = Field(
        ..., min_length=1, max_length=120, description="Exact session name as confirmation"
    )


class DemoResetDeleted(BaseModel):
    readings: int = 0
    alerts: int = 0
    predictions: int = 0


class DemoResetResponse(BaseModel):
    success: bool = True
    demo_session_id: uuid.UUID
    deleted: DemoResetDeleted
