"""
Predict IQ - Maintenance Feedback & Ground-Truth API Endpoints (PostgreSQL)

Phase 3 (multi-tenant): feedback is organization-scoped. Every reference
(prediction, alert, maintenance record) must belong to the same organization as
the machine; cross-organization references are rejected before persistence and
are also blocked by composite foreign keys in PostgreSQL.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.core.tenant import OrganizationContext, require_org_member
from backend.app.db.database import get_db
from backend.app.db.models import (
    Alert,
    FeedbackRecord,
    Machine,
    MaintenanceRecord,
    Prediction,
)
from backend.app.schemas.sensor import FeedbackCreate, FeedbackResponse, FeedbackListEntry

router = APIRouter(tags=["Maintenance Feedback & Ground Truth"])


@router.get("/feedback", response_model=List[FeedbackListEntry],
            summary="List the organization's feedback/ground-truth records")
def get_feedback(
    ctx: OrganizationContext = Depends(require_org_member),
    machine_id: Optional[str] = Query(None, description="Filter by machine ID"),
    db: Session = Depends(get_db),
):
    query = db.query(FeedbackRecord).filter(
        FeedbackRecord.organization_id == ctx.organization_id
    )
    if machine_id:
        query = query.filter(FeedbackRecord.machine_id == machine_id)
    return [
        FeedbackListEntry.from_orm(r)
        for r in query.order_by(FeedbackRecord.created_at.desc()).all()
    ]


@router.get("/feedback/{feedback_id}", response_model=FeedbackResponse,
            summary="Get a feedback record in the caller's organization")
def get_single_feedback(
    feedback_id: int,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    record = (
        db.query(FeedbackRecord)
        .filter(
            FeedbackRecord.organization_id == ctx.organization_id,
            FeedbackRecord.id == feedback_id,
        )
        .first()
    )
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feedback record with ID {feedback_id} not found.",
        )
    return FeedbackResponse.from_orm(record)


@router.get("/machines/{machine_id}/feedback", response_model=List[FeedbackListEntry],
            summary="List feedback for a machine in the caller's organization")
def get_machine_feedback(
    machine_id: str,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    machine = (
        db.query(Machine)
        .filter(
            Machine.organization_id == ctx.organization_id,
            Machine.machine_id == machine_id,
        )
        .first()
    )
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine '{machine_id}' does not exist in registry.",
        )
    records = (
        db.query(FeedbackRecord)
        .filter(
            FeedbackRecord.organization_id == ctx.organization_id,
            FeedbackRecord.machine_id == machine_id,
        )
        .order_by(FeedbackRecord.created_at.desc())
        .all()
    )
    return [FeedbackListEntry.from_orm(r) for r in records]


def create_feedback(
    payload: FeedbackCreate, db: Session, organization_id=None
) -> FeedbackResponse:
    """Persist technician feedback inside one organization.

    ``organization_id`` scopes the machine lookup (None = platform operator,
    which still uses the machine's own organization). Every linked record must
    belong to the same organization.
    """
    query = db.query(Machine).filter(Machine.machine_id == payload.machine_id)
    if organization_id is not None:
        query = query.filter(Machine.organization_id == organization_id)
    machine = query.first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine '{payload.machine_id}' does not exist in registry.",
        )

    org_id = machine.organization_id

    if payload.prediction_id is not None:
        pred = (
            db.query(Prediction)
            .filter(
                Prediction.id == payload.prediction_id,
                Prediction.organization_id == org_id,
            )
            .first()
        )
        if not pred:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Prediction with ID {payload.prediction_id} not found.",
            )
        if pred.machine_id != payload.machine_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Prediction {payload.prediction_id} belongs to machine '{pred.machine_id}', "
                       f"not '{payload.machine_id}'.",
            )

    if payload.alert_id is not None:
        alert = (
            db.query(Alert)
            .filter(Alert.id == payload.alert_id, Alert.organization_id == org_id)
            .first()
        )
        if not alert:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Alert with ID {payload.alert_id} not found.",
            )
        if alert.machine_id != payload.machine_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Alert {payload.alert_id} belongs to machine '{alert.machine_id}', "
                       f"not '{payload.machine_id}'.",
            )

    if payload.maintenance_record_id is not None:
        maint = (
            db.query(MaintenanceRecord)
            .filter(
                MaintenanceRecord.id == payload.maintenance_record_id,
                MaintenanceRecord.organization_id == org_id,
            )
            .first()
        )
        if not maint:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Maintenance record with ID {payload.maintenance_record_id} not found.",
            )
        if maint.machine_id != payload.machine_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Maintenance record {payload.maintenance_record_id} belongs to machine "
                       f"'{maint.machine_id}', not '{payload.machine_id}'.",
            )

    now = datetime.now(timezone.utc)
    record = FeedbackRecord(
        organization_id=org_id,
        machine_id=payload.machine_id,
        prediction_id=payload.prediction_id,
        alert_id=payload.alert_id,
        maintenance_record_id=payload.maintenance_record_id,
        observed_condition=payload.observed_condition,
        actual_fault=payload.actual_fault,
        root_cause=payload.root_cause,
        symptoms=payload.symptoms,
        action_taken=payload.action_taken,
        parts_replaced=payload.parts_replaced,
        severity=payload.severity,
        outcome=payload.outcome,
        technician_notes=payload.technician_notes,
        prediction_correct=payload.prediction_correct,
        feedback_source=payload.feedback_source,
        created_at=now,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return FeedbackResponse.from_orm(record)


@router.post("/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED,
             summary="Record technician feedback in the caller's organization")
def create_feedback_endpoint(
    payload: FeedbackCreate,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    return create_feedback(payload, db, ctx.organization_id)
