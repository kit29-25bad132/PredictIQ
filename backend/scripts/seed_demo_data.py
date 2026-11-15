"""Seed the isolated public demo with simulated motor data.

This is a manual, standalone data-provisioning script. It is never imported by
the application, never invoked by a migration, and never runs at startup.

What it writes (only inside the fixed ``public-demo`` organization):

* 3 demo machines with ``is_demo=True`` and ``DEMO-MOTOR-00x`` identifiers;
* one ACTIVE demo session per machine (required by the MANUAL_DEMO coherence
  constraint on ``sensor_readings``);
* 48 hours of hourly simulated temperature, vibration, current and RPM readings
  per machine with ``source='MANUAL_DEMO'`` and no device identity;
* one ACTIVE ``Warning`` alert on one machine.

It contains no real customer values, names, devices or organisation ids.

Prerequisites and safety
------------------------
* Migration 010 must already be applied by an operator with ``deploy/migrate.sh``.
  This script does NOT create or alter schema; it refuses to run otherwise.
* The default invocation is a dry run. Pass ``--execute`` to write.
* Re-running is idempotent: existing demo readings/alerts are not duplicated.
* ``--reset`` deletes only rows owned by the public demo organization and must be
  combined with ``--confirm --execute``.

Exact commands (from the repository root)::

    python -m backend.scripts.seed_demo_data
    python -m backend.scripts.seed_demo_data --execute

    python -m backend.scripts.seed_demo_data --reset --confirm --execute
"""

from __future__ import annotations

import argparse
import math
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import delete, func, inspect
from sqlalchemy.orm import Session

from backend.app.core.public_demo import (
    PUBLIC_DEMO_ORGANIZATION_ID,
    PUBLIC_DEMO_ORGANIZATION_NAME,
    PUBLIC_DEMO_ORGANIZATION_SLUG,
    PUBLIC_DEMO_PROVENANCE,
)
from backend.app.db.database import SessionLocal
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

READING_HOURS = 48
WARNING_MACHINE_ID = "DEMO-MOTOR-002"
WARNING_ALERT_TYPE = "Elevated Vibration"

DEMO_MACHINES: Sequence[Dict[str, Any]] = (
    {
        "machine_id": "DEMO-MOTOR-001",
        "name": "Demo Conveyor Motor A",
        "type": "Three-Phase Induction Motor",
        "location": "Public Demo Plant - Line 1",
        "status": "Healthy",
        "rated_rpm": 1480.0,
        "rated_current": 12.5,
        "max_temp": 85.0,
        "max_vibration": 4.5,
        "base_temp": 57.0,
        "base_vibration": 1.1,
        "base_current": 9.2,
        "base_rpm": 1472.0,
    },
    {
        "machine_id": "DEMO-MOTOR-002",
        "name": "Demo Pump Motor B",
        "type": "Three-Phase Induction Motor",
        "location": "Public Demo Plant - Line 2",
        "status": "Warning",
        "rated_rpm": 1460.0,
        "rated_current": 13.0,
        "max_temp": 85.0,
        "max_vibration": 4.5,
        "base_temp": 66.0,
        "base_vibration": 2.5,
        "base_current": 10.8,
        "base_rpm": 1452.0,
    },
    {
        "machine_id": "DEMO-MOTOR-003",
        "name": "Demo Compressor Motor C",
        "type": "Three-Phase Induction Motor",
        "location": "Public Demo Plant - Line 3",
        "status": "Critical",
        "rated_rpm": 1440.0,
        "rated_current": 14.0,
        "max_temp": 85.0,
        "max_vibration": 4.5,
        "base_temp": 74.0,
        "base_vibration": 3.7,
        "base_current": 12.4,
        "base_rpm": 1432.0,
    },
)


def _demo_session_id(machine_id: str) -> uuid.UUID:
    return uuid.uuid5(
        uuid.NAMESPACE_URL, f"predictiq:public-demo:seed:{machine_id}"
    )


def _schema_problem(db: Session) -> Optional[str]:
    inspector = inspect(db.get_bind())
    tables = set(inspector.get_table_names())
    missing: List[str] = []

    for table in ("organizations", "machines", "sensor_readings", "alerts", "demo_sessions"):
        if table not in tables:
            missing.append(table)
    if "machines" in tables:
        columns = {column["name"] for column in inspector.get_columns("machines")}
        if "is_demo" not in columns:
            missing.append("machines.is_demo")
    for table in ("sensor_readings", "alerts"):
        if table not in tables:
            continue
        columns = {column["name"] for column in inspector.get_columns(table)}
        if "demo_session_id" not in columns:
            missing.append(f"{table}.demo_session_id")

    if not missing:
        return None
    return (
        "The database schema is older than this script expects (missing: "
        + ", ".join(sorted(missing))
        + "). Apply the existing Alembic revisions first with deploy/migrate.sh; "
        "this script never changes schema."
    )


