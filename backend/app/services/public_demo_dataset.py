"""Provision the public demo from an explicitly selected production organization.

The public demo is still one isolated organization (``PUBLIC_DEMO_ORGANIZATION_ID``
/ slug ``public-demo``) using the existing schema. It does not generate or
randomize telemetry. Instead it copies selected machines and their historical
records from a source organization that the operator names explicitly.

Copy rules
----------
* Only the selected source machines are copied. The source organization is never
  modified.
* New primary keys are assigned. The source machine id is replaced with a
  deterministic public id, so original asset ids are not exposed.
* Every copied reading is written as ``source='MANUAL_DEMO'``,
  ``device_id=NULL`` and with a demo-session id. The database constraint therefore
  prevents a demo row from impersonating a real device. Values and timestamps are
  copied unchanged.
* Devices, memberships, user ids, feedback and source organization ids are not
  copied. Maintenance technician names are replaced with a non-personal label.
* Locations are redacted by default. Names, types, status, specifications and
  historical free-text records are copied only for the selected machines.
* One deterministic ACTIVE demo session is created per copied machine.
* Re-running without ``refresh`` is a no-op when the demo dataset already exists.
  Re-running with ``refresh`` deletes only demo-organization rows and rebuilds
  them atomically, so repeated provisioning cannot duplicate rows.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

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
    Device,
    FeedbackRecord,
    Machine,
    MaintenanceRecord,
    Organization,
    Prediction,
    SensorReading,
)

DEFAULT_READINGS_PER_MACHINE = 500
DEFAULT_TECHNICIAN_LABEL = "PredictIQ Maintenance Team"
DEFAULT_PUBLIC_LOCATION = "Public Demo Fleet"
SOURCE_READING_SOURCES = ("WOKWI", "REAL_HARDWARE")


def public_machine_id_for(source_machine_id: str) -> str:
    """Stable, non-identifying public machine id for a source machine.

    The hash suffix keeps the mapping deterministic while preventing a source id
    from being exposed directly. The result always fits ``machines.machine_id``.
    """
    digest = hashlib.sha256(
        f"predictiq:public-demo:machine:{source_machine_id}".encode("utf-8")
    ).hexdigest()[:12].upper()
    return f"PUB-{digest}"


def demo_session_id_for(
    source_organization_id: uuid.UUID, source_machine_id: str
) -> uuid.UUID:
    """Deterministic session id; re-provisioning reuses the same identity."""
    return uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"predictiq:public-demo:session:{source_organization_id}:{source_machine_id}",
    )


def resolve_source_organization(
    db: Session,
    *,
    organization_id: Optional[uuid.UUID] = None,
    slug: Optional[str] = None,
) -> Organization:
    """Resolve an operator-supplied source organization; never infer one."""
    if bool(organization_id) == bool(slug):
        raise ValueError("Provide exactly one of organization_id or slug.")
    if organization_id is not None:
        org = db.get(Organization, organization_id)
    else:
        org = db.query(Organization).filter(Organization.slug == slug).first()
    if org is None:
        raise ValueError("Source organization not found.")
    if org.id == PUBLIC_DEMO_ORGANIZATION_ID or org.slug == PUBLIC_DEMO_ORGANIZATION_SLUG:
        raise ValueError("The public demo organization cannot be used as its own source.")
    return org


def _count(db: Session, model: Any, *criteria: Any) -> int:
    return int(db.query(func.count(model.id)).filter(*criteria).scalar() or 0)


def _scrub_text(value: Optional[str], replacements: Sequence[tuple[str, str]]) -> Optional[str]:
    """Replace known source identifiers in copied free-text fields."""
    if not value:
        return value
    scrubbed = value
    for old, new in sorted(replacements, key=lambda item: len(item[0]), reverse=True):
        if old and old in scrubbed:
            scrubbed = scrubbed.replace(old, new)
    return scrubbed


def _machine_replacements(
    db: Session, source_org: Organization, source_machine: Machine, public_machine_id: str
) -> List[tuple[str, str]]:
    replacements = [
        (source_machine.machine_id, public_machine_id),
        (source_org.slug, PUBLIC_DEMO_ORGANIZATION_SLUG),
        (source_org.name, PUBLIC_DEMO_ORGANIZATION_NAME),
    ]
    device_ids = (
        db.query(Device.device_id)
        .filter(
            Device.organization_id == source_org.id,
            Device.machine_id == source_machine.machine_id,
        )
        .all()
    )
    replacements.extend((device_id, "public-demo-device") for (device_id,) in device_ids)
    return replacements


def source_organization_summaries(db: Session) -> List[Dict[str, Any]]:
    """Read-only organization inventory for operator selection.

    Contains no memberships, credentials, device ids or telemetry values.
    """
    organizations = db.query(Organization).order_by(Organization.slug.asc()).all()
    summaries: List[Dict[str, Any]] = []
    for org in organizations:
        machine_query = db.query(Machine).filter(Machine.organization_id == org.id)
        machine_count = int(machine_query.count())
        machines_with_readings = int(
            db.query(func.count(func.distinct(SensorReading.machine_id)))
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.source.in_(SOURCE_READING_SOURCES),
            )
            .scalar()
            or 0
        )
        latest_reading = (
            db.query(func.max(SensorReading.timestamp))
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.source.in_(SOURCE_READING_SOURCES),
            )
            .scalar()
        )
        summaries.append(
            {
                "organization_id": str(org.id),
                "slug": org.slug,
                "name": org.name,
                "status": org.status,
                "is_public_demo": org.id == PUBLIC_DEMO_ORGANIZATION_ID,
                "machines": machine_count,
                "machines_with_readings": machines_with_readings,
                "readings": _count(
                    db,
                    SensorReading,
                    SensorReading.organization_id == org.id,
                    SensorReading.source.in_(SOURCE_READING_SOURCES),
                ),
                "alerts": _count(db, Alert, Alert.organization_id == org.id),
                "predictions": _count(
                    db, Prediction, Prediction.organization_id == org.id
                ),
                "maintenance": _count(
                    db, MaintenanceRecord, MaintenanceRecord.organization_id == org.id
                ),
                "latest_reading": latest_reading,
            }
        )
    return summaries


def source_machine_summaries(
    db: Session, source_organization_id: uuid.UUID
) -> List[Dict[str, Any]]:
    """Read-only machine inventory for one source organization."""
    org = resolve_source_organization(db, organization_id=source_organization_id)
    machines = (
        db.query(Machine)
        .filter(
            Machine.organization_id == org.id,
            Machine.is_demo.is_(False),
        )
        .order_by(Machine.machine_id.asc())
        .all()
    )
    summaries: List[Dict[str, Any]] = []
    for machine in machines:
        readings_query = db.query(SensorReading).filter(
            SensorReading.organization_id == org.id,
            SensorReading.machine_id == machine.machine_id,
            SensorReading.source.in_(SOURCE_READING_SOURCES),
        )
        reading_count = int(readings_query.count())
        latest = readings_query.with_entities(
            func.max(SensorReading.timestamp)
        ).scalar()
        summaries.append(
            {
                "machine_id": machine.machine_id,
                "name": machine.name,
                "type": machine.type,
                "status": machine.status,
                "readings": reading_count,
                "latest_reading": latest,
                "alerts": _count(
                    db,
                    Alert,
                    Alert.organization_id == org.id,
                    Alert.machine_id == machine.machine_id,
                ),
                "predictions": _count(
                    db,
                    Prediction,
                    Prediction.organization_id == org.id,
                    Prediction.machine_id == machine.machine_id,
                ),
                "maintenance": _count(
                    db,
                    MaintenanceRecord,
                    MaintenanceRecord.organization_id == org.id,
                    MaintenanceRecord.machine_id == machine.machine_id,
                ),
            }
        )
    return summaries


def _selected_source_machines(
    db: Session, org: Organization, machine_ids: Sequence[str]
) -> List[Machine]:
    if not machine_ids:
        raise ValueError("At least one source machine must be selected explicitly.")
    machines = (
        db.query(Machine)
        .filter(
            Machine.organization_id == org.id,
            Machine.is_demo.is_(False),
            Machine.machine_id.in_(list(machine_ids)),
        )
        .order_by(Machine.machine_id.asc())
        .all()
    )
    found = {machine.machine_id for machine in machines}
    missing = sorted(set(machine_ids) - found)
    if missing:
        raise ValueError(
            "Selected machines were not found in the source organization: "
            + ", ".join(missing)
        )
    return machines


def _demo_machine_ids(db: Session, org: Organization) -> List[str]:
    rows = (
        db.query(Machine.machine_id)
        .filter(
            Machine.organization_id == org.id,
            Machine.is_demo.is_(True),
        )
        .all()
    )
    return [row[0] for row in rows]


def _require_source_readings(
    db: Session, org: Organization, machines: Iterable[Machine]
) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    empty: List[str] = []
    for machine in machines:
        count = int(
            db.query(func.count(SensorReading.id))
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.machine_id == machine.machine_id,
                SensorReading.source.in_(SOURCE_READING_SOURCES),
            )
            .scalar()
            or 0
        )
        counts[machine.machine_id] = count
        if count == 0:
            empty.append(machine.machine_id)
    if empty:
        raise ValueError(
            "Selected machines have no copyable historical readings: "
            + ", ".join(sorted(empty))
        )
    return counts


def _purge_demo_rows(db: Session, org: Organization) -> None:
    """Delete only rows owned by the demo organization."""
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
            Machine.organization_id == org.id,
            Machine.is_demo.is_(True),
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

    return {
        "machines": len(demo_machine_ids),
        "sessions": _count(db, DemoSession, DemoSession.organization_id == org.id),
        "readings": _count(
            db,
            SensorReading,
            SensorReading.organization_id == org.id,
            SensorReading.source == PUBLIC_DEMO_PROVENANCE,
        ),
        "predictions": _count(db, Prediction, Prediction.organization_id == org.id),
        "alerts": _count(db, Alert, Alert.organization_id == org.id),
        "maintenance": _count(
            db, MaintenanceRecord, MaintenanceRecord.organization_id == org.id
        ),
    }


def copy_public_demo_from_source(
    db: Session,
    source_organization_id: uuid.UUID,
    *,
    machine_ids: Sequence[str],
    readings_per_machine: int = DEFAULT_READINGS_PER_MACHINE,
    include_alerts: bool = True,
    include_predictions: bool = True,
    include_maintenance: bool = True,
    redact_location: bool = True,
    technician_label: str = DEFAULT_TECHNICIAN_LABEL,
    refresh: bool = False,
    commit: bool = True,
) -> Dict[str, int]:
    """Copy selected real source rows into the isolated public demo organization.

    ``source_organization_id`` and ``machine_ids`` are required; no source tenant
    or asset is ever inferred. The source organization is only read.
    """
    if readings_per_machine < 0:
        raise ValueError("readings_per_machine must be >= 0 (0 means all readings).")
    if not technician_label.strip():
        raise ValueError("technician_label must not be empty.")

    source_org = resolve_source_organization(
        db, organization_id=source_organization_id
    )
    source_machines = _selected_source_machines(db, source_org, machine_ids)
    _require_source_readings(db, source_org, source_machines)

    public_ids = {
        machine.machine_id: public_machine_id_for(machine.machine_id)
        for machine in source_machines
    }
    collisions = (
        db.query(Machine.machine_id, Machine.organization_id)
        .filter(Machine.machine_id.in_(list(public_ids.values())))
        .all()
    )
    for machine_id, organization_id in collisions:
        if organization_id != PUBLIC_DEMO_ORGANIZATION_ID:
            raise RuntimeError(
                f"Refusing to provision: public machine id '{machine_id}' already "
                "exists in another organization."
            )

    demo_org = db.get(Organization, PUBLIC_DEMO_ORGANIZATION_ID)
    if demo_org is not None and demo_org.slug != PUBLIC_DEMO_ORGANIZATION_SLUG:
        raise RuntimeError(
            "Refusing to provision: the reserved demo organization id belongs to "
            "a differently named organization."
        )

    has_demo_rows = demo_org is not None and bool(
        _demo_machine_ids(db, demo_org)
        or _count(db, DemoSession, DemoSession.organization_id == demo_org.id)
    )
    if demo_org is not None and has_demo_rows:
        if not refresh:
            if commit:
                db.commit()
            return public_demo_counts(db, demo_org)
        _purge_demo_rows(db, demo_org)
        db.flush()

    reference = datetime.now(timezone.utc)
    if demo_org is None:
        demo_org = Organization(
            id=PUBLIC_DEMO_ORGANIZATION_ID,
            name=PUBLIC_DEMO_ORGANIZATION_NAME,
            slug=PUBLIC_DEMO_ORGANIZATION_SLUG,
            status="active",
            created_at=reference,
            updated_at=reference,
        )
        db.add(demo_org)
        db.flush()

    try:
        for source_machine in source_machines:
            public_machine_id = public_ids[source_machine.machine_id]
            session_id = demo_session_id_for(
                source_org.id, source_machine.machine_id
            )
            replacements = _machine_replacements(
                db, source_org, source_machine, public_machine_id
            )

            demo_machine = Machine(
                organization_id=demo_org.id,
                machine_id=public_machine_id,
                name=_scrub_text(source_machine.name, replacements),
                type=_scrub_text(source_machine.type, replacements),
                location=DEFAULT_PUBLIC_LOCATION
                if redact_location
                else _scrub_text(source_machine.location, replacements),
                status=source_machine.status,
                is_demo=True,
                rated_rpm=source_machine.rated_rpm,
                rated_current=source_machine.rated_current,
                max_temp=source_machine.max_temp,
                max_vibration=source_machine.max_vibration,
                created_at=source_machine.created_at,
            )
            db.add(demo_machine)
            db.flush()

            db.add(
                DemoSession(
                    id=session_id,
                    organization_id=demo_org.id,
                    machine_id=public_machine_id,
                    name=f"Public Demo - {demo_machine.name}"[:120],
                    status="ACTIVE",
                    created_by=None,
                    created_at=source_machine.created_at or reference,
                    closed_at=None,
                )
            )
            db.flush()

            reading_query = (
                db.query(SensorReading)
                .filter(
                    SensorReading.organization_id == source_org.id,
                    SensorReading.machine_id == source_machine.machine_id,
                    SensorReading.source.in_(SOURCE_READING_SOURCES),
                )
                .order_by(SensorReading.timestamp.desc(), SensorReading.id.desc())
            )
            if readings_per_machine:
                reading_query = reading_query.limit(readings_per_machine)
            readings = list(reversed(reading_query.all()))

            for reading in readings:
                db.add(
                    SensorReading(
                        organization_id=demo_org.id,
                        machine_id=public_machine_id,
                        device_id=None,
                        demo_session_id=session_id,
                        timestamp=reading.timestamp,
                        temperature=reading.temperature,
                        vibration=reading.vibration,
                        current=reading.current,
                        rpm=reading.rpm,
                        source=PUBLIC_DEMO_PROVENANCE,
                        created_at=reading.created_at,
                    )
                )

            if include_predictions:
                predictions = (
                    db.query(Prediction)
                    .filter(
                        Prediction.organization_id == source_org.id,
                        Prediction.machine_id == source_machine.machine_id,
                    )
                    .order_by(Prediction.timestamp.asc(), Prediction.id.asc())
                    .all()
                )
                for prediction in predictions:
                    db.add(
                        Prediction(
                            organization_id=demo_org.id,
                            machine_id=public_machine_id,
                            demo_session_id=session_id,
                            timestamp=prediction.timestamp,
                            failure_probability=prediction.failure_probability,
                            component=_scrub_text(prediction.component, replacements),
                            remaining_life_days=prediction.remaining_life_days,
                            confidence=prediction.confidence,
                            explanation=_scrub_text(prediction.explanation, replacements),
                            recommended_action=_scrub_text(
                                prediction.recommended_action, replacements
                            ),
                            model_version=_scrub_text(
                                prediction.model_version, replacements
                            ),
                            is_prototype=prediction.is_prototype,
                            explanation_data=_scrub_text(
                                prediction.explanation_data, replacements
                            ),
                            input_hash=None,
                            created_at=prediction.created_at,
                        )
                    )

            if include_alerts:
                alerts = (
                    db.query(Alert)
                    .filter(
                        Alert.organization_id == source_org.id,
                        Alert.machine_id == source_machine.machine_id,
                    )
                    .order_by(Alert.created_at.asc(), Alert.id.asc())
                    .all()
                )
                for alert in alerts:
                    db.add(
                        Alert(
                            organization_id=demo_org.id,
                            machine_id=public_machine_id,
                            demo_session_id=session_id,
                            alert_type=_scrub_text(alert.alert_type, replacements),
                            severity=alert.severity,
                            message=_scrub_text(alert.message, replacements),
                            status=alert.status,
                            created_at=alert.created_at,
                            resolved_at=alert.resolved_at,
                        )
                    )

            if include_maintenance:
                maintenance = (
                    db.query(MaintenanceRecord)
                    .filter(
                        MaintenanceRecord.organization_id == source_org.id,
                        MaintenanceRecord.machine_id == source_machine.machine_id,
                    )
                    .order_by(
                        MaintenanceRecord.maintenance_date.asc(),
                        MaintenanceRecord.id.asc(),
                    )
                    .all()
                )
                for record in maintenance:
                    db.add(
                        MaintenanceRecord(
                            organization_id=demo_org.id,
                            machine_id=public_machine_id,
                            component=_scrub_text(record.component, replacements),
                            failure_type=_scrub_text(record.failure_type, replacements),
                            issue_description=_scrub_text(
                                record.issue_description, replacements
                            ),
                            maintenance_action=_scrub_text(
                                record.maintenance_action, replacements
                            ),
                            technician=technician_label.strip(),
                            status=record.status,
                            failure_date=record.failure_date,
                            maintenance_date=record.maintenance_date,
                            created_at=record.created_at,
                        )
                    )

        if commit:
            db.commit()
        else:
            db.flush()
    except Exception:
        db.rollback()
        raise

    return public_demo_counts(db, demo_org)
