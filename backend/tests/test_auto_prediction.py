"""
Automatic prototype prediction tests (telemetry -> prediction linkage).

Verifies the V1 plan §10 spine: a degraded reading that flips machine health
also produces ONE persisted, honestly-labeled prototype prediction per cooldown
window, without fabricating inputs or outputs.

Phase 3: telemetry ingest stays device-authenticated but now requires a
registered device bound to the target machine; prediction reads require an
authenticated organization member.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.main import app
from backend.tests.tenant_utils import (
    USER_A,
    auth_headers,
    install_auth,
    seed_device,
    seed_machine,
    seed_membership,
    seed_organization,
)

TEST_KEY = "test-write-key-12345"

DEVICE_PAIRS = (("M-AUTO", "D-AUTO"), ("M-ONE", "D-ONE"), ("M-TWO", "D-TWO"))


@pytest.fixture
def api(monkeypatch):
    install_auth(monkeypatch)
    get_settings().device_api_key = TEST_KEY
    auth_module._WARNED_UNCONFIGURED = False

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    with factory() as db:
        org = seed_organization(db, "auto-org")
        seed_membership(db, org, "owner", user_id=USER_A)
        for machine_id, device_id in DEVICE_PAIRS:
            machine = seed_machine(db, org, machine_id, name=f"{machine_id} machine")
            seed_device(db, org, machine, device_id)
        org_id = str(org.id)

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), org_id
    finally:
        get_settings().device_api_key = ""
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


def _device_headers() -> dict:
    return {"X-API-Key": TEST_KEY}


def _user_headers(org_id: str) -> dict:
    return auth_headers(USER_A, org_id)


def degraded_payload(timestamp: str, machine_id: str = "M-AUTO", device_id: str = "D-AUTO") -> dict:
    return {
        "device_id": device_id,
        "machine_id": machine_id,
        "timestamp": timestamp,
        "temperature": 90.0,
        "vibration": 6.0,
        "current": 14.0,
        "rpm": 1500.0,
        "source": "WOKWI",
    }


def normal_payload(timestamp: str, machine_id: str = "M-AUTO") -> dict:
    return {
        "device_id": "D-AUTO",
        "machine_id": machine_id,
        "timestamp": timestamp,
        "temperature": 45.0,
        "vibration": 2.0,
        "current": 8.0,
        "rpm": 1450.0,
        "source": "WOKWI",
    }


def _predictions(client, org_id: str, machine_id: str) -> list:
    response = client.get(
        "/api/predictions",
        params={"machine_id": machine_id},
        headers=_user_headers(org_id),
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestAutomaticPrediction:
    def test_critical_reading_persists_prototype_prediction(self, api):
        client, org_id = api
        assert (
            client.post(
                "/api/sensor-data",
                json=degraded_payload("2026-01-01T00:00:00Z"),
                headers=_device_headers(),
            ).status_code
            == 201
        )
        predictions = _predictions(client, org_id, "M-AUTO")
        assert len(predictions) == 1
        body = predictions[0]
        assert body["is_prototype"] is True
        assert body["model_version"] == "physics-rule-v1"
        assert 0.0 <= body["failure_probability"] <= 1.0
        assert body["contributing_factors"]
        # Honesty contract: no RUL, no confidence anywhere in the response.
        assert "remaining_life_days" not in body
        assert "confidence" not in body

    def test_repeated_degraded_readings_do_not_spam_predictions(self, api):
        client, org_id = api
        for minute in range(3):
            client.post(
                "/api/sensor-data",
                json=degraded_payload(f"2026-01-01T00:0{minute}:00Z"),
                headers=_device_headers(),
            )
        assert len(_predictions(client, org_id, "M-AUTO")) == 1

    def test_second_prediction_after_cooldown(self, api):
        client, org_id = api
        client.post(
            "/api/sensor-data",
            json=degraded_payload("2026-01-01T00:00:00Z"),
            headers=_device_headers(),
        )
        # 11 minutes later the cooldown window has passed.
        client.post(
            "/api/sensor-data",
            json=degraded_payload("2026-01-01T00:11:00Z"),
            headers=_device_headers(),
        )
        assert len(_predictions(client, org_id, "M-AUTO")) == 2

    def test_normal_reading_does_not_generate_prediction(self, api):
        client, org_id = api
        client.post(
            "/api/sensor-data",
            json=normal_payload("2026-01-01T00:00:00Z"),
            headers=_device_headers(),
        )
        assert len(_predictions(client, org_id, "M-AUTO")) == 0

    def test_incomplete_reading_does_not_generate_prediction(self, api):
        # Missing rpm channel: engine must not be fed fabricated inputs.
        client, org_id = api
        payload = degraded_payload("2026-01-01T00:00:00Z")
        del payload["rpm"]
        response = client.post(
            "/api/sensor-data", json=payload, headers=_device_headers()
        )
        assert response.status_code == 201
        assert len(_predictions(client, org_id, "M-AUTO")) == 0

    def test_manual_predict_still_works_alongside_auto(self, api):
        client, org_id = api
        client.post(
            "/api/sensor-data",
            json=degraded_payload("2026-01-01T00:00:00Z"),
            headers=_device_headers(),
        )
        manual = client.post(
            "/api/predict",
            json={"machine_id": "M-AUTO", "temperature": 95, "vibration": 7, "current": 15, "rpm": 1500},
            headers=_device_headers(),
        )
        assert manual.status_code == 201
        assert len(_predictions(client, org_id, "M-AUTO")) == 2  # 1 auto + 1 manual

    def test_prediction_linked_machine_isolation(self, api):
        # Each device is bound to exactly one machine (device-ownership rule,
        # enforced by the ingest API), so isolation uses distinct devices.
        client, org_id = api
        client.post(
            "/api/sensor-data",
            json=degraded_payload("2026-01-01T00:00:00Z", "M-ONE", "D-ONE"),
            headers=_device_headers(),
        )
        client.post(
            "/api/sensor-data",
            json=degraded_payload("2026-01-01T00:00:00Z", "M-TWO", "D-TWO"),
            headers=_device_headers(),
        )
        one = _predictions(client, org_id, "M-ONE")
        two = _predictions(client, org_id, "M-TWO")
        assert len(one) == 1 and one[0]["machine_id"] == "M-ONE"
        assert len(two) == 1 and two[0]["machine_id"] == "M-TWO"

    def test_unknown_device_is_rejected(self, api):
        client, _ = api
        payload = degraded_payload("2026-01-01T00:00:00Z", "M-AUTO", "D-UNKNOWN")
        response = client.post("/api/sensor-data", json=payload, headers=_device_headers())
        assert response.status_code == 404
