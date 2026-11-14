"""Public demo dataset provisioning (dedicated, isolated, simulated).

Everything here is written into ONE dedicated demo organization
(``PUBLIC_DEMO_ORGANIZATION_ID`` / slug ``public-demo``) using the existing
schema and domain relationships:

* ``machines.is_demo = True`` - excluded from authenticated fleet reads, device
  ingestion, heartbeats, feedback and model evaluation by the existing code;
* one ACTIVE ``demo_sessions`` row per demo machine - required by the
  ``MANUAL_DEMO`` provenance check constraint;
* ``sensor_readings`` rows with ``source='MANUAL_DEMO'``, ``device_id=NULL`` and
  ``demo_session_id`` set - the database constraint makes it impossible to
  present them as WOKWI or REAL_HARDWARE telemetry;
* ``predictions`` / ``alerts`` stamped with the same ``demo_session_id``;
* ``maintenance_records`` with role-based technician labels (no personal data).

The generator is deterministic (seeded per machine). The seeder is idempotent:
running it twice is a no-op unless ``reset=True``, and reset deletes only rows
owned by the demo organization. It refuses to run if a demo machine ID is
already owned by a different organization, so it can never overwrite a
production asset.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, func
from sqlalchemy.orm import Session

from backend.app.core.public_demo import (
    PUBLIC_DEMO_ORGANIZATION_ID,
    PUBLIC_DEMO_ORGANIZATION_NAME,
    PUBLIC_DEMO_ORGANIZATION_SLUG,
    PUBLIC_DEMO_PROVENANCE,
)
from backend.app.db.models import (
    Alert,
    DemoSession,
    FeedbackRecord,
    Machine,
    MaintenanceRecord,
    Organization,
    Prediction,
    SensorReading,
)

READING_COUNT = 48
READING_INTERVAL_MINUTES = 5

# Deterministic demo fleet. Values are inside the physical envelope enforced by
# the telemetry schema, and each machine tells a different condition story.
MACHINE_BLUEPRINTS: List[Dict[str, Any]] = [
    {
        "machine_id": "DM-001",
        "name": "Feedwater Pump P-101",
        "type": "Centrifugal Pump",
        "location": "Demo Plant / Utilities Bay 1",
        "status": "Healthy",
        "seed": 101,
        "specifications": {
            "rated_rpm": 1480.0,
            "rated_current": 22.0,
            "max_temp": 85.0,
            "max_vibration": 4.5,
        },
        "temperature": (42.0, 47.0),
        "temperature_wobble": 0.9,
        "vibration": (1.6, 2.1),
        "vibration_wobble": 0.12,
        "current": (11.0, 12.2),
        "current_wobble": 0.25,
        "rpm": (1478.0, 1472.0),
        "rpm_wobble": 3.0,
        "prediction": {
            "failure_probability": 0.18,
            "component": "Bearing",
            "remaining_life_days": 96,
            "confidence": 0.72,
            "explanation": "Vibration and thermal channels are within the rated operating envelope; "
            "a slow bearing wear trend remains the dominant, low-confidence risk signal.",
            "recommended_action": "Continue routine vibration monitoring; inspect drive-end bearing "
            "grease at the next planned service window.",
            "feature_importance": {
                "temperature": 0.22,
                "vibration": 0.34,
                "current": 0.18,
                "rpm": 0.26,
            },
        },
        "alerts": [
            {
                "alert_type": "bearing_inspection",
                "severity": "Info",
                "message": "Routine drive-end bearing inspection completed during planned service.",
                "status": "RESOLVED",
                "minutes_ago": 2880,
                "resolved_minutes_ago": 2760,
            },
        ],
        "maintenance": [
            {
                "component": "Bearing",
                "failure_type": "Preventive wear inspection",
                "issue_description": "Scheduled grease replenishment on drive-end bearing.",
                "maintenance_action": "Repacked drive-end bearing with high-temperature grease and "
                "verified shaft alignment.",
                "technician": "Demo Technician A",
                "status": "Completed",
                "maintenance_days_ago": 6,
            },
        ],
    },
    {
        "machine_id": "DM-002",
        "name": "Induction Motor M-204",
        "type": "Induction Motor",
        "location": "Demo Plant / Line 2 Drive Train",
        "status": "Warning",
        "seed": 202,
        "specifications": {
            "rated_rpm": 1450.0,
            "rated_current": 38.0,
            "max_temp": 90.0,
            "max_vibration": 4.5,
        },
        "temperature": (72.0, 84.0),
        "temperature_wobble": 1.3,
        "vibration": (4.1, 5.2),
        "vibration_wobble": 0.22,
        "current": (27.0, 31.0),
        "current_wobble": 0.6,
        "rpm": (1446.0, 1442.0),
        "rpm_wobble": 4.0,
        "prediction": {
            "failure_probability": 0.63,
            "component": "Stator Winding",
            "remaining_life_days": 34,
            "confidence": 0.78,
            "explanation": "Stator winding temperature is trending above the rated thermal class while "
            "phase current remains inside nameplate limits, consistent with developing insulation "
            "degradation or a blocked cooling path.",
            "recommended_action": "Inspect motor cooling airflow and stator insulation resistance at "
            "the next shift; schedule a winding thermography survey this week.",
            "feature_importance": {
                "temperature": 0.46,
                "vibration": 0.16,
                "current": 0.24,
                "rpm": 0.14,
            },
        },
        "alerts": [
            {
                "alert_type": "stator_overheat",
                "severity": "Critical",
                "message": "Stator winding temperature exceeded the rated thermal limit.",
                "status": "ACTIVE",
                "minutes_ago": 18,
            },
            {
                "alert_type": "vibration_elevated",
                "severity": "Warning",
                "message": "Vibration velocity is trending above the warning band at the drive end.",
                "status": "ACKNOWLEDGED",
                "minutes_ago": 240,
            },
        ],
        "maintenance": [
            {
                "component": "Stator Winding",
                "failure_type": "Insulation degradation (suspected)",
                "issue_description": "Elevated stator temperature under steady 60% load.",
                "maintenance_action": "Cleaned motor cooling ducts and scheduled insulation resistance test.",
                "technician": "Demo Technician B",
                "status": "Scheduled",
                "maintenance_days_ago": -2,
            },
            {
                "component": "Shaft / Coupling",
                "failure_type": "Coupling misalignment",
                "issue_description": "Axial vibration harmonics observed during acceleration.",
                "maintenance_action": "Re-shimmed motor feet and laser-aligned the coupling.",
                "technician": "Demo Technician A",
                "status": "Completed",
                "maintenance_days_ago": 21,
            },
        ],
    },
    {
        "machine_id": "DM-003",
        "name": "CNC Spindle S-310",
        "type": "CNC Spindle",
        "location": "Demo Plant / Machining Cell 3",
        "status": "Critical",
        "seed": 303,
        "specifications": {
            "rated_rpm": 12000.0,
            "rated_current": 12.0,
            "max_temp": 70.0,
            "max_vibration": 2.8,
        },
        "temperature": (78.0, 92.0),
        "temperature_wobble": 1.8,
        "vibration": (6.4, 7.9),
        "vibration_wobble": 0.35,
        "current": (13.0, 15.0),
        "current_wobble": 0.4,
        "rpm": (11920.0, 11810.0),
        "rpm_wobble": 25.0,
        "prediction": {
            "failure_probability": 0.87,
            "component": "Spindle Bearing",
            "remaining_life_days": 9,
            "confidence": 0.83,
            "explanation": "High-frequency vibration and rising spindle temperature together indicate "
            "advanced bearing degradation; speed droop under load is consistent with increasing friction.",
            "recommended_action": "Plan an immediate spindle bearing replacement and avoid high-load "
            "finishing operations until the spindle is serviced.",
            "feature_importance": {
                "temperature": 0.28,
                "vibration": 0.52,
                "current": 0.12,
                "rpm": 0.08,
            },
        },
        "alerts": [
            {
                "alert_type": "vibration_critical",
                "severity": "Critical",
                "message": "Spindle vibration 7.9 mm/s RMS exceeded the critical limit of 2.8 mm/s.",
                "status": "ACTIVE",
                "minutes_ago": 7,
            },
            {
                "alert_type": "thermal_drift",
                "severity": "Warning",
                "message": "Spindle temperature is rising faster than the normal warm-up profile.",
                "status": "ACTIVE",
                "minutes_ago": 55,
            },
        ],
        "maintenance": [
            {
                "component": "Spindle Bearing",
                "failure_type": "Bearing spalling (suspected)",
                "issue_description": "Progressive high-frequency vibration with thermal rise.",
                "maintenance_action": "Ordered matched spindle bearing set; machining limited to low-load "
                "operations pending teardown.",
                "technician": "Demo Technician C",
                "status": "In Progress",
                "maintenance_days_ago": 1,
                "failure_days_ago": 3,
            },
        ],
    },
    {
        "machine_id": "DM-004",
        "name": "Screw Compressor C-402",
        "type": "Screw Compressor",
        "location": "Demo Plant / Compressor Room",
        "status": "Maintenance",
        "seed": 404,
        "specifications": {
            "rated_rpm": 3000.0,
            "rated_current": 45.0,
            "max_temp": 95.0,
            "max_vibration": 5.0,
        },
        "temperature": (88.0, 95.0),
        "temperature_wobble": 1.6,
        "vibration": (3.2, 3.6),
        "vibration_wobble": 0.18,
        "current": (41.0, 44.0),
        "current_wobble": 0.7,
        "rpm": (2988.0, 2962.0),
        "rpm_wobble": 6.0,
        "prediction": {
            "failure_probability": 0.52,
            "component": "Cooling System",
            "remaining_life_days": 48,
            "confidence": 0.69,
            "explanation": "Discharge temperature is elevated while vibration and current remain "
            "moderate, pointing at heat-exchanger fouling rather than a mechanical fault.",
            "recommended_action": "Clean the aftercooler and verify cooling-water flow before returning "
            "the compressor to full duty.",
            "feature_importance": {
                "temperature": 0.55,
                "vibration": 0.15,
                "current": 0.2,
                "rpm": 0.1,
            },
        },
        "alerts": [
            {
                "alert_type": "discharge_temperature",
                "severity": "Warning",
                "message": "Discharge temperature is above the normal operating band.",
                "status": "ACTIVE",
                "minutes_ago": 95,
            },
        ],
        "maintenance": [
            {
                "component": "Cooling System",
                "failure_type": "Heat exchanger fouling",
                "issue_description": "Reduced cooling effectiveness with elevated discharge temperature.",
                "maintenance_action": "Isolated the compressor and started aftercooler chemical cleaning.",
                "technician": "Demo Technician B",
                "status": "Completed",
                "maintenance_days_ago": 0,
            },
        ],
    },
]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _interpolate(start: float, end: float, progress: float) -> float:
    return start + (end - start) * progress


def _reading_series(blueprint: Dict[str, Any], now: datetime) -> List[Dict[str, float]]:
    """Deterministic 48-point telemetry series ending at ``now``."""
    rng = random.Random(int(blueprint["seed"]))
    values: List[Dict[str, float]] = []
    for index in range(READING_COUNT):
        progress = index / float(READING_COUNT - 1)
        temperature = (
            _interpolate(*blueprint["temperature"], progress)
            + blueprint["temperature_wobble"] * math.sin(index / 3.1)
            + rng.uniform(-0.6, 0.6)
        )
        vibration = (
            _interpolate(*blueprint["vibration"], progress)
            + blueprint["vibration_wobble"] * math.sin(index / 2.4)
            + rng.uniform(-0.05, 0.05)
        )
        current = (
            _interpolate(*blueprint["current"], progress)
            + blueprint["current_wobble"] * math.sin(index / 4.2)
            + rng.uniform(-0.08, 0.08)
        )
        rpm = (
            _interpolate(*blueprint["rpm"], progress)
            + blueprint["rpm_wobble"] * math.sin(index / 5.0)
            + rng.uniform(-1.5, 1.5)
        )
        values.append(
            {
                "timestamp": (
                    now - timedelta(minutes=READING_INTERVAL_MINUTES * (READING_COUNT - 1 - index))
                ).timestamp(),
                "temperature": round(_clamp(temperature, -50.0, 300.0), 2),
                "vibration": round(_clamp(vibration, 0.0, 100.0), 3),
                "current": round(_clamp(current, 0.0, 1000.0), 2),
                "rpm": round(_clamp(rpm, 0.0, 60000.0), 1),
            }
        )
    return values


def _impact_label(ratio: float) -> str:
    if ratio >= 1.10:
        return "Critical"
    if ratio >= 1.00:
        return "Very High"
    if ratio >= 0.85:
        return "High"
    if ratio >= 0.70:
        return "Above Normal"
    return "Normal"


def _contributing_factors(
    machine: Machine, reading: Dict[str, float], importance: Dict[str, float]
) -> List[Dict[str, Any]]:
    """Physics-heuristic attribution (NOT SHAP) consistent with the prototype engine."""
    max_temp = machine.max_temp or 85.0
    max_vibration = machine.max_vibration or 4.5
    rated_current = machine.rated_current or 10.0
    rated_rpm = machine.rated_rpm or 1450.0
    rpm_deviation = abs(reading["rpm"] - rated_rpm) / rated_rpm if rated_rpm else 0.0

    return [
        {
            "factor": "Temperature",
            "impact": _impact_label(reading["temperature"] / max_temp),
            "shap_value": round(importance.get("temperature", 0.0), 3),
            "value_observed": f"{reading['temperature']:.1f} °C",
            "threshold_reference": f"Rated maximum {max_temp:.1f} °C",
            "description": "Thermal trend versus the asset's rated maximum operating temperature.",
        },
        {
            "factor": "Vibration",
            "impact": _impact_label(reading["vibration"] / max_vibration),
            "shap_value": round(importance.get("vibration", 0.0), 3),
            "value_observed": f"{reading['vibration']:.2f} mm/s RMS",
            "threshold_reference": f"Rated maximum {max_vibration:.2f} mm/s RMS",
            "description": "Vibration velocity trend versus the ISO-style rated envelope.",
        },
        {
            "factor": "Current",
            "impact": _impact_label(reading["current"] / rated_current),
            "shap_value": round(importance.get("current", 0.0), 3),
            "value_observed": f"{reading['current']:.2f} A",
            "threshold_reference": f"Rated current {rated_current:.2f} A",
            "description": "Electrical load relative to nameplate current.",
        },
        {
            "factor": "RPM",
            "impact": _impact_label(rpm_deviation / 0.10),
            "shap_value": round(importance.get("rpm", 0.0), 3),
            "value_observed": f"{reading['rpm']:.0f} RPM",
            "threshold_reference": f"Rated speed {rated_rpm:.0f} RPM",
            "description": "Speed deviation from the rated operating point.",
        },
    ]


def _demo_machine_ids(db: Session, org: Organization) -> List[str]:
    rows = (
        db.query(Machine.machine_id)
        .filter(Machine.organization_id == org.id, Machine.is_demo.is_(True))
        .all()
    )
    return [row[0] for row in rows]


def _guard_against_machine_id_collisions(db: Session) -> None:
    """Never adopt a machine ID that already belongs to another organization."""
    blueprint_ids = [item["machine_id"] for item in MACHINE_BLUEPRINTS]
    collisions = (
        db.query(Machine.machine_id, Machine.organization_id)
        .filter(Machine.machine_id.in_(blueprint_ids))
        .all()
    )
    for machine_id, organization_id in collisions:
        if organization_id != PUBLIC_DEMO_ORGANIZATION_ID:
            raise RuntimeError(
                f"Refusing to seed public demo data: machine '{machine_id}' already exists in "
                "another organization."
            )


def _purge_demo_rows(db: Session, org: Organization) -> None:
    """Delete only demo-organization rows. Never touches another tenant."""
    machine_ids = _demo_machine_ids(db, org)
    machine_filter = machine_ids or [""]

    db.execute(
        delete(FeedbackRecord).where(
            FeedbackRecord.organization_id == org.id,
            FeedbackRecord.machine_id.in_(machine_filter),
        )
    )
    db.execute(
        delete(Prediction).where(
            Prediction.organization_id == org.id,
            Prediction.machine_id.in_(machine_filter),
        )
    )
    db.execute(
        delete(Alert).where(
            Alert.organization_id == org.id,
            Alert.machine_id.in_(machine_filter),
        )
    )
    db.execute(
        delete(SensorReading).where(
            SensorReading.organization_id == org.id,
            SensorReading.machine_id.in_(machine_filter),
        )
    )
    db.execute(
        delete(MaintenanceRecord).where(
            MaintenanceRecord.organization_id == org.id,
            MaintenanceRecord.machine_id.in_(machine_filter),
        )
    )
    db.execute(delete(DemoSession).where(DemoSession.organization_id == org.id))
    db.execute(
        delete(Machine).where(
            Machine.organization_id == org.id, Machine.is_demo.is_(True)
        )
    )


def public_demo_counts(db: Session, org: Optional[Organization] = None) -> Dict[str, int]:
    """Row counts for the demo dataset only (used by the API, script and tests)."""
    if org is None:
        db_org = db.get(Organization, PUBLIC_DEMO_ORGANIZATION_ID)
        if db_org is None or db_org.slug != PUBLIC_DEMO_ORGANIZATION_SLUG:
            return {
                "machines": 0,
                "sessions": 0,
                "readings": 0,
                "predictions": 0,
                "alerts": 0,
                "maintenance": 0,
            }
        org = db_org

    demo_machine_ids = _demo_machine_ids(db, org)

    def count(model, *criteria) -> int:
        return int(
            db.query(func.count(model.id)).filter(*criteria).scalar() or 0
        )

    return {
        "machines": len(demo_machine_ids),
        "sessions": count(DemoSession, DemoSession.organization_id == org.id),
        "readings": count(
            SensorReading,
            SensorReading.organization_id == org.id,
            SensorReading.source == PUBLIC_DEMO_PROVENANCE,
        ),
        "predictions": count(
            Prediction, Prediction.organization_id == org.id
        ),
        "alerts": count(Alert, Alert.organization_id == org.id),
        "maintenance": count(
            MaintenanceRecord, MaintenanceRecord.organization_id == org.id
        ),
    }


def seed_public_demo_dataset(
    db: Session,
    *,
    reset: bool = False,
    now: Optional[datetime] = None,
    commit: bool = True,
) -> Dict[str, int]:
    """Provision the demo organization/dataset. Idempotent unless ``reset=True``.

    Raises ``RuntimeError`` when a demo machine ID is already owned by another
    organization. No production row is ever read from, written to, or deleted.
    """
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)

    org = db.get(Organization, PUBLIC_DEMO_ORGANIZATION_ID)
    if org is not None and org.slug != PUBLIC_DEMO_ORGANIZATION_SLUG:
        raise RuntimeError(
            "Refusing to seed public demo data: the reserved demo organization id "
            "belongs to a differently named organization."
        )

    _guard_against_machine_id_collisions(db)

    if reset and org is not None:
        _purge_demo_rows(db, org)
        db.flush()

    if org is None:
        org = Organization(
            id=PUBLIC_DEMO_ORGANIZATION_ID,
            name=PUBLIC_DEMO_ORGANIZATION_NAME,
            slug=PUBLIC_DEMO_ORGANIZATION_SLUG,
            status="active",
            created_at=reference,
            updated_at=reference,
        )
        db.add(org)
        db.flush()

    if _demo_machine_ids(db, org):
        # Already provisioned: leave the dataset untouched.
        if commit:
            db.commit()
        return public_demo_counts(db, org)

    try:
        for blueprint in MACHINE_BLUEPRINTS:
            specs = blueprint["specifications"]
            machine = Machine(
                organization_id=org.id,
                machine_id=blueprint["machine_id"],
                name=blueprint["name"],
                type=blueprint["type"],
                location=blueprint["location"],
                status=blueprint["status"],
                is_demo=True,
                rated_rpm=specs["rated_rpm"],
                rated_current=specs["rated_current"],
                max_temp=specs["max_temp"],
                max_vibration=specs["max_vibration"],
                created_at=reference - timedelta(days=14),
            )
            db.add(machine)
            db.flush()

            session = DemoSession(
                organization_id=org.id,
                machine_id=machine.machine_id,
                name=f"Public Demo - {machine.name}",
                status="ACTIVE",
                created_by=None,
                created_at=reference - timedelta(days=14),
            )
            db.add(session)
            db.flush()

            series = _reading_series(blueprint, reference)
            for point in series:
                db.add(
                    SensorReading(
                        organization_id=org.id,
                        machine_id=machine.machine_id,
                        device_id=None,
                        demo_session_id=session.id,
                        timestamp=datetime.fromtimestamp(point["timestamp"], tz=timezone.utc),
                        temperature=point["temperature"],
                        vibration=point["vibration"],
                        current=point["current"],
                        rpm=point["rpm"],
                        source=PUBLIC_DEMO_PROVENANCE,
                        created_at=reference,
                    )
                )

            prediction_spec = blueprint["prediction"]
            latest = series[-1]
            db.add(
                Prediction(
                    organization_id=org.id,
                    machine_id=machine.machine_id,
                    demo_session_id=session.id,
                    timestamp=datetime.fromtimestamp(latest["timestamp"], tz=timezone.utc),
                    failure_probability=prediction_spec["failure_probability"],
                    component=prediction_spec["component"],
                    remaining_life_days=prediction_spec["remaining_life_days"],
                    confidence=prediction_spec["confidence"],
                    explanation=prediction_spec["explanation"],
                    recommended_action=prediction_spec["recommended_action"],
                    model_version="physics-rule-v1",
                    is_prototype=True,
                    explanation_data=_explanation_json(machine, latest, prediction_spec),
                    input_hash=None,
                    created_at=reference,
                )
            )

            for alert_spec in blueprint["alerts"]:
                created_at = reference - timedelta(minutes=alert_spec["minutes_ago"])
                resolved_at = (
                    reference - timedelta(minutes=alert_spec["resolved_minutes_ago"])
                    if alert_spec.get("resolved_minutes_ago") is not None
                    else None
                )
                db.add(
                    Alert(
                        organization_id=org.id,
                        machine_id=machine.machine_id,
                        demo_session_id=session.id,
                        alert_type=alert_spec["alert_type"],
                        severity=alert_spec["severity"],
                        message=alert_spec["message"],
                        status=alert_spec["status"],
                        created_at=created_at,
                        resolved_at=resolved_at,
                    )
                )

            for record_spec in blueprint["maintenance"]:
                maintenance_date = reference - timedelta(
                    days=record_spec["maintenance_days_ago"]
                )
                failure_date = (
                    reference - timedelta(days=record_spec["failure_days_ago"])
                    if record_spec.get("failure_days_ago") is not None
                    else None
                )
                db.add(
                    MaintenanceRecord(
                        organization_id=org.id,
                        machine_id=machine.machine_id,
                        component=record_spec["component"],
                        failure_type=record_spec.get("failure_type"),
                        issue_description=record_spec["issue_description"],
                        maintenance_action=record_spec["maintenance_action"],
                        technician=record_spec["technician"],
                        status=record_spec["status"],
                        failure_date=failure_date,
                        maintenance_date=maintenance_date,
                        created_at=reference,
                    )
                )

        if commit:
            db.commit()
    except Exception:
        db.rollback()
        raise

    return public_demo_counts(db, org)


def _explanation_json(
    machine: Machine, latest: Dict[str, float], prediction_spec: Dict[str, Any]
) -> str:
    """Serialized explanation payload matching the authenticated prediction contract."""
    import json

    factors = _contributing_factors(
        machine, latest, prediction_spec["feature_importance"]
    )
    reasons = [
        f"{factor['factor']} observed at {factor['value_observed']} "
        f"(reference: {factor['threshold_reference']})."
        for factor in factors
        if factor["impact"] not in ("Normal", "Low")
    ]
    return json.dumps(
        {
            "feature_importance": prediction_spec["feature_importance"],
            "contributing_factors": factors,
            "reasons": reasons,
        }
    )
