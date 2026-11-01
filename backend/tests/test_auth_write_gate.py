"""
Authentication gate tests after Phase 3.

The security model is now split into three independent transports:

- device:    X-API-Key (or Bearer <device key>) on device write endpoints
- user:      Supabase JWT + X-Organization-Id on organization endpoints
- operator:  signed HttpOnly operator session on platform endpoints

These tests prove each gate rejects the others, that reads are no longer public,
and that machine/device administration requires organization admin rights.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import Alert, Device, Machine, Organization
from backend.app.main import app
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

TEST_KEY = "test-write-key-12345"


def _set_device_api_key(value: str) -> None:
    get_settings().device_api_key = value


@pytest.fixture
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def client_with_key(session_factory, monkeypatch):
    install_auth(monkeypatch)
    _set_device_api_key(TEST_KEY)
    auth_module._WARNED_UNCONFIGURED = False

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        _set_device_api_key("")
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def seeded_tenant(session_factory):
    """Organization A with a registered machine + device, and a member user."""
    with session_factory() as db:
        org = seed_organization(db, "gate-org")
        seed_membership(db, org, "owner", user_id=USER_A)
        seed_membership(db, org, "member", user_id=USER_B)
        machine = seed_machine(db, org, "M-AUTH")
        seed_device(db, org, machine, "D-AUTH")
        db.add(
            Alert(
                organization_id=org.id,
                machine_id="M-AUTH",
                alert_type="TEMPERATURE_HIGH",
                severity="Warning",
                message="test",
                status="ACTIVE",
            )
        )
        db.commit()
        return str(org.id)


def telemetry_payload(device_id: str = "D-AUTH", machine_id: str = "M-AUTH") -> dict:
    return {
        "device_id": device_id,
        "machine_id": machine_id,
        "timestamp": "2026-01-01T00:00:00Z",
        "temperature": 40.0,
        "vibration": 1.0,
        "current": 5.0,
        "rpm": 1450,
        "source": "WOKWI",
    }


class TestDeviceGate:
    def test_sensor_data_requires_key(self, client_with_key):
        response = client_with_key.post("/api/sensor-data", json=telemetry_payload())
        assert response.status_code == 401
        assert "X-API-Key" in response.json()["detail"]

    def test_sensor_data_rejects_wrong_key(self, client_with_key):
        response = client_with_key.post(
            "/api/sensor-data", json=telemetry_payload(), headers={"X-API-Key": "wrong"}
        )
        assert response.status_code == 403

    def test_sensor_data_rejects_user_jwt(self, client_with_key, seeded_tenant):
        """A Supabase JWT is never a device credential."""
        response = client_with_key.post(
            "/api/sensor-data",
            json=telemetry_payload(),
            headers=auth_headers(USER_A, seeded_tenant),
        )
        assert response.status_code == 403

    def test_predict_requires_key(self, client_with_key):
        response = client_with_key.post(
            "/api/predict",
            json={"machine_id": "M-AUTH", "temperature": 50, "vibration": 2, "current": 5, "rpm": 1450},
        )
        assert response.status_code == 401

    def test_heartbeat_requires_key(self, client_with_key):
        assert (
            client_with_key.post(
                "/api/devices/heartbeat",
                json={"device_id": "D-AUTH", "machine_id": "M-AUTH", "source": "WOKWI"},
            ).status_code
            == 401
        )

    def test_telemetry_ingest_with_key_and_registered_device_persists(
        self, client_with_key, seeded_tenant
    ):
        response = client_with_key.post(
            "/api/sensor-data", json=telemetry_payload(), headers={"X-API-Key": TEST_KEY}
        )
        assert response.status_code == 201, response.text
        assert response.json()["success"] is True

    def test_bearer_alias_accepted_for_device_key(self, client_with_key, seeded_tenant):
        response = client_with_key.post(
            "/api/sensor-data",
            json=telemetry_payload(),
            headers={"Authorization": f"Bearer {TEST_KEY}"},
        )
        assert response.status_code == 201

    def test_unknown_device_is_rejected(self, client_with_key, seeded_tenant):
        response = client_with_key.post(
            "/api/sensor-data",
            json=telemetry_payload(device_id="D-UNKNOWN"),
            headers={"X-API-Key": TEST_KEY},
        )
        assert response.status_code == 404

    def test_device_cannot_write_another_organizations_machine(
        self, client_with_key, seeded_tenant, session_factory
    ):
        """D-AUTH is registered to M-AUTH only; another machine must be refused."""
        with session_factory() as db:
            machine = db.query(Machine).filter_by(machine_id="M-AUTH").one()
            org = db.get(Organization, machine.organization_id)
            seed_machine(db, org, "M-FOREIGN")
        response = client_with_key.post(
            "/api/sensor-data",
            json=telemetry_payload(machine_id="M-FOREIGN"),
            headers={"X-API-Key": TEST_KEY},
        )
        assert response.status_code in (400, 403, 404)


class TestUserGate:
    def test_reads_are_not_public(self, client_with_key):
        for path in ("/api/machines", "/api/alerts", "/api/feedback", "/api/stats"):
            assert client_with_key.get(path).status_code == 401, path

    def test_missing_organization_selector_is_rejected_for_multi_org_user(
        self, client_with_key, seeded_tenant, session_factory
    ):
        with session_factory() as db:
            org = seed_organization(db, "second-org")
            seed_membership(db, org, "owner", user_id=USER_A)
            second_id = str(org.id)
        response = client_with_key.get("/api/machines", headers=auth_headers(USER_A))
        assert response.status_code == 400

    def test_member_can_read_organization_data(self, client_with_key, seeded_tenant):
        response = client_with_key.get(
            "/api/machines", headers=auth_headers(USER_B, seeded_tenant)
        )
        assert response.status_code == 200

    def test_member_cannot_register_machine(self, client_with_key, seeded_tenant):
        response = client_with_key.post(
            "/api/machines",
            json={
                "machine_id": "M-NEW",
                "name": "New",
                "type": "Pump",
                "location": "Bay",
            },
            headers=auth_headers(USER_B, seeded_tenant),
        )
        assert response.status_code == 403

    def test_owner_can_register_machine_in_own_organization(self, client_with_key, seeded_tenant):
        response = client_with_key.post(
            "/api/machines",
            json={
                "machine_id": "M-NEW",
                "name": "New",
                "type": "Pump",
                "location": "Bay",
            },
            headers=auth_headers(USER_A, seeded_tenant),
        )
        assert response.status_code == 201, response.text

    def test_member_can_acknowledge_alert(self, client_with_key, seeded_tenant):
        response = client_with_key.post(
            "/api/alerts/1/acknowledge", headers=auth_headers(USER_B, seeded_tenant)
        )
        assert response.status_code == 200
        assert response.json()["status"] == "ACKNOWLEDGED"

    def test_device_key_is_not_a_user_credential(self, client_with_key):
        response = client_with_key.get("/api/machines", headers={"X-API-Key": TEST_KEY})
        assert response.status_code == 401


class TestPublicEndpoints:
    def test_health_and_ready_stay_public(self, client_with_key):
        assert client_with_key.get("/api/health").status_code == 200
        assert client_with_key.get("/api/ready").status_code in (200, 503)

    def test_device_gate_is_dev_posture_only_when_unconfigured(
        self, session_factory, monkeypatch
    ):
        """Unconfigured DEVICE_API_KEY means an open gate (warned once at startup).

        Phase 3 keeps that documented development posture, but the request is
        still rejected later: unknown devices are never provisioned.
        """
        install_auth(monkeypatch)
        _set_device_api_key("")
        auth_module._WARNED_UNCONFIGURED = False

        def override_get_db():
            with session_factory() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            response = client.post("/api/sensor-data", json=telemetry_payload())
            # The key gate is open, but D-AUTH is not registered in this DB.
            assert response.status_code == 404
        finally:
            auth_module._WARNED_UNCONFIGURED = False
            app.dependency_overrides.pop(get_db, None)
