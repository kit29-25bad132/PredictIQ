"""
Predict IQ - Machine Assets & Device Management API Endpoints (PostgreSQL)
Handles industrial machine registration, ESP32 device tracking, device heartbeats, and real asset status.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from datetime import datetime, timedelta, timezone

from backend.app.core.auth import require_api_key
from backend.app.core.config import get_settings
from backend.app.db.database import get_db
from backend.app.db.models import Machine, Device, SensorReading
from backend.app.schemas.sensor import (
    MachineCreate,
    MachineSpecifications,
    MachineResponse,
    DeviceCreate,
    DeviceResponse,
    DeviceHeartbeatInput,
    DeviceHeartbeatResponse,
    DeviceStatusDetailResponse,
    SensorReadingResponse
)

router = APIRouter(tags=["Machines & Devices (ESP32)"])

DEVICE_TIMEOUT_SECONDS = get_settings().device_timeout_seconds

def compute_device_status(
    last_seen: Optional[datetime],
    now: Optional[datetime] = None,
) -> str:
    if not last_seen:
        return "OFFLINE"
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    return "ONLINE" if (current_time - last_seen).total_seconds() <= DEVICE_TIMEOUT_SECONDS else "OFFLINE"

# ============================================================================
# 1. MACHINE ASSET ENDPOINTS
# ============================================================================
@router.get("/machines", response_model=List[MachineResponse], summary="List all registered industrial machines")
def list_machines(db: Session = Depends(get_db)):
    """
    Returns all machine assets from PostgreSQL along with registered devices and latest real telemetry.
    """
    machines = db.query(Machine).order_by(Machine.created_at.desc()).all()
    results = []
    
    for m in machines:
        latest_reading = (
            db.query(SensorReading)
            .filter(SensorReading.machine_id == m.machine_id)
            .order_by(desc(SensorReading.timestamp))
            .first()
        )
        
        devices = db.query(Device).filter(Device.machine_id == m.machine_id).all()
        dev_responses = [
            DeviceResponse(
                id=d.id,
                device_id=d.device_id,
                machine_id=d.machine_id,
                device_type=d.device_type,
                firmware_version=d.firmware_version,
                status=compute_device_status(d.last_seen),
                last_seen=d.last_seen,
                source=d.source,
                created_at=d.created_at
            )
            for d in devices
        ]

        results.append(
            MachineResponse(
                id=m.id,
                machine_id=m.machine_id,
                name=m.name,
                type=m.type,
                location=m.location,
                status=m.status,
                specifications=MachineSpecifications(
                    rated_rpm=m.rated_rpm,
                    rated_current=m.rated_current,
                    max_temp=m.max_temp,
                    max_vibration=m.max_vibration,
                ),
                created_at=m.created_at,
                devices=dev_responses,
                latest_reading=SensorReadingResponse.from_orm(latest_reading) if latest_reading else None
            )
        )
    return results

@router.get("/machines/{machine_id}", response_model=MachineResponse, summary="Get details for a specific machine asset")
def get_machine(machine_id: str, db: Session = Depends(get_db)):
    """
    Retrieves complete profile, assigned devices, and latest real reading for a single machine from PostgreSQL.
    """
    m = db.query(Machine).filter(Machine.machine_id == machine_id).first()
    if not m:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine with ID '{machine_id}' was not found in PostgreSQL registry."
        )

    latest_reading = (
        db.query(SensorReading)
        .filter(SensorReading.machine_id == machine_id)
        .order_by(desc(SensorReading.timestamp))
        .first()
    )

    devices = db.query(Device).filter(Device.machine_id == machine_id).all()
    dev_responses = [
        DeviceResponse(
            id=d.id,
            device_id=d.device_id,
            machine_id=d.machine_id,
            device_type=d.device_type,
            firmware_version=d.firmware_version,
            status=compute_device_status(d.last_seen),
            last_seen=d.last_seen,
            source=d.source,
            created_at=d.created_at
        )
        for d in devices
    ]

    return MachineResponse(
        id=m.id,
        machine_id=m.machine_id,
        name=m.name,
        type=m.type,
        location=m.location,
        status=m.status,
        specifications=MachineSpecifications(
            rated_rpm=m.rated_rpm,
            rated_current=m.rated_current,
            max_temp=m.max_temp,
            max_vibration=m.max_vibration,
        ),
        created_at=m.created_at,
        devices=dev_responses,
        latest_reading=SensorReadingResponse.from_orm(latest_reading) if latest_reading else None
    )

@router.post("/machines", response_model=MachineResponse, status_code=status.HTTP_201_CREATED, summary="Register a new machine asset",
             dependencies=[Depends(require_api_key)])
def create_machine(data: MachineCreate, db: Session = Depends(get_db)):
    """
    Registers a new industrial machine asset in PostgreSQL.
    """
    existing = db.query(Machine).filter(Machine.machine_id == data.machine_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Machine ID '{data.machine_id}' is already registered."
        )

    new_machine = Machine(
        machine_id=data.machine_id,
        name=data.name,
        type=data.type,
        location=data.location,
        status=data.status or "Healthy",
        rated_rpm=data.specifications.rated_rpm if data.specifications else None,
        rated_current=data.specifications.rated_current if data.specifications else None,
        max_temp=data.specifications.max_temp if data.specifications else None,
        max_vibration=data.specifications.max_vibration if data.specifications else None,
        created_at=datetime.now(timezone.utc)
    )
    db.add(new_machine)
    db.commit()
    db.refresh(new_machine)

    return MachineResponse(
        id=new_machine.id,
        machine_id=new_machine.machine_id,
        name=new_machine.name,
        type=new_machine.type,
        location=new_machine.location,
        status=new_machine.status,
        specifications=MachineSpecifications(
            rated_rpm=new_machine.rated_rpm,
            rated_current=new_machine.rated_current,
            max_temp=new_machine.max_temp,
            max_vibration=new_machine.max_vibration,
        ),
        created_at=new_machine.created_at,
        devices=[],
        latest_reading=None
    )

# ============================================================================
# 2. DEVICE (ESP32) ENDPOINTS
# ============================================================================
@router.get("/devices", response_model=List[DeviceResponse], summary="List all registered ESP32 IoT devices")
def list_devices(db: Session = Depends(get_db)):
    """
    Returns all registered ESP32 hardware devices and computes connection status based on last_seen.
    """
    devices = db.query(Device).all()
    return [
        DeviceResponse(
            id=d.id,
            device_id=d.device_id,
            machine_id=d.machine_id,
            device_type=d.device_type,
            firmware_version=d.firmware_version,
            status=compute_device_status(d.last_seen),
            last_seen=d.last_seen,
            source=d.source,
            created_at=d.created_at
        )
        for d in devices
    ]

@router.post("/devices", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED, summary="Register an ESP32 hardware device to a machine",
             dependencies=[Depends(require_api_key)])
def register_device(payload: DeviceCreate, db: Session = Depends(get_db)):
    """
    Registers an ESP32 IoT node to a target machine in PostgreSQL.
    """
    machine = db.query(Machine).filter(Machine.machine_id == payload.machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target machine '{payload.machine_id}' does not exist in registry."
        )

    existing_dev = db.query(Device).filter(Device.device_id == payload.device_id).first()
    if existing_dev:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device ID '{payload.device_id}' is already registered to machine '{existing_dev.machine_id}'."
        )

    new_device = Device(
        device_id=payload.device_id,
        machine_id=payload.machine_id,
        device_type=payload.device_type or "ESP32",
        firmware_version=payload.firmware_version or "1.0.0",
        status="OFFLINE",
        last_seen=None,
        created_at=datetime.now(timezone.utc)
    )
    db.add(new_device)
    db.commit()
    db.refresh(new_device)

    return DeviceResponse(
        id=new_device.id,
        device_id=new_device.device_id,
        machine_id=new_device.machine_id,
        device_type=new_device.device_type,
        firmware_version=new_device.firmware_version,
        status="OFFLINE",
        last_seen=None,
        source="REAL_HARDWARE",
        created_at=new_device.created_at
    )

@router.get("/devices/{device_id}", response_model=DeviceResponse, summary="Get details for a specific device")
def get_device(device_id: str, db: Session = Depends(get_db)):
    """
    Returns single ESP32 device metadata from PostgreSQL.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{device_id}' not found."
        )

    return DeviceResponse(
        id=device.id,
        device_id=device.device_id,
        machine_id=device.machine_id,
        device_type=device.device_type,
        firmware_version=device.firmware_version,
        status=compute_device_status(device.last_seen),
        last_seen=device.last_seen,
        created_at=device.created_at
    )

