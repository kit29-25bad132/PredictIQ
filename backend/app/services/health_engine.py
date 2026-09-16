"""Deterministic telemetry health evaluation, alert production, and prototype prediction trigger.

Prediction linkage (V1 plan §10 spine): when an ingested reading drives a
machine to WARNING or CRITICAL and all four telemetry channels are present, a
deterministic prototype prediction is generated and persisted automatically so
technician feedback can link to it. Guard rails:

- Only complete readings (temperature, vibration, current, rpm) produce a
  prediction — no fabricated inputs.
- One prediction per machine per PREDICTION_COOLDOWN window, so repeated
  degraded readings do not spam the predictions table.
- The same physics-rule engine as POST /api/predict is used; output stays
  honestly labeled is_prototype=True with no RUL and no invented confidence.
- Prediction failure never fails the ingest: the reading and health state are
  still committed and the error is logged.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from sqlalchemy.orm import Session

from backend.app.db.models import Alert, Machine, Prediction, SensorReading

logger = logging.getLogger(__name__)

DEFAULT_RATED_RPM = 1450.0
DEFAULT_RATED_CURRENT = 10.0
DEFAULT_MAX_TEMP = 75.0
DEFAULT_MAX_VIBRATION = 4.5
ALERT_COOLDOWN = timedelta(minutes=5)
PREDICTION_COOLDOWN = timedelta(minutes=10)


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

    if state in ("WARNING", "CRITICAL"):
        _maybe_generate_prototype_prediction(machine, reading, state, observed_at, db)

    return HealthEvaluation(state=state, machine_status=machine.status, metric_states=metric_states)


def _maybe_generate_prototype_prediction(
    machine: Machine,
    reading: SensorReading,
    state: str,
    observed_at: datetime,
    db: Session,
) -> None:
    """Persist one prototype prediction per cooldown window for degraded readings.

    Uses the identical deterministic engine as POST /api/predict. Never
    fabricated: requires all four channels, and any engine failure is logged
    without corrupting the telemetry transaction.
    """
    if None in (reading.temperature, reading.vibration, reading.current, reading.rpm):
        return

    recent_prediction = (
        db.query(Prediction)
        .filter(
            Prediction.machine_id == machine.machine_id,
            # Cooldown runs on the TELEMETRY timeline (Prediction.timestamp holds
            # the reading's observed_at), not wall-clock created_at: replayed or
            # backdated readings must still dedupe, and a cooldown measured in
            # wall-clock time would never expire for historical timestamps.
            Prediction.timestamp >= observed_at - PREDICTION_COOLDOWN,
        )
        .first()
    )
    if recent_prediction is not None:
        return

    try:
        # Imported lazily to avoid an import cycle (prediction service pulls in
        # the ml package; the health engine must stay importable without it).
        from backend.app.services.prediction_service import prediction_service

        result = prediction_service.predict(
            machine_id=machine.machine_id,
            temperature=reading.temperature,
            vibration=reading.vibration,
            current=reading.current,
            rpm=reading.rpm,
            rated_rpm=machine.rated_rpm if machine.rated_rpm is not None else DEFAULT_RATED_RPM,
            rated_current=machine.rated_current if machine.rated_current is not None else DEFAULT_RATED_CURRENT,
            max_temp=machine.max_temp if machine.max_temp is not None else DEFAULT_MAX_TEMP,
            max_vibration=machine.max_vibration if machine.max_vibration is not None else DEFAULT_MAX_VIBRATION,
            machine_type=machine.type,
        )
        db.add(
            Prediction(
                machine_id=machine.machine_id,
                timestamp=observed_at,
                failure_probability=result["failure_probability"],
                component=result["component"],
                explanation=result["explanation"],
                recommended_action=result["recommended_action"],
                model_version=result["model_version"],
                is_prototype=result["is_prototype"],
                explanation_data=json.dumps(
                    {
                        "feature_importance": result["feature_importance"],
                        "contributing_factors": result["contributing_factors"],
                        "reasons": result["reasons"],
                    }
                ),
                created_at=datetime.now(timezone.utc),
            )
        )
    except Exception:
        # Honest degradation: telemetry + health + alerts stand on their own;
        # prediction is an enhancement and must never break ingestion.
        logger.exception(
            "Automatic prototype prediction failed for machine %s; ingest continues.",
            machine.machine_id,
        )


class HealthEngine:
    """Small injectable facade retained for service-level tests and callers."""

    @staticmethod
    def evaluate(machine: Machine, reading: SensorReading, db: Session) -> HealthEvaluation:
        return evaluate_reading(machine, reading, db)