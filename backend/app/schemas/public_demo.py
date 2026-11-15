"""Response schemas for the public, read-only demo API.

These schemas intentionally reuse the existing domain response models
(``MachineResponse``, ``SensorReadingResponse``, ``PredictionResponse``,
``AlertResponse``, ``MaintenanceResponse``) so the demo dashboard consumes the
same contracts as the authenticated dashboard instead of a parallel API shape.

Only fields the demo UI needs are exposed. Tenant identifiers (organization id,
membership, device credentials, technician identifiers) are never part of these
models; list endpoints are wrapped in a pagination envelope.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal

from pydantic import BaseModel, Field

from backend.app.schemas.sensor import (
    AlertResponse,
    DataCollectionStatusResponse,
    FleetStatsResponse,
    MachineResponse,
    MaintenanceResponse,
    ModelStatusResponse,
    PredictionResponse,
    SensorReadingResponse,
)


class DemoDatasetInfo(BaseModel):
    """Honest description of where the demo data comes from."""

    label: str
    organization_name: str
    organization_slug: str
    provenance: Literal["MANUAL_DEMO"] = "MANUAL_DEMO"
    hardware_telemetry: bool = False
    read_only: bool = True
    notice: str


class DemoOverviewResponse(BaseModel):
    mode: Literal["PUBLIC_DEMO"] = "PUBLIC_DEMO"
    dataset: DemoDatasetInfo
    stats: FleetStatsResponse
    generated_at: datetime


class DemoSnapshotResponse(BaseModel):
    """Single read-only snapshot served at ``GET /api/public/demo``.

    Keys are the public demo contract. ``predictions`` and
    ``maintenance_records`` are present even when the dataset has no rows so a
    client never has to distinguish "missing endpoint" from "empty section".
    """

    machines: List[MachineResponse] = Field(default_factory=list)
    sensor_readings: List[SensorReadingResponse] = Field(default_factory=list)
    alerts: List[AlertResponse] = Field(default_factory=list)
    predictions: List[PredictionResponse] = Field(default_factory=list)
    maintenance_records: List[MaintenanceResponse] = Field(default_factory=list)


class DemoMachineListResponse(BaseModel):
    items: List[MachineResponse] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0


class DemoReadingListResponse(BaseModel):
    items: List[SensorReadingResponse] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0


class DemoPredictionListResponse(BaseModel):
    items: List[PredictionResponse] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0


class DemoAlertListResponse(BaseModel):
    items: List[AlertResponse] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0


class DemoMaintenanceListResponse(BaseModel):
    items: List[MaintenanceResponse] = Field(default_factory=list)
    total: int = 0
    limit: int = 0
    offset: int = 0


class DemoDataStatusResponse(DataCollectionStatusResponse):
    """Dashboard data-status contract, explicitly labelled as demo data."""

    provenance: Literal["MANUAL_DEMO"] = "MANUAL_DEMO"
    demo_mode: bool = True


class DemoModelStatusResponse(ModelStatusResponse):
    """Model readiness is platform-wide; this only labels the caller as a demo visitor."""

    demo_mode: bool = True
