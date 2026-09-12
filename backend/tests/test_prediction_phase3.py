import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.database import Base, get_db
from backend.app.db.models import Machine, Prediction
from backend.app.main import app
from backend.app.services.prediction_service import prediction_service


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        yield db


def add_machine(db: Session, machine_id: str = "M-PRED", **specs) -> Machine:
    machine = Machine(
        machine_id=machine_id,
        name="Prediction test machine",
        type="Centrifugal Pump",
        location="Test bay",
        **specs,
    )
    db.add(machine)
    db.commit()
    return machine


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


def test_prediction_api_persists_and_returns_explanation() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        add_machine(db)

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            response = client.post("/api/predict", json={"machine_id": "M-PRED", **normal_features()})
            assert response.status_code == 201
            result = response.json()
            assert result["prediction_available"] is True
            assert result["is_prototype"] is True
            assert result["feature_importance"]
            assert result["contributing_factors"]
            assert "remaining_life_days" not in result
            assert "confidence" not in result

            latest = client.get("/api/machines/M-PRED/prediction")
            assert latest.status_code == 200
            assert latest.json()["explanation"] == result["explanation"]

        with factory() as db:
            stored = db.query(Prediction).one()
            assert stored.is_prototype is True
            assert json.loads(stored.explanation_data)["contributing_factors"]
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_prediction_api_returns_insufficient_data_for_machine_without_prediction() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        add_machine(db, "M-EMPTY")

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        response = TestClient(app).get("/api/machines/M-EMPTY/prediction")
        assert response.status_code == 200
        assert response.json()["prediction_available"] is False
        assert "remaining_life_days" not in response.json()
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_prediction_api_rejects_unknown_machine_and_invalid_features() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        add_machine(db)

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            missing = client.post("/api/predict", json={"machine_id": "MISSING", **normal_features()})
            invalid = client.post("/api/predict", json={"machine_id": "M-PRED", **normal_features(), "temperature": 301})
        assert missing.status_code == 404
        assert invalid.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_prediction_api_keeps_machine_predictions_isolated() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        add_machine(db, "M-ONE")
        add_machine(db, "M-TWO")

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            first = client.post("/api/predict", json={"machine_id": "M-ONE", **normal_features()})
            second = client.get("/api/machines/M-TWO/prediction")
        assert first.status_code == 201
        assert second.status_code == 200
        assert second.json()["prediction_available"] is False
    finally:
        app.dependency_overrides.pop(get_db, None)