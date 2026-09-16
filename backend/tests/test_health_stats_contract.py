"""
Health contract and fleet statistics endpoint tests.

The frontend (frontend/src/services/api.ts) consumes:
- GET /api/health  -> system/version/timestamp/database/counts snapshot
- GET /api/stats   -> fleet KPIs (dashboard MetricCards)

These tests pin the authoritative response shapes and prove the values are
computed from real database rows (no hardcoded zeros, no fabricated stats).
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.database import Base, get_db
from backend.app.db.models import Alert, Device, Machine, SensorReading
from backend.app.main import app, _liveness_db


def _override_session(factory):
    def override_get_db():
        with factory() as db:
            yield db

    return override_get_db


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    app.dependency_overrides[get_db] = _override_session(factory)
    # /api/health and /api/stats resolve their session through _liveness_db;
    # override it too so the test database is the one actually queried.
    app.dependency_overrides[_liveness_db] = _override_session(factory)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(_liveness_db, None)


def _seed_real_rows(db) -> None:
    """Real rows through the ORM — no demo fixtures are committed anywhere."""
    machine = Machine(
        machine_id="M-STATS",
        name="Stats machine",
        type="Centrifugal Pump",
        location="Bay 1",
    )
    device = Device(
        device_id="D-STATS",
        machine_id="M-STATS",
        last_seen=datetime.now(timezone.utc),
        status="ONLINE",
        source="WOKWI",
    )
    stale_device = Device(
        device_id="D-STALE",
        machine_id="M-STATS",
        last_seen=datetime.now(timezone.utc) - timedelta(hours=1),
        status="OFFLINE",
        source="WOKWI",
    )
    reading = SensorReading(
        machine_id="M-STATS",
        device_id="D-STATS",
        timestamp=datetime.now(timezone.utc),
        temperature=50.0,
        vibration=2.0,
        current=5.0,
        rpm=1450.0,
        source="WOKWI",
    )
    alert = Alert(
        machine_id="M-STATS",
        alert_type="VIBRATION_HIGH",
        severity="Warning",
        message="Test alert",
        status="ACTIVE",
    )
    resolved_alert = Alert(
        machine_id="M-STATS",
        alert_type="TEMPERATURE_HIGH",
        severity="Info",
        message="Resolved alert",
        status="RESOLVED",
    )
    db.add_all([machine, device, stale_device, reading, alert, resolved_alert])
    db.commit()


class TestHealthContract:
    def test_health_returns_frontend_contract_fields(self, client):
        body = client.get("/api/health").json()
        # api.ts getHealth() consumes exactly these fields.
        for field in (
            "status",
            "system",
            "version",
            "environment",
            "timestamp",
            "database",
            "active_machines",
            "registered_devices",
            "connected_esp32_devices",
            "total_sensor_readings",
        ):
            assert field in body, f"health contract missing field: {field}"
        assert body["status"] == "ok"
        assert body["system"]
        assert body["database"]

    def test_health_counts_are_real(self, client):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, expire_on_commit=False)

        def override():
            with factory() as db:
                yield db

        app.dependency_overrides[get_db] = override
        app.dependency_overrides[_liveness_db] = override
        try:
            with factory() as db:
                _seed_real_rows(db)
            body = client.get("/api/health").json()
            assert body["active_machines"] == 1
            assert body["registered_devices"] == 2
            assert body["connected_esp32_devices"] == 1
            assert body["total_sensor_readings"] == 1
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(_liveness_db, None)


class TestFleetStats:
    def test_stats_returns_frontend_contract_fields(self, client):
        body = client.get("/api/stats").json()
        for field in (
            "total_machines",
            "total_devices",
            "connected_devices",
            "total_sensor_readings",
            "total_maintenance_records",
            "active_alerts",
            "data_collection_status",
        ):
            assert field in body, f"stats contract missing field: {field}"

    def test_stats_values_are_zero_on_empty_database(self, client):
        body = client.get("/api/stats").json()
        assert body["total_machines"] == 0
        assert body["active_alerts"] == 0
        assert body["data_collection_status"] == "WAITING"

    def test_stats_values_come_from_real_rows(self, client):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, expire_on_commit=False)

        def override():
            with factory() as db:
                yield db

        app.dependency_overrides[get_db] = override
        app.dependency_overrides[_liveness_db] = override
        try:
            with factory() as db:
                _seed_real_rows(db)
            body = client.get("/api/stats").json()
            assert body["total_machines"] == 1
            assert body["total_devices"] == 2
            assert body["connected_devices"] == 1  # stale device excluded
            assert body["total_sensor_readings"] == 1
            assert body["active_alerts"] == 1  # resolved alert excluded
            assert body["data_collection_status"] == "ACTIVE"
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(_liveness_db, None)
