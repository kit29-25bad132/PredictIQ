"""Deterministic Level-1 physics-rule prediction engine."""

from dataclasses import asdict, dataclass
from typing import Any, Dict

import numpy as np

from ml.explainability import compute_xai_explanation
from ml.recommendation import generate_recommendation


@dataclass(frozen=True)
class PredictionResult:
    failure_probability: float
    component: str
    explanation: str
    recommended_action: str
    model_version: str
    is_prototype: bool
    feature_importance: Dict[str, float]
    contributing_factors: list[Dict[str, Any]]
    reasons: list[str]


class AIPredictionService:
    """Physics baseline with explicit prototype labeling until Phase 6 ML."""

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
    ) -> PredictionResult:
        """Return a deterministic risk estimate and evidence from telemetry."""
        failure_probability = self._compute_physics_prob(
            temperature, vibration, current, max_temp, max_vibration, rated_current
        )

        vibration_ratio = vibration / max(max_vibration, 0.5)
        temperature_ratio = temperature / max(max_temp, 30.0)
        current_ratio = current / max(rated_current, 1.0)

        if failure_probability < 0.25:
            component = "System Optimal"
        elif vibration_ratio > 1.2 and temperature_ratio > 1.0:
            component = "Bearing"
        elif vibration_ratio > 1.3:
            component = "Shaft / Coupling"
        elif temperature_ratio > 1.15 and current_ratio > 1.1:
            component = "Motor Winding"
        elif temperature_ratio > 1.1:
            component = "Cooling System"
        elif current_ratio > 1.2:
            component = "Electrical System"
        else:
            component = "Bearing"

        feature_importance, contributing_factors, reasons, explanation = compute_xai_explanation(
            temperature=temperature,
            vibration=vibration,
            current=current,
            rpm=rpm,
            model=None,
            feature_vector=None,
            rated_rpm=rated_rpm,
            rated_current=rated_current,
            max_temp=max_temp,
            max_vibration=max_vibration,
        )
        recommended_action = generate_recommendation(
            component=component,
            failure_probability=failure_probability,
            temperature=temperature,
            vibration=vibration,
            current=current,
            rpm=rpm,
            feature_importance=feature_importance,
        )

        return PredictionResult(
            failure_probability=failure_probability,
            component=component,
            explanation=explanation,
            recommended_action=recommended_action,
            model_version="physics-rule-v1",
            is_prototype=True,
            feature_importance=feature_importance,
            contributing_factors=contributing_factors,
            reasons=reasons,
        )

    @staticmethod
    def _compute_physics_prob(
        temperature: float,
        vibration: float,
        current: float,
        max_temp: float,
        max_vibration: float,
        rated_current: float,
    ) -> float:
        vibration_stress = max(0.0, (vibration - (max_vibration * 0.7)) / (max_vibration * 0.8))
        temperature_stress = max(0.0, (temperature - (max_temp * 0.8)) / (max_temp * 0.4))
        current_stress = max(0.0, (current - (rated_current * 0.9)) / (rated_current * 0.5))
        score = (vibration_stress * 0.45) + (temperature_stress * 0.35) + (current_stress * 0.20)
        probability = 1.0 / (1.0 + np.exp(-3.5 * (score - 0.7)))
        return round(float(np.clip(probability, 0.04, 0.96)), 2)


ai_prediction_engine = AIPredictionService()


def predict_machine_health(
    machine_id: str,
    temperature: float,
    vibration: float,
    current: float,
    rpm: float,
    **kwargs,
) -> Dict[str, Any]:
    return asdict(ai_prediction_engine.predict(
        machine_id=machine_id,
        temperature=temperature,
        vibration=vibration,
        current=current,
        rpm=rpm,
        **kwargs,
    ))
