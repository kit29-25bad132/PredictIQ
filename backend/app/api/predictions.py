"""
Typed prediction and explanation API endpoints (multi-tenant).

Phase 3 policy
--------------
* Prediction reads (history, latest) are organization-scoped.
* ``POST /api/predict`` keeps the device API-key gate and derives the
  organization from the registered machine; the model itself is platform-wide.
* ``POST /api/predictions/analyze`` keeps the device API-key gate, requires a
  registered device, and derives the organization from that device.
* ``POST /api/train-model`` and ``GET /api/model-evaluation`` are operator-only.

Training-data policy (explicit)
-------------------------------
PredictIQ runs ONE platform-global model, not a per-organization model. Training
is an operator-only governance action and intentionally uses curated feedback
from all organizations; therefore no organization-specific model is ever built
from mixed tenants, and no tenant can trigger or influence another tenant's
model. Per-organization models would require a separate approved design.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from backend.app.core.auth import require_api_key, require_operator_session
from backend.app.core.tenant import OrganizationContext, require_org_member
from backend.app.db.database import get_db
from backend.app.db.models import Device, Machine, Prediction, SensorReading
from backend.app.schemas.sensor import (
    ModelEvaluationResponse,
    ModelStatusResponse,
    ModelTrainRequest,
    ModelTrainResponse,
    PredictionAnalyzeRequest,
    PredictionAnalyzeResponse,
    PredictionInput,
    PredictionResponse,
)
from backend.app.services.ai_provider import (
    AIPredictorError,
    TelemetryInput,
    build_inference_input,
    get_predictor,
)
from backend.app.services.prediction_service import prediction_service

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


@router.get("/model-status", response_model=ModelStatusResponse,
            summary="AI model readiness for the caller's organization")
def get_ai_model_status(ctx: OrganizationContext = Depends(require_org_member)) -> ModelStatusResponse:
    model_status = prediction_service.get_status()
    return ModelStatusResponse(**model_status)


@router.get("/model-evaluation", response_model=ModelEvaluationResponse,
            summary="Platform model evaluation (operator only)")
def get_model_evaluation(
    _operator: None = Depends(require_operator_session),
    db: Session = Depends(get_db),
) -> ModelEvaluationResponse:
    """Honest prototype-vs-reality evaluation from all stored ground truth.

    Operator-only: the training pool spans organizations, so it must not be
    exposed to a tenant user.
    """
    from backend.app.services.model_evaluation import build_evaluation

    report = build_evaluation(db)
    payload = dict(report)
    payload.pop("samples", None)
    return ModelEvaluationResponse(**payload)


@router.post("/train-model", response_model=ModelTrainResponse,
             dependencies=[Depends(require_operator_session)],
             summary="Train the platform model (operator only)")
def train_governed_ml_model(payload: ModelTrainRequest, db: Session = Depends(get_db)) -> ModelTrainResponse:
    """Operator-only governed training on curated technician labels (ADR-005).

    Feed stock is platform-wide by design (see module docstring): this endpoint
    never builds a per-organization model from mixed tenants.
    """
    from backend.app.services.model_evaluation import build_evaluation
    from ml.train import train_governed_model

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


@router.post("/predict", response_model=PredictionResponse, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_api_key)],
             summary="Deterministic prototype prediction for a registered machine")
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
        organization_id=machine.organization_id,
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


@router.post("/predictions/analyze", response_model=PredictionAnalyzeResponse,
             status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(require_api_key)],
             summary="External-AI assessment of the latest real telemetry")
def analyze_prediction(
    payload: PredictionAnalyzeRequest, response: Response, db: Session = Depends(get_db)
) -> PredictionAnalyzeResponse:
    """External-AI (Gemini) assessment of the latest REAL telemetry.

    Tenant isolation: the device must be registered and bound to the requested
    machine; the organization is derived from that device. Telemetry is never
    taken from the request.
    """
    machine = db.query(Machine).filter(Machine.machine_id == payload.machine_id).first()
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine '{payload.machine_id}' does not exist in registry.")

    device = db.query(Device).filter(Device.device_id == payload.device_id).first()
    if device is None:
        raise HTTPException(
            status_code=404,
            detail=f"Device '{payload.device_id}' is not registered.",
        )
    if device.machine_id != payload.machine_id:
        raise HTTPException(
            status_code=400,
            detail=f"Device '{payload.device_id}' is registered to machine '{device.machine_id}', not '{payload.machine_id}'.",
        )
    if device.organization_id != machine.organization_id:
        raise HTTPException(status_code=400, detail="Device and machine do not share an organization.")

    reading = (
        db.query(SensorReading)
        .filter(
            SensorReading.organization_id == device.organization_id,
            SensorReading.device_id == payload.device_id,
            SensorReading.machine_id == payload.machine_id,
        )
        .order_by(desc(SensorReading.timestamp), desc(SensorReading.id))
        .first()
    )
    if reading is None:
        raise HTTPException(
            status_code=404,
            detail="No telemetry found for the exact device+machine pair.",
        )

    telemetry = TelemetryInput(
        device_id=reading.device_id,
        machine_id=reading.machine_id,
        timestamp=_iso_utc(reading.timestamp),
        temperature=reading.temperature,
        vibration=reading.vibration,
        current=reading.current,
        rpm=reading.rpm,
        machine_type=machine.type,
        machine_status=machine.status,
        max_temp=machine.max_temp,
        max_vibration=machine.max_vibration,
        rated_current=machine.rated_current,
        rated_rpm=machine.rated_rpm,
    )
    inference_input = build_inference_input(telemetry)
    input_hash = hashlib.sha256(
        json.dumps(inference_input, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    predictor = get_predictor()
    existing = (
        db.query(Prediction)
        .filter(
            Prediction.organization_id == device.organization_id,
            Prediction.machine_id == payload.machine_id,
            Prediction.model_version == predictor.model_identifier,
            Prediction.input_hash == input_hash,
        )
        .order_by(desc(Prediction.id))
        .first()
    )
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return _analyze_response(existing)

    try:
        assessment = predictor.analyze_telemetry(telemetry)
    except AIPredictorError as exc:
        raise HTTPException(status_code=502, detail=f"External AI analysis failed: {exc}") from exc

    observed_at = _normalise_utc(reading.timestamp)
    now = datetime.now(timezone.utc)
    prediction = Prediction(
        organization_id=device.organization_id,
        machine_id=machine.machine_id,
        timestamp=observed_at,
        failure_probability=assessment.failure_probability,
        component=assessment.likely_component,
        confidence=assessment.confidence,
        explanation=assessment.explanation,
        recommended_action=assessment.recommended_action,
        model_version=predictor.model_identifier,
        is_prototype=False,
        input_hash=input_hash,
        explanation_data=json.dumps(
            {
                "source": "external_ai",
                "provider": "gemini",
                "model": predictor.model,
                "input_timestamp": _iso_utc(reading.timestamp),
                "inference_input_hash": input_hash,
                "health_status": assessment.health_status,
                "severity": assessment.severity,
                "assessment": assessment.raw,
                "device_id": reading.device_id,
            }
        ),
        created_at=now,
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)
    return _analyze_response(prediction)


@router.get("/machines/{machine_id}/prediction", response_model=PredictionResponse,
            summary="Latest prediction for a machine in the caller's organization")
def get_machine_prediction(
    machine_id: str,
    ctx: OrganizationContext = Depends(require_org_member),
    db: Session = Depends(get_db),
) -> PredictionResponse:
    machine = (
        db.query(Machine)
        .filter(
            Machine.organization_id == ctx.organization_id,
            Machine.machine_id == machine_id,
        )
        .first()
    )
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine '{machine_id}' does not exist in registry.")
    latest_prediction = (
        db.query(Prediction)
        .filter(
            Prediction.organization_id == ctx.organization_id,
            Prediction.machine_id == machine_id,
        )
        .order_by(desc(Prediction.timestamp))
        .first()
    )
    if latest_prediction:
        return response_from_prediction(latest_prediction)
    return insufficient_data(machine_id)


@router.get("/predictions", response_model=List[PredictionResponse],
            summary="List predictions in the caller's organization")
def list_predictions(
    ctx: OrganizationContext = Depends(require_org_member),
    machine_id: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[PredictionResponse]:
    query = db.query(Prediction).filter(
        Prediction.organization_id == ctx.organization_id
    )
    if machine_id:
        query = query.filter(Prediction.machine_id == machine_id)
    return [response_from_prediction(item) for item in query.order_by(desc(Prediction.timestamp)).all()]


_HASH_KEY = "inference_input_hash"


def _iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _normalise_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _analyze_response(prediction: Prediction) -> PredictionAnalyzeResponse:
    """Map a persisted analyze-row onto the response schema, defensively."""
    try:
        data = json.loads(prediction.explanation_data or "{}")
        if not isinstance(data, dict):
            data = {}
    except (json.JSONDecodeError, TypeError, ValueError):
        data = {}

    def _field(name: str, fallback: str) -> str:
        value = data.get(name)
        return value if isinstance(value, str) and value else fallback

    input_timestamp = prediction.timestamp
    raw_ts = data.get("input_timestamp")
    if isinstance(raw_ts, str):
        try:
            input_timestamp = datetime.fromisoformat(raw_ts)
        except (TypeError, ValueError):
            pass

    return PredictionAnalyzeResponse(
        id=prediction.id,
        machine_id=prediction.machine_id,
        device_id=_field("device_id", ""),
        timestamp=prediction.timestamp,
        failure_probability=prediction.failure_probability,
        health_status=_field("health_status", "unknown"),
        likely_component=prediction.component or "",
        severity=_field("severity", "unknown"),
        explanation=prediction.explanation or "",
        recommended_action=prediction.recommended_action or "",
        confidence=prediction.confidence,
        model_version=prediction.model_version or "",
        source=_field("source", "external_ai"),
        provider=_field("provider", "gemini"),
        input_timestamp=input_timestamp,
        inference_input_hash=_field("inference_input_hash", ""),
        created_at=prediction.created_at,
    )
