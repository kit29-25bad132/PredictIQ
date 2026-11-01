"""
Predict IQ - Machine Assets & Device Management API Endpoints (PostgreSQL)

Phase 3 (multi-tenant): every query is scoped to the caller's verified
organization. Reads require any active membership; machine/device
administration requires owner or admin. Cross-organization identifiers return a
uniform 404 so existence is never disclosed.

Device heartbeat stays on the existing API-key gate: the registered device row
is the authority for its organization, and unknown devices are rejected rather
than auto-provisioned.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from backend.app.core.auth import require_api_key
from backend.app.core.config import get_settings
from backend.app.core.tenant import (
    OrganizationContext,
    require_org_admin,
    require_org_member,
)
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
    SensorReadingResponse,
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


def _device_response(device: Device) -> DeviceResponse:
    return DeviceResponse(
        id=device.id,
        device_id=device.device_id,
        machine_id=device.machine_id,
        device_type=device.device_type,
        firmware_version=device.firmware_version,
        status=compute_device_status(device.last_seen),
        last_seen=device.last_seen,
        source=device.source,
        created_at=device.created_at,
    )


def _machine_response(machine: Machine, db: Session, organization_id) -> MachineResponse:
    latest_reading = (
        db.query(SensorReading)
        .filter(
            SensorReading.organization_id == organization_id,
            SensorReading.machine_id == machine.machine_id,
        )
        .order_by(desc(SensorReading.timestamp))
        .first()
    )
    devices = (
        db.query(Device)
        .filter(
            Device.organization_id == organization_id,
            Device.machine_id == machine.machine_id,
        )
        .all()
    )
    return MachineResponse(
        id=machine.id,
        machine_id=machine.machine_id,
        name=machine.name,
        type=machine.type,
        location=machine.location,
        status=machine.status,
        specifications=MachineSpecifications(
            rated_rpm=machine.rated_rpm,
            rated_current=machine.rated_current,
            max_temp=machine.max_temp,
            max_vibration=machine.max_vibration,
        ),
        created_at=machine.created_at,
        devices=[_device_response(d) for d in devices],
        latest_reading=SensorReadingResponse.from_orm(latest_reading) if latest_reading else None,
    )


# ============================================================================
# 1. MACHINE ASSET ENDPOINTS (organization-scoped reads, admin writes)
# ============================================================================
@router.get("/machines", response_model=List[MachineResponse],
            summary="List the organization's industrial machines")
def list_machines(
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    machines = (
        db.query(Machine)
        .filter(Machine.organization_id == ctx.organization_id)
        .order_by(Machine.created_at.desc())
        .all()
    )
    return [_machine_response(m, db, ctx.organization_id) for m in machines]


@router.get("/machines/{machine_id}", response_model=MachineResponse,
            summary="Get a machine asset in the caller's organization")
def get_machine(
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
        # Uniform non-disclosing denial for missing AND foreign machines.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine '{machine_id}' was not found.",
        )
    return _machine_response(machine, db, ctx.organization_id)


def create_machine(data: MachineCreate, db: Session, organization_id) -> MachineResponse:
    """Create a machine inside an explicitly resolved organization."""
    existing = db.query(Machine).filter(Machine.machine_id == data.machine_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Machine ID '{data.machine_id}' is already registered.",
        )

    new_machine = Machine(
        organization_id=organization_id,
        machine_id=data.machine_id,
        name=data.name,
        type=data.type,
        location=data.location,
        status=data.status or "Healthy",
        rated_rpm=data.specifications.rated_rpm if data.specifications else None,
        rated_current=data.specifications.rated_current if data.specifications else None,
        max_temp=data.specifications.max_temp if data.specifications else None,
        max_vibration=data.specifications.max_vibration if data.specifications else None,
        created_at=datetime.now(timezone.utc),
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
        latest_reading=None,
    )


@router.post("/machines", response_model=MachineResponse,
             status_code=status.HTTP_201_CREATED,
             summary="Register a machine in the caller's organization (owner/admin)")
def register_machine(
    data: MachineCreate,
    ctx: OrganizationContext = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    # organization_id comes from the verified membership; any value supplied in
    # the request body is ignored by the schema and never consulted here.
    return create_machine(data, db, ctx.organization_id)


# ============================================================================
# 2. DEVICE (ESP32) ENDPOINTS
# ============================================================================
@router.get("/devices", response_model=List[DeviceResponse],
            summary="List the organization's registered ESP32 devices")
def list_devices(
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    devices = (
        db.query(Device)
        .filter(Device.organization_id == ctx.organization_id)
        .all()
    )
    return [_device_response(d) for d in devices]


def register_device(payload: DeviceCreate, db: Session, organization_id=None) -> DeviceResponse:
    """Register a device; the machine must live in the same organization."""
    query = db.query(Machine).filter(Machine.machine_id == payload.machine_id)
    if organization_id is not None:
        query = query.filter(Machine.organization_id == organization_id)
    machine = query.first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target machine '{payload.machine_id}' was not found.",
        )

    existing_dev = db.query(Device).filter(Device.device_id == payload.device_id).first()
    if existing_dev:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device ID '{payload.device_id}' is already registered.",
        )

    new_device = Device(
        organization_id=machine.organization_id,
        device_id=payload.device_id,
        machine_id=payload.machine_id,
        device_type=payload.device_type or "ESP32",
        firmware_version=payload.firmware_version or "1.0.0",
        status="OFFLINE",
        last_seen=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(new_device)
    db.commit()
    db.refresh(new_device)
    return _device_response(new_device)


@router.post("/devices", response_model=DeviceResponse,
             status_code=status.HTTP_201_CREATED,
             summary="Register an ESP32 device to a machine (owner/admin)")
def register_device_endpoint(
    payload: DeviceCreate,
    ctx: OrganizationContext = Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    return register_device(payload, db, ctx.organization_id)


@router.get("/devices/{device_id}", response_model=DeviceResponse,
            summary="Get a device in the caller's organization")
def get_device(
    device_id: str,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    device = (
        db.query(Device)
        .filter(
            Device.organization_id == ctx.organization_id,
            Device.device_id == device_id,
        )
        .first()
    )
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{device_id}' not found.",
        )
    return _device_response(device)


@router.get("/devices/{device_id}/status", response_model=DeviceStatusDetailResponse,
            summary="Get connection and sensor availability for a device")
def get_device_status(
    device_id: str,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
):
    device = (
        db.query(Device)
        .filter(
            Device.organization_id == ctx.organization_id,
            Device.device_id == device_id,
        )
        .first()
    )
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{device_id}' not found.",
        )

    latest_reading = (
        db.query(SensorReading)
        .filter(
            SensorReading.organization_id == ctx.organization_id,
            SensorReading.device_id == device_id,
        )
        .order_by(desc(SensorReading.timestamp))
        .first()
    )

    return DeviceStatusDetailResponse(
        device_id=device.device_id,
        machine_id=device.machine_id,
        device_type=device.device_type,
        firmware_version=device.firmware_version,
        status=compute_device_status(device.last_seen),
        last_seen=device.last_seen,
        temperature_status="CONNECTED" if latest_reading and latest_reading.temperature is not None else "NOT_CONFIGURED",
        vibration_status="CONNECTED" if latest_reading and latest_reading.vibration is not None else "NOT_CONFIGURED",
        current_status="CONNECTED" if latest_reading and latest_reading.current is not None else "NOT_CONFIGURED",
        rpm_status="CONNECTED" if latest_reading and latest_reading.rpm is not None else "NOT_CONFIGURED",
        last_reading=SensorReadingResponse.from_orm(latest_reading) if latest_reading else None,
    )


# ============================================================================
# 3. ESP32 DEVICE HEARTBEAT (device API key only)
# ============================================================================
@router.post(
    "/devices/heartbeat",
    response_model=DeviceHeartbeatResponse,
    summary="Acknowledge ESP32 device heartbeat and update last_seen",
    dependencies=[Depends(require_api_key)],
)
def record_device_heartbeat(payload: DeviceHeartbeatInput, db: Session = Depends(get_db)):
    """Device-authenticated heartbeat for an ALREADY REGISTERED device.

    Unknown device IDs are rejected (404) instead of being auto-provisioned:
    silent provisioning would let any holder of the shared device key create
    rows inside an arbitrary tenant. The device row supplies the organization.
    """
    now = payload.timestamp or datetime.now(timezone.utc)

    device = db.query(Device).filter(Device.device_id == payload.device_id).first()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device '{payload.device_id}' is not registered. Provision it before sending telemetry.",
        )

    if device.machine_id != payload.machine_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device is assigned to a different machine.",
        )

    machine = db.query(Machine).filter(Machine.machine_id == device.machine_id).first()
    if machine is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device's machine no longer exists.",
        )

    try:
        device.last_seen = now
        device.status = "ONLINE"
        device.source = payload.source
        if payload.firmware_version:
            device.firmware_version = payload.firmware_version
        db.commit()
        db.refresh(device)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=503, detail="Heartbeat could not be stored in PostgreSQL.")

    return DeviceHeartbeatResponse(
        success=True,
        message="Heartbeat recorded successfully",
        device_id=device.device_id,
        machine_id=device.machine_id,
        status="ONLINE",
        last_seen=now,
    )
