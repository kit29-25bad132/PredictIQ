from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.database import Base, get_db
from backend.app.db.models import Alert, Device, Machine, SensorReading
from backend.app.main import app
from backend.app.services.health_engine import (
    DEFAULT_MAX_TEMP,
    DEFAULT_MAX_VIBRATION,
    DEFAULT_RATED_CURRENT,
    DEFAULT_RATED_RPM,
    evaluate_reading,
)


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        yield db


def make_machine(db: Session, **specs) -> Machine:
    machine = Machine(
        machine_id="M-HEALTH",
        name="Health test machine",
        type="Pump",
        location="Test bay",
        **specs,
    )
    db.add(machine)
    db.flush()
    return machine


def make_reading(machine: Machine, **values) -> SensorReading:
    return SensorReading(
        machine_id=machine.machine_id,
        device_id="D-HEALTH",
        timestamp=values.pop("timestamp", datetime.now(timezone.utc)),
        source="WOKWI",
        temperature=values.pop("temperature", 50),
        vibration=values.pop("vibration", 2),
        current=values.pop("current", 5),
        rpm=values.pop("rpm", DEFAULT_RATED_RPM),
        **values,
    )


@pytest.mark.parametrize(
    ("field", "warning", "critical"),
    [
        ("temperature", DEFAULT_MAX_TEMP, DEFAULT_MAX_TEMP * 1.2),
        ("vibration", DEFAULT_MAX_VIBRATION, DEFAULT_MAX_VIBRATION * 1.2),
        ("current", DEFAULT_RATED_CURRENT, DEFAULT_RATED_CURRENT * 1.2),
    ],
)
def test_normal_warning_critical_boundaries(session, field, warning, critical) -> None:
    machine = make_machine(session)
    session.commit()
    for value, expected in ((warning - 0.01, "NORMAL"), (warning, "WARNING"), (critical, "CRITICAL")):
        reading = make_reading(machine, **{field: value})
        assert evaluate_reading(machine, reading, session).state == expected
        session.commit()
        machine = session.query(Machine).filter_by(machine_id="M-HEALTH").one()


@pytest.mark.parametrize(
    ("rpm", "expected"),
    [(DEFAULT_RATED_RPM * 0.9, "WARNING"), (DEFAULT_RATED_RPM * 0.8, "CRITICAL")],
)
def test_rpm_deviation_boundaries(session, rpm, expected) -> None:
    machine = make_machine(session)
    assert evaluate_reading(machine, make_reading(machine, rpm=rpm), session).state == expected


def test_machine_specific_specs_override_global_defaults(session) -> None:
    machine = make_machine(session, rated_rpm=1000, rated_current=20, max_temp=100, max_vibration=10)
    reading = make_reading(machine, temperature=100, vibration=5, current=10, rpm=1000)

    evaluation = evaluate_reading(machine, reading, session)

    assert evaluation.state == "WARNING"
    assert evaluation.metric_states["TEMPERATURE_HIGH"] == "WARNING"


def test_global_defaults_are_used_when_specs_are_missing(session) -> None:
    machine = make_machine(session)
    reading = make_reading(
        machine,
        temperature=DEFAULT_MAX_TEMP,
        vibration=DEFAULT_MAX_VIBRATION,
        current=DEFAULT_RATED_CURRENT,
        rpm=DEFAULT_RATED_RPM,
    )

    assert evaluate_reading(machine, reading, session).state == "WARNING"


def test_status_transitions_recovery_and_no_normal_alert(session) -> None:
    machine = make_machine(session)
    warning = make_reading(machine, vibration=DEFAULT_MAX_VIBRATION)
    normal = make_reading(machine, vibration=1, timestamp=warning.timestamp + timedelta(minutes=1))

    assert evaluate_reading(machine, warning, session).machine_status == "Warning"
    assert evaluate_reading(machine, normal, session).machine_status == "Healthy"
    assert session.query(Alert).count() == 1


def test_alert_creation_and_identical_reading_deduplication(session) -> None:
    machine = make_machine(session)
    timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    first = make_reading(machine, vibration=DEFAULT_MAX_VIBRATION * 1.2, timestamp=timestamp)
    repeated = make_reading(machine, vibration=DEFAULT_MAX_VIBRATION * 1.2, timestamp=timestamp + timedelta(seconds=30))

    evaluate_reading(machine, first, session)
    session.commit()
    evaluate_reading(machine, repeated, session)
    session.commit()

    alerts = session.query(Alert).all()
    assert len(alerts) == 1
    assert alerts[0].severity == "Critical"
    assert alerts[0].status == "ACTIVE"


def test_alert_can_be_created_again_after_cooldown(session) -> None:
    machine = make_machine(session)
    first = make_reading(machine, current=DEFAULT_RATED_CURRENT, timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    later = make_reading(machine, current=DEFAULT_RATED_CURRENT, timestamp=first.timestamp + timedelta(minutes=6))

    evaluate_reading(machine, first, session)
    session.commit()
    evaluate_reading(machine, later, session)
    session.commit()

    assert session.query(Alert).count() == 2


def test_sensor_ingest_evaluates_and_persists_health_and_alert() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/sensor-data",
                json={
                    "device_id": "D-ROUTE",
                    "machine_id": "M-ROUTE",
                    "timestamp": "2026-01-01T00:00:00Z",
                    "temperature": 50,
                    "vibration": 5.4,
                    "current": 5,
                    "rpm": 1450,
                    "source": "WOKWI",
                },
            )
            assert response.status_code == 201

        with factory() as db:
            machine = db.query(Machine).filter_by(machine_id="M-ROUTE").one()
            assert machine.status == "Critical"
            assert db.query(SensorReading).count() == 1
            assert db.query(Alert).count() == 1
    finally:
        app.dependency_overrides.pop(get_db, None)