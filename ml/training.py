"""
Predict IQ - Legacy training entry (Phase 6 compatibility shim).

Phase 6 replaces threshold-rule labels and fabricated ``cv_scores=[1.0]`` /
``f1_score=accuracy`` metrics with :mod:`ml.train`, which trains ONLY on
curated technician ground truth and refuses thin/single-class data.

This module is kept so old imports do not break at collection time. Every
legacy entry point now delegates to the governed implementation and returns
an explicit insufficient-data / requires-ground-truth refusal instead of fake
metrics. No caller may treat it as a trained model.
"""

import warnings

from typing import Any, Dict, List, Optional

from ml.train import (
    MIN_LABELED_SAMPLES,
    collect_labeled_samples,
    get_registry_status,
    train_governed_model,
)

MODEL_DIR = None
MODEL_PATH = None
METADATA_PATH = None

MIN_READINGS_TO_TRAIN = MIN_LABELED_SAMPLES  # curated ground-truth records, not raw readings

_LEGACY_MESSAGE = (
    "ml.training is a Phase 6 compatibility shim: legacy threshold-rule training was removed. "
    "Use ml.train with curated technician ground truth."
)

def get_model_status() -> Dict[str, Any]:
    """Honest registry status for legacy callers (never fabricates metrics)."""
    warnings.warn(_LEGACY_MESSAGE, DeprecationWarning, stacklevel=2)
    return get_registry_status()


def train_model_from_real_data(
    readings: List[Dict[str, Any]],
    maintenance_records: List[Dict[str, Any]],
    machine_specs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Legacy entry: refuse, because raw readings are not curated labels.

    The V0 path labeled rows from its own threshold rules and reported
    ``cv_scores=[1.0]``. Phase 6 forbids that, so this shim returns an
    explicit requires-ground-truth refusal and never writes an artifact.
    """
    warnings.warn(_LEGACY_MESSAGE, DeprecationWarning, stacklevel=2)
    _ = (readings, maintenance_records, machine_specs)
    refusal = train_governed_model(collect_labeled_samples([]).samples)
    return {
        "success": False,
        "status": "Training requires curated ground truth",
        "state_code": 2,
        "can_train": False,
        "refusal": refusal.get("refusal"),
        "message": (
            "Legacy threshold-rule training was removed in Phase 6. "
            "Submit technician feedback with prediction-vs-reality verdicts, "
            "then run ml.train.train_governed_model on curated labels."
        ),
    }