@router.get("/devices/{device_id}/status", response_model=DeviceStatusDetailResponse, summary="Get real connection and sensor availability status for an ESP32")
def get_device_status(device_id: str, db: Session = Depends(get_db)):
    """
    Returns real-time connection status (CONNECTED/OFFLINE), last_seen timestamp, and latest telemetry snapshot.
    """
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{device_id}' not found."
        )

    latest_reading = (
        db.query(SensorReading)
        .filter(SensorReading.device_id == device_id)
        .order_by(desc(SensorReading.timestamp))
        .first()
    )

    computed_status = compute_device_status(device.last_seen)

    return DeviceStatusDetailResponse(
        device_id=device.device_id,
        machine_id=device.machine_id,
        device_type=device.device_type,
        firmware_version=device.firmware_version,
        status=computed_status,
        last_seen=device.last_seen,
        temperature_status="CONNECTED" if latest_reading and latest_reading.temperature is not None else "NOT_CONFIGURED",
        vibration_status="CONNECTED" if latest_reading and latest_reading.vibration is not None else "NOT_CONFIGURED",
        current_status="CONNECTED" if latest_reading and latest_reading.current is not None else "NOT_CONFIGURED",
        rpm_status="CONNECTED" if latest_reading and latest_reading.rpm is not None else "NOT_CONFIGURED",
        last_reading=SensorReadingResponse.from_orm(latest_reading) if latest_reading else None
    )

