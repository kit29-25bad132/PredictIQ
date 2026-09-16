"""
Write-gate (API key) authentication tests.

Proves, per the remediation contract:
- unauthenticated writes are rejected (401)
- wrong credentials are rejected (403)
- the valid configured credential is accepted (2xx)
- reads stay public, so the dashboard keeps working without credentials
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import Machine
from backend.app.main import app


TEST_KEY = "test-write-key-12345"


def _set_device_api_key(value: str) -> None:
    """Patch the cached Settings instance device_api_key.

    pydantic-settings v2 instances do not expose fields as class attributes,
    so patching ``Settings.device_api_key`` raises AttributeError. Patching the
    live instance works because ``get_settings()`` is lru_cache'd and auth.py
    reads the instance on every call.
    """
    get_settings().device_api_key = value


@pytest.fixture
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def client_with_key(session_factory, monkeypatch):
    _set_device_api_key(TEST_KEY)
    auth_module._WARNED_UNCONFIGURED = False

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        # Restore the unauthenticated dev posture for other tests.
        get_settings().device_api_key = ""
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client_without_key(session_factory, monkeypatch):
    _set_device_api_key("")
    auth_module._WARNED_UNCONFIGURED = False

    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        get_settings().device_api_key = ""
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


def machine_payload() -> dict:
    return {
        "machine_id": "M-AUTH",
        "name": "Auth test machine",
        "type": "Centrifugal Pump",
        "location": "Test bay",
    }


class TestUnauthenticatedWritesRejected:
    def test_sensor_data_requires_key(self, client_with_key):
        response = client_with_key.post(
            "/api/sensor-data",
            json={
                "device_id": "D1",
                "machine_id": "M-AUTH",
                "timestamp": "2026-01-01T00:00:00Z",
                "temperature": 40.0,
                "vibration": 1.0,
                "current": 5.0,
                "rpm": 1450,
                "source": "WOKWI",
            },
        )
        assert response.status_code == 401
        assert "X-API-Key" in response.json()["detail"]

    def test_predict_requires_key(self, client_with_key, session_factory):
        """Auth gate fires BEFORE the machine-lookup 404, so no seeded row is needed."""
        response = client_with_key.post(
            "/api/predict",
            json={"machine_id": "M-AUTH", "temperature": 50, "vibration": 2, "current": 5, "rpm": 1450},
        )
        assert response.status_code == 401

    def test_feedback_requires_key(self, client_with_key):
        response = client_with_key.post(
            "/api/feedback",
            json={
                "machine_id": "M-AUTH",
                "observed_condition": "Inspected",
                "severity": "Warning",
                "outcome": "Confirmed",
            },
        )
        assert response.status_code == 401

    def test_maintenance_requires_key(self, client_with_key):
        response = client_with_key.post(
            "/api/maintenance",
            json={
                "machine_id": "M-AUTH",
                "component": "Bearing",
                "issue_description": "Noise",
                "maintenance_action": "Replace",
                "technician": "Tech",
            },
        )
        assert response.status_code == 401

    def test_machine_registration_requires_key(self, client_with_key):
        assert client_with_key.post("/api/machines", json=machine_payload()).status_code == 401

    def test_device_registration_requires_key(self, client_with_key):
        assert client_with_key.post("/api/devices", json={"device_id": "D9", "machine_id": "M-AUTH"}).status_code == 401

    def test_heartbeat_requires_key(self, client_with_key):
        assert client_with_key.post(
            "/api/devices/heartbeat",
            json={"device_id": "D1", "machine_id": "M-AUTH", "source": "WOKWI"},
        ).status_code == 401

    def test_train_model_requires_key(self, client_with_key):
        assert client_with_key.post("/api/train-model", json={}).status_code == 401

    def test_alert_acknowledge_requires_key(self, client_with_key):
        assert client_with_key.post("/api/alerts/1/acknowledge").status_code == 401

    def test_alert_resolve_requires_key(self, client_with_key):
        assert client_with_key.post("/api/alerts/1/resolve").status_code == 401


class TestWrongCredentialRejected:
    def test_wrong_key_is_forbidden(self, client_with_key):
        response = client_with_key.post(
            "/api/machines",
            json=machine_payload(),
            headers={"X-API-Key": "wrong-key"},
        )
        assert response.status_code == 403

    def test_wrong_bearer_is_forbidden(self, client_with_key):
        response = client_with_key.post(
            "/api/machines",
            json=machine_payload(),
            headers={"Authorization": "Bearer wrong-key"},
        )
        assert response.status_code == 403


class TestValidCredentialAccepted:
    def test_alert_lifecycle_with_key(self, client_with_key, session_factory):
        from backend.app.db.models import Alert

        with session_factory() as db:
            db.add(Alert(machine_id="M-AUTH", alert_type="TEMPERATURE_HIGH", severity="Warning",
                         message="test", status="ACTIVE"))
            db.commit()
        ack = client_with_key.post("/api/alerts/1/acknowledge", headers={"X-API-Key": TEST_KEY})
        assert ack.status_code == 200
        assert ack.json()["status"] == "ACKNOWLEDGED"
        resolve = client_with_key.post("/api/alerts/1/resolve", headers={"X-API-Key": TEST_KEY})
        assert resolve.status_code == 200
        assert resolve.json()["status"] == "RESOLVED"

    def test_machine_registration_with_header_key(self, client_with_key):
        response = client_with_key.post("/api/machines", json=machine_payload(), headers={"X-API-Key": TEST_KEY})
        assert response.status_code == 201
        assert response.json()["machine_id"] == "M-AUTH"

    def test_bearer_alias_accepted(self, client_with_key):
        response = client_with_key.post(
            "/api/machines",
            json=machine_payload(),
            headers={"Authorization": f"Bearer {TEST_KEY}"},
        )
        assert response.status_code == 201

    def test_telemetry_ingest_with_key_persists(self, client_with_key):
        client_with_key.post("/api/machines", json=machine_payload(), headers={"X-API-Key": TEST_KEY})
        response = client_with_key.post(
            "/api/sensor-data",
            json={
                "device_id": "D-OK",
                "machine_id": "M-AUTH",
                "timestamp": "2026-01-01T00:00:00Z",
                "temperature": 40.0,
                "vibration": 1.0,
                "current": 5.0,
                "rpm": 1450,
                "source": "WOKWI",
            },
            headers={"X-API-Key": TEST_KEY},
        )
        assert response.status_code == 201
        assert response.json()["success"] is True

    def test_prediction_with_key_persists(self, client_with_key):
        client_with_key.post("/api/machines", json=machine_payload(), headers={"X-API-Key": TEST_KEY})
        response = client_with_key.post(
            "/api/predict",
            json={"machine_id": "M-AUTH", "temperature": 50, "vibration": 2, "current": 5, "rpm": 1450},
            headers={"X-API-Key": TEST_KEY},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["is_prototype"] is True
        assert "remaining_life_days" not in body
        assert "confidence" not in body


class TestReadsStayPublic:
    def test_reads_work_without_credentials(self, client_with_key):
        assert client_with_key.get("/api/machines").status_code == 200
        assert client_with_key.get("/api/alerts").status_code == 200
        assert client_with_key.get("/api/feedback").status_code == 200
        assert client_with_key.get("/api/stats").status_code == 200
        assert client_with_key.get("/api/health").status_code == 200

    def test_gate_open_when_server_has_no_key(self, client_without_key):
        """Dev posture: no configured key means anonymous writes are allowed (warned at startup)."""
        response = client_without_key.post("/api/machines", json=machine_payload())
        assert response.status_code == 201