def _purge_demo_rows(db: Session, org: Organization) -> None:
    machine_ids = [
        row[0]
        for row in db.query(Machine.machine_id)
        .filter(
            Machine.organization_id == org.id,
            Machine.is_demo.is_(True),
        )
        .all()
    ]
    scoped_ids = machine_ids or [""]

    db.execute(
        delete(FeedbackRecord).where(
            FeedbackRecord.organization_id == org.id,
            FeedbackRecord.machine_id.in_(scoped_ids),
        )
    )
    db.execute(
        delete(Prediction).where(
            Prediction.organization_id == org.id,
            Prediction.machine_id.in_(scoped_ids),
        )
    )
    db.execute(
        delete(Alert).where(
            Alert.organization_id == org.id,
            Alert.machine_id.in_(scoped_ids),
        )
    )
    db.execute(
        delete(SensorReading).where(
            SensorReading.organization_id == org.id,
            SensorReading.machine_id.in_(scoped_ids),
        )
    )
    db.execute(
        delete(MaintenanceRecord).where(
            MaintenanceRecord.organization_id == org.id,
            MaintenanceRecord.machine_id.in_(scoped_ids),
        )
    )
    db.execute(delete(DemoSession).where(DemoSession.organization_id == org.id))
    db.execute(
        delete(Machine).where(
            Machine.organization_id == org.id,
            Machine.is_demo.is_(True),
        )
    )
    db.flush()


def _reading_values(spec: Dict[str, Any], index: int, hours_back: int) -> Dict[str, float]:
    phase = (index + 1) * 0.7 + hours_back / 6.0
    temperature = spec["base_temp"] + 2.2 * math.sin(phase) + 0.02 * hours_back
    vibration = (
        spec["base_vibration"] + 0.35 * math.sin(phase / 2.0) + 0.015 * hours_back
    )
    current = spec["base_current"] + 0.55 * math.sin(phase + 0.6)
    rpm = spec["base_rpm"] + 30.0 * math.sin(phase / 3.0)
    return {
        "temperature": round(temperature, 2),
        "vibration": round(max(0.05, vibration), 2),
        "current": round(max(0.1, current), 2),
        "rpm": round(max(0.0, rpm), 1),
    }


def _ensure_demo_organization(db: Session, now: datetime) -> Organization:
    org = db.get(Organization, PUBLIC_DEMO_ORGANIZATION_ID)
    if org is not None and org.slug != PUBLIC_DEMO_ORGANIZATION_SLUG:
        raise RuntimeError(
            "The reserved public-demo organization id belongs to a different slug."
        )
    if org is None:
        org = Organization(
            id=PUBLIC_DEMO_ORGANIZATION_ID,
            name=PUBLIC_DEMO_ORGANIZATION_NAME,
            slug=PUBLIC_DEMO_ORGANIZATION_SLUG,
            status="active",
            created_at=now,
            updated_at=now,
        )
        db.add(org)
        db.flush()
    return org