# ============================================================================
# 3. ESP32 DEVICE HEARTBEAT ENDPOINT
# ============================================================================
@router.post(
    "/devices/heartbeat",
    response_model=DeviceHeartbeatResponse,
    summary="Acknowledge ESP32 device heartbeat and update last_seen",
    dependencies=[Depends(require_api_key)],
)
def record_device_heartbeat(payload: DeviceHeartbeatInput, db: Session = Depends(get_db)):
    """
    Receives periodic ping from an active ESP32.
    Updates device.last_seen in PostgreSQL so dashboard displays real CONNECTED state.
    """
    now = payload.timestamp or datetime.now(timezone.utc)

    try:
        machine = db.query(Machine).filter(Machine.machine_id == payload.machine_id).first()
        if not machine:
            machine = Machine(
                machine_id=payload.machine_id,
                name=f"Asset {payload.machine_id}",
                type="Industrial Asset",
                location="Plant Floor",
                status="Healthy",
                created_at=now
            )
            db.add(machine)
            db.flush()

        device = db.query(Device).filter(Device.device_id == payload.device_id).first()
        if device and device.machine_id != payload.machine_id:
            raise HTTPException(status_code=400, detail="Device is already assigned to another machine.")
        if not device:
            device = Device(
                device_id=payload.device_id,
                machine_id=payload.machine_id,
                device_type=payload.device_type or "ESP32",
                firmware_version=payload.firmware_version or "1.0.0",
                status="ONLINE",
                last_seen=now,
                source=payload.source,
                created_at=now
            )
            db.add(device)
        else:
            device.last_seen = now
            device.status = "ONLINE"
            device.source = payload.source
            if payload.firmware_version:
                device.firmware_version = payload.firmware_version

        db.commit()
        db.refresh(device)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise HTTPException(status_code=503, detail="Heartbeat could not be stored in PostgreSQL.")

    return DeviceHeartbeatResponse(
        success=True,
        message="Heartbeat recorded successfully",
        device_id=device.device_id,
        machine_id=device.machine_id,
        status="ONLINE",
        last_seen=now
    )
