"""
Predict IQ - AI Assistant / Maintenance Copilot Chat API endpoint.
Directly interfaces with GeminiProvider to offer real-time conversational assistance
grounded in real machine telemetry and health metrics.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from backend.app.db.database import get_db
from backend.app.db.models import Alert, Machine, Prediction, SensorReading
from backend.app.services.ai_provider import AIPredictorError, get_predictor

logger = logging.getLogger(__name__)

router = APIRouter(tags=["AI Maintenance Assistant"])


class ChatMessageItem(BaseModel):
    sender: str = Field(..., description="'user' or 'assistant'")
    text: str = Field(..., description="Message text content")
    timestamp: Optional[str] = None


class AssistantChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, description="User's query")
    machine_id: Optional[str] = Field(default=None, description="Optional target machine ID")
    history: Optional[List[ChatMessageItem]] = Field(default=[], description="Recent conversation turns")


class AssistantChatResponse(BaseModel):
    reply: str
    machine_id: Optional[str] = None
    timestamp: str
    model: str


@router.post(
    "/assistant/chat",
    response_model=AssistantChatResponse,
    summary="Chat in real-time with Predict IQ AI Maintenance Assistant",
)
def chat_with_assistant(
    payload: AssistantChatRequest,
    db: Session = Depends(get_db),
) -> AssistantChatResponse:
    """
    Live conversational AI Maintenance Assistant powered by Gemini.
    Incorporates authentic machine specs, real-time sensor telemetry, active alerts,
    and current timestamp so answers are context-aware, technically accurate,
    and helpful in English, Tamil, or any language.
    """
    machine_id = payload.machine_id
    machine_context_lines = []
    
    now_utc = datetime.now(timezone.utc)
    now_local_str = now_utc.strftime("%I:%M:%S %p UTC")

    machine_context_lines.append(f"Current System Time: {now_local_str} ({now_utc.isoformat()})")

    if machine_id:
        machine = db.query(Machine).filter(Machine.machine_id == machine_id).first()
        if machine:
            machine_context_lines.append(
                f"Machine: {machine.machine_id} ({machine.name or 'Industrial Unit'})\n"
                f"Type: {machine.type or 'Induction Motor'}, Status: {machine.status or 'Operational'}\n"
                f"Threshold Limits: Max Temp: {machine.max_temp}°C, Max Vibration: {machine.max_vibration} mm/s RMS, "
                f"Rated Current: {machine.rated_current} A, Rated RPM: {machine.rated_rpm}"
            )

            # Latest authentic sensor reading
            latest_reading = (
                db.query(SensorReading)
                .filter(SensorReading.machine_id == machine_id)
                .order_by(desc(SensorReading.timestamp), desc(SensorReading.id))
                .first()
            )
            if latest_reading:
                machine_context_lines.append(
                    f"Latest Real Telemetry Reading (Timestamp: {latest_reading.timestamp.isoformat()}):\n"
                    f" - Temperature: {latest_reading.temperature}°C\n"
                    f" - Vibration: {latest_reading.vibration} mm/s RMS\n"
                    f" - Current: {latest_reading.current} A\n"
                    f" - RPM: {latest_reading.rpm} RPM"
                )
            else:
                machine_context_lines.append("Latest Real Telemetry: No telemetry recorded yet.")

            # Active alerts
            active_alerts = (
                db.query(Alert)
                .filter(Alert.machine_id == machine_id, Alert.status == "ACTIVE")
                .order_by(desc(Alert.created_at))
                .limit(3)
                .all()
            )
            if active_alerts:
                alert_summaries = [f"[{a.severity}] {a.message}" for a in active_alerts]
                machine_context_lines.append("Active Alerts: " + "; ".join(alert_summaries))
            else:
                machine_context_lines.append("Active Alerts: None (All systems nominal).")

    system_instruction = (
        "You are the Predict IQ Maintenance Assistant, an expert industrial diagnostic and predictive maintenance AI copilot.\n"
        "Your task is to assist machine operators, plant engineers, and maintenance technicians with real-time diagnostics, "
        "inspection guidance, sensor interpretations, failure root-cause analysis (bearings, misalignment, unbalance, thermal dissipation), "
        "and general operational queries.\n\n"
        "LIVE TELEMETRY CONTEXT:\n"
        + "\n".join(machine_context_lines)
        + "\n\n"
        "INSTRUCTIONS:\n"
        "1. Answer concisely, practically, and professionally.\n"
        "2. Ground your analysis strictly in the real telemetry and machine limits provided above.\n"
        "3. If the user asks general questions (e.g. 'time', greetings, status checks), answer accurately and directly.\n"
        "4. If the user speaks in Tamil, Tanglish, or any other language, reply naturally and helpfully in the same language or clear Tamil/English.\n"
        "5. Provide actionable engineering recommendations (e.g., lubrication, bolt torque, alignment, cooling fan inspection) when anomalies exist."
    )

    history_dicts = [
        {"sender": h.sender, "text": h.text}
        for h in (payload.history or [])
    ]

    predictor = get_predictor()
    try:
        reply_text = predictor.generate_chat_reply(
            message=payload.message,
            history=history_dicts,
            system_instruction=system_instruction,
        )
    except AIPredictorError as exc:
        logger.error("Assistant chat error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI Assistant unavailable: {exc}",
        ) from exc
    except Exception as exc:
        logger.error("Unexpected error in chat: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process chat query.",
        ) from exc

    return AssistantChatResponse(
        reply=reply_text,
        machine_id=machine_id,
        timestamp=now_utc.isoformat(),
        model=predictor.model_identifier,
    )
