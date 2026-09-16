"""
Predict IQ - AI Machine Learning & Explainable AI Module
Exclusively powered by real IoT sensor telemetry and ground-truth maintenance logs.
"""

from ai.prediction import predict_machine_health, ai_prediction_engine, AIPredictionService
from ai.data_validation import validate_sensor_reading, audit_dataset_quality
from ai.feature_engineering import extract_features, batch_extract_features, FEATURE_NAMES
from ai.training import train_model_from_real_data, get_model_status
from ai.explainability import compute_xai_explanation
from ai.recommendation import generate_recommendation

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
    "compute_xai_explanation",
    "generate_recommendation",
]
