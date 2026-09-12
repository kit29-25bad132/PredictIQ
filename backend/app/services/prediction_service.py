"""Service boundary for deterministic Phase 3 predictions."""

from typing import Any, Dict

from ml.prediction import predict_machine_health


class PredictionService:
    @staticmethod
    def predict(
        machine_id: str,
        temperature: float,
        vibration: float,
        current: float,
        rpm: float,
        rated_rpm: float,
        rated_current: float,
        max_temp: float,
        max_vibration: float,
        machine_type: str,
    ) -> Dict[str, Any]:
        return predict_machine_health(
            machine_id=machine_id,
            temperature=temperature,
            vibration=vibration,
            current=current,
            rpm=rpm,
            rated_rpm=rated_rpm,
            rated_current=rated_current,
            max_temp=max_temp,
            max_vibration=max_vibration,
            machine_type=machine_type,
        )

    @staticmethod
    def get_status() -> Dict[str, Any]:
        return {
            "trained": False,
            "status": "Prototype physics engine active",
            "model_version": "physics-rule-v1",
            "message": "Deterministic prototype estimates are active; validated ML is deferred to Phase 6.",
        }


prediction_service = PredictionService()
