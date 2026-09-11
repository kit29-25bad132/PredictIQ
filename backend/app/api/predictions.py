"""
Predict IQ - AI Prediction & Model Status Endpoints (PostgreSQL Architecture)
Strictly adheres to real-data policy: does NOT fabricate predictions without a validated ML model.
Reports transparent model readiness status.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import List, Optional
from datetime import datetime

from backend.app.db.database import get_db
from backend.app.db.models import Machine, Prediction, SensorReading, MaintenanceRecord
from backend.app.schemas.sensor import (
    AIModelStatusResponse,
    PredictionResponse
)
from backend.services.prediction_service import prediction_service

router = APIRouter(tags=["AI Model & Predictions (Real Data First)"])

@router.get(
    "/model-status",
    response_model=AIModelStatusResponse,
    summary="Get current AI model training status and readiness"
)
def get_ai_model_status(db: Session = Depends(get_db)):
    """
    Returns the real state of the trained model and the PostgreSQL dataset.
    """
    total_readings = db.query(SensorReading).count()
    total_maintenance = db.query(MaintenanceRecord).count()
    model_status = prediction_service.get_status()
    trained = model_status.get("trained", False)

    return AIModelStatusResponse(
        status=model_status["status"],
        prediction="Available" if trained else "Not available",
        remaining_useful_life="Available" if trained else "Not available",
        confidence="Available" if trained else "Not available",
        trained_model_exists=trained,
        message=(
            f"Currently collecting real IoT telemetry in PostgreSQL ({total_readings} sensor readings, "
            f"{total_maintenance} maintenance records stored). {model_status['message']}"
        )
    )

@router.post(
    "/train-model",
    summary="Train the AI model from stored real telemetry"
)
def train_ai_model(db: Session = Depends(get_db)):
    """
    Trains exclusively from sensor readings and maintenance records persisted in PostgreSQL.
    The AI pipeline enforces its minimum sample threshold and returns a transparent result
    when training is not yet possible.
    """
    readings = [
        {
            "is_valid": True,
            "temperature": reading.temperature,
            "vibration": reading.vibration,
            "current": reading.current,
            "rpm": reading.rpm,
            "timestamp": reading.timestamp,
            "machine_id": reading.machine_id,
        }
        for reading in db.query(SensorReading).all()
    ]
    maintenance_records = [
        {
            "failure_date": record.failure_date,
            "component": record.component,
            "machine_id": record.machine_id,
        }
        for record in db.query(MaintenanceRecord).all()
    ]

    return prediction_service.train_model(readings, maintenance_records)

@router.get(
    "/machines/{machine_id}/prediction",
    summary="Get latest AI prediction for a specific machine asset"
)
def get_machine_prediction(machine_id: str, db: Session = Depends(get_db)):
    """
    Queries latest prediction for machine.
    If no validated model exists or no predictions have been generated, returns 'Not available'.
    Never outputs fake or hardcoded percentages.
    """
    machine = db.query(Machine).filter(Machine.machine_id == machine_id).first()
    if not machine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Machine '{machine_id}' does not exist in registry."
        )

    latest_pred = (
        db.query(Prediction)
        .filter(Prediction.machine_id == machine_id)
        .order_by(desc(Prediction.timestamp))
        .first()
    )

    if latest_pred:
        return PredictionResponse.from_orm(latest_pred)

    return {
        "machine_id": machine_id,
        "status": "Waiting for real historical data",
        "prediction": "Not available",
        "failure_probability": None,
        "component": "Not available",
        "remaining_life_days": None,
        "confidence": None,
        "explanation": "No trained ML model has been validated yet. System is collecting real sensor telemetry in PostgreSQL.",
        "recommended_action": "Continue real ESP32 sensor telemetry ingestion.",
        "trained_model_exists": False
    }

@router.post(
    "/predict",
    summary="Execute AI failure prediction"
)
def execute_prediction(payload: dict, db: Session = Depends(get_db)):
    """
    Inference endpoint. Returns transparent status that real ML training is pending.
    """
    return {
        "machine_id": payload.get("machine_id", "M001"),
        "status": "Waiting for real historical data",
        "prediction": "Not available",
        "failure_probability": None,
        "component": "Not available",
        "remaining_life_days": None,
        "confidence": None,
        "explanation": "Predictions are disabled until the ML model is trained on real historical PostgreSQL telemetry.",
        "recommended_action": "Ingest real sensor readings via POST /api/sensor-data.",
        "trained_model_exists": False
    }

@router.get(
    "/predictions",
    response_model=List[PredictionResponse],
    summary="List stored predictions from PostgreSQL"
)
def list_predictions(
    machine_id: Optional[str] = Query(None, description="Optional machine ID filter"),
    db: Session = Depends(get_db)
):
    """
    Returns actual prediction records from PostgreSQL.
    """
    query = db.query(Prediction)
    if machine_id:
        query = query.filter(Prediction.machine_id == machine_id)
    preds = query.order_by(desc(Prediction.timestamp)).all()
    return [PredictionResponse.from_orm(p) for p in preds]
