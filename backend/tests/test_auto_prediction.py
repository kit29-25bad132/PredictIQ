"""
Automatic prototype prediction tests (telemetry → prediction linkage).

Verifies the V1 plan §10 spine: a degraded reading that flips machine health
also produces ONE persisted, honestly-labeled prototype prediction per cooldown
window, without fabricating inputs or outputs.
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
from backend.app.db.models import Machine, Prediction
from backend.app.main import app


TEST_KEY = "test-write-key-12345"


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db():
        with factory() as db:
            yield db

    monkeypatch_key()
    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        # Restore the unauthenticated dev posture for other tests.
        get_settings().device_api_key = ""
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


def monkeypatch_key():
    # Patch the cached Settings instance (pydantic-settings v2 does not expose
    # fields as class attributes). get_settings() is lru_cache'd and auth.py
    # reads the instance live, so this takes effect immediately.
    get_settings().device_api_key = TEST_KEY
    auth_module._WARNED_UNCONFIGURED = False


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


def _headers() -> dict:
    return {"X-API-Key": TEST_KEY}


class TestAutomaticPrediction:
    def test_critical_reading_persists_prototype_prediction(self, client):
        assert (
            client.post(
                "/api/sensor-data", json=degraded_payload("2026-01-01T00:00:00Z"), headers=_headers()
            ).status_code
            == 201
        )
        predictions = client.get("/api/predictions?machine_id=M-AUTO").json()
        assert len(predictions) == 1
        body = predictions[0]
        assert body["is_prototype"] is True
        assert body["model_version"] == "physics-rule-v1"
        assert 0.0 <= body["failure_probability"] <= 1.0
        assert body["contributing_factors"]
        # Honesty contract: no RUL, no confidence anywhere in the response.
        assert "remaining_life_days" not in body
        assert "confidence" not in body

    def test_repeated_degraded_readings_do_not_spam_predictions(self, client):
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:00:00Z"), headers=_headers())
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:01:00Z"), headers=_headers())
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:02:00Z"), headers=_headers())
        predictions = client.get("/api/predictions?machine_id=M-AUTO").json()
        assert len(predictions) == 1

    def test_second_prediction_after_cooldown(self, client):
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:00:00Z"), headers=_headers())
        # 11 minutes later the cooldown window has passed.
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:11:00Z"), headers=_headers())
        predictions = client.get("/api/predictions?machine_id=M-AUTO").json()
        assert len(predictions) == 2

    def test_normal_reading_does_not_generate_prediction(self, client):
        client.post("/api/sensor-data", json=normal_payload("2026-01-01T00:00:00Z"), headers=_headers())
        predictions = client.get("/api/predictions?machine_id=M-AUTO").json()
        assert len(predictions) == 0

    def test_incomplete_reading_does_not_generate_prediction(self, client):
        # Missing rpm channel: engine must not be fed fabricated inputs.
        payload = degraded_payload("2026-01-01T00:00:00Z")
        del payload["rpm"]
        response = client.post("/api/sensor-data", json=payload, headers=_headers())
        assert response.status_code == 201
        predictions = client.get("/api/predictions?machine_id=M-AUTO").json()
        assert len(predictions) == 0

    def test_manual_predict_still_works_alongside_auto(self, client):
        client.post("/api/machines", json={
            "machine_id": "M-AUTO", "name": "Auto", "type": "Pump", "location": "Bay",
        }, headers=_headers())
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:00:00Z"), headers=_headers())
        manual = client.post(
            "/api/predict",
            json={"machine_id": "M-AUTO", "temperature": 95, "vibration": 7, "current": 15, "rpm": 1500},
            headers=_headers(),
        )
        assert manual.status_code == 201
        predictions = client.get("/api/predictions?machine_id=M-AUTO").json()
        assert len(predictions) == 2  # 1 auto + 1 manual

    def test_prediction_linked_machine_isolation(self, client):
        # Each device is bound to exactly one machine (device-ownership rule,
        # enforced by the ingest API), so isolation uses distinct devices.
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:00:00Z", "M-ONE", "D-ONE"), headers=_headers())
        client.post("/api/sensor-data", json=degraded_payload("2026-01-01T00:00:00Z", "M-TWO", "D-TWO"), headers=_headers())
        one = client.get("/api/predictions?machine_id=M-ONE").json()
        two = client.get("/api/predictions?machine_id=M-TWO").json()
        assert len(one) == 1 and one[0]["machine_id"] == "M-ONE"
        assert len(two) == 1 and two[0]["machine_id"] == "M-TWO"
