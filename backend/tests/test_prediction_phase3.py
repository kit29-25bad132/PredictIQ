"""
Prediction API tests (Phase 3: organization-scoped reads, device-gated writes).

The prediction engine itself is stateless and unchanged. Route-level tests prove:
- POST /api/predict stays device-authenticated (telemetry/prototype path)
- prediction reads require an authenticated organization member
- stored predictions are only visible to their own machine/organization
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import Machine, Organization, Prediction
from backend.app.main import app
from backend.app.services.prediction_service import prediction_service
from backend.tests.tenant_utils import USER_A, USER_B, auth_headers, install_auth, seed_membership

DEVICE_KEY = "prediction-device-key"


def normal_features() -> dict:
    return {"temperature": 50, "vibration": 2, "current": 5, "rpm": 1450}


def test_prediction_service_is_deterministic_and_explainable() -> None:
    first = prediction_service.predict(
        machine_id="M-PRED", **normal_features(), rated_rpm=1450, rated_current=10,
        max_temp=75, max_vibration=4.5, machine_type="Centrifugal Pump",
    )
    second = prediction_service.predict(
        machine_id="M-PRED", **normal_features(), rated_rpm=1450, rated_current=10,
        max_temp=75, max_vibration=4.5, machine_type="Centrifugal Pump",
    )

    assert first == second
    assert 0 <= first["failure_probability"] <= 1
    assert first["is_prototype"] is True
    assert first["model_version"] == "physics-rule-v1"
    assert first["contributing_factors"]
    assert first["reasons"]


def test_prediction_service_uses_machine_specific_specs() -> None:
    default_result = prediction_service.predict(
        machine_id="M-DEFAULT", temperature=75, vibration=4.5, current=10, rpm=1450,
        rated_rpm=1450, rated_current=10, max_temp=75, max_vibration=4.5,
        machine_type="Pump",
    )
    specific_result = prediction_service.predict(
        machine_id="M-SPEC", temperature=75, vibration=4.5, current=10, rpm=1000,
        rated_rpm=1000, rated_current=20, max_temp=100, max_vibration=10,
        machine_type="Pump",
    )

    assert default_result["failure_probability"] != specific_result["failure_probability"]
    assert specific_result["is_prototype"] is True


@pytest.fixture
def api(monkeypatch):
    install_auth(monkeypatch)
    get_settings().device_api_key = DEVICE_KEY
    auth_module._WARNED_UNCONFIGURED = False

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    org_id = uuid.uuid4()
    with factory() as db:
        org = Organization(id=org_id, name="Predictions", slug="predictions")
        db.add(org)
        db.flush()
        seed_membership(db, org, "owner", user_id=USER_A)
        db.add(
            Machine(
                organization_id=org_id,
                machine_id="M-PRED",
                name="Prediction test machine",
                type="Centrifugal Pump",
                location="Test bay",
            )
        )
        db.add(
            Machine(
                organization_id=org_id,
                machine_id="M-EMPTY",
                name="Empty machine",
                type="Centrifugal Pump",
                location="Test bay",
            )
        )
        db.commit()

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), factory, str(org_id)
    finally:
        get_settings().device_api_key = ""
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


def test_prediction_api_persists_and_returns_explanation(api):
    client, factory, org_id = api
    response = client.post(
        "/api/predict",
        json={"machine_id": "M-PRED", **normal_features()},
        headers={"X-API-Key": DEVICE_KEY},
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["prediction_available"] is True
    assert result["is_prototype"] is True
    assert result["feature_importance"]
    assert result["contributing_factors"]
    assert "remaining_life_days" not in result
    assert "confidence" not in result

    latest = client.get("/api/machines/M-PRED/prediction", headers=auth_headers(USER_A, org_id))
    assert latest.status_code == 200
    assert latest.json()["explanation"] == result["explanation"]

    with factory() as db:
        stored = db.query(Prediction).one()
        assert stored.is_prototype is True
        assert str(stored.organization_id) == org_id
        assert json.loads(stored.explanation_data)["contributing_factors"]


def test_prediction_reads_require_authentication(api):
    client, _, _ = api
    assert client.get("/api/machines/M-PRED/prediction").status_code == 401
    assert client.get("/api/predictions").status_code == 401


def test_prediction_api_returns_insufficient_data_for_machine_without_prediction(api):
    client, _, org_id = api
    response = client.get("/api/machines/M-EMPTY/prediction", headers=auth_headers(USER_A, org_id))
    assert response.status_code == 200
    assert response.json()["prediction_available"] is False
    assert "remaining_life_days" not in response.json()


def test_prediction_api_rejects_unknown_machine_and_invalid_features(api):
    client, _, _ = api
    headers = {"X-API-Key": DEVICE_KEY}
    missing = client.post(
        "/api/predict", json={"machine_id": "MISSING", **normal_features()}, headers=headers
    )
    invalid = client.post(
        "/api/predict",
        json={"machine_id": "M-PRED", **normal_features(), "temperature": 301},
        headers=headers,
    )
    assert missing.status_code == 404
    assert invalid.status_code == 422


def test_prediction_reads_are_organization_scoped(api):
    client, _, org_id = api
    client.post(
        "/api/predict",
        json={"machine_id": "M-PRED", **normal_features()},
        headers={"X-API-Key": DEVICE_KEY},
    )
    # A user without an active membership in this organization cannot see the
    # prediction; the denial is uniform and non-disclosing.
    outsider = auth_headers(USER_B, org_id)
    assert client.get("/api/machines/M-PRED/prediction", headers=outsider).status_code == 404
    denied = client.get("/api/predictions", headers=outsider)
    assert denied.status_code == 404
    assert "access denied" in denied.json()["detail"].lower()


def test_prediction_api_keeps_machine_predictions_isolated(api):
    client, factory, org_id = api
    with factory() as db:
        db.add(
            Machine(
                organization_id=uuid.UUID(org_id),
                machine_id="M-TWO",
                name="Second",
                type="Centrifugal Pump",
                location="Test bay",
            )
        )
        db.commit()

    first = client.post(
        "/api/predict",
        json={"machine_id": "M-PRED", **normal_features()},
        headers={"X-API-Key": DEVICE_KEY},
    )
    second = client.get("/api/machines/M-TWO/prediction", headers=auth_headers(USER_A, org_id))
    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["prediction_available"] is False
