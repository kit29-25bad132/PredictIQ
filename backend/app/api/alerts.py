"""
Predict IQ - Industrial Alerts API Endpoints (PostgreSQL)
Manages threshold anomaly notifications and resolution workflows.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from backend.app.db.database import get_db
from backend.app.db.models import Alert, Machine
from backend.app.schemas.sensor import AlertResponse

router = APIRouter(tags=["Alerts & Anomalies"])

@router.get("/alerts", response_model=List[AlertResponse], summary="List anomaly alerts")
def get_alerts(
    machine_id: Optional[str] = Query(None, description="Filter by machine ID"),
    status_filter: Optional[str] = Query(None, description="Filter by status (ACTIVE/RESOLVED)"),
    db: Session = Depends(get_db)
):
    """
    Returns alerts stored in PostgreSQL, sorted newest first.
    """
    query = db.query(Alert)
    if machine_id:
        query = query.filter(Alert.machine_id == machine_id)
    if status_filter:
        query = query.filter(Alert.status == status_filter.upper())
    
    alerts = query.order_by(Alert.created_at.desc()).all()
    return [AlertResponse.from_orm(a) for a in alerts]

@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertResponse, summary="Acknowledge an active alert")
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db)):
    """
    Marks an alert as ACKNOWLEDGED in PostgreSQL.
    """
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID {alert_id} not found."
        )
    alert.status = "ACKNOWLEDGED"
    db.commit()
    db.refresh(alert)
    return AlertResponse.from_orm(alert)

@router.post("/alerts/{alert_id}/resolve", response_model=AlertResponse, summary="Resolve an alert")
def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    """
    Marks an alert as RESOLVED in PostgreSQL.
    """
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert with ID {alert_id} not found."
        )
    alert.status = "RESOLVED"
    alert.resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(alert)
    return AlertResponse.from_orm(alert)
