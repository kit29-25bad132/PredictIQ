"""
Predict IQ - Real Sensor Data Telemetry Ingestion & Query Endpoints (PostgreSQL)

Phase 3 (multi-tenant):
- Ingestion requires an already-registered device; no auto-provisioning.
- The organization is derived from the registered device row, never from the
  payload; the payload's machine must be the device's machine.
- All reads are scoped to the caller's verified organization.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.core.auth import require_api_key
from backend.app.core.config import get_settings
from backend.app.core.tenant import OrganizationContext, require_org_member
from backend.app.db.database import get_db
from backend.app.db.models import Machine, Device, SensorReading, Alert
from backend.app.schemas.sensor import (
    SensorDataInput,
    SensorDataResponse,
    SensorReadingResponse,
    MachineSensorDataListResponse,
    DataCollectionStatusResponse,
)
from backend.app.services.health_engine import evaluate_reading

router = APIRouter(tags=["Real Sensor Telemetry (ESP32)"])

DEVICE_TIMEOUT_SECONDS = get_settings().device_timeout_seconds


def get_device_computed_status(last_seen: Optional[datetime]) -> str:
    if not last_seen:
        return "OFFLINE"
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    diff_seconds = (datetime.now(timezone.utc) - last_seen).total_seconds()
    return "ONLINE" if diff_seconds <= DEVICE_TIMEOUT_SECONDS else "OFFLINE"


# ============================================================================
# 1. INGEST REAL ESP32 SENSOR DATA (device API key)
# ============================================================================
@router.post(
    "/sensor-data",
    response_model=SensorDataResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest real-time IoT sensor readings from a registered ESP32",
    dependencies=[Depends(require_api_key)],
)
def ingest_sensor_data(payload: SensorDataInput, db: Session = Depends(get_db)):
    """Store telemetry for a registered device.

    Trust chain: device row -> machine -> organization. The device must exist,
    must belong to the payload's machine, and both must share one organization.
    Nothing is auto-created, and no organization id is accepted from the client.
    """
    now = payload.timestamp

    machine = db.query(Machine).filter(Machine.machine_id == payload.machine_id).first()
    if machine is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine '{payload.machine_id}' is not registered.",
        )

    device = db.query(Device).filter(Device.device_id == payload.device_id).first()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{payload.device_id}' is not registered. Provision it before sending telemetry.",
        )

    if device.machine_id != payload.machine_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device '{payload.device_id}' is registered to machine '{device.machine_id}', not '{payload.machine_id}'.",
        )

    if device.organization_id != machine.organization_id:
        # Structurally impossible with the composite FK; defense in depth.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device and machine do not share an organization.",
        )

    try:
        device.last_seen = now
        device.status = "ONLINE"
        device.source = payload.source

        new_reading = SensorReading(
            organization_id=device.organization_id,
            machine_id=payload.machine_id,
            device_id=payload.device_id,
            timestamp=now,
            temperature=payload.temperature,
            vibration=payload.vibration,
            current=payload.current,
            rpm=payload.rpm,
            source=payload.source,
            created_at=datetime.now(timezone.utc),
        )
        db.add(new_reading)
        db.commit()
        db.refresh(new_reading)
        evaluate_reading(machine, new_reading, db)
        db.commit()
        db.refresh(machine)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sensor data could not be stored in PostgreSQL.",
        )

    return SensorDataResponse(success=True, id=new_reading.id)


# ============================================================================
# 2. ORGANIZATION-SCOPED TELEMETRY READS
# ============================================================================
@router.get(
    "/machines/{machine_id}/latest",
    response_model=SensorReadingResponse,
    summary="Get the latest real sensor reading for a machine",
)
def get_latest_machine_reading(
    machine_id: str,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    reading = (
        db.query(SensorReading)
        .filter(
            SensorReading.organization_id == ctx.organization_id,
            SensorReading.machine_id == machine_id,
        )
        .order_by(desc(SensorReading.timestamp))
        .first()
    )
    if not reading:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No real sensor reading is available.",
        )
    return reading


@router.get(
    "/machines/{machine_id}/history",
    response_model=List[SensorReadingResponse],
    summary="Get recent real sensor readings for a machine",
)
def get_machine_history(
    machine_id: str,
    ctx: OrganizationContext = Depends(require_org_member),
    limit: int = Query(default=100, ge=1, le=1000),
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
        # Uniform, non-disclosing denial for foreign/unknown machines.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No real sensor reading is available.",
        )
    readings = (
        db.query(SensorReading)
        .filter(
            SensorReading.organization_id == ctx.organization_id,
            SensorReading.machine_id == machine_id,
        )
        .order_by(desc(SensorReading.timestamp))
        .limit(limit)
        .all()
    )
    return list(reversed(readings))


@router.get(
    "/sensor-data",
    response_model=List[SensorReadingResponse],
    summary="Get stored sensor readings for the organization",
)
def get_sensor_data(
    ctx: OrganizationContext = Depends(require_org_member),
    machine_id: Optional[str] = Query(None),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    query = db.query(SensorReading).filter(
        SensorReading.organization_id == ctx.organization_id
    )
    if machine_id:
        query = query.filter(SensorReading.machine_id == machine_id)
    readings = query.order_by(desc(SensorReading.timestamp)).limit(limit).all()
    return [SensorReadingResponse.from_orm(reading) for reading in readings]


@router.get(
    "/machines/{machine_id}/sensor-data",
    response_model=MachineSensorDataListResponse,
    summary="Get real historical sensor readings for a machine in the organization",
)
def get_machine_sensor_data(
    machine_id: str,
    ctx: OrganizationContext = Depends(require_org_member),
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
    limit: int = Query(default=100, ge=1, le=1000),
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
            detail=f"Machine '{machine_id}' was not found.",
        )

    query = db.query(SensorReading).filter(
        SensorReading.organization_id == ctx.organization_id,
        SensorReading.machine_id == machine_id,
    )
    if start_time:
        query = query.filter(SensorReading.timestamp >= start_time)
    if end_time:
        query = query.filter(SensorReading.timestamp <= end_time)

    readings = query.order_by(desc(SensorReading.timestamp)).limit(limit).all()
    if not readings:
        return MachineSensorDataListResponse(data=[], message="No sensor data available", count=0)

    sorted_readings = list(reversed(readings))
    return MachineSensorDataListResponse(
        data=[SensorReadingResponse.from_orm(r) for r in sorted_readings],
        message=f"Retrieved {len(readings)} real telemetry records",
        count=len(readings),
    )


@router.get(
    "/data-status",
    response_model=DataCollectionStatusResponse,
    summary="Get the organization's data collection status",
)
def get_data_collection_status(
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    org = ctx.organization_id
    total_readings = (
        db.query(SensorReading).filter(SensorReading.organization_id == org).count()
    )
    latest_reading = (
        db.query(SensorReading)
        .filter(SensorReading.organization_id == org)
        .order_by(desc(SensorReading.timestamp))
        .first()
    )

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=DEVICE_TIMEOUT_SECONDS)
    active_devices = (
        db.query(Device)
        .filter(Device.organization_id == org, Device.last_seen >= cutoff)
        .count()
    )

    sensor_status = "ONLINE" if active_devices > 0 else "OFFLINE"
    data_collection = "ACTIVE" if total_readings > 0 and active_devices > 0 else "WAITING"
    msg = "Data collection active" if total_readings > 0 else "Waiting for real ESP32 sensor data."

    return DataCollectionStatusResponse(
        sensor_status=sensor_status,
        last_reading=latest_reading.timestamp if latest_reading else None,
        total_readings=total_readings,
        data_collection=data_collection,
        active_devices_count=active_devices,
        message=msg,
    )
