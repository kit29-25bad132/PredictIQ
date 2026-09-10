"""
Predict IQ - AI Prediction & Diagnosis Service Adapter
Connects FastAPI backend directly to the real-data AI machine learning engine in ai/
"""

from typing import Dict, Any, List
from ai.prediction import predict_machine_health, ai_prediction_engine
from ai.training import get_model_status, train_model_from_real_data

class PredictionService:
    """
    Service layer bridging FastAPI endpoints with the Python AI module.
    """

    @classmethod
    def predict(
        cls,
        machine_id: str,
        temperature: float,
        vibration: float,
        current: float,
        rpm: float,
        rated_rpm: float = 1450.0,
        rated_current: float = 10.0,
        max_temp: float = 75.0,
        max_vibration: float = 4.5,
        machine_type: str = "Centrifugal Pump"
    ) -> Dict[str, Any]:
        """
        Executes prediction using the Python AI engine.
        """
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
            machine_type=machine_type
        )

    @classmethod
    def get_status(cls) -> Dict[str, Any]:
        return get_model_status()

    @classmethod
    def train_model(cls, readings: List[Dict[str, Any]], maintenance_records: List[Dict[str, Any]]) -> Dict[str, Any]:
        res = train_model_from_real_data(readings, maintenance_records)
        if res.get("success"):
            ai_prediction_engine.reload()
        return res

# Global instance
prediction_service = PredictionService()
