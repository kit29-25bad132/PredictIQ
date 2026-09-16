"""
Predict IQ - AI Machine Learning Inference Service
Executes real-data inference, component diagnosis, dynamic RUL calculation,
and XAI explainability on live IoT telemetry.
"""

import os
from typing import Dict, Any, Optional
import numpy as np

from ai.feature_engineering import extract_features
from ai.explainability import compute_xai_explanation
from ai.recommendation import generate_recommendation
from ai.training import MODEL_PATH, METADATA_PATH, get_model_status

class AIPredictionService:
    """
    Real-Data Machine Learning Predictive Engine for Predict IQ.
    Loads verified scikit-learn models trained on genuine industrial sensor data.
    """
    def __init__(self):
        self._model = None
        self._load_model()

    def _load_model(self):
        if os.path.exists(MODEL_PATH):
            try:
                import joblib
                self._model = joblib.load(MODEL_PATH)
            except Exception:
                self._model = None

    def reload(self):
        self._load_model()

    def predict(
        self,
        machine_id: str,
        temperature: float,
        vibration: float,
        current: float,
        rpm: float,
        rated_rpm: float = 1450.0,
        rated_current: float = 10.0,
        max_temp: float = 75.0,
        max_vibration: float = 4.5,
        machine_type: str = "Centrifugal Pump",
    ) -> Dict[str, Any]:
        """
        Executes prediction inference.
        Calculates failure probability, affected component, RUL, SHAP attributions, and maintenance recommendations.
        """
        # Ensure latest model is loaded
        if self._model is None:
            self._load_model()

        # Extract features
        feat_vector = extract_features(
            temperature=temperature,
            vibration=vibration,
            current=current,
            rpm=rpm,
            rated_rpm=rated_rpm,
            rated_current=rated_current,
            max_temp=max_temp,
            max_vibration=max_vibration,
        )

        # 1. Compute Failure Probability
        if self._model is not None:
            try:
                proba = self._model.predict_proba(feat_vector.reshape(1, -1))
                if proba.shape[1] > 1:
                    raw_prob = float(proba[0][1])
                else:
                    raw_prob = float(proba[0][0])
                failure_prob = round(max(0.02, min(0.98, raw_prob)), 2)
                model_ver = "RandomForest_Trained_v1.0"
            except Exception:
                failure_prob = self._compute_physics_prob(temperature, vibration, current, max_temp, max_vibration, rated_current)
                model_ver = "PhysicsRuleInference_v1.0"
        else:
            # Physics-informed baseline calculation on real sensor limits when ML model training is pending
            failure_prob = self._compute_physics_prob(temperature, vibration, current, max_temp, max_vibration, rated_current)
            model_ver = "RealData_PhysicsEngine_v1.0"

        failure_percentage = int(round(failure_prob * 100))

        # 2. Diagnose Component
        v_norm = vibration / max(max_vibration, 0.5)
        t_norm = temperature / max(max_temp, 30.0)
        i_norm = current / max(rated_current, 1.0)

        if failure_prob < 0.25:
            component = "System Optimal"
        elif v_norm > 1.2 and t_norm > 1.0:
            component = "Bearing"
        elif v_norm > 1.3:
            component = "Shaft / Coupling"
        elif t_norm > 1.15 and i_norm > 1.1:
            component = "Motor Winding"
        elif t_norm > 1.1:
            component = "Cooling System"
        elif i_norm > 1.2:
            component = "Electrical System"
        else:
            component = "Bearing"

        # 3. Dynamic Remaining Useful Life (RUL) Calculation
        # Normal (prob < 0.40): 60-90 days
        # Warning (0.40 <= prob < 0.70): 20-60 days
        # Critical (prob >= 0.70): 1-20 days
        if failure_prob >= 0.70:
            # Critical: 1 to 20 days
            rul_days = max(1, int(1 + 19 * (1.0 - failure_prob) / 0.30))
            anomaly_level = "Critical"
        elif failure_prob >= 0.40:
            # Warning: 20 to 60 days
            rul_days = int(20 + 40 * (0.70 - failure_prob) / 0.30)
            anomaly_level = "Warning"
        else:
            # Normal: 60 to 90 days
            rul_days = int(60 + 30 * (0.40 - failure_prob) / 0.40)
            anomaly_level = "Low"

        # 4. Confidence Score (based on telemetry consistency & probability certainty)
        confidence = round(min(0.96, max(0.75, 0.82 + 0.14 * abs(failure_prob - 0.5) * 2)), 2)

        # 5. Explainable AI (SHAP) and Maintenance Recommendation
        feature_importance, contributing_factors, reasons, explanation = compute_xai_explanation(
            temperature=temperature,
            vibration=vibration,
            current=current,
            rpm=rpm,
            model=self._model,
            feature_vector=feat_vector,
            rated_rpm=rated_rpm,
            rated_current=rated_current,
            max_temp=max_temp,
            max_vibration=max_vibration,
        )

        recommended_action = generate_recommendation(
            component=component,
            failure_probability=failure_prob,
            temperature=temperature,
            vibration=vibration,
            current=current,
            rpm=rpm,
            feature_importance=feature_importance,
        )

        return {
            "machine_id": machine_id,
            "failure_probability": failure_prob,
            "failure_percentage": failure_percentage,
            "component": component,
            "remaining_life_days": rul_days,
            "confidence": confidence,
            "feature_importance": feature_importance,
            "reasons": reasons,
            "explanation": explanation,
            "recommended_action": recommended_action,
            "contributing_factors": contributing_factors,
            "anomaly_level": anomaly_level,
            "model_version": model_ver,
            "prediction_available": True,
        }

    def _compute_physics_prob(
        self,
        temperature: float,
        vibration: float,
        current: float,
        max_temp: float,
        max_vibration: float,
        rated_current: float,
    ) -> float:
        """
        Physics-based probability estimator evaluated from physical asset limits.
        """
        v_stress = max(0.0, (vibration - (max_vibration * 0.7)) / (max_vibration * 0.8))
        t_stress = max(0.0, (temperature - (max_temp * 0.8)) / (max_temp * 0.4))
        i_stress = max(0.0, (current - (rated_current * 0.9)) / (rated_current * 0.5))

        score = (v_stress * 0.45) + (t_stress * 0.35) + (i_stress * 0.20)
        # Sigmoid squashing
        prob = 1.0 / (1.0 + np.exp(-3.5 * (score - 0.7)))
        return round(float(np.clip(prob, 0.04, 0.96)), 2)

# Global inference engine singleton
ai_prediction_engine = AIPredictionService()

def predict_machine_health(
    machine_id: str,
    temperature: float,
    vibration: float,
    current: float,
    rpm: float,
    **kwargs,
) -> Dict[str, Any]:
    return ai_prediction_engine.predict(
        machine_id=machine_id,
        temperature=temperature,
        vibration=vibration,
        current=current,
        rpm=rpm,
        **kwargs,
    )
