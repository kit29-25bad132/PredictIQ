"""
Predict IQ - AI Machine Learning & Explainable AI Module
Exclusively powered by real IoT sensor telemetry and ground-truth maintenance logs.
"""

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
