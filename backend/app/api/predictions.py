"""Typed prediction and explanation API endpoints."""

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from backend.app.db.database import get_db
from backend.app.db.models import Machine, Prediction
from backend.app.schemas.sensor import (
    ModelEvaluationResponse,
    ModelStatusResponse,
    ModelTrainRequest,
    ModelTrainResponse,
    PredictionInput,
    PredictionResponse,
)
from backend.app.services.model_evaluation import build_evaluation
from backend.app.services.prediction_service import prediction_service
from ml.train import train_governed_model

router = APIRouter(tags=["Predictions & Explanations"])


def response_from_prediction(prediction: Prediction) -> PredictionResponse:
    data = json.loads(prediction.explanation_data or "{}")
    return PredictionResponse(
        id=prediction.id,
        machine_id=prediction.machine_id,
        timestamp=prediction.timestamp,
        failure_probability=prediction.failure_probability,
        component=prediction.component,
        explanation=prediction.explanation,
        recommended_action=prediction.recommended_action,
        model_version=prediction.model_version,
        is_prototype=prediction.is_prototype,
        feature_importance=data.get("feature_importance", {}),
        contributing_factors=data.get("contributing_factors", []),
        reasons=data.get("reasons", []),
        prediction_available=True,
        created_at=prediction.created_at,
    )


def insufficient_data(machine_id: str) -> PredictionResponse:
    return PredictionResponse(
        machine_id=machine_id,
        timestamp=datetime.now(timezone.utc),
        is_prototype=True,
        prediction_available=False,
        explanation="Prediction requires a complete temperature, vibration, current, and RPM reading.",
    )


@router.get("/model-status", response_model=ModelStatusResponse)
def get_ai_model_status() -> ModelStatusResponse:
    model_status = prediction_service.get_status()
    return ModelStatusResponse(**model_status)


@router.get("/model-evaluation", response_model=ModelEvaluationResponse)
def get_model_evaluation(db: Session = Depends(get_db)) -> ModelEvaluationResponse:
    """Honest prototype-vs-reality evaluation from stored ground truth."""
    report = build_evaluation(db)
    payload = dict(report)
    payload.pop("samples", None)
    return ModelEvaluationResponse(**payload)


@router.post("/train-model", response_model=ModelTrainResponse)
def train_governed_ml_model(payload: ModelTrainRequest, db: Session = Depends(get_db)) -> ModelTrainResponse:
    """Explicit, governed training on curated technician labels only (ADR-005).

    Feedback ingestion never calls this: training happens only here, and only
    when enough two-class ground truth exists. Returns HTTP 200 with
    ``success=false`` on honest refusals so clients can display the reason.
    """
    report = build_evaluation(db)
    result = train_governed_model(
        report["samples"],
        dataset_version=payload.dataset_version,
        test_size=payload.test_size,
        random_state=payload.random_state,
    )
    if not result.get("success"):
        return ModelTrainResponse(
            success=False,
            refusal=result.get("refusal"),
            message=result.get("message", "Training refused."),
            dataset_version=payload.dataset_version,
            dataset_size=result.get("labeled_count", report["labeled_count"]),
            labeled_count=result.get("labeled_count", report["labeled_count"]),
            positive_count=result.get("positive_count", report["positive_count"]),
            negative_count=result.get("negative_count", report["negative_count"]),
        )
    return ModelTrainResponse(
        success=True,
        message=f"Governed model {result['model_version']} trained on curated ground truth.",
        model_version=result.get("model_version"),
        dataset_version=result.get("dataset_version"),
        metrics=result.get("metrics"),
        dataset_size=result.get("dataset_size"),
        train_dataset_size=result.get("train_dataset_size"),
        evaluation_dataset_size=result.get("evaluation_dataset_size"),
        labeled_count=result.get("dataset_size"),
        positive_count=result.get("metadata", {}).get("label_positive"),
        negative_count=result.get("metadata", {}).get("label_negative"),
        metadata=result.get("metadata"),
    )


@router.post("/predict", response_model=PredictionResponse, status_code=status.HTTP_201_CREATED)
def execute_prediction(payload: PredictionInput, db: Session = Depends(get_db)) -> PredictionResponse:
    machine = db.query(Machine).filter(Machine.machine_id == payload.machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine '{payload.machine_id}' does not exist in registry.")

    result = prediction_service.predict(
        machine_id=machine.machine_id,
        temperature=payload.temperature,
        vibration=payload.vibration,
        current=payload.current,
        rpm=payload.rpm,
        rated_rpm=machine.rated_rpm if machine.rated_rpm is not None else 1450.0,
        rated_current=machine.rated_current if machine.rated_current is not None else 10.0,
        max_temp=machine.max_temp if machine.max_temp is not None else 75.0,
        max_vibration=machine.max_vibration if machine.max_vibration is not None else 4.5,
        machine_type=machine.type,
    )
    now = datetime.now(timezone.utc)
    prediction = Prediction(
        machine_id=machine.machine_id,
        timestamp=now,
        failure_probability=result["failure_probability"],
        component=result["component"],
        explanation=result["explanation"],
        recommended_action=result["recommended_action"],
        model_version=result["model_version"],
        is_prototype=result["is_prototype"],
        explanation_data=json.dumps({
            "feature_importance": result["feature_importance"],
            "contributing_factors": result["contributing_factors"],
            "reasons": result["reasons"],
        }),
        created_at=now,
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)
    return response_from_prediction(prediction)


@router.get("/machines/{machine_id}/prediction", response_model=PredictionResponse)
def get_machine_prediction(machine_id: str, db: Session = Depends(get_db)) -> PredictionResponse:
    machine = db.query(Machine).filter(Machine.machine_id == machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine '{machine_id}' does not exist in registry.")
    latest_prediction = (
        db.query(Prediction)
        .filter(Prediction.machine_id == machine_id)
        .order_by(desc(Prediction.timestamp))
        .first()
    )
    if latest_prediction:
        return response_from_prediction(latest_prediction)
    return insufficient_data(machine_id)


@router.get("/predictions", response_model=List[PredictionResponse])
def list_predictions(machine_id: Optional[str] = None, db: Session = Depends(get_db)) -> List[PredictionResponse]:
    query = db.query(Prediction)
    if machine_id:
        query = query.filter(Prediction.machine_id == machine_id)
    return [response_from_prediction(item) for item in query.order_by(desc(Prediction.timestamp)).all()]
