"""Honest Phase 6 evaluation: prototype verdicts + governed training pool from ground truth."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.app.db.models import FeedbackRecord, Machine, Prediction
from ml.train import (
    MODEL_FEATURES,
    CollectionReport,
    collect_labeled_samples,
    evaluate_prototype,
    get_registry_status,
)


def collect_ground_truth_rows(db: Session) -> List[Dict[str, Any]]:
    """Join feedback to its linked prediction + machine specs from real stored rows.

    Unlinked feedback still counts as ground truth for coverage, but only rows
    with a complete linked prediction + specs can become training labels.
    """
    rows: List[Dict[str, Any]] = []
    records = db.query(FeedbackRecord).order_by(FeedbackRecord.id.asc()).all()
    for record in records:
        prediction: Optional[Prediction] = None
        if record.prediction_id is not None:
            prediction = db.query(Prediction).filter(Prediction.id == record.prediction_id).first()
        machine = db.query(Machine).filter(Machine.machine_id == record.machine_id).first()
        feature_importance: Dict[str, float] = {}
        failure_probability: Optional[float] = None
        if prediction is not None:
            failure_probability = prediction.failure_probability
            try:
                payload = json.loads(prediction.explanation_data or "{}")
            except (TypeError, ValueError):
                payload = {}
            if isinstance(payload, dict) and isinstance(payload.get("feature_importance"), dict):
                feature_importance = payload["feature_importance"]
        rows.append(
            {
                "sample_id": f"feedback-{record.id}",
                "feedback_id": record.id,
                "prediction_id": record.prediction_id,
                "machine_id": record.machine_id,
                "outcome": record.outcome,
                "actual_fault": record.actual_fault,
                "root_cause": record.root_cause,
                "prediction_correct": record.prediction_correct,
                "failure_probability": failure_probability,
                "feature_importance": feature_importance,
                "max_temp": machine.max_temp if machine and machine.max_temp is not None else 75.0,
                "max_vibration": machine.max_vibration if machine and machine.max_vibration is not None else 4.5,
                "rated_current": machine.rated_current if machine and machine.rated_current is not None else 10.0,
                "rated_rpm": machine.rated_rpm if machine and machine.rated_rpm is not None else 1450.0,
            }
        )
    return rows


def build_evaluation(db: Session) -> Dict[str, Any]:
    """Prototype-vs-reality report plus the curated-label pool (no fabrication)."""
    rows = collect_ground_truth_rows(db)
    ground_truth_count = len(rows)
    prototype = evaluate_prototype([row["prediction_correct"] for row in rows])
    labeled: CollectionReport = collect_labeled_samples(rows)
    samples = labeled.samples
    positives = sum(1 for item in samples if item.label == 1)
    negatives = sum(1 for item in samples if item.label == 0)
    return {
        "evaluated": prototype["evaluated"],
        "reason": prototype.get("reason"),
        "message": prototype["message"],
        "ground_truth_count": ground_truth_count,
        "evaluated_count": prototype["evaluated_count"],
        "correct_count": prototype["correct_count"],
        "incorrect_count": prototype["incorrect_count"],
        "prototype_accuracy": prototype["prototype_accuracy"],
        "labeled_count": len(samples),
        "positive_count": positives,
        "negative_count": negatives,
        "excluded_ambiguous_label": labeled.excluded_ambiguous_label,
        "excluded_non_finite": labeled.excluded_non_finite,
        "excluded_unknown_outcome": labeled.excluded_unknown_outcome,
        "samples": samples,
        "features": list(MODEL_FEATURES),
        "model_status": get_registry_status(),
    }
