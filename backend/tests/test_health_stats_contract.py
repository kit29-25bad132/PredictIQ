"""
Health contract and organization fleet statistics endpoint tests.

The frontend (frontend/src/services/api.ts) consumes:
- GET /api/health  -> system/version/timestamp/database/counts snapshot (public)
- GET /api/stats   -> fleet KPIs (dashboard MetricCards), organization-scoped

Phase 3: /api/stats requires an authenticated organization member and must never
count another organization's rows.
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
from backend.tests.tenant_utils import (
    USER_A,
    USER_B,
    auth_headers,
    install_auth,
    seed_device,
    seed_machine,
    seed_membership,
    seed_organization,
)


def _override_session(factory):
    def override_get_db():
        with factory() as db:
            yield db

    return override_get_db


@pytest.fixture
def tenant(monkeypatch):
    install_auth(monkeypatch)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    with factory() as db:
        org = seed_organization(db, "acme")
        seed_membership(db, org, "owner", user_id=USER_A)
        seed_organization(db, "other")
    org_id = org.id

    app.dependency_overrides[get_db] = _override_session(factory)
    app.dependency_overrides[_liveness_db] = _override_session(factory)
    try:
        yield TestClient(app), factory, org_id
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(_liveness_db, None)


def _seed_real_rows(db, org_id, machine_id="M-STATS", device_id="D-STATS") -> None:
    now = datetime.now(timezone.utc)
    machine = Machine(
        organization_id=org_id,
        machine_id=machine_id,
        name="Stats machine",
        type="Centrifugal Pump",
        location="Bay 1",
    )
    device = Device(
        organization_id=org_id,
        device_id=device_id,
        machine_id=machine_id,
        last_seen=now,
        status="ONLINE",
        source="WOKWI",
    )
    stale_device = Device(
        organization_id=org_id,
        device_id=f"{device_id}-STALE",
        machine_id=machine_id,
        last_seen=now - timedelta(hours=1),
        status="OFFLINE",
        source="WOKWI",
    )
    reading = SensorReading(
        organization_id=org_id,
        machine_id=machine_id,
        device_id=device_id,
        timestamp=now,
        temperature=50.0,
        vibration=2.0,
        current=5.0,
        rpm=1450.0,
        source="WOKWI",
    )
    alert = Alert(
        organization_id=org_id,
        machine_id=machine_id,
        alert_type="VIBRATION_HIGH",
        severity="Warning",
        message="Test alert",
        status="ACTIVE",
    )
    resolved_alert = Alert(
        organization_id=org_id,
        machine_id=machine_id,
        alert_type="TEMPERATURE_HIGH",
        severity="Info",
        message="Resolved alert",
        status="RESOLVED",
    )
    db.add_all([machine, device, stale_device, reading, alert, resolved_alert])
    db.commit()


class TestHealthContract:
    def test_health_is_public_and_keeps_contract_fields(self, tenant):
        client, _, _ = tenant
        body = client.get("/api/health").json()
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

    def test_health_counts_are_real(self, tenant):
        client, factory, org_id = tenant
        with factory() as db:
            _seed_real_rows(db, org_id)
        body = client.get("/api/health").json()
        assert body["active_machines"] == 1
        assert body["registered_devices"] == 2
        assert body["connected_esp32_devices"] == 1
        assert body["total_sensor_readings"] == 1


class TestFleetStats:
    def test_stats_requires_authentication(self, tenant):
        client, _, _ = tenant
        assert client.get("/api/stats").status_code == 401

    def test_stats_returns_contract_fields(self, tenant):
        client, _, org_id = tenant
        body = client.get("/api/stats", headers=auth_headers(USER_A, org_id)).json()
        for field in (
            "total_machines",
            "total_devices",
            "connected_devices",
            "total_sensor_readings",
            "total_maintenance_records",
            "active_alerts",
            "data_collection_status",
        ):
            assert field in body

    def test_stats_zero_on_empty_organization(self, tenant):
        client, _, org_id = tenant
        body = client.get("/api/stats", headers=auth_headers(USER_A, org_id)).json()
        assert body["total_machines"] == 0
        assert body["active_alerts"] == 0
        assert body["data_collection_status"] == "WAITING"

    def test_stats_are_scoped_to_the_organization(self, tenant):
        """Organization A must never see organization B's counts."""
        client, factory, org_a = tenant
        with factory() as db:
            _seed_real_rows(db, org_a)
        body = client.get("/api/stats", headers=auth_headers(USER_A, org_a)).json()
        assert body["total_machines"] == 1
        assert body["total_devices"] == 2
        assert body["connected_devices"] == 1
        assert body["total_sensor_readings"] == 1
        assert body["active_alerts"] == 1
        assert body["data_collection_status"] == "ACTIVE"
