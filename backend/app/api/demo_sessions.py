"""Controlled MANUAL_DEMO sessions.

Design goals (Phase 1):
* A demo session owns exactly one dedicated ``is_demo=True`` machine. The
  machine is invisible to ``GET /machines`` (unless explicitly requested) and
  rejected by device ingest, heartbeats, device provisioning and feedback.
* Demo readings are ``source='MANUAL_DEMO'`` with ``device_id=NULL`` and a
  ``demo_session_id``; the database check constraint forbids mixing that
  provenance with device telemetry.
* Reset is strictly scoped to one session: it deletes only that session's
  MANUAL_DEMO readings/alerts/predictions for the caller's organization and
  never touches real machines, devices or WOKWI/REAL_HARDWARE data.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.core.tenant import (
    OrganizationContext,
    require_org_admin,
    require_org_member,
)
from backend.app.db.database import get_db
from backend.app.db.models import Alert, DemoSession, Machine, Prediction, SensorReading
from backend.app.schemas.demo import (
    DemoResetDeleted,
    DemoResetRequest,
    DemoResetResponse,
    DemoSessionCounts,
    DemoSessionCreate,
    DemoSessionMachine,
    DemoSessionResponse,
    ManualDemoInput,
    ManualDemoResponse,
)
from backend.app.services.health_engine import evaluate_reading

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Demo Sessions (MANUAL_DEMO)"])

DEMO_MACHINE_TYPE = "Demo"
DEMO_MACHINE_LOCATION = "Demo Session"


def _session_or_404(
    db: Session, session_id: uuid.UUID, organization_id: uuid.UUID
) -> DemoSession:
    session = (
        db.query(DemoSession)
        .filter(
            DemoSession.id == session_id,
            DemoSession.organization_id == organization_id,
        )
        .first()
    )
    if session is None:
        # Uniform non-disclosing denial for missing AND cross-organization ids.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo session not found.",
        )
    return session


def _machine_of(db: Session, session: DemoSession) -> Machine:
    machine = (
        db.query(Machine)
        .filter(
            Machine.organization_id == session.organization_id,
            Machine.machine_id == session.machine_id,
        )
        .first()
    )
    if machine is None:  # structurally impossible (FK CASCADE)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Demo session machine no longer exists.",
        )
    return machine


def _session_counts(db: Session, session: DemoSession) -> DemoSessionCounts:
    readings = (
        db.query(func.count(SensorReading.id))
        .filter(
            SensorReading.organization_id == session.organization_id,
            SensorReading.demo_session_id == session.id,
            SensorReading.source == "MANUAL_DEMO",
        )
        .scalar()
        or 0
    )
    alerts = (
        db.query(func.count(Alert.id))
        .filter(
            Alert.organization_id == session.organization_id,
            Alert.demo_session_id == session.id,
        )
        .scalar()
        or 0
    )
    predictions = (
        db.query(func.count(Prediction.id))
        .filter(
            Prediction.organization_id == session.organization_id,
            Prediction.demo_session_id == session.id,
        )
        .scalar()
        or 0
    )
    return DemoSessionCounts(
        readings=int(readings), alerts=int(alerts), predictions=int(predictions)
    )


def _session_response(
    db: Session, session: DemoSession, machine: Optional[Machine] = None
) -> DemoSessionResponse:
    machine = machine or _machine_of(db, session)
    return DemoSessionResponse(
        id=session.id,
        name=session.name,
        status=session.status,
        machine=DemoSessionMachine(
            machine_id=machine.machine_id,
            name=machine.name,
            status=machine.status,
            is_demo=machine.is_demo,
        ),
        created_by=session.created_by,
        created_at=session.created_at,
        closed_at=session.closed_at,
        counts=_session_counts(db, session),
    )


def _created_by(ctx: OrganizationContext) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(ctx.user_id))
    except (ValueError, AttributeError, TypeError):
        return None


def _new_demo_machine_id(db: Session) -> str:
    while True:
        candidate = f"DEMO-{uuid.uuid4().hex[:12].upper()}"
        exists = db.query(Machine.id).filter(Machine.machine_id == candidate).first()
        if exists is None:
            return candidate


# ============================================================================
# Lifecycle
# ============================================================================
@router.post(
    "/demo-sessions",
    response_model=DemoSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an ACTIVE demo session with its dedicated demo machine (owner/admin)",
)
def create_demo_session(
    payload: DemoSessionCreate,
    ctx: OrganizationContext = Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> DemoSessionResponse:
    machine_id = _new_demo_machine_id(db)
    now = datetime.now(timezone.utc)
    machine = Machine(
        organization_id=ctx.organization_id,
        machine_id=machine_id,
        name=(payload.machine_label or f"{payload.name} (Demo)")[:100],
        type=DEMO_MACHINE_TYPE,
        location=DEMO_MACHINE_LOCATION,
        status="Healthy",
        is_demo=True,
        created_at=now,
    )
    session = DemoSession(
        organization_id=ctx.organization_id,
        machine_id=machine_id,
        name=payload.name,
        status="ACTIVE",
        created_by=_created_by(ctx),
        created_at=now,
    )
    try:
        db.add(machine)
        db.add(session)
        db.commit()
        db.refresh(session)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Demo session could not be stored.",
        )
    logger.info("Created demo session %s for organization %s", session.id, ctx.organization_id)
    return _session_response(db, session, machine)


@router.get(
    "/demo-sessions",
    response_model=List[DemoSessionResponse],
    summary="List the organization's demo sessions (any member)",
)
def list_demo_sessions(
    session_status: Optional[Literal["ACTIVE", "CLOSED"]] = Query(
        default=None, alias="status", description="Filter by session status"
    ),
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
) -> List[DemoSessionResponse]:
    query = db.query(DemoSession).filter(
        DemoSession.organization_id == ctx.organization_id
    )
    if session_status is not None:
        query = query.filter(DemoSession.status == session_status)
    sessions = query.order_by(DemoSession.created_at.desc()).all()
    return [_session_response(db, session) for session in sessions]


@router.get(
    "/demo-sessions/{session_id}",
    response_model=DemoSessionResponse,
    summary="Get one demo session in the caller's organization (any member)",
)
def get_demo_session(
    session_id: uuid.UUID,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
) -> DemoSessionResponse:
    session = _session_or_404(db, session_id, ctx.organization_id)
    return _session_response(db, session)


@router.post(
    "/demo-sessions/{session_id}/activate",
    response_model=DemoSessionResponse,
    summary="Activate (or re-activate) a demo session (owner/admin)",
)
def activate_demo_session(
    session_id: uuid.UUID,
    ctx: OrganizationContext = Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> DemoSessionResponse:
    session = _session_or_404(db, session_id, ctx.organization_id)
    session.status = "ACTIVE"
    session.closed_at = None
    try:
        db.commit()
        db.refresh(session)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Demo session could not be activated.",
        )
    return _session_response(db, session)


@router.post(
    "/demo-sessions/{session_id}/close",
    response_model=DemoSessionResponse,
    summary="Close a demo session (owner/admin, idempotent)",
)
def close_demo_session(
    session_id: uuid.UUID,
    ctx: OrganizationContext = Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> DemoSessionResponse:
    session = _session_or_404(db, session_id, ctx.organization_id)
    if session.status != "CLOSED":
        session.status = "CLOSED"
        session.closed_at = datetime.now(timezone.utc)
        try:
            db.commit()
            db.refresh(session)
        except SQLAlchemyError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Demo session could not be closed.",
            )
    return _session_response(db, session)


# ============================================================================
# Demo telemetry (MANUAL_DEMO)
# ============================================================================
@router.post(
    "/demo-sessions/{session_id}/readings",
    response_model=ManualDemoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest a manual demo reading into an ACTIVE session (any member)",
)
def ingest_demo_reading(
    session_id: uuid.UUID,
    payload: ManualDemoInput,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
) -> ManualDemoResponse:
    session = _session_or_404(db, session_id, ctx.organization_id)
    if session.status != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Demo session is closed; activate it before ingesting readings.",
        )
    machine = _machine_of(db, session)

    observed_at = payload.timestamp or datetime.now(timezone.utc)
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)

    # ``note`` is accepted for operator context but intentionally not persisted:
    # Phase 1 adds no note column to sensor_readings.
    reading = SensorReading(
        organization_id=ctx.organization_id,
        machine_id=session.machine_id,
        device_id=None,
        demo_session_id=session.id,
        timestamp=observed_at,
        temperature=payload.temperature,
        vibration=payload.vibration,
        current=payload.current,
        rpm=payload.rpm,
        source="MANUAL_DEMO",
        created_at=datetime.now(timezone.utc),
    )
    try:
        db.add(reading)
        db.commit()
        db.refresh(reading)
        evaluate_reading(machine, reading, db)
        db.commit()
        db.refresh(machine)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Demo reading could not be stored.",
        )

    return ManualDemoResponse(
        id=reading.id,
        demo_session_id=session.id,
        machine_id=session.machine_id,
        timestamp=reading.timestamp,
    )


# ============================================================================
# Scoped reset
# ============================================================================
@router.post(
    "/demo-sessions/{session_id}/reset",
    response_model=DemoResetResponse,
    summary="Delete one demo session's MANUAL_DEMO data (owner/admin, explicit confirmation)",
)
def reset_demo_session(
    session_id: uuid.UUID,
    payload: DemoResetRequest,
    ctx: OrganizationContext = Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> DemoResetResponse:
    session = _session_or_404(db, session_id, ctx.organization_id)
    if not payload.confirm or payload.confirm_session_name != session.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation failed: set confirm=true and repeat the exact session name.",
        )

    machine = _machine_of(db, session)
    org_id = ctx.organization_id
    try:
        predictions = db.execute(
            delete(Prediction).where(
                Prediction.organization_id == org_id,
                Prediction.demo_session_id == session.id,
            )
        ).rowcount or 0
        alerts = db.execute(
            delete(Alert).where(
                Alert.organization_id == org_id,
                Alert.demo_session_id == session.id,
            )
        ).rowcount or 0
        readings = db.execute(
            delete(SensorReading).where(
                SensorReading.organization_id == org_id,
                SensorReading.demo_session_id == session.id,
                SensorReading.source == "MANUAL_DEMO",
            )
        ).rowcount or 0
        machine.status = "Healthy"
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Demo session reset failed; nothing was deleted.",
        )

    logger.info(
        "Reset demo session %s: %s readings, %s alerts, %s predictions deleted",
        session.id,
        readings,
        alerts,
        predictions,
    )
    return DemoResetResponse(
        demo_session_id=session.id,
        deleted=DemoResetDeleted(
            readings=int(readings), alerts=int(alerts), predictions=int(predictions)
        ),
    )
