"""
Phase 5 — Maintenance feedback / ground-truth API tests.

Covers the feedback DoD:
- full docs/03 field set is captured and persisted per feedback record
- prediction linkage is validated (prediction must exist and belong to the same machine)
- alert / maintenance linkage is validated with machine isolation
- enum values and the prediction_correct-without-prediction rule are rejected
- list / single retrieval and machine-isolated listing
- migration 006 creates the feedback_records table and upgrades/downgrades cleanly
"""

from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.database import Base, get_db
from backend.app.db.models import Alert, FeedbackRecord, Machine, MaintenanceRecord, Prediction
from backend.app.main import app

ROOT = Path(__file__).parents[1]


def load_migration(name: str):
    path = ROOT / "alembic" / "versions" / name
    spec = spec_from_file_location(name.removesuffix(".py"), path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return factory


@pytest.fixture
def client(session_factory):
    def override_get_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def add_machine(db: Session, machine_id: str = "M-FEED") -> Machine:
    machine = Machine(
        machine_id=machine_id,
        name=f"{machine_id} test machine",
        type="Centrifugal Pump",
        location="Test bay",
        status="Warning",
    )
    db.add(machine)
    db.commit()
    return machine


def add_prediction(db: Session, machine_id: str) -> Prediction:
    prediction = Prediction(
        machine_id=machine_id,
        timestamp=datetime.now(timezone.utc),
        failure_probability=0.62,
        component="Bearing",
        is_prototype=True,
    )
    db.add(prediction)
    db.commit()
    return prediction


def add_alert(db: Session, machine_id: str) -> Alert:
    alert = Alert(
        machine_id=machine_id,
        alert_type="Vibration",
        severity="Warning",
        message="Vibration above threshold",
        status="ACTIVE",
    )
    db.add(alert)
    db.commit()
    return alert


def add_maintenance(db: Session, machine_id: str) -> MaintenanceRecord:
    record = MaintenanceRecord(
        machine_id=machine_id,
        component="Bearing",
        failure_type="Wear",
        issue_description="Excessive vibration observed",
        maintenance_action="Replace bearing",
        technician="Rishi",
        status="Completed",
    )
    db.add(record)
    db.commit()
    return record


def full_feedback_payload(machine_id: str, prediction_id: int, alert_id: int, maintenance_id: int) -> dict:
    return {
        "machine_id": machine_id,
        "prediction_id": prediction_id,
        "alert_id": alert_id,
        "maintenance_record_id": maintenance_id,
        "observed_condition": "Bearing housing is hot and vibrating",
        "actual_fault": "Bearing spalling",
        "root_cause": "Lubrication starvation",
        "symptoms": "Elevated vibration, rising temperature",
        "action_taken": "Replaced bearing and flushed lubrication",
        "parts_replaced": "Bearing, seal",
        "severity": "Critical",
        "outcome": "Confirmed",
        "technician_notes": "Failure matched the predicted component",
        "prediction_correct": True,
        "feedback_source": "MANUAL",
    }

def test_feedback_api_persists_full_docs03_field_set(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")
        pred = add_prediction(db, "M-FEED")
        alert = add_alert(db, "M-FEED")
        maint = add_maintenance(db, "M-FEED")

    payload = full_feedback_payload("M-FEED", pred.id, alert.id, maint.id)
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 201
    body = response.json()
    assert body["machine_id"] == "M-FEED"
    assert body["prediction_id"] == pred.id
    assert body["alert_id"] == alert.id
    assert body["maintenance_record_id"] == maint.id
    assert body["observed_condition"] == payload["observed_condition"]
    assert body["actual_fault"] == "Bearing spalling"
    assert body["root_cause"] == "Lubrication starvation"
    assert body["symptoms"] == payload["symptoms"]
    assert body["action_taken"] == payload["action_taken"]
    assert body["parts_replaced"] == "Bearing, seal"
    assert body["severity"] == "Critical"
    assert body["outcome"] == "Confirmed"
    assert body["technician_notes"] == payload["technician_notes"]
    assert body["prediction_correct"] is True
    assert body["feedback_source"] == "MANUAL"

    with session_factory() as db:
        stored = db.query(FeedbackRecord).one()
        assert stored.prediction_id == pred.id
        assert stored.alert_id == alert.id
        assert stored.maintenance_record_id == maint.id
        assert stored.prediction_correct is True
        assert stored.outcome == "Confirmed"


def test_feedback_api_requires_existing_machine(client) -> None:
    payload = {
        "machine_id": "MISSING",
        "observed_condition": "Inspected after alert",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 404
    assert "does not exist" in response.json()["detail"]


def test_feedback_api_rejects_unknown_prediction_link(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")

    payload = {
        "machine_id": "M-FEED",
        "prediction_id": 999,
        "observed_condition": "Inspected after alert",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 404
    assert "Prediction with ID 999 not found" in response.json()["detail"]


def test_feedback_api_rejects_unknown_alert_link(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")

    payload = {
        "machine_id": "M-FEED",
        "alert_id": 999,
        "observed_condition": "Inspected after alert",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 404
    assert "Alert with ID 999 not found" in response.json()["detail"]


def test_feedback_api_rejects_unknown_maintenance_link(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")

    payload = {
        "machine_id": "M-FEED",
        "maintenance_record_id": 999,
        "observed_condition": "Inspected after alert",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 404
    assert "Maintenance record with ID 999 not found" in response.json()["detail"]


def test_feedback_api_enforces_prediction_machine_isolation(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-ONE")
        add_machine(db, "M-TWO")
        pred = add_prediction(db, "M-ONE")

    payload = {
        "machine_id": "M-TWO",
        "prediction_id": pred.id,
        "observed_condition": "Inspected",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 400
    assert "belongs to machine 'M-ONE'" in response.json()["detail"]


def test_feedback_api_enforces_alert_machine_isolation(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-ONE")
        add_machine(db, "M-TWO")
        alert = add_alert(db, "M-ONE")

    payload = {
        "machine_id": "M-TWO",
        "alert_id": alert.id,
        "observed_condition": "Inspected",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 400
    assert "belongs to machine 'M-ONE'" in response.json()["detail"]


def test_feedback_api_enforces_maintenance_machine_isolation(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-ONE")
        add_machine(db, "M-TWO")
        maint = add_maintenance(db, "M-ONE")

    payload = {
        "machine_id": "M-TWO",
        "maintenance_record_id": maint.id,
        "observed_condition": "Inspected",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 400
    assert "belongs to machine 'M-ONE'" in response.json()["detail"]


def test_feedback_api_rejects_invalid_enum_values(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")

    bad_severity = {
        "machine_id": "M-FEED",
        "observed_condition": "Inspected",
        "severity": "Extreme",
        "outcome": "Confirmed",
    }
    bad_outcome = {
        "machine_id": "M-FEED",
        "observed_condition": "Inspected",
        "severity": "Warning",
        "outcome": "Maybe",
    }
    bad_source = {
        "machine_id": "M-FEED",
        "observed_condition": "Inspected",
        "severity": "Warning",
        "outcome": "Confirmed",
        "feedback_source": "AUTOMATIC",
    }
    assert client.post("/api/feedback", json=bad_severity).status_code == 422
    assert client.post("/api/feedback", json=bad_outcome).status_code == 422
    assert client.post("/api/feedback", json=bad_source).status_code == 422


def test_feedback_api_requires_prediction_link_when_prediction_correct(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")

    payload = {
        "machine_id": "M-FEED",
        "observed_condition": "Inspected",
        "severity": "Warning",
        "outcome": "Confirmed",
        "prediction_correct": True,
    }
    response = client.post("/api/feedback", json=payload)
    assert response.status_code == 422
    assert "prediction_correct=True requires a prediction_id link" in response.json()["detail"][0]["msg"]


def test_feedback_api_lists_filters_and_isolates_by_machine(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-ONE")
        add_machine(db, "M-TWO")
        pred_one = add_prediction(db, "M-ONE")
        pred_two = add_prediction(db, "M-TWO")

    payload_one = {
        "machine_id": "M-ONE",
        "prediction_id": pred_one.id,
        "observed_condition": "Found for M-ONE",
        "severity": "Warning",
        "outcome": "Confirmed",
        "prediction_correct": True,
    }
    payload_two = {
        "machine_id": "M-TWO",
        "prediction_id": pred_two.id,
        "observed_condition": "Found for M-TWO",
        "severity": "Critical",
        "outcome": "Not Confirmed",
        "prediction_correct": False,
    }
    assert client.post("/api/feedback", json=payload_one).status_code == 201
    assert client.post("/api/feedback", json=payload_two).status_code == 201

    all_records = client.get("/api/feedback").json()
    assert len(all_records) == 2

    only_one = client.get("/api/feedback", params={"machine_id": "M-ONE"}).json()
    assert len(only_one) == 1
    assert only_one[0]["machine_id"] == "M-ONE"

    machine_one = client.get("/api/machines/M-ONE/feedback").json()
    assert len(machine_one) == 1
    assert machine_one[0]["observed_condition"] == "Found for M-ONE"


def test_feedback_api_list_carries_prediction_vs_reality_fields(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")
        pred = add_prediction(db, "M-FEED")
        maint = add_maintenance(db, "M-FEED")

    payload = {
        "machine_id": "M-FEED",
        "prediction_id": pred.id,
        "maintenance_record_id": maint.id,
        "observed_condition": "Vibration spike during run",
        "actual_fault": "Bearing spalling",
        "root_cause": "Lubrication starvation",
        "action_taken": "Replaced bearing",
        "severity": "Critical",
        "outcome": "Confirmed",
        "prediction_correct": True,
    }
    assert client.post("/api/feedback", json=payload).status_code == 201

    listed = client.get("/api/feedback").json()
    assert listed[0]["prediction_id"] == pred.id
    assert listed[0]["maintenance_record_id"] == maint.id
    assert listed[0]["actual_fault"] == "Bearing spalling"
    assert listed[0]["root_cause"] == "Lubrication starvation"
    assert listed[0]["action_taken"] == "Replaced bearing"
    assert listed[0]["prediction_correct"] is True


def test_feedback_api_returns_single_record_and_404(session_factory, client) -> None:
    with session_factory() as db:
        add_machine(db, "M-FEED")

    payload = {
        "machine_id": "M-FEED",
        "observed_condition": "Single record lookup",
        "severity": "Info",
        "outcome": "Confirmed",
    }
    created = client.post("/api/feedback", json=payload)
    assert created.status_code == 201
    feedback_id = created.json()["id"]

    single = client.get(f"/api/feedback/{feedback_id}")
    assert single.status_code == 200
    assert single.json()["observed_condition"] == "Single record lookup"

    missing = client.get("/api/feedback/999999")
    assert missing.status_code == 404
    assert "not found" in missing.json()["detail"]


def test_feedback_machine_endpoint_404_for_unknown_machine(client) -> None:
    response = client.get("/api/machines/M-NOPE/feedback")
    assert response.status_code == 404
    assert "does not exist" in response.json()["detail"]


def test_feedback_migration_006_creates_table_and_chains() -> None:
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration_005 = load_migration("005_prediction_prototype_fields.py")
    migration_006 = load_migration("006_feedback_ground_truth.py")
    assert migration_006.down_revision == migration_005.revision
    assert callable(migration_006.upgrade)
    assert callable(migration_006.downgrade)

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        context = MigrationContext.configure(conn)
        with Operations.context(context):
            migration_006.upgrade()

    inspector = inspect(engine)
    columns = {c["name"] for c in inspector.get_columns("feedback_records")}
    expected = {
        "id", "machine_id", "prediction_id", "alert_id", "maintenance_record_id",
        "observed_condition", "actual_fault", "root_cause", "symptoms", "action_taken",
        "parts_replaced", "severity", "outcome", "technician_notes", "prediction_correct",
        "feedback_source", "created_at",
    }
    assert columns == expected
    constraints = {c["name"] for c in inspector.get_check_constraints("feedback_records")}
    assert {"ck_feedback_records_severity", "ck_feedback_records_outcome", "ck_feedback_records_source"} <= constraints