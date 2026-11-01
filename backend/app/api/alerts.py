"""
Predict IQ - Industrial Alerts API Endpoints (PostgreSQL)

Phase 3 (multi-tenant): alerts are read and mutated only inside the caller's
verified organization. Alert identifiers from other tenants resolve to a
uniform 404. Acknowledge/resolve require an active membership (owner, admin or
member); device credentials no longer write human alert lifecycle records.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.app.core.tenant import OrganizationContext, require_org_member
from backend.app.db.database import get_db
from backend.app.db.models import Alert
from backend.app.schemas.sensor import AlertResponse

router = APIRouter(tags=["Alerts & Anomalies"])


@router.get("/alerts", response_model=List[AlertResponse],
            summary="List the organization's anomaly alerts")
def get_alerts(
    ctx: OrganizationContext = Depends(require_org_member),
    machine_id: Optional[str] = Query(None, description="Filter by machine ID"),
    status_filter: Optional[str] = Query(None, description="Filter by status (ACTIVE/RESOLVED)"),
    db: Session = Depends(get_db),
):
    query = db.query(Alert).filter(Alert.organization_id == ctx.organization_id)
    if machine_id:
        query = query.filter(Alert.machine_id == machine_id)
    if status_filter:
        query = query.filter(Alert.status == status_filter.upper())

    alerts = query.order_by(Alert.created_at.desc()).all()
    return [AlertResponse.from_orm(a) for a in alerts]


def _scoped_alert(db: Session, alert_id: int, organization_id=None) -> Alert:
    query = db.query(Alert).filter(Alert.id == alert_id)
    if organization_id is not None:
        query = query.filter(Alert.organization_id == organization_id)
    alert = query.first()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID {alert_id} not found.",
        )
    return alert


def acknowledge_alert(alert_id: int, db: Session, organization_id=None) -> AlertResponse:
    alert = _scoped_alert(db, alert_id, organization_id)
    alert.status = "ACKNOWLEDGED"
    db.commit()
    db.refresh(alert)
    return AlertResponse.from_orm(alert)


def resolve_alert(alert_id: int, db: Session, organization_id=None) -> AlertResponse:
    alert = _scoped_alert(db, alert_id, organization_id)
    alert.status = "RESOLVED"
    alert.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(alert)
    return AlertResponse.from_orm(alert)


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertResponse,
             summary="Acknowledge an alert in the caller's organization")
def acknowledge_alert_endpoint(
    alert_id: int,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    return acknowledge_alert(alert_id, db, ctx.organization_id)


@router.post("/alerts/{alert_id}/resolve", response_model=AlertResponse,
             summary="Resolve an alert in the caller's organization")
def resolve_alert_endpoint(
    alert_id: int,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    return resolve_alert(alert_id, db, ctx.organization_id)
