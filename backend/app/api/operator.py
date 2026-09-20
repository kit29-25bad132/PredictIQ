"""
Predict IQ - Operator Browser-Write Endpoints

Dedicated namespace for browser/operator-initiated writes, authenticated via
signed HttpOnly session cookie (see ``app/core/auth.py``).

These endpoints reuse the exact same business logic as the device-facing
endpoints but swap the authentication gate: ``require_operator_session``
instead of ``require_api_key``.

The existing device endpoints (``/api/sensor-data``, ``/api/machines``,
``/api/maintenance``, ``/api/feedback``, ``/api/alerts/*``) remain untouched
and continue to require ``X-API-Key``.

Device-only endpoints (heartbeat) are intentionally NOT exposed here.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.auth import require_operator_session
from backend.app.db.database import get_db
from backend.app.schemas.sensor import (
    MachineCreate,
    MachineResponse,
    SensorDataInput,
    SensorDataResponse,
    MaintenanceCreate,
    MaintenanceResponse,
    FeedbackCreate,
    FeedbackResponse,
    AlertResponse,
    DeviceCreate,
)

from backend.app.api.machines import create_machine, register_device
from backend.app.api.sensors import ingest_sensor_data
from backend.app.api.maintenance import create_maintenance
from backend.app.api.feedback import create_feedback
from backend.app.api.alerts import acknowledge_alert, resolve_alert

router = APIRouter(tags=["Operator Browser Writes"])

_AUTH = Depends(require_operator_session)


# ---------------------------------------------------------------------------
# Machine registration
# ---------------------------------------------------------------------------
@router.post(
    "/machines",
    response_model=MachineResponse,
    status_code=201,
    summary="Register a new machine asset (browser operator)",
    dependencies=[_AUTH],
)
def operator_create_machine(
    data: MachineCreate,
    db: Session = Depends(get_db),
):
    return create_machine(data, db)


# ---------------------------------------------------------------------------
# Device registration (browser operator)
# ---------------------------------------------------------------------------
@router.post(
    "/devices",
    status_code=201,
    summary="Register an ESP32 device to a machine (browser operator)",
    dependencies=[_AUTH],
)
def operator_register_device(
    payload: DeviceCreate,
    db: Session = Depends(get_db),
):
    return register_device(payload, db)


# ---------------------------------------------------------------------------
# Sensor data ingestion (browser operator)
# ---------------------------------------------------------------------------
@router.post(
    "/sensor-data",
    response_model=SensorDataResponse,
    status_code=201,
    summary="Submit sensor telemetry (browser operator)",
    dependencies=[_AUTH],
)
def operator_ingest_sensor_data(
    payload: SensorDataInput,
    db: Session = Depends(get_db),
):
    return ingest_sensor_data(payload, db)


# ---------------------------------------------------------------------------
# Maintenance records
# ---------------------------------------------------------------------------
@router.post(
    "/maintenance",
    response_model=MaintenanceResponse,
    status_code=201,
    summary="Log maintenance record (browser operator)",
    dependencies=[_AUTH],
)
def operator_create_maintenance(
    payload: MaintenanceCreate,
    db: Session = Depends(get_db),
):
    return create_maintenance(payload, db)


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------
@router.post(
    "/feedback",
    response_model=FeedbackResponse,
    status_code=201,
    summary="Record technician feedback (browser operator)",
    dependencies=[_AUTH],
)
def operator_create_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
):
    return create_feedback(payload, db)


# ---------------------------------------------------------------------------
# Alert actions
# ---------------------------------------------------------------------------
@router.post(
    "/alerts/{alert_id}/acknowledge",
    response_model=AlertResponse,
    summary="Acknowledge an alert (browser operator)",
    dependencies=[_AUTH],
)
def operator_acknowledge_alert(
    alert_id: int,
    db: Session = Depends(get_db),
):
    return acknowledge_alert(alert_id, db)


@router.post(
    "/alerts/{alert_id}/resolve",
    response_model=AlertResponse,
    summary="Resolve an alert (browser operator)",
    dependencies=[_AUTH],
)
def operator_resolve_alert(
    alert_id: int,
    db: Session = Depends(get_db),
):
    return resolve_alert(alert_id, db)
