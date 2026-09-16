"""
External AI provider abstraction for predictive analysis (Gemini).

Design contract (recovery task, aligned with the repository's honesty rules):

- AIPredictor is the minimal protocol the predictions API depends on; concrete
  providers (Gemini today) implement ``analyze_telemetry``.
- GeminiProvider calls the official Google Generative Language REST API over
  HTTPS using ``urllib`` from the Python standard library — no new dependency
  and no SDK: the project deliberately keeps its dependency surface small.
- Configuration is environment-backed ONLY: GEMINI_API_KEY and GEMINI_MODEL.
  A missing key fails closed (AIPredictorError), never a fabricated result.
- The model must answer with a strict JSON assessment; every field is
  validated (ranges, enums, non-empty strings) BEFORE anything is persisted.
  Malformed or out-of-range output raises AIPredictorError and no prediction
  row is ever created from it.
- This module performs no I/O itself at import time and contains no secrets.
"""

from __future__ import annotations

import json
import logging
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional, Protocol

from backend.app.core.config import get_settings

logger = logging.getLogger(__name__)

# Official Google Generative Language REST API endpoint (HTTPS only).
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

DEFAULT_TIMEOUT_SECONDS = 30.0
MAX_RESPONSE_BYTES = 1_000_000  # 1 MiB guard against pathological payloads.

HEALTH_STATUSES = ("healthy", "warning", "faulted", "unknown")
SEVERITIES = ("nominal", "minor", "major", "critical")

# Gemini request tuning (official docs: ai.google.dev/gemini-api/docs/thinking):
# thinking tokens are billed against max_output_tokens, and an exhausted token
# budget truncates the response (finishReason "incomplete", truncated or empty
# output) — the exact mechanism that made a thinking-default 3.6 Flash emit
# non-JSON output under the old 1024-token cap. The documented remedy is a
# generous max_output_tokens plus an explicit thinking_level, never a small
# token ceiling.
GEMINI_THINKING_LEVEL = "low"
GEMINI_MAX_OUTPUT_TOKENS = 2048

# Strict structured-output contract for the analyze assessment, sent via the
# documented v1beta generateContent mechanism (responseMimeType + responseSchema)
# so the model is constrained to JSON syntax matching this shape.
# validate_assessment() still enforces semantic correctness afterwards.
ASSESSMENT_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "assessment": {
            "type": "object",
            "properties": {
                "failure_probability": {"type": "number"},
                "health_status": {"type": "string", "enum": list(HEALTH_STATUSES)},
                "likely_component": {"type": "string"},
                "severity": {"type": "string", "enum": list(SEVERITIES)},
                "explanation": {"type": "string"},
                "recommended_action": {"type": "string"},
                "confidence": {"type": "number"},
            },
            "required": [
                "failure_probability",
                "health_status",
                "likely_component",
                "severity",
                "explanation",
                "recommended_action",
                "confidence",
            ],
        }
    },
    "required": ["assessment"],
}


class AIPredictorError(Exception):
    """Raised for any provider failure: config, network, timeout, or bad output."""


@dataclass(frozen=True)
class TelemetryInput:
    """The exact real telemetry row (plus machine context) sent to the provider."""

    device_id: str
    machine_id: str
    timestamp: str  # ISO-8601 UTC, the reading's exact stored timestamp
    temperature: Optional[float]
    vibration: Optional[float]
    current: Optional[float]
    rpm: Optional[float]
    machine_type: Optional[str] = None
    machine_status: Optional[str] = None
    max_temp: Optional[float] = None
    max_vibration: Optional[float] = None
    rated_current: Optional[float] = None
    rated_rpm: Optional[float] = None


@dataclass(frozen=True)
class AIAssessment:
    """Validated assessment returned by a provider. Safe to persist."""

    failure_probability: float
    health_status: str
    likely_component: str
    severity: str
    explanation: str
    recommended_action: str
    confidence: float
    raw: Dict[str, Any]


