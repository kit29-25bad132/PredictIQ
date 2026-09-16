"""
Predict IQ - Honest, Gated ML Training & Evaluation (Phase 6).

Replaces the V0 ``ai/training.py`` carryover that reported fabricated 100% accuracy / F1
(``cv_scores = [1.0]``, ``f1_score = accuracy``, hardcoded ``"Passed"``) and labelled from
threshold rules (the model's own rules - circular). Per docs/06 governance and ADR-005:

- Labels come ONLY from curated ground truth: the Phase 5 ``feedback_records.prediction_correct``
  field (technician-judged prediction-vs-reality). No synthetic labels, no threshold-rule labels.
- Training refuses to run on unlabeled / thin / single-class data and fails loudly rather than
  celebrating a fake 100% metric.
- A governed run uses a deterministic train/test (held-out) split and reports REAL precision,
  recall, F1 and accuracy computed on the held-out test set only.
- Every governed run persists a versioned metadata record with the docs/06 governance fields.
- Feedback ingestion NEVER triggers retraining (ADR-005): this module is the only training entry,
  invoked explicitly.

Nothing here ever fabricates confidence, RUL, accuracy, or a "trained" flag. A model is only ever
reported as trained after a real governed run wrote an artifact that subsequently loads.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional

import numpy as np
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

# Default artifact location for governed production runs (ml/models/ is gitignored for *.joblib).
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_FILENAME = "model.joblib"
METADATA_FILENAME = "metadata.json"

# Labeled-data floors: at least MIN_LABELED_SAMPLES curated ground-truth records with a definitive
# prediction_correct label, and at least one positive AND one negative, before any ML is attempted.
MIN_LABELED_SAMPLES = 10
TEST_SPLIT = 0.25
RANDOM_STATE = 42

# Feature vector built from real stored facts: the prototype's risk estimate, the stored feature
# attribution (explanation_data.feature_importance), and the machine's specifications.
MODEL_FEATURES = [
    "failure_probability",
    "shap_temperature",
    "shap_vibration",
    "shap_current",
    "shap_rpm",
    "max_temp",
    "max_vibration",
    "rated_current",
    "rated_rpm",
]

# docs/06 governance fields required on every governed metadata record.
GOVERNANCE_FIELDS = ["dataset_version", "features", "metrics", "eval_date", "deployment_status"]

# ============================================================================
# Phase 6 — governed dataset collection and prototype evaluation.
# ============================================================================

REFUSAL_INSUFFICIENT_DATA = "insufficient_labeled_data"
REFUSAL_SINGLE_CLASS = "single_class_labels"
REFUSAL_PER_CLASS = "insufficient_per_class_data"

MIN_PER_CLASS = 2


class InsufficientDataError(ValueError):
    """Raised when curated ground truth cannot support honest training."""


@dataclass(frozen=True)
class LabeledSample:
    """One curated ground-truth example: real stored features + technician label."""

    sample_id: str
    features: Dict[str, float]
    label: int
    prediction_id: Optional[int] = None
    feedback_id: Optional[int] = None


@dataclass
class CollectionReport:
    """Honest accounting of which candidate rows became labels and why not."""

    samples: List[LabeledSample] = field(default_factory=list)
    excluded_ambiguous_label: int = 0
    excluded_non_finite: int = 0
    excluded_unknown_outcome: int = 0


def _finite_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def derive_fault_label(outcome: Any, actual_fault: Any, root_cause: Any) -> Optional[int]:
    """Derive a fault-presence label ONLY from technician-confirmed outcomes.

    ``Confirmed`` with a recorded fault/root cause means a real fault existed (1).
    ``Not Confirmed`` means inspection found no fault (0). Anything else
    (``Cancelled``, missing outcome, confirmed-but-unspecified) is ambiguous and
    yields ``None`` so the row is excluded rather than guessed.
    """
    if outcome == "Not Confirmed":
        return 0
    if outcome == "Confirmed" and (actual_fault or root_cause):
        return 1
    return None


def collect_labeled_samples(rows: Iterable[Mapping[str, Any]]) -> CollectionReport:
    """Build the governed training pool from real stored feedback/prediction facts.

    Each row must carry the linked prediction's ``failure_probability``,
    ``feature_importance`` (temperature/vibration/current/rpm attributions),
    the machine specs, and the technician ``outcome``/``actual_fault``/``root_cause``.
    Rows that are ambiguous or non-finite are counted as excluded, never imputed.
    """
    report = CollectionReport()
    for index, row in enumerate(rows or []):
        if not isinstance(row, Mapping):
            report.excluded_unknown_outcome += 1
            continue
        outcome = row.get("outcome")
        label = derive_fault_label(outcome, row.get("actual_fault"), row.get("root_cause"))
        if label is None:
            if outcome in ("Confirmed", "Not Confirmed"):
                report.excluded_ambiguous_label += 1
            else:
                report.excluded_unknown_outcome += 1
            continue
        importance = row.get("feature_importance") or {}
        candidate = {
            "failure_probability": row.get("failure_probability"),
            "shap_temperature": importance.get("temperature"),
            "shap_vibration": importance.get("vibration"),
            "shap_current": importance.get("current"),
            "shap_rpm": importance.get("rpm"),
            "max_temp": row.get("max_temp"),
            "max_vibration": row.get("max_vibration"),
            "rated_current": row.get("rated_current"),
            "rated_rpm": row.get("rated_rpm"),
        }
        features: Dict[str, float] = {}
        valid = True
        for name in MODEL_FEATURES:
            number = _finite_number(candidate.get(name))
            if number is None:
                valid = False
                break
            features[name] = number
        if not valid:
            report.excluded_non_finite += 1
            continue
        sample_id = str(row.get("sample_id") or f"row-{index}")
        report.samples.append(
            LabeledSample(
                sample_id=sample_id,
                features=features,
                label=label,
                prediction_id=row.get("prediction_id"),
                feedback_id=row.get("feedback_id"),
            )
        )
    return report


def evaluate_prototype(flags: Iterable[Any]) -> Dict[str, Any]:
    """Score the Phase 3 prototype against technician ``prediction_correct`` verdicts.

    Only records with a definitive True/False verdict count. With zero verdicts
    the prototype is reported as unevaluated — never as 0% or 100%.
    """
    verdicts = [flag for flag in (flags or []) if flag is True or flag is False]
    evaluated_count = len(verdicts)
    if evaluated_count == 0:
        return {
            "evaluated": False,
            "reason": "insufficient_evaluation_data",
            "evaluated_count": 0,
            "correct_count": 0,
            "incorrect_count": 0,
            "prototype_accuracy": None,
            "message": "No technician prediction-vs-reality verdicts are stored yet; prototype accuracy is unavailable, not zero.",
        }
    correct = sum(1 for flag in verdicts if flag is True)
    incorrect = evaluated_count - correct
    return {
        "evaluated": True,
        "evaluated_count": evaluated_count,
        "correct_count": correct,
        "incorrect_count": incorrect,
        "prototype_accuracy": round(correct / evaluated_count, 4),
        "message": f"Prototype matched technician reality in {correct} of {evaluated_count} linked verdicts.",
    }


# ============================================================================
# Phase 6 — governed training and model registry.
# ============================================================================

def resolve_model_dir(model_dir: Optional[str] = None) -> str:
    """Resolve artifact dir, honoring explicit override (used by tests)."""
    override = model_dir or os.environ.get("PREDICTIQ_MODEL_DIR") or MODEL_DIR
    return os.path.abspath(override)


def dataset_fingerprint(samples: List[LabeledSample]) -> str:
    """Deterministic fingerprint of the exact labeled rows used for a run."""
    digest = hashlib.sha256()
    for sample in sorted(samples, key=lambda item: item.sample_id):
        digest.update(f"{sample.sample_id}:{sample.label}".encode("utf-8"))
    return digest.hexdigest()[:16]


def dataset_feature_matrix(samples: List[LabeledSample]) -> tuple:
    """Ordered feature matrix/label vector for governed runs (by sample id)."""
    ordered = sorted(samples, key=lambda item: item.sample_id)
    matrix = np.array(
        [[item.features[name] for name in MODEL_FEATURES] for item in ordered],
        dtype=np.float64,
    )
    labels = np.array([item.label for item in ordered], dtype=np.int32)
    return matrix, labels, [item.sample_id for item in ordered]


def gate_labeled_samples(samples: List[LabeledSample]) -> Optional[Dict[str, Any]]:
    """Refuse thin/single-class ground truth loudly instead of celebrating it."""
    items = list(samples or [])
    total = len(items)
    positives = sum(1 for item in items if item.label == 1)
    negatives = sum(1 for item in items if item.label == 0)
    context = {
        "labeled_count": total,
        "positive_count": positives,
        "negative_count": negatives,
        "minimum_labeled": MIN_LABELED_SAMPLES,
        "minimum_per_class": MIN_PER_CLASS,
    }
    if total < MIN_LABELED_SAMPLES:
        return {
            "refusal": REFUSAL_INSUFFICIENT_DATA,
            "message": (
                f"Insufficient curated ground truth: {total} labeled record(s); "
                f"at least {MIN_LABELED_SAMPLES} with both outcomes are required."
            ),
            **context,
        }
    if positives == 0 or negatives == 0:
        return {
            "refusal": REFUSAL_SINGLE_CLASS,
            "message": "Single-class ground truth cannot validate a classifier.",
            **context,
        }
    if positives < MIN_PER_CLASS or negatives < MIN_PER_CLASS:
        return {
            "refusal": REFUSAL_PER_CLASS,
            "message": "Each outcome needs more curated records before training.",
            **context,
        }
    return None



def _split_held_out(matrix, labels, sample_ids, test_size=TEST_SPLIT, random_state=RANDOM_STATE):
    """Deterministic train/held-out split with disjoint sample ids."""
    try:
        result = train_test_split(
            matrix, labels, sample_ids,
            test_size=test_size, random_state=random_state, stratify=labels,
        )
    except ValueError:
        result = train_test_split(
            matrix, labels, sample_ids,
            test_size=test_size, random_state=random_state, stratify=None,
        )
    x_train, x_test, y_train, y_test, train_ids, test_ids = result
    if set(train_ids) & set(test_ids):
        raise InsufficientDataError("Train/held-out split leaked sample ids.")
    return x_train, x_test, y_train, y_test, list(train_ids), list(test_ids)


def _held_out_metrics(y_true, y_pred) -> Dict[str, Any]:
    """Real held-out metrics only; zero-division yields 0.0, never 1.0."""
    accuracy = round(float(accuracy_score(y_true, y_pred)), 4)
    precision = round(float(precision_score(y_true, y_pred, zero_division=0)), 4)
    recall = round(float(recall_score(y_true, y_pred, zero_division=0)), 4)
    f1 = round(float(f1_score(y_true, y_pred, zero_division=0)), 4)
    matrix = confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist()
    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "confusion_matrix": {"labels": [0, 1], "matrix": matrix},
        "support": int(len(y_true)),
    }


def train_governed_model(samples, dataset_version="feedback-v1", model_dir=None,
                         test_size=TEST_SPLIT, random_state=RANDOM_STATE,
                         deployment_status="candidate") -> Dict[str, Any]:
    """Train one governed classifier on curated labels; persist on success."""
    items = list(samples or [])
    refusal = gate_labeled_samples(items)
    if refusal is not None:
        return {"success": False, **refusal}
    matrix, labels, sample_ids = dataset_feature_matrix(items)
    split = _split_held_out(matrix, labels, sample_ids, test_size=test_size, random_state=random_state)
    x_train, x_test, y_train, y_test, train_ids, test_ids = split
    model = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=random_state, class_weight="balanced")
    model.fit(x_train, y_train)
    metrics = _held_out_metrics(y_test, model.predict(x_test))
    now = datetime.now(timezone.utc)
    model_version = f"grounded-rf-v{now.strftime('%Y%m%d_%H%M%S')}"
    target_dir = resolve_model_dir(model_dir)
    os.makedirs(target_dir, exist_ok=True)
    artifact_path = os.path.join(target_dir, MODEL_FILENAME)
    metadata_path = os.path.join(target_dir, METADATA_FILENAME)
    joblib.dump(model, artifact_path)
    joblib.load(artifact_path)  # prove it loads before any trained claim
    metadata = {
        "model_version": model_version,
        "dataset_version": dataset_version,
        "dataset_fingerprint": dataset_fingerprint(items),
        "features": list(MODEL_FEATURES),
        "metrics": metrics,
        "eval_date": now.isoformat(),
        "training_timestamp": now.isoformat(),
        "deployment_status": deployment_status,
        "evaluation_status": "evaluated",
        "dataset_size": len(items),
        "train_dataset_size": int(len(y_train)),
        "evaluation_dataset_size": int(len(y_test)),
        "label_positive": int(sum(1 for item in items if item.label == 1)),
        "label_negative": int(sum(1 for item in items if item.label == 0)),
        "random_state": random_state,
        "test_size": test_size,
        "artifact": MODEL_FILENAME,
        "train_sample_ids": train_ids,
        "test_sample_ids": test_ids,
    }
    missing = [name for name in GOVERNANCE_FIELDS if name not in metadata]
    if missing:
        raise InsufficientDataError(f"Governed metadata missing fields: {missing}")
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2, sort_keys=True)
    return {
        "success": True,
        "model_version": model_version,
        "dataset_version": dataset_version,
        "metrics": metrics,
        "dataset_size": len(items),
        "train_dataset_size": int(len(y_train)),
        "evaluation_dataset_size": int(len(y_test)),
        "metadata_path": metadata_path,
        "artifact_path": artifact_path,
        "metadata": metadata,
    }

def read_governed_metadata(model_dir=None) -> Optional[Dict[str, Any]]:
    """Return governed metadata only when a real file exists and parses."""
    metadata_path = os.path.join(resolve_model_dir(model_dir), METADATA_FILENAME)
    if not os.path.exists(metadata_path):
        return None
    try:
        with open(metadata_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def load_governed_model(model_dir=None) -> Optional[Any]:
    """Return a governed model only when a real artifact exists and loads."""
    artifact_path = os.path.join(resolve_model_dir(model_dir), MODEL_FILENAME)
    if not os.path.exists(artifact_path):
        return None
    try:
        return joblib.load(artifact_path)
    except Exception:
        return None


def get_registry_status(model_dir=None) -> Dict[str, Any]:
    """Honest registry: prototype by default; trained only on real artifacts."""
    metadata = read_governed_metadata(model_dir)
    model = load_governed_model(model_dir)
    base = {
        "source": "prototype",
        "trained": False,
        "evaluated": False,
        "model_version": "physics-rule-v1",
        "status": "Prototype physics engine active",
        "message": "Prototype active; validated ML waits for curated ground truth.",
    }
    if metadata is None or model is None:
        missing = []
        if metadata is None:
            missing.append(METADATA_FILENAME)
        if model is None:
            missing.append(MODEL_FILENAME)
        base["missing_artifacts"] = missing
        return base
    if any(name not in metadata for name in GOVERNANCE_FIELDS):
        base["message"] = "Governed artifacts exist but metadata is incomplete."
        base["missing_governance_fields"] = [n for n in GOVERNANCE_FIELDS if n not in metadata]
        return base
    metrics = metadata.get("metrics") if isinstance(metadata.get("metrics"), dict) else None
    evaluated = metadata.get("evaluation_status") == "evaluated" and metrics is not None
    return {
        "source": "trained" if evaluated else "trained-unevaluated",
        "trained": True,
        "evaluated": evaluated,
        "model_version": metadata.get("model_version"),
        "status": "Governed ML model active" if evaluated else "Trained model present; evaluation incomplete",
        "message": "Governed model trained on curated ground truth." if evaluated else "Artifact loads but evaluation is incomplete.",
        "dataset_version": metadata.get("dataset_version"),
        "features": metadata.get("features"),
        "metrics": metrics,
        "eval_date": metadata.get("eval_date"),
        "deployment_status": metadata.get("deployment_status"),
        "dataset_size": metadata.get("dataset_size"),
        "evaluation_dataset_size": metadata.get("evaluation_dataset_size"),
    }
