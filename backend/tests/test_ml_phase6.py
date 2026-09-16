"""
Phase 6 — honest ML / evaluation tests.

Gates every DoD item on REAL curated technician ground truth:
- thin / single-class data is refused, never celebrated as 100%
- deterministic governed runs produce versioned metadata with docs/06 fields
- prototype-vs-trained source is explicit in API + registry
- feedback-to-evaluation linkage uses stored prediction/specs (no leakage)
- no confidence/RUL/accuracy is ever fabricated
"""

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.database import Base, get_db
from backend.app.db.models import Machine, Prediction
from backend.app.main import app
from ml.train import (
    GOVERNANCE_FIELDS,
    MIN_LABELED_SAMPLES,
    MODEL_FEATURES,
    collect_labeled_samples,
    derive_fault_label,
    evaluate_prototype,
    gate_labeled_samples,
    get_registry_status,
    train_governed_model,
)


def _row(index, outcome, fault="Bearing wear", prob=0.5):
    return {
        "sample_id": f"feedback-{index}",
        "outcome": outcome,
        "actual_fault": fault if outcome == "Confirmed" else None,
        "root_cause": "Lubrication" if outcome == "Confirmed" else None,
        "failure_probability": prob,
        "feature_importance": {"temperature": 0.3, "vibration": 0.4, "current": 0.2, "rpm": 0.1},
        "max_temp": 75.0,
        "max_vibration": 4.5,
        "rated_current": 10.0,
        "rated_rpm": 1450.0,
    }


def _balanced_rows(total=12):
    rows = []
    for index in range(total):
        outcome = "Confirmed" if index % 2 == 0 else "Not Confirmed"
        prob = 0.82 if outcome == "Confirmed" else 0.12
        rows.append(_row(index + 1, outcome, prob=prob))
    return rows


def test_labels_come_only_from_technician_outcomes():
    assert derive_fault_label("Confirmed", "Bearing wear", None) == 1
    assert derive_fault_label("Confirmed", None, "Root cause") == 1
    assert derive_fault_label("Not Confirmed", None, None) == 0
    assert derive_fault_label("Confirmed", None, None) is None
    assert derive_fault_label("Cancelled", "Bearing", "Cause") is None
    assert derive_fault_label(None, "Bearing", "Cause") is None


def test_collection_excludes_ambiguous_and_non_finite_rows():
    rows = [
        _row(1, "Confirmed"),
        dict(_row(2, "Confirmed", fault=None), **{"actual_fault": None, "root_cause": None}),
        _row(3, "Cancelled", fault="Bearing"),
        dict(_row(4, "Not Confirmed"), failure_probability=float("nan")),
    ]
    report = collect_labeled_samples(rows)
    assert [sample.label for sample in report.samples] == [1]
    assert report.excluded_ambiguous_label == 1
    assert report.excluded_unknown_outcome == 1
    assert report.excluded_non_finite == 1


def test_gates_refuse_thin_and_single_class_data():
    thin = collect_labeled_samples(_balanced_rows(4)).samples
    assert gate_labeled_samples(thin)["refusal"] == "insufficient_labeled_data"
    single_rows = [_row(i + 1, "Confirmed") for i in range(MIN_LABELED_SAMPLES)]
    single = collect_labeled_samples(single_rows).samples
    assert gate_labeled_samples(single)["refusal"] == "single_class_labels"
    refused = train_governed_model(single)
    assert refused["success"] is False
    assert refused["refusal"] == "single_class_labels"
    assert "accuracy" not in refused


def test_governed_run_is_deterministic_and_governed(tmp_path, monkeypatch):
    monkeypatch.setenv("PREDICTIQ_MODEL_DIR", str(tmp_path))
    samples = collect_labeled_samples(_balanced_rows(12)).samples
    first = train_governed_model(samples, dataset_version="feedback-test-v1")
    second = train_governed_model(samples, dataset_version="feedback-test-v1")
    assert first["success"] is True and second["success"] is True
    assert first["metrics"] == second["metrics"]
    assert first["metadata"]["dataset_fingerprint"] == second["metadata"]["dataset_fingerprint"]
    assert set(first["metadata"]["train_sample_ids"]).isdisjoint(second["metadata"]["test_sample_ids"])
    assert set(first["metadata"]["train_sample_ids"]) | set(second["metadata"]["test_sample_ids"]) == {
        sample.sample_id for sample in samples
    }
    for field in GOVERNANCE_FIELDS:
        assert field in first["metadata"]
    assert first["metadata"]["features"] == list(MODEL_FEATURES)
    assert first["evaluation_dataset_size"] > 0
    for key in ("accuracy", "precision", "recall", "f1"):
        value = first["metrics"][key]
        assert isinstance(value, float) and 0.0 <= value <= 1.0
    matrix = first["metrics"]["confusion_matrix"]["matrix"]
    assert sum(sum(row) for row in matrix) == first["metrics"]["support"]


