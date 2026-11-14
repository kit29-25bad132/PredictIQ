"""Predict IQ - Public, read-only demo API.

Contract
--------
``GET /api/public/demo/*`` is the only unauthenticated data surface. It exists
so the landing page's "Explore Demo" experience can read a dedicated simulated
dataset without creating a Supabase session, a fake membership, or any write
path.

Security model
--------------
* No Supabase JWT, operator cookie, or device API key is required - and none is
  consulted. These routes never call ``require_org_member`` or relax it.
* The tenant is resolved from the fixed demo organization (UUID + slug). No
  organization identifier is accepted from the caller; supplying one is a 400.
* Every machine is validated against the demo dataset; unknown and
  non-demo machine IDs are a uniform 404.
* Read-only: only GET routes are registered. Writes answer 405.
* Only columns required by the dashboard are projected through the existing
  response schemas. Organization ids, memberships, devices, credentials and
  technician identities are never returned.
* Rate limited per client IP (``public_demo_rate_limit_*`` settings), and
  database failures are reduced to a generic 503.

The authenticated API is untouched: ``/api/machines`` and friends still require
a verified Supabase user and an active organization membership.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import desc, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.api.predictions import response_from_prediction
from backend.app.core.config import get_settings
from backend.app.core.public_demo import (
    PUBLIC_DEMO_DATASET_LABEL,
    PUBLIC_DEMO_NOTICE,
    PUBLIC_DEMO_ORGANIZATION_NAME,
    PUBLIC_DEMO_ORGANIZATION_SLUG,
    PUBLIC_DEMO_PROVENANCE,
    reject_organization_selector,
    resolve_public_demo_organization,
)
from backend.app.core.rate_limit import SlidingWindowRateLimiter
from backend.app.db.database import get_db
from backend.app.db.models import (
    Alert,
    Machine,
    MaintenanceRecord,
    Organization,
    Prediction,
    SensorReading,
)
from backend.app.schemas.public_demo import (
    DemoAlertListResponse,
    DemoDataStatusResponse,
    DemoDatasetInfo,
    DemoMachineListResponse,
    DemoMaintenanceListResponse,
    DemoModelStatusResponse,
    DemoOverviewResponse,
    DemoPredictionListResponse,
    DemoReadingListResponse,
)
from backend.app.schemas.sensor import (
    AlertResponse,
    FleetStatsResponse,
    MachineResponse,
    MachineSpecifications,
    MaintenanceResponse,
    SensorReadingResponse,
)
from backend.app.services.prediction_service import prediction_service

_RATE_LIMITER: Optional[SlidingWindowRateLimiter] = None


def get_rate_limiter() -> SlidingWindowRateLimiter:
    """Lazy singleton so settings (and tests) are read at first use."""
    global _RATE_LIMITER
    if _RATE_LIMITER is None:
        settings = get_settings()
        _RATE_LIMITER = SlidingWindowRateLimiter(
            settings.public_demo_rate_limit_requests,
            settings.public_demo_rate_limit_window_seconds,
        )
    return _RATE_LIMITER


def reset_rate_limiter() -> None:
    """Test hook: drop the current limiter so the next call rebuilds it."""
    global _RATE_LIMITER
    _RATE_LIMITER = None


def enforce_public_demo_guard(request: Request, response: Response) -> None:
    """Reject tenant selectors and apply the per-client rate limit."""
    reject_organization_selector(request.query_params)

    limiter = get_rate_limiter()
    client = request.client.host if request.client else "unknown"
    allowed, remaining, retry_after = limiter.check(client)
    response.headers["X-RateLimit-Limit"] = str(limiter.max_requests)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many public demo requests. Please retry shortly.",
            headers={"Retry-After": str(retry_after)},
        )


# The guard (tenant-selector rejection + rate limiting) is declared on the
# router itself so every route inherits it; FastAPI snapshots router
# dependencies when routes are declared, so the router is created here.
router = APIRouter(
    prefix="/public/demo",
    tags=["Public Demo (read-only)"],
    dependencies=[Depends(enforce_public_demo_guard)],
)

LIMIT_QUERY = Query(default=50, ge=1, le=200, description="Page size (max 200)")
OFFSET_QUERY = Query(default=0, ge=0, le=5000, description="Rows to skip")


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="The public demo dataset is temporarily unavailable.",
    )


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Demo machine not found.",
    )


def _demo_organization(db: Session) -> Organization:
    org = resolve_public_demo_organization(db)
    if org is None or org.status != "active":
        # Fail closed: never fall back to production data.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The public demo dataset is not available on this deployment.",
        )
    return org


def _demo_machine(db: Session, org: Organization, machine_id: str) -> Machine:
    machine = (
        db.query(Machine)
        .filter(
            Machine.organization_id == org.id,
            Machine.is_demo.is_(True),
            Machine.machine_id == machine_id,
        )
        .first()
    )
    if machine is None:
        # Uniform non-disclosing 404 for unknown AND non-demo identifiers.
        raise _not_found()
    return machine


def _latest_demo_reading(
    db: Session, org: Organization, machine_id: str
) -> Optional[SensorReading]:
    return (
        db.query(SensorReading)
        .filter(
            SensorReading.organization_id == org.id,
            SensorReading.machine_id == machine_id,
            SensorReading.source == PUBLIC_DEMO_PROVENANCE,
        )
        .order_by(desc(SensorReading.timestamp), desc(SensorReading.id))
        .first()
    )


def _machine_payload(db: Session, org: Organization, machine: Machine) -> MachineResponse:
    latest = _latest_demo_reading(db, org, machine.machine_id)
    return MachineResponse(
        id=machine.id,
        machine_id=machine.machine_id,
        name=machine.name,
        type=machine.type,
        location=machine.location,
        status=machine.status,
        is_demo=True,
        specifications=MachineSpecifications(
            rated_rpm=machine.rated_rpm,
            rated_current=machine.rated_current,
            max_temp=machine.max_temp,
            max_vibration=machine.max_vibration,
        ),
        created_at=machine.created_at,
        # Demo machines are structurally barred from physical devices.
        devices=[],
        latest_reading=SensorReadingResponse.model_validate(latest) if latest else None,
    )


def _demo_machine_count(db: Session, org: Organization) -> int:
    return int(
        db.query(func.count(Machine.id))
        .filter(Machine.organization_id == org.id, Machine.is_demo.is_(True))
        .scalar()
        or 0
    )


# ============================================================================
# Dataset / fleet
# ============================================================================
@router.get(
    "/overview",
    response_model=DemoOverviewResponse,
    summary="Read-only demo fleet overview (no authentication)",
)
def get_demo_overview(db: Session = Depends(get_db)) -> DemoOverviewResponse:
    try:
        org = _demo_organization(db)
        readings = int(
            db.query(func.count(SensorReading.id))
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.source == PUBLIC_DEMO_PROVENANCE,
            )
            .scalar()
            or 0
        )
        maintenance = int(
            db.query(func.count(MaintenanceRecord.id))
            .filter(MaintenanceRecord.organization_id == org.id)
            .scalar()
            or 0
        )
        active_alerts = int(
            db.query(func.count(Alert.id))
            .filter(
                Alert.organization_id == org.id,
                Alert.status == "ACTIVE",
            )
            .scalar()
            or 0
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()

    return DemoOverviewResponse(
        dataset=DemoDatasetInfo(
            label=PUBLIC_DEMO_DATASET_LABEL,
            organization_name=PUBLIC_DEMO_ORGANIZATION_NAME,
            organization_slug=PUBLIC_DEMO_ORGANIZATION_SLUG,
            provenance=PUBLIC_DEMO_PROVENANCE,
            hardware_telemetry=False,
            read_only=True,
            notice=PUBLIC_DEMO_NOTICE,
        ),
        stats=FleetStatsResponse(
            total_machines=_demo_machine_count(db, org),
            # Demo machines cannot own devices; reporting 0 is the honest value.
            total_devices=0,
            connected_devices=0,
            total_sensor_readings=readings,
            total_maintenance_records=maintenance,
            active_alerts=active_alerts,
            data_collection_status="DEMO_DATASET",
        ),
        generated_at=datetime.now(timezone.utc),
    )


@router.get(
    "/machines",
    response_model=DemoMachineListResponse,
    summary="List demo machines (no authentication)",
)
def list_demo_machines(
    limit: int = LIMIT_QUERY,
    offset: int = OFFSET_QUERY,
    db: Session = Depends(get_db),
) -> DemoMachineListResponse:
    try:
        org = _demo_organization(db)
        query = db.query(Machine).filter(
            Machine.organization_id == org.id, Machine.is_demo.is_(True)
        )
        total = int(query.with_entities(func.count(Machine.id)).scalar() or 0)
        machines = (
            query.order_by(Machine.machine_id.asc()).offset(offset).limit(limit).all()
        )
        items = [_machine_payload(db, org, machine) for machine in machines]
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()
    return DemoMachineListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get(
    "/machines/{machine_id}",
    response_model=MachineResponse,
    summary="Read one demo machine (no authentication)",
)
def get_demo_machine(
    machine_id: str, db: Session = Depends(get_db)
) -> MachineResponse:
    try:
        org = _demo_organization(db)
        machine = _demo_machine(db, org, machine_id)
        return _machine_payload(db, org, machine)
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()


@router.get(
    "/machines/{machine_id}/latest",
    response_model=SensorReadingResponse,
    summary="Latest demo reading for one machine (no authentication)",
)
def get_demo_latest_reading(
    machine_id: str, db: Session = Depends(get_db)
) -> SensorReadingResponse:
    try:
        org = _demo_organization(db)
        _demo_machine(db, org, machine_id)
        reading = _latest_demo_reading(db, org, machine_id)
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()
    if reading is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No demo reading is available for this machine.",
        )
    return SensorReadingResponse.model_validate(reading)


# ============================================================================
# Telemetry
# ============================================================================
@router.get(
    "/readings",
    response_model=DemoReadingListResponse,
    summary="List demo sensor readings (no authentication)",
)
def list_demo_readings(
    machine_id: Optional[str] = Query(default=None),
    limit: int = LIMIT_QUERY,
    offset: int = OFFSET_QUERY,
    db: Session = Depends(get_db),
) -> DemoReadingListResponse:
    try:
        org = _demo_organization(db)
        if machine_id:
            _demo_machine(db, org, machine_id)

        query = db.query(SensorReading).filter(
            SensorReading.organization_id == org.id,
            SensorReading.source == PUBLIC_DEMO_PROVENANCE,
        )
        if machine_id:
            query = query.filter(SensorReading.machine_id == machine_id)

        total = int(query.with_entities(func.count(SensorReading.id)).scalar() or 0)
        rows = (
            query.order_by(desc(SensorReading.timestamp), desc(SensorReading.id))
            .offset(offset)
            .limit(limit)
            .all()
        )
        # Same chronological ordering as the authenticated history contract.
        items = [
            SensorReadingResponse.model_validate(reading)
            for reading in reversed(rows)
        ]
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()
    return DemoReadingListResponse(items=items, total=total, limit=limit, offset=offset)


@router.get(
    "/data-status",
    response_model=DemoDataStatusResponse,
    summary="Demo data-status contract (no authentication)",
)
def get_demo_data_status(
    db: Session = Depends(get_db),
) -> DemoDataStatusResponse:
    try:
        org = _demo_organization(db)
        total = int(
            db.query(func.count(SensorReading.id))
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.source == PUBLIC_DEMO_PROVENANCE,
            )
            .scalar()
            or 0
        )
        latest = (
            db.query(SensorReading)
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.source == PUBLIC_DEMO_PROVENANCE,
            )
            .order_by(desc(SensorReading.timestamp), desc(SensorReading.id))
            .first()
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()

    return DemoDataStatusResponse(
        # Explicitly not ONLINE/OFFLINE: there is no hardware behind demo data.
        sensor_status="DEMO",
        last_reading=latest.timestamp if latest else None,
        total_readings=total,
        data_collection="DEMO",
        active_devices_count=0,
        message="Read-only demo dataset. No ESP32 hardware is attached to demo machines.",
        provenance=PUBLIC_DEMO_PROVENANCE,
        demo_mode=True,
    )


# ============================================================================
# Predictions
# ============================================================================
@router.get(
    "/predictions",
    response_model=DemoPredictionListResponse,
    summary="List demo predictions (no authentication)",
)
def list_demo_predictions(
    machine_id: Optional[str] = Query(default=None),
    limit: int = LIMIT_QUERY,
    offset: int = OFFSET_QUERY,
    db: Session = Depends(get_db),
) -> DemoPredictionListResponse:
    try:
        org = _demo_organization(db)
        if machine_id:
            _demo_machine(db, org, machine_id)

        query = db.query(Prediction).filter(Prediction.organization_id == org.id)
        if machine_id:
            query = query.filter(Prediction.machine_id == machine_id)

        total = int(query.with_entities(func.count(Prediction.id)).scalar() or 0)
        rows = (
            query.order_by(desc(Prediction.timestamp), desc(Prediction.id))
            .offset(offset)
            .limit(limit)
            .all()
        )
        items = [response_from_prediction(row) for row in rows]
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()
    return DemoPredictionListResponse(
        items=items, total=total, limit=limit, offset=offset
    )


@router.get(
    "/machines/{machine_id}/prediction",
    summary="Latest demo prediction for one machine (no authentication)",
)
def get_demo_machine_prediction(
    machine_id: str, db: Session = Depends(get_db)
):
    try:
        org = _demo_organization(db)
        _demo_machine(db, org, machine_id)
        latest = (
            db.query(Prediction)
            .filter(
                Prediction.organization_id == org.id,
                Prediction.machine_id == machine_id,
            )
            .order_by(desc(Prediction.timestamp), desc(Prediction.id))
            .first()
        )
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()

    if latest is None:
        # Same "insufficient data" contract as the authenticated endpoint, but
        # never fabricated.
        from backend.app.api.predictions import insufficient_data

        return insufficient_data(machine_id)
    return response_from_prediction(latest)


@router.get(
    "/model-status",
    response_model=DemoModelStatusResponse,
    response_model_exclude_none=True,
    summary="Model readiness for demo visitors (no authentication)",
)
def get_demo_model_status() -> DemoModelStatusResponse:
    """Readiness only.

    ``get_status()`` can include platform-wide governance metadata (dataset
    sizes, evaluation metrics) aggregated across organizations. That is
    operator information, so the public contract keeps only readiness fields.
    """
    payload = prediction_service.get_status()
    allowed = {
        "source",
        "trained",
        "evaluated",
        "model_version",
        "status",
        "message",
        "deployment_status",
    }
    readiness = {key: value for key, value in payload.items() if key in allowed}
    return DemoModelStatusResponse(**readiness, demo_mode=True)


# ============================================================================
# Alerts
# ============================================================================
@router.get(
    "/alerts",
    response_model=DemoAlertListResponse,
    summary="List demo alerts (no authentication)",
)
def list_demo_alerts(
    machine_id: Optional[str] = Query(default=None),
    status_filter: Optional[Literal["ACTIVE", "ACKNOWLEDGED", "RESOLVED"]] = Query(
        default=None, description="Filter by alert status"
    ),
    limit: int = LIMIT_QUERY,
    offset: int = OFFSET_QUERY,
    db: Session = Depends(get_db),
) -> DemoAlertListResponse:
    try:
        org = _demo_organization(db)
        if machine_id:
            _demo_machine(db, org, machine_id)

        query = db.query(Alert).filter(Alert.organization_id == org.id)
        if machine_id:
            query = query.filter(Alert.machine_id == machine_id)
        if status_filter:
            query = query.filter(Alert.status == status_filter)

        total = int(query.with_entities(func.count(Alert.id)).scalar() or 0)
        rows = (
            query.order_by(desc(Alert.created_at), desc(Alert.id))
            .offset(offset)
            .limit(limit)
            .all()
        )
        items = [AlertResponse.model_validate(row) for row in rows]
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()
    return DemoAlertListResponse(items=items, total=total, limit=limit, offset=offset)


# ============================================================================
# Maintenance
# ============================================================================
@router.get(
    "/maintenance",
    response_model=DemoMaintenanceListResponse,
    summary="List demo maintenance records (no authentication)",
)
def list_demo_maintenance(
    machine_id: Optional[str] = Query(default=None),
    limit: int = LIMIT_QUERY,
    offset: int = OFFSET_QUERY,
    db: Session = Depends(get_db),
) -> DemoMaintenanceListResponse:
    try:
        org = _demo_organization(db)
        if machine_id:
            _demo_machine(db, org, machine_id)

        query = db.query(MaintenanceRecord).filter(
            MaintenanceRecord.organization_id == org.id
        )
        if machine_id:
            query = query.filter(MaintenanceRecord.machine_id == machine_id)

        total = int(
            query.with_entities(func.count(MaintenanceRecord.id)).scalar() or 0
        )
        rows = (
            query.order_by(
                desc(MaintenanceRecord.maintenance_date),
                desc(MaintenanceRecord.id),
            )
            .offset(offset)
            .limit(limit)
            .all()
        )
        items = [MaintenanceResponse.model_validate(row) for row in rows]
    except HTTPException:
        raise
    except SQLAlchemyError:
        raise _unavailable()
    return DemoMaintenanceListResponse(
        items=items, total=total, limit=limit, offset=offset
    )
