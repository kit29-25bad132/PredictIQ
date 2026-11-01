"""
Predict IQ - AI Machine Learning & Explainable AI Module
Exclusively powered by real IoT sensor telemetry and ground-truth maintenance logs.
"""

try:
    from ml.prediction import predict_machine_health, ai_prediction_engine, AIPredictionService
    from ml.data_validation import validate_sensor_reading, audit_dataset_quality
    from ml.feature_engineering import extract_features, batch_extract_features, FEATURE_NAMES
    from ml.training import train_model_from_real_data, get_model_status
    from ml.train import (
        MODEL_FEATURES,
        MIN_LABELED_SAMPLES,
        collect_labeled_samples,
        derive_fault_label,
        evaluate_prototype,
        gate_labeled_samples,
        get_registry_status,
        load_governed_model,
        read_governed_metadata,
        resolve_model_dir,
        train_governed_model,
    )
    from ml.explainability import compute_xai_explanation
    from ml.recommendation import generate_recommendation
    _ML_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - platform policy may block optional ML runtime
    _ML_IMPORT_ERROR = exc

    def _missing_ml(*_args, **_kwargs):
        raise ImportError(
            "Predict IQ ML dependencies are unavailable in this environment; "
            "real telemetry is still accepted, but AI training/prediction is disabled."
        ) from _ML_IMPORT_ERROR

    predict_machine_health = _missing_ml
    ai_prediction_engine = None
    AIPredictionService = None
    validate_sensor_reading = _missing_ml
    audit_dataset_quality = _missing_ml
    extract_features = _missing_ml
    batch_extract_features = _missing_ml
    FEATURE_NAMES = []
    train_model_from_real_data = _missing_ml
    get_model_status = lambda: {"trained": False, "status": "unavailable", "message": "Machine learning dependencies are unavailable in this environment."}
    MODEL_FEATURES = []
    MIN_LABELED_SAMPLES = 10
    collect_labeled_samples = _missing_ml
    derive_fault_label = _missing_ml
    evaluate_prototype = _missing_ml
    gate_labeled_samples = _missing_ml
    get_registry_status = lambda: {"trained": False, "status": "unavailable", "message": "Machine learning dependencies are unavailable in this environment."}
    load_governed_model = _missing_ml
    read_governed_metadata = _missing_ml
    resolve_model_dir = _missing_ml
    train_governed_model = _missing_ml
    compute_xai_explanation = _missing_ml
    generate_recommendation = _missing_ml

__all__ = [
    "predict_machine_health",
    "ai_prediction_engine",
    "AIPredictionService",
    "validate_sensor_reading",
    "audit_dataset_quality",
    "extract_features",
    "batch_extract_features",
    "FEATURE_NAMES",
    "train_model_from_real_data",
    "get_model_status",
    "MODEL_FEATURES",
    "MIN_LABELED_SAMPLES",
    "collect_labeled_samples",
    "derive_fault_label",
    "evaluate_prototype",
    "gate_labeled_samples",
    "get_registry_status",
    "load_governed_model",
    "read_governed_metadata",
    "resolve_model_dir",
    "train_governed_model",
    "compute_xai_explanation",
    "generate_recommendation",
]
