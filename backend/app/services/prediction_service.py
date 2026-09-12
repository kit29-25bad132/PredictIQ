"""Service boundary for deterministic Phase 3 predictions + Phase 6 registry."""

from typing import Any, Dict

from ml.prediction import predict_machine_health
from ml.train import get_registry_status


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
        """Honest registry status: trained only when a real artifact loads."""
        return get_registry_status()


prediction_service = PredictionService()
