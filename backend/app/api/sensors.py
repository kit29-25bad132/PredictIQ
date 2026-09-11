"""
Predict IQ - Real Sensor Data Telemetry Ingestion & Query Endpoints (PostgreSQL)
Receives authentic ESP32 time-series readings, validates against physical limits,
updates device connection status, and stores records in PostgreSQL.
Strictly zero fake, synthetic, or mock data generation.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Optional
from datetime import datetime, timedelta

from backend.app.core.config import get_settings
from backend.database.database import get_db
from backend.database.models import Machine, Device, SensorReading, Alert
from backend.schemas.sensor import (
    SensorDataInput,
    SensorDataResponse,
    SensorReadingResponse,
    MachineSensorDataListResponse,
    DataCollectionStatusResponse
)

router = APIRouter(tags=["Real Sensor Telemetry (ESP32)"])

# Configurable device offline timeout (seconds)
DEVICE_TIMEOUT_SECONDS = get_settings().device_timeout_seconds

def get_device_computed_status(last_seen: Optional[datetime]) -> str:
    if not last_seen:
        return "OFFLINE"
    diff_seconds = (datetime.utcnow() - last_seen).total_seconds()
    return "ONLINE" if diff_seconds <= DEVICE_TIMEOUT_SECONDS else "OFFLINE"

# ============================================================================
# 1. INGEST REAL ESP32 SENSOR DATA
# ============================================================================
@router.post(
    "/sensor-data",
    response_model=SensorDataResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest real-time IoT sensor readings from ESP32"
)
def ingest_sensor_data(payload: SensorDataInput, db: Session = Depends(get_db)):
    """
    Ingests genuine ESP32 telemetry.
    1. Verifies that machine exists (or provisions asset if new deployment).
    2. Verifies that device exists and belongs to the specified machine.
    3. Validates timestamp and numerical bounds.
    4. Updates device last_seen and status in PostgreSQL.
    5. Saves reading to sensor_readings table.
    """
    now = payload.timestamp

    try:
        machine = db.query(Machine).filter(Machine.machine_id == payload.machine_id).first()
        if not machine:
            machine = Machine(
                machine_id=payload.machine_id,
                name=f"Asset {payload.machine_id}",
                type="Industrial Asset",
                location="Plant Floor - Real IoT Ingestion",
                status="Healthy",
                created_at=now
            )
            db.add(machine)
            db.flush()

        device = db.query(Device).filter(Device.device_id == payload.device_id).first()
        if not device:
            device = Device(
                device_id=payload.device_id,
                machine_id=payload.machine_id,
                device_type="ESP32",
                firmware_version="v1.0.0",
                status="ONLINE",
                last_seen=now,
                source=payload.source,
                created_at=now
            )
            db.add(device)
        elif device.machine_id != payload.machine_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Device '{payload.device_id}' is already registered to machine '{device.machine_id}', not '{payload.machine_id}'."
            )
        else:
            device.last_seen = now
            device.status = "ONLINE"
            device.source = payload.source

        new_reading = SensorReading(
            machine_id=payload.machine_id,
            device_id=payload.device_id,
            timestamp=now,
            temperature=payload.temperature,
            vibration=payload.vibration,
            current=payload.current,
            rpm=payload.rpm,
            source=payload.source,
            created_at=datetime.utcnow()
        )
        db.add(new_reading)
        db.commit()
        db.refresh(new_reading)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sensor data could not be stored in PostgreSQL."
        )

    return SensorDataResponse(
        success=True,
        id=new_reading.id
    )

@router.get(
    "/machines/{machine_id}/latest",
    response_model=SensorReadingResponse,
    summary="Get the latest real sensor reading for a machine"
)
def get_latest_machine_reading(machine_id: str, db: Session = Depends(get_db)):
    reading = (
        db.query(SensorReading)
        .filter(SensorReading.machine_id == machine_id)
        .order_by(desc(SensorReading.timestamp))
        .first()
    )
    if not reading:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No real sensor reading is available.")
    return reading

@router.get(
    "/machines/{machine_id}/history",
    response_model=List[SensorReadingResponse],
    summary="Get recent real sensor readings for a machine"
)
def get_machine_history(
    machine_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    readings = (
        db.query(SensorReading)
        .filter(SensorReading.machine_id == machine_id)
        .order_by(desc(SensorReading.timestamp))
        .limit(limit)
        .all()
    )
    return list(reversed(readings))

@router.get(
    "/sensor-data",
    response_model=List[SensorReadingResponse],
    summary="Get stored sensor readings"
)
def get_sensor_data(
    machine_id: Optional[str] = Query(None),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    query = db.query(SensorReading)
    if machine_id:
        query = query.filter(SensorReading.machine_id == machine_id)
    readings = query.order_by(desc(SensorReading.timestamp)).limit(limit).all()
    return [SensorReadingResponse.from_orm(reading) for reading in readings]

# ============================================================================
# 2. QUERY REAL HISTORICAL SENSOR TELEMETRY BY MACHINE
# ============================================================================
@router.get(
    "/machines/{machine_id}/sensor-data",
    response_model=MachineSensorDataListResponse,
    summary="Get real historical sensor readings for a specific machine asset"
)
def get_machine_sensor_data(
    machine_id: str,
    start_time: Optional[datetime] = Query(None, description="Filter readings starting from ISO timestamp"),
    end_time: Optional[datetime] = Query(None, description="Filter readings up to ISO timestamp"),
    limit: int = Query(default=100, ge=1, le=1000, description="Max readings to retrieve"),
    db: Session = Depends(get_db)
):
    """
    Retrieves real sensor readings from PostgreSQL with time range filtering and pagination.
    Returns empty data list if no records exist. Never fabricates sensor measurements.
    """
    machine = db.query(Machine).filter(Machine.machine_id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine '{machine_id}' was not found in the PostgreSQL asset registry."
        )

    query = db.query(SensorReading).filter(SensorReading.machine_id == machine_id)
    
    if start_time:
        query = query.filter(SensorReading.timestamp >= start_time)
    if end_time:
        query = query.filter(SensorReading.timestamp <= end_time)

    # Order newest first for querying, then limit
    readings = query.order_by(desc(SensorReading.timestamp)).limit(limit).all()

    if not readings:
        return MachineSensorDataListResponse(
            data=[],
            message="No sensor data available",
            count=0
        )

    # Return chronological order (oldest to newest) for charting
    sorted_readings = list(reversed(readings))
    return MachineSensorDataListResponse(
        data=[SensorReadingResponse.from_orm(r) for r in sorted_readings],
        message=f"Retrieved {len(readings)} real telemetry records",
        count=len(readings)
    )

# ============================================================================
# 3. GET FLEET DATA COLLECTION STATUS
# ============================================================================
@router.get(
    "/data-status",
    response_model=DataCollectionStatusResponse,
    summary="Get real-time data collection and sensor connectivity status"
)
def get_data_collection_status(db: Session = Depends(get_db)):
    """
    Returns actual data collection metrics computed directly from PostgreSQL:
    - Total readings stored
    - Latest reading timestamp
    - Connected ESP32 devices count
    - Active vs Waiting status
    """
    total_readings = db.query(SensorReading).count()
    latest_reading = db.query(SensorReading).order_by(desc(SensorReading.timestamp)).first()
    
    # Check active devices
    cutoff = datetime.utcnow() - timedelta(seconds=DEVICE_TIMEOUT_SECONDS)
    active_devices = db.query(Device).filter(Device.last_seen >= cutoff).count()

    sensor_status = "ONLINE" if active_devices > 0 else "OFFLINE"
    data_collection = "ACTIVE" if total_readings > 0 and active_devices > 0 else "WAITING"
    
    msg = "Data collection active" if total_readings > 0 else "Waiting for real ESP32 sensor data."

    return DataCollectionStatusResponse(
        sensor_status=sensor_status,
        last_reading=latest_reading.timestamp if latest_reading else None,
        total_readings=total_readings,
        data_collection=data_collection,
        active_devices_count=active_devices,
        message=msg
    )