def validate_assessment(payload: Any) -> AIAssessment:
    """Strictly validate a provider assessment dict; raise AIPredictorError if invalid.

    Validation is intentionally duplicated here (not delegated to Pydantic) so
    the acceptance contract for EXTERNAL AI output is testable without HTTP and
    cannot be silently widened by schema changes elsewhere.
    """
    if not isinstance(payload, dict):
        raise AIPredictorError("AI assessment must be a JSON object.")

    assessment = payload.get("assessment")
    if not isinstance(assessment, dict):
        raise AIPredictorError("AI response is missing the 'assessment' object.")

    def _require_number(field: str, low: float, high: float) -> float:
        value = assessment.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise AIPredictorError(f"AI field '{field}' must be a number.")
        value = float(value)
        if value != value or value in (float("inf"), float("-inf")):
            raise AIPredictorError(f"AI field '{field}' must be finite.")
        if value < low or value > high:
            raise AIPredictorError(f"AI field '{field}' must be within [{low}, {high}], got {value}.")
        return value

    def _require_non_empty_str(field: str) -> str:
        value = assessment.get(field)
        if not isinstance(value, str) or not value.strip():
            raise AIPredictorError(f"AI field '{field}' must be a non-empty string.")
        return value.strip()

    failure_probability = _require_number("failure_probability", 0.0, 1.0)
    confidence = _require_number("confidence", 0.0, 1.0)

    health_status = assessment.get("health_status")
    if health_status not in HEALTH_STATUSES:
        raise AIPredictorError(
            f"AI field 'health_status' must be one of {list(HEALTH_STATUSES)}, got {health_status!r}."
        )

    severity = assessment.get("severity")
    if severity not in SEVERITIES:
        raise AIPredictorError(
            f"AI field 'severity' must be one of {list(SEVERITIES)}, got {severity!r}."
        )

    return AIAssessment(
        failure_probability=failure_probability,
        health_status=health_status,
        likely_component=_require_non_empty_str("likely_component"),
        severity=severity,
        explanation=_require_non_empty_str("explanation"),
        recommended_action=_require_non_empty_str("recommended_action"),
        confidence=confidence,
        raw=dict(assessment),
    )


def build_inference_input(telemetry: TelemetryInput) -> Dict[str, Any]:
    """Build the deterministic inference-input document from REAL telemetry only."""
    return {
        "device_id": telemetry.device_id,
        "machine_id": telemetry.machine_id,
        "telemetry_timestamp": telemetry.timestamp,
        "readings": {
            "temperature_c": telemetry.temperature,
            "vibration_mm_s": telemetry.vibration,
            "current_a": telemetry.current,
            "rpm": telemetry.rpm,
        },
        "machine": {
            "type": telemetry.machine_type,
            "status": telemetry.machine_status,
            "max_temp": telemetry.max_temp,
            "max_vibration": telemetry.max_vibration,
            "rated_current": telemetry.rated_current,
            "rated_rpm": telemetry.rated_rpm,
        },
    }


def build_prompt(inference_input: Dict[str, Any]) -> str:
    """Prompt requiring a strict JSON assessment for the given real telemetry."""
    payload = json.dumps(inference_input, sort_keys=True, separators=(",", ":"))
    return (
        "You are an industrial predictive-maintenance analyst. You receive one real "
        "sensor reading from a machine (temperature in °C, vibration in mm/s RMS, "
        "current in A, rpm) plus machine limits and nameplate values. Missing sensor "
        "channels arrive as null. Assess the failure risk for THIS reading only.\n\n"
        "Telemetry (real database values):\n"
        f"{payload}\n\n"
        "Respond with ONLY a JSON object, no markdown fences and no prose, shaped exactly like:\n"
        '{"assessment": {"failure_probability": <number 0..1>, "health_status": '
        '"healthy|warning|faulted|unknown", "likely_component": "<string>", '
        '"severity": "nominal|minor|major|critical", "explanation": "<string>", '
        '"recommended_action": "<string>", "confidence": <number 0..1>}}\n\n'
        "Rules: use the given values only, never invent readings; if data is insufficient "
        "set health_status to \"unknown\" and lower confidence; all fields are required."
    )


class AIPredictor(Protocol):
    """Minimal interface consumed by the predictions API."""

    def analyze_telemetry(self, telemetry: TelemetryInput) -> AIAssessment:
        """Return a validated assessment for the given real telemetry."""
        ...


