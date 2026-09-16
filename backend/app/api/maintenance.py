"""
Predict IQ - Maintenance Records & Failure Events API (PostgreSQL)
Manages ground-truth equipment failure logs and technician work orders.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone

from backend.app.core.auth import require_api_key
from backend.app.db.database import get_db
from backend.app.db.models import MaintenanceRecord, Machine
from backend.app.schemas.sensor import MaintenanceCreate, MaintenanceResponse

router = APIRouter(tags=["Maintenance & Failure Records"])

@router.get("/maintenance", response_model=List[MaintenanceResponse], summary="List maintenance and failure records")
def list_maintenance_records(
    machine_id: Optional[str] = Query(None, description="Optional machine ID filter"),
    db: Session = Depends(get_db)
):
    """
    Returns maintenance work orders and failure records from PostgreSQL, sorted chronologically descending.
    """
    query = db.query(MaintenanceRecord)
    if machine_id:
        query = query.filter(MaintenanceRecord.machine_id == machine_id)
    records = query.order_by(MaintenanceRecord.maintenance_date.desc()).all()
    return [MaintenanceResponse.from_orm(r) for r in records]

@router.post(
    "/maintenance",
    response_model=MaintenanceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Log a new maintenance action or ground-truth failure record",
    dependencies=[Depends(require_api_key)],
)
def create_maintenance(payload: MaintenanceCreate, db: Session = Depends(get_db)):
    """
    Stores an authentic maintenance event or failure report into PostgreSQL.
    """
    machine = db.query(Machine).filter(Machine.machine_id == payload.machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine ID '{payload.machine_id}' does not exist in registry."
        )

    now = datetime.now(timezone.utc)
    new_rec = MaintenanceRecord(
        machine_id=payload.machine_id,
        component=payload.component,
        failure_type=payload.failure_type,
        issue_description=payload.issue_description,
        maintenance_action=payload.maintenance_action,
        technician=payload.technician,
        status=payload.status or "Scheduled",
        failure_date=payload.failure_date,
        maintenance_date=payload.maintenance_date or now,
        created_at=now
    )
    db.add(new_rec)

    # If status is In Progress, mark machine as Maintenance
    if payload.status == "In Progress":
        machine.status = "Maintenance"
    elif payload.status == "Completed" and machine.status == "Maintenance":
        machine.status = "Healthy"

    db.commit()
    db.refresh(new_rec)

    return MaintenanceResponse.from_orm(new_rec)
