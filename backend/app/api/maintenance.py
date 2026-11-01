"""
Predict IQ - Maintenance Records & Failure Events API (PostgreSQL)

Phase 3 (multi-tenant): reads are organization-scoped; writes require an
active membership and may only target a machine in that organization.
Maintenance records are human ground truth, so the device API key no longer
creates them (telemetry ingress is unchanged).
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.core.tenant import OrganizationContext, require_org_member
from backend.app.db.database import get_db
from backend.app.db.models import MaintenanceRecord, Machine
from backend.app.schemas.sensor import MaintenanceCreate, MaintenanceResponse

router = APIRouter(tags=["Maintenance & Failure Records"])


@router.get("/maintenance", response_model=List[MaintenanceResponse],
            summary="List the organization's maintenance and failure records")
def list_maintenance_records(
    ctx: OrganizationContext = Depends(require_org_member),
    machine_id: Optional[str] = Query(None, description="Optional machine ID filter"),
    db: Session = Depends(get_db),
):
    query = db.query(MaintenanceRecord).filter(
        MaintenanceRecord.organization_id == ctx.organization_id
    )
    if machine_id:
        query = query.filter(MaintenanceRecord.machine_id == machine_id)
    records = query.order_by(MaintenanceRecord.maintenance_date.desc()).all()
    return [MaintenanceResponse.from_orm(r) for r in records]


def create_maintenance(
    payload: MaintenanceCreate, db: Session, organization_id=None
) -> MaintenanceResponse:
    """Create a maintenance record; ``organization_id`` scopes the machine lookup.

    When ``organization_id`` is None the caller is the platform operator and the
    machine's own organization is used.
    """
    query = db.query(Machine).filter(Machine.machine_id == payload.machine_id)
    if organization_id is not None:
        query = query.filter(Machine.organization_id == organization_id)
    machine = query.first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine ID '{payload.machine_id}' was not found.",
        )

    now = datetime.now(timezone.utc)
    new_rec = MaintenanceRecord(
        organization_id=machine.organization_id,
        machine_id=payload.machine_id,
        component=payload.component,
        failure_type=payload.failure_type,
        issue_description=payload.issue_description,
        maintenance_action=payload.maintenance_action,
        technician=payload.technician,
        status=payload.status or "Scheduled",
        failure_date=payload.failure_date,
        maintenance_date=payload.maintenance_date or now,
        created_at=now,
    )
    db.add(new_rec)

    if payload.status == "In Progress":
        machine.status = "Maintenance"
    elif payload.status == "Completed" and machine.status == "Maintenance":
        machine.status = "Healthy"

    db.commit()
    db.refresh(new_rec)
    return MaintenanceResponse.from_orm(new_rec)


@router.post(
    "/maintenance",
    response_model=MaintenanceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Log a maintenance action for a machine in the caller's organization",
)
def create_maintenance_endpoint(
    payload: MaintenanceCreate,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    return create_maintenance(payload, db, ctx.organization_id)