class GeminiProvider:
    """AIPredictor backed by Google's Generative Language REST API (Gemini).

    - Model and key come exclusively from settings (env: GEMINI_API_KEY /
      GEMINI_MODEL). Missing key => fail closed with AIPredictorError.
    - Network/timeout/HTTP errors and unparseable or invalid AI output all raise
      AIPredictorError; callers must treat that as "no prediction this time".
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        api_base_url: str = GEMINI_API_BASE_URL,
    ) -> None:
        settings = get_settings()
        self.api_key = api_key if api_key is not None else settings.gemini_api_key
        self.model = model if model is not None else (settings.gemini_model or DEFAULT_GEMINI_MODEL)
        self.timeout_seconds = timeout_seconds
        self.api_base_url = api_base_url.rstrip("/")

    @property
    def model_identifier(self) -> str:
        """Stable identifier persisted on predictions, e.g. 'gemini:gemini-2.5-flash'."""
        return f"gemini:{self.model}"

    def analyze_telemetry(self, telemetry: TelemetryInput) -> AIAssessment:
        if not self.api_key:
            # Fail closed: never fabricate a result when unconfigured.
            raise AIPredictorError("GEMINI_API_KEY is not configured; external AI analysis is unavailable.")

        inference_input = build_inference_input(telemetry)
        request_body = {
            "contents": [{"parts": [{"text": build_prompt(inference_input)}]}],
            "generationConfig": {
                # Documented structured-output mechanism: forces syntactically
                # valid JSON constrained to the assessment schema.
                "responseMimeType": "application/json",
                "responseSchema": ASSESSMENT_RESPONSE_SCHEMA,
                # Documented thinking/limit tuning for 3.x Flash: enough budget
                # for thinking plus the full JSON assessment, with an explicit
                # low thinking_level instead of a small token cap. The sampling
                # parameters temperature/topP/topK are deprecated as of
                # 2026-07-21 and deliberately omitted; validate_assessment()
                # pins output semantics.
                "maxOutputTokens": GEMINI_MAX_OUTPUT_TOKENS,
                "thinkingConfig": {"thinkingLevel": GEMINI_THINKING_LEVEL},
            },
        }
        url = f"{self.api_base_url}/{self.model}:generateContent"
        raw_text = self._post_json(url, request_body)
        assessment = validate_assessment(self._extract_assessment(raw_text))
        return assessment

    # ------------------------------------------------------------------
    # Transport + response extraction
    # ------------------------------------------------------------------

    def _post_json(self, url: str, body: Dict[str, Any]) -> str:
        """POST JSON over HTTPS and return the response body text."""
        data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self.api_key,
            },
            method="POST",
        )
        # Pin default verification explicitly; we never disable certificate
        # checks and never send the key in the URL.
        context = ssl.create_default_context()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds, context=context) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            detail = ""
            try:
                detail = exc.read(MAX_RESPONSE_BYTES).decode("utf-8", errors="replace")
            except Exception:  # pragma: no cover - best-effort detail only
                pass
            logger.warning("Gemini API HTTP error %s: %s", exc.code, detail[:200])
            raise AIPredictorError(f"Gemini API returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            raise AIPredictorError(f"Gemini API unreachable: {exc.reason}") from exc
        except TimeoutError as exc:  # pragma: no cover - platform dependent
            raise AIPredictorError("Gemini API request timed out.") from exc
        if len(raw) > MAX_RESPONSE_BYTES:
            raise AIPredictorError("Gemini API response exceeded the size limit.")
        return raw.decode("utf-8", errors="replace")

    def _extract_assessment(self, raw_text: str) -> Any:
        """Parse the Gemini generateContent envelope and return the parsed assessment JSON."""
        try:
            envelope = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise AIPredictorError("Gemini API response is not valid JSON.") from exc

        if isinstance(envelope, dict) and envelope.get("error"):
            message = envelope["error"].get("message", "unknown error")
            raise AIPredictorError(f"Gemini API error: {message}")

        try:
            text = envelope["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AIPredictorError("Gemini API response is missing candidate content.") from exc

        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, TypeError) as exc:
            raise AIPredictorError("Gemini model output is not valid JSON.") from exc
        return parsed


def get_predictor() -> AIPredictor:
    """Factory used by the API layer (keeps endpoint code provider-agnostic)."""
    return GeminiProvider()