def seed(db: Session, *, reset: bool = False) -> Dict[str, int]:
    now = datetime.now(timezone.utc)
    org = _ensure_demo_organization(db, now)

    if reset:
        _purge_demo_rows(db, org)

    for index, spec in enumerate(DEMO_MACHINES):
        existing = (
            db.query(Machine)
            .filter(Machine.machine_id == spec["machine_id"])
            .first()
        )
        if existing is not None:
            if existing.organization_id != org.id or not existing.is_demo:
                raise RuntimeError(
                    f"Refusing to touch '{spec['machine_id']}': it exists outside "
                    "the public demo organization."
                )
            machine = existing
        else:
            machine = Machine(
                organization_id=org.id,
                machine_id=spec["machine_id"],
                name=spec["name"],
                type=spec["type"],
                location=spec["location"],
                status=spec["status"],
                is_demo=True,
                rated_rpm=spec["rated_rpm"],
                rated_current=spec["rated_current"],
                max_temp=spec["max_temp"],
                max_vibration=spec["max_vibration"],
                created_at=now,
            )
            db.add(machine)
            db.flush()

        session_id = _demo_session_id(spec["machine_id"])
        if db.get(DemoSession, session_id) is None:
            db.add(
                DemoSession(
                    id=session_id,
                    organization_id=org.id,
                    machine_id=spec["machine_id"],
                    name=f"Public Demo - {spec['name']}"[:120],
                    status="ACTIVE",
                    created_by=None,
                    created_at=now,
                    closed_at=None,
                )
            )
            db.flush()

        reading_count = int(
            db.query(func.count(SensorReading.id))
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.machine_id == spec["machine_id"],
                SensorReading.source == PUBLIC_DEMO_PROVENANCE,
            )
            .scalar()
            or 0
        )
        if reading_count == 0:
            for hours_back in range(READING_HOURS, -1, -1):
                values = _reading_values(spec, index, hours_back)
                db.add(
                    SensorReading(
                        organization_id=org.id,
                        machine_id=spec["machine_id"],
                        device_id=None,
                        demo_session_id=session_id,
                        timestamp=now - timedelta(hours=hours_back),
                        temperature=values["temperature"],
                        vibration=values["vibration"],
                        current=values["current"],
                        rpm=values["rpm"],
                        source=PUBLIC_DEMO_PROVENANCE,
                        created_at=now,
                    )
                )

        if spec["machine_id"] == WARNING_MACHINE_ID:
            existing_alert = (
                db.query(Alert)
                .filter(
                    Alert.organization_id == org.id,
                    Alert.machine_id == spec["machine_id"],
                    Alert.alert_type == WARNING_ALERT_TYPE,
                )
                .first()
            )
            if existing_alert is None:
                db.add(
                    Alert(
                        organization_id=org.id,
                        machine_id=spec["machine_id"],
                        demo_session_id=session_id,
                        alert_type=WARNING_ALERT_TYPE,
                        severity="Warning",
                        message=(
                            "Simulated demo alert: vibration is above the warning "
                            "threshold on this demo machine."
                        ),
                        status="ACTIVE",
                        created_at=now - timedelta(hours=2),
                    )
                )

    db.commit()
    return _counts(db, org)


def _counts(db: Session, org: Organization) -> Dict[str, int]:
    return {
        "machines": int(
            db.query(func.count(Machine.id))
            .filter(
                Machine.organization_id == org.id,
                Machine.is_demo.is_(True),
            )
            .scalar()
            or 0
        ),
        "sessions": int(
            db.query(func.count(DemoSession.id))
            .filter(DemoSession.organization_id == org.id)
            .scalar()
            or 0
        ),
        "readings": int(
            db.query(func.count(SensorReading.id))
            .filter(
                SensorReading.organization_id == org.id,
                SensorReading.source == PUBLIC_DEMO_PROVENANCE,
            )
            .scalar()
            or 0
        ),
        "alerts": int(
            db.query(func.count(Alert.id))
            .filter(Alert.organization_id == org.id)
            .scalar()
            or 0
        ),
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Seed simulated, isolated data for the public demo (manual run only)."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write the demo rows. Without this flag the command is a dry run.",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete existing public-demo rows first (requires --confirm).",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Acknowledge the scoped demo-only delete performed by --reset.",
    )
    args = parser.parse_args(argv)

    if args.reset and not args.confirm:
        print(
            "Refusing to reset: pass --reset --confirm to delete demo-organization rows.",
            file=sys.stderr,
        )
        return 2
    if SessionLocal is None:
        print(
            "Database is not configured. Set DATABASE_URL (or complete DB_* settings) first.",
            file=sys.stderr,
        )
        return 1

    session = SessionLocal()
    try:
        problem = _schema_problem(session)
        if problem:
            print(problem, file=sys.stderr)
            return 1

        org = session.get(Organization, PUBLIC_DEMO_ORGANIZATION_ID)
        before = (
            _counts(session, org)
            if org is not None and org.slug == PUBLIC_DEMO_ORGANIZATION_SLUG
            else {"machines": 0, "sessions": 0, "readings": 0, "alerts": 0}
        )

        print(f"Target demo organization: {PUBLIC_DEMO_ORGANIZATION_ID} "
              f"(slug '{PUBLIC_DEMO_ORGANIZATION_SLUG}')")
        print("Planned machines:")
        for spec in DEMO_MACHINES:
            print(
                f"  {spec['machine_id']}  status={spec['status']}  "
                f"readings={READING_HOURS + 1} (hourly, last {READING_HOURS}h)"
            )
        print(f"Planned alert: 1 ACTIVE Warning on {WARNING_MACHINE_ID}")
        print(f"Existing demo rows: {before}")

        if not args.execute:
            print("Dry run only: no rows were written. Re-run with --execute to seed.")
            return 0

        after = seed(session, reset=args.reset)
    except Exception as exc:  # noqa: BLE001 - CLI reports, never traceback-leaks
        session.rollback()
        detail = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        print(f"Public demo seed failed: {detail}", file=sys.stderr)
        return 1
    finally:
        session.close()

    print(f"Demo rows after: {after}")
    print(
        "Public demo data is ready. It is served by the unauthenticated, "
        "read-only /api/public/demo endpoints."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
