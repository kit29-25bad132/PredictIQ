"""Deterministic telemetry health evaluation and alert production."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from sqlalchemy.orm import Session

from backend.app.db.models import Alert, Machine, SensorReading


DEFAULT_RATED_RPM = 1450.0
DEFAULT_RATED_CURRENT = 10.0
DEFAULT_MAX_TEMP = 75.0
DEFAULT_MAX_VIBRATION = 4.5
ALERT_COOLDOWN = timedelta(minutes=5)


@dataclass(frozen=True)
class HealthEvaluation:
    state: str
    machine_status: str
    metric_states: Dict[str, str]


def _state_for_ratio(ratio: float) -> str:
    if ratio >= 1.2:
        return "CRITICAL"
    if ratio >= 1.0:
        return "WARNING"
    return "NORMAL"


def _rpm_state(rpm: float, rated_rpm: float) -> str:
    deviation = abs(rpm - rated_rpm) / rated_rpm if rated_rpm else 0.0
    if deviation >= 0.2:
        return "CRITICAL"
    if deviation >= 0.1:
        return "WARNING"
    return "NORMAL"


def _machine_status(state: str) -> str:
    return {"NORMAL": "Healthy", "WARNING": "Warning", "CRITICAL": "Critical"}[state]


def _normalise_timestamp(value: Optional[datetime]) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def evaluate_reading(machine: Machine, reading: SensorReading, db: Session) -> HealthEvaluation:
    """Evaluate one persisted reading, update its machine, and persist alerts."""
    rated_rpm = machine.rated_rpm if machine.rated_rpm is not None else DEFAULT_RATED_RPM
    rated_current = machine.rated_current if machine.rated_current is not None else DEFAULT_RATED_CURRENT
    max_temp = machine.max_temp if machine.max_temp is not None else DEFAULT_MAX_TEMP
    max_vibration = machine.max_vibration if machine.max_vibration is not None else DEFAULT_MAX_VIBRATION

    metric_states: Dict[str, str] = {}
    metric_values = {
        "TEMPERATURE_HIGH": (reading.temperature, max_temp),
        "VIBRATION_HIGH": (reading.vibration, max_vibration),
        "CURRENT_HIGH": (reading.current, rated_current),
    }
    for alert_type, (value, limit) in metric_values.items():
        if value is not None:
            metric_states[alert_type] = _state_for_ratio(value / limit if limit else 0.0)
    if reading.rpm is not None:
        metric_states["RPM_DEVIATION"] = _rpm_state(reading.rpm, rated_rpm)

    state = max(
        (metric_states.values() or ["NORMAL"]),
        key={"NORMAL": 0, "WARNING": 1, "CRITICAL": 2}.get,
    )
    machine.status = _machine_status(state)

    observed_at = _normalise_timestamp(reading.timestamp)
    for alert_type, metric_state in metric_states.items():
        if metric_state == "NORMAL":
            continue
        severity = "Critical" if metric_state == "CRITICAL" else "Warning"
        recent = (
            db.query(Alert)
            .filter(
                Alert.machine_id == machine.machine_id,
                Alert.alert_type == alert_type,
                Alert.status != "RESOLVED",
                Alert.created_at >= observed_at - ALERT_COOLDOWN,
            )
            .first()
        )
        if recent is None:
            db.add(
                Alert(
                    machine_id=machine.machine_id,
                    alert_type=alert_type,
                    severity=severity,
                    message=f"{alert_type.replace('_', ' ').title()} detected for machine {machine.machine_id}.",
                    status="ACTIVE",
                    created_at=observed_at,
                )
            )

    return HealthEvaluation(state=state, machine_status=machine.status, metric_states=metric_states)


class HealthEngine:
    """Small injectable facade retained for service-level tests and callers."""

    @staticmethod
    def evaluate(machine: Machine, reading: SensorReading, db: Session) -> HealthEvaluation:
        return evaluate_reading(machine, reading, db)