def test_governed_run_writes_loadable_artifacts_only_on_success(tmp_path, monkeypatch):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    assert get_registry_status(str(empty_dir))["source"] == "prototype"
    assert get_registry_status(str(empty_dir))["trained"] is False
    monkeypatch.setenv("PREDICTIQ_MODEL_DIR", str(tmp_path))
    samples = collect_labeled_samples(_balanced_rows(12)).samples
    result = train_governed_model(samples)
    assert result["success"] is True
    status = get_registry_status()
    assert status["trained"] is True and status["evaluated"] is True
    assert status["source"] == "trained"
    assert status["metrics"] == result["metrics"]


def test_zero_positive_edge_case_stays_honest():
    assert evaluate_prototype([])["prototype_accuracy"] is None
    assert evaluate_prototype([None, None])["evaluated"] is False
    report = evaluate_prototype([True, True, False])
    assert report["evaluated"] is True
    assert report["prototype_accuracy"] == pytest.approx(2 / 3, abs=1e-4)


def _seed_feedback_machine(db, machine_id="M-ML"):
    db.add(Machine(machine_id=machine_id, name="ML machine", type="Centrifugal Pump", location="Bay"))
    db.commit()
    prediction_ids = []
    for index in range(4):
        prediction = Prediction(
            machine_id=machine_id,
            timestamp=datetime.now(timezone.utc),
            failure_probability=0.8 if index % 2 == 0 else 0.1,
            component="Bearing",
            model_version="physics-rule-v1",
            is_prototype=True,
            explanation_data=json.dumps({"feature_importance": {"temperature": 0.3, "vibration": 0.4, "current": 0.2, "rpm": 0.1}}),
        )
        db.add(prediction)
        db.commit()
        prediction_ids.append(prediction.id)
    return prediction_ids


def _client(factory):
    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_feedback_to_evaluation_linkage_and_insufficient_state():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        prediction_ids = _seed_feedback_machine(db)
    client = _client(factory)
    try:
        empty = client.get("/api/model-evaluation").json()
        assert empty["evaluated"] is False
        assert empty["prototype_accuracy"] is None
        assert empty["ground_truth_count"] == 0
        payloads = [
            {"machine_id": "M-ML", "prediction_id": prediction_ids[0], "observed_condition": "Seized",
             "actual_fault": "Bearing spalling", "severity": "Critical", "outcome": "Confirmed", "prediction_correct": False},
            {"machine_id": "M-ML", "prediction_id": prediction_ids[1], "observed_condition": "Normal",
             "severity": "Info", "outcome": "Not Confirmed", "prediction_correct": True},
        ]
        for payload in payloads:
            assert client.post("/api/feedback", json=payload).status_code == 201
        evaluation = client.get("/api/model-evaluation").json()
        assert evaluation["ground_truth_count"] == 2
        assert evaluation["evaluated"] is True
        assert evaluation["correct_count"] == 1
        assert evaluation["prototype_accuracy"] == 0.5
        assert evaluation["labeled_count"] == 2
        assert evaluation["model_status"]["source"] == "prototype"
        refused = client.post("/api/train-model", json={}).json()
        assert refused["success"] is False
        assert refused["refusal"] == "insufficient_labeled_data"
        status = client.get("/api/model-status").json()
        assert status["trained"] is False
        assert status["source"] == "prototype"
        assert "confidence" not in status and "remaining_life_days" not in status
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_train_model_reports_refusal_without_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("PREDICTIQ_MODEL_DIR", str(tmp_path))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        _seed_feedback_machine(db, "M-THIN")
    client = _client(factory)
    try:
        body = client.post("/api/train-model", json={"dataset_version": "feedback-thin"}).json()
        assert body["success"] is False
        assert body["refusal"] == "insufficient_labeled_data"
        assert list(tmp_path.iterdir()) == []
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_legacy_threshold_training_shim_never_fabricates_metrics():
    import warnings

    from ml.training import get_model_status as legacy_status
    from ml.training import train_model_from_real_data as legacy_train

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        refused = legacy_train([{"temperature": 90.0}], [])
        assert refused["success"] is False
        assert refused["refusal"] == "insufficient_labeled_data"
        assert "accuracy" not in refused
        assert legacy_status()["trained"] is False
