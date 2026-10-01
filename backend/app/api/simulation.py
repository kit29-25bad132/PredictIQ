"""
Predict IQ - Simulation Configuration API Router
Provides endpoints to read, update, validate, and reset digital twin simulation parameters
for Temperature, Motor Current, RPM, and Vibration per machine.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db.database import get_db
from backend.app.db.models import Machine, MachineSimulationConfig
from backend.app.schemas.simulation import (
    SimulationConfigBase,
    SimulationConfigResponse,
    SimulationConfigUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Digital Twin Simulation Configuration"])


def _get_or_create_config(machine_id: str, db: Session) -> MachineSimulationConfig:
    machine = db.query(Machine).filter(Machine.machine_id == machine_id).first()
    if not machine:
        machine = Machine(
            machine_id=machine_id,
            name=f"Digital Twin {machine_id}",
            type="Induction Motor",
            location="Simulation Bay",
            rated_rpm=1500.0,
            rated_current=2.0,
            max_temp=60.0,
            status="Healthy",
        )
        db.add(machine)
        db.commit()
        db.refresh(machine)

    config = db.query(MachineSimulationConfig).filter(MachineSimulationConfig.machine_id == machine_id).first()
    if not config:
        # Create with machine rated specifications if available
        config = MachineSimulationConfig(
            machine_id=machine_id,
            motor_powered=True,
            simulation_mode="cycling",
            update_interval_ms=1000,
            # Temperature
            temp_min=22.0,
            temp_max=machine.max_temp if machine.max_temp and machine.max_temp > 25.0 else 45.0,
            temp_target=32.0,
            temp_step=0.2,
            temp_warning=45.0,
            temp_critical=machine.max_temp or 60.0,
            # Current
            current_min=0.2,
            current_max=machine.rated_current * 1.5 if machine.rated_current else 3.0,
            current_target=machine.rated_current * 0.8 if machine.rated_current else 1.2,
            current_step=0.1,
            current_warning=machine.rated_current or 2.0,
            current_critical=machine.rated_current * 1.5 if machine.rated_current else 3.0,
            # RPM
            rpm_min=0.0,
            rpm_max=machine.rated_rpm * 1.2 if machine.rated_rpm else 1800.0,
            rpm_target=machine.rated_rpm or 1450.0,
            rpm_step=50.0,
            rpm_rated=machine.rated_rpm or 1500.0,
            rpm_warning=(machine.rated_rpm * 0.7) if machine.rated_rpm else 1050.0,
            rpm_critical=(machine.rated_rpm * 0.5) if machine.rated_rpm else 750.0,
            # Vibration
            vib_min=0.1,
            vib_max=machine.max_vibration * 1.5 if machine.max_vibration else 5.0,
            vib_target=0.8,
            vib_step=0.05,
            vib_warning=machine.max_vibration or 1.5,
            vib_critical=machine.max_vibration * 1.5 if machine.max_vibration else 3.0,
        )
        db.add(config)
        db.commit()
        db.refresh(config)

    return config


@router.get(
    "/machines/{machine_id}/simulation-config",
    response_model=SimulationConfigResponse,
    summary="Get saved simulation configuration for a machine",
)
def get_simulation_config(
    machine_id: str,
    db: Session = Depends(get_db),
) -> SimulationConfigResponse:
    """Returns the persistent simulation configuration for the given machine asset."""
    config = _get_or_create_config(machine_id, db)
    return SimulationConfigResponse.model_validate(config)


@router.post(
    "/machines/{machine_id}/simulation-config",
    response_model=SimulationConfigResponse,
    summary="Save simulation configuration for a machine",
)
@router.put(
    "/machines/{machine_id}/simulation-config",
    response_model=SimulationConfigResponse,
    summary="Update simulation configuration for a machine",
)
def update_simulation_config(
    machine_id: str,
    payload: SimulationConfigUpdate,
    db: Session = Depends(get_db),
) -> SimulationConfigResponse:
    """Updates and validates simulation parameters for Temperature, Current, RPM, and Vibration."""
    config = _get_or_create_config(machine_id, db)

    # Apply all validated fields
    data = payload.model_dump()
    for key, value in data.items():
        if hasattr(config, key):
            setattr(config, key, value)

    config.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(config)
    logger.info("Updated simulation config for machine '%s'", machine_id)
    return SimulationConfigResponse.model_validate(config)


@router.post(
    "/machines/{machine_id}/simulation-config/reset",
    response_model=SimulationConfigResponse,
    summary="Reset simulation configuration to factory defaults",
)
def reset_simulation_config(
    machine_id: str,
    db: Session = Depends(get_db),
) -> SimulationConfigResponse:
    """Resets machine simulation configuration to baseline defaults."""
    machine = db.query(Machine).filter(Machine.machine_id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine '{machine_id}' does not exist in registry.",
        )

    config = db.query(MachineSimulationConfig).filter(MachineSimulationConfig.machine_id == machine_id).first()
    defaults = SimulationConfigBase()

    if not config:
        config = MachineSimulationConfig(machine_id=machine_id)
        db.add(config)

    for key, value in defaults.model_dump().items():
        if hasattr(config, key):
            setattr(config, key, value)

    config.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(config)
    logger.info("Reset simulation config for machine '%s' to defaults", machine_id)
    return SimulationConfigResponse.model_validate(config)
