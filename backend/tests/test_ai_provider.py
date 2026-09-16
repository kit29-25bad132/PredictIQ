"""
External Gemini predictive-analysis tests (POST /api/predictions/analyze).

EVERY Gemini interaction is mocked: no test ever touches the network or the
real Gemini API. The GeminiProvider transport (_post_json) is blocked by a
function-scoped autouse fixture: unless a test installs a fake transport, any
HTTP attempt raises immediately.

Coverage:
- device+machine telemetry isolation and latest-reading selection
- fail-closed behavior (missing key) and provider failures (HTTP error,
  timeout, malformed JSON, invalid assessment fields) with NO row persisted
- strict assessment validation (ranges, enums, non-empty strings)
- provenance (source/provider/model/input_timestamp/inference_input_hash)
- deterministic idempotency (same input => same single row, replay 200)
- train-model insufficient-ground-truth refusal remains unchanged
"""

import hashlib
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import Machine, Prediction, SensorReading
from backend.app.main import app
from backend.app.services.ai_provider import (
    AIPredictorError,
    GeminiProvider,
    TelemetryInput,
    build_inference_input,
    validate_assessment,
)

TEST_KEY = "test-write-key-12345"
MODEL_ID = "gemini:gemini-2.5-flash"


# ============================================================================
# Fixtures & helpers
# ============================================================================

VALID_ASSESSMENT = {
    "failure_probability": 0.42,
    "health_status": "warning",
    "likely_component": "Drive-end bearing",
    "severity": "minor",
    "explanation": "Vibration trending upward against the machine limit.",
    "recommended_action": "Schedule bearing inspection within 7 days.",
    "confidence": 0.77,
}


def gemini_envelope(assessment) -> dict:
    """A well-formed Gemini generateContent response wrapping the given assessment."""
    return {
        "candidates": [
            {"content": {"parts": [{"text": json.dumps({"assessment": assessment})}]}}
        ]
    }


@pytest.fixture(autouse=True)
def blocked_transport():
    """Default-deny for the provider transport: tests must never hit the network.

    Unless a test installs its own fake via _patch_transport, any Gemini HTTP
    attempt raises AIPredictorError immediately (never a real request).
    """
    def _deny(self, url, body):  # pragma: no cover - safety net
        raise AIPredictorError("Blocked in tests: GeminiProvider._post_json must be mocked.")

    original = GeminiProvider._post_json
    GeminiProvider._post_json = _deny  # type: ignore[method-assign]
    yield
    GeminiProvider._post_json = original  # type: ignore[method-assign]


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db():
        with factory() as db:
            yield db

    get_settings().device_api_key = TEST_KEY
    # Pin the model so tests are hermetic: a developer's local .env may set
    # GEMINI_MODEL (e.g. to the production gemini-3.6-flash) and must not
    # change which literals these tests assert on.
    get_settings().gemini_model = "gemini-2.5-flash"
    auth_module._WARNED_UNCONFIGURED = False
    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), factory
    finally:
        get_settings().device_api_key = ""
        get_settings().gemini_api_key = ""
        get_settings().gemini_model = ""
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


def seed_machine(
    factory,
    machine_id="TEST-001",
    with_readings=True,
    device_id="ESP32_001",
    temperature=78.5,
    vibration=5.1,
    current=11.2,
    rpm=1500.0,
    timestamp=datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc),
    reading_count=1,
):
    """Seed a machine (once) and its readings. Readings are offset by minutes."""
    with factory() as db:
        exists = db.query(Machine).filter(Machine.machine_id == machine_id).first()
        if not exists:
            db.add(
                Machine(
                    machine_id=machine_id,
                    name=f"Machine {machine_id}",
                    type="Centrifugal Pump",
                    location="Bay 1",
                    max_temp=75.0,
                    max_vibration=4.5,
                    rated_current=10.0,
                    rated_rpm=1450.0,
                )
            )
            db.commit()
        for offset in range(reading_count if with_readings else 0):
            db.add(
                SensorReading(
                    machine_id=machine_id,
                    device_id=device_id,
                    timestamp=datetime.fromtimestamp(
                        timestamp.timestamp() + 60 * offset, tz=timezone.utc
                    ),
                    temperature=temperature,
                    vibration=vibration,
                    current=current,
                    rpm=rpm,
                    source="WOKWI",
                )
            )
        db.commit()


def analyze(client, device_id="ESP32_001", machine_id="TEST-001"):
    return client.post(
        "/api/predictions/analyze",
        json={"device_id": device_id, "machine_id": machine_id},
        headers={"X-API-Key": TEST_KEY},
    )


_ORIGINAL_ANALYZE = GeminiProvider.analyze_telemetry


def _patch_analyze(fake_method):
    GeminiProvider.analyze_telemetry = fake_method  # type: ignore[method-assign]


def _unpatch_analyze():
    GeminiProvider.analyze_telemetry = _ORIGINAL_ANALYZE  # type: ignore[method-assign]


def _patch_transport(fake_method):
    GeminiProvider._post_json = fake_method  # type: ignore[method-assign]


def _unpatch_transport():
    GeminiProvider._post_json = GeminiProvider.__dict__["_post_json"]  # type: ignore[method-assign]


def _always_valid(self, telemetry):
    return validate_assessment({"assessment": VALID_ASSESSMENT})


# ============================================================================
# 1. Provider unit behavior (no HTTP anywhere)
# ============================================================================

class TestGeminiProviderConfig:
    # Settings state is mutated only through monkeypatch so the cached
    # get_settings() instance is restored after every test (no leakage).

    def test_missing_api_key_fails_closed(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "gemini_api_key", "")
        provider = GeminiProvider()
        with pytest.raises(AIPredictorError, match="GEMINI_API_KEY"):
            provider.analyze_telemetry(
                TelemetryInput("D", "M", "2026-01-01T00:00:00+00:00", 1, 2, 3, 4)
            )

    def test_model_identifier_uses_configured_model(self, monkeypatch):
        monkeypatch.setattr(get_settings(), "gemini_api_key", "k")
        monkeypatch.setattr(get_settings(), "gemini_model", "gemini-test-model")
        assert GeminiProvider().model_identifier == "gemini:gemini-test-model"

    def test_transport_block_fixture_actually_blocks(self, monkeypatch):
        """Proves the autouse fixture denies network attempts (fail the suite otherwise)."""
        monkeypatch.setattr(get_settings(), "gemini_api_key", "k")
        with pytest.raises(AIPredictorError, match="Blocked in tests"):
            GeminiProvider().analyze_telemetry(
                TelemetryInput("D", "M", "2026-01-01T00:00:00+00:00", 1, 2, 3, 4)
            )


class TestAssessmentValidation:
    def _valid(self, **overrides):
        return {**VALID_ASSESSMENT, **overrides}

    def test_valid_assessment_is_accepted(self):
        result = validate_assessment({"assessment": VALID_ASSESSMENT})
        assert result.failure_probability == 0.42
        assert result.health_status == "warning"
        assert result.severity == "minor"

    @pytest.mark.parametrize(
        "overrides",
        [
            {"failure_probability": -0.01},
            {"failure_probability": 1.01},
            {"confidence": -0.1},
            {"confidence": 1.5},
        ],
    )
    def test_out_of_range_numbers_are_rejected(self, overrides):
        with pytest.raises(AIPredictorError):
            validate_assessment({"assessment": self._valid(**overrides)})

    @pytest.mark.parametrize("value", ["warning ", "CRITICAL", "faulted2", None, 3])
    def test_invalid_health_status_is_rejected(self, value):
        with pytest.raises(AIPredictorError, match="health_status"):
            validate_assessment({"assessment": self._valid(health_status=value)})

    @pytest.mark.parametrize("value", ["Minor", "severe", "none", None, 2.5])
    def test_invalid_severity_is_rejected(self, value):
        with pytest.raises(AIPredictorError, match="severity"):
            validate_assessment({"assessment": self._valid(severity=value)})

    @pytest.mark.parametrize("field", ["likely_component", "explanation", "recommended_action"])
    @pytest.mark.parametrize("value", ["", "   ", None, 7])
    def test_empty_or_non_string_fields_are_rejected(self, field, value):
        with pytest.raises(AIPredictorError, match=field):
            validate_assessment({"assessment": self._valid(**{field: value})})

    @pytest.mark.parametrize("field", ["failure_probability", "confidence"])
    @pytest.mark.parametrize("value", ["0.5", None, True])
    def test_non_numeric_scalars_are_rejected(self, field, value):
        with pytest.raises(AIPredictorError, match=field):
            validate_assessment({"assessment": self._valid(**{field: value})})

    def test_missing_assessment_object_is_rejected(self):
        with pytest.raises(AIPredictorError, match="assessment"):
            validate_assessment({"result": VALID_ASSESSMENT})

    def test_non_object_payload_is_rejected(self):
        with pytest.raises(AIPredictorError):
            validate_assessment([VALID_ASSESSMENT])


# ============================================================================
# 2. Analyze endpoint: isolation, latest selection, persistence, provenance
# ============================================================================

class TestAnalyzeEndpoint:
    def test_valid_analyze_persists_assessment_with_provenance(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)
        _patch_analyze(_always_valid)
        try:
            response = analyze(testclient)
            assert response.status_code == 201, response.text
            body = response.json()
            assert body["source"] == "external_ai"
            assert body["provider"] == "gemini"
            assert body["model_version"] == MODEL_ID
            assert body["device_id"] == "ESP32_001"
            assert body["machine_id"] == "TEST-001"
            assert body["health_status"] == "warning"
            assert body["severity"] == "minor"
            assert body["failure_probability"] == 0.42
            assert body["confidence"] == 0.77
            # Real telemetry timestamp, not wall clock.
            assert body["input_timestamp"].startswith("2026-03-01T12:00:00")
            assert len(body["inference_input_hash"]) == 64

            with factory() as db:
                stored = db.query(Prediction).one()
                assert stored.model_version == MODEL_ID
                assert stored.is_prototype is False
                data = json.loads(stored.explanation_data)
                assert data["source"] == "external_ai"
                assert data["provider"] == "gemini"
                assert data["model"] == "gemini-2.5-flash"
                assert data["input_timestamp"].startswith("2026-03-01T12:00:00")
                assert data["inference_input_hash"] == body["inference_input_hash"]
        finally:
            _unpatch_analyze()

    def test_requires_authentication(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)
        response = testclient.post(
            "/api/predictions/analyze", json={"device_id": "ESP32_001", "machine_id": "TEST-001"}
        )
        assert response.status_code == 401

    def test_unknown_machine_returns_404(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)
        response = analyze(testclient, machine_id="GHOST")
        assert response.status_code == 404

    def test_no_telemetry_for_exact_pair_returns_404(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory, with_readings=False)
        response = analyze(testclient)
        assert response.status_code == 404

    def test_cross_machine_telemetry_isolation(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)  # ESP32_001 @ TEST-001 (readings)
        seed_machine(factory, machine_id="OTHER-001", device_id="ESP32_002")  # readings
        seed_machine(factory, machine_id="THIRD-001", with_readings=False)  # NO readings

        # ESP32_001 is bound to TEST-001 only; asking for it on THIRD-001 must 404
        # and must NOT fall back to the ESP32_001/TEST-001 telemetry.
        response = analyze(testclient, device_id="ESP32_001", machine_id="THIRD-001")
        assert response.status_code == 404
        _patch_analyze(_always_valid)
        try:
            ok = analyze(testclient, device_id="ESP32_002", machine_id="OTHER-001")
            assert ok.status_code == 201
            assert ok.json()["machine_id"] == "OTHER-001"
        finally:
            _unpatch_analyze()

    def test_latest_reading_is_selected(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(
            factory,
            reading_count=3,
            timestamp=datetime(2026, 3, 1, 10, 0, 0, tzinfo=timezone.utc),
        )
        captured = {}

        def capture(self, telemetry):
            captured["telemetry"] = telemetry
            return _always_valid(self, telemetry)

        _patch_analyze(capture)
        try:
            response = analyze(testclient)
            assert response.status_code == 201
            assert captured["telemetry"].timestamp == "2026-03-01T10:02:00+00:00"
        finally:
            _unpatch_analyze()

    def test_inference_input_hash_is_deterministic_and_matches_input(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)
        _patch_analyze(_always_valid)
        try:
            body = analyze(testclient).json()
            expected_input = build_inference_input(
                TelemetryInput(
                    device_id="ESP32_001",
                    machine_id="TEST-001",
                    timestamp="2026-03-01T12:00:00+00:00",
                    temperature=78.5,
                    vibration=5.1,
                    current=11.2,
                    rpm=1500.0,
                    machine_type="Centrifugal Pump",
                    machine_status="Healthy",
                    max_temp=75.0,
                    max_vibration=4.5,
                    rated_current=10.0,
                    rated_rpm=1450.0,
                )
            )
            expected_hash = hashlib.sha256(
                json.dumps(expected_input, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
            assert body["inference_input_hash"] == expected_hash
        finally:
            _unpatch_analyze()


# ============================================================================
# 3. Fail-safe behavior: provider errors never persist anything
# ============================================================================

class TestFailSafe:
    def _row_count(self, factory) -> int:
        with factory() as db:
            return db.query(Prediction).count()

    def test_missing_gemini_key_returns_error_and_no_row(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = ""
        seed_machine(factory)
        response = analyze(testclient)
        assert response.status_code == 502
        assert "GEMINI_API_KEY" in response.json()["detail"]
        assert self._row_count(factory) == 0

    def test_invalid_api_key_http_error_returns_502_and_no_row(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "wrong-key"
        seed_machine(factory)

        def http_400(self, url, body):
            raise AIPredictorError("Gemini API returned HTTP 400.")

        _patch_transport(http_400)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert "HTTP 400" in response.json()["detail"]
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

    def test_provider_timeout_returns_502_and_no_row(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        def timeout(self, url, body):
            raise AIPredictorError("Gemini API request timed out.")

        _patch_transport(timeout)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert "timed out" in response.json()["detail"].lower()
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

    def test_provider_network_error_returns_502_and_no_row(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        def network_error(self, url, body):
            raise AIPredictorError("Gemini API unreachable: connection refused")

        _patch_transport(network_error)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

    def test_malformed_gemini_json_returns_502_and_no_row(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        def malformed_text(self, url, body):
            return "this is not json at all"

        _patch_transport(malformed_text)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert "not valid JSON" in response.json()["detail"]
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

    def test_gemini_error_envelope_returns_502_and_no_row(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        def error_envelope(self, url, body):
            return json.dumps({"error": {"code": 429, "message": "Resource exhausted"}})

        _patch_transport(error_envelope)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert "Resource exhausted" in response.json()["detail"]
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

    def test_malformed_envelope_missing_candidates_returns_502(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        def empty_envelope(self, url, body):
            return json.dumps({"candidates": []})

        _patch_transport(empty_envelope)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert "missing candidate content" in response.json()["detail"]
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

    @pytest.mark.parametrize(
        "overrides",
        [
            {"failure_probability": 1.2},
            {"failure_probability": -0.2},
            {"confidence": 7},
            {"confidence": -0.01},
            {"health_status": "exploded"},
            {"severity": "apocalyptic"},
            {"likely_component": ""},
            {"explanation": None},
        ],
    )
    def test_invalid_ai_output_is_rejected_without_persistence(self, client, overrides):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)
        bad = {**VALID_ASSESSMENT, **overrides}

        def bad_output(self, url, body):
            return json.dumps(gemini_envelope(bad))

        _patch_transport(bad_output)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

        # And validate_assessment itself rejects each of these payloads.
        with pytest.raises(AIPredictorError):
            validate_assessment({"assessment": bad})

    def test_truncated_model_json_returns_502_and_no_row(self, client):
        """Production-blocker regression: an exhausted output/thinking budget
        truncates the model text mid-JSON; it must fail safely with no row."""
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        def truncated_text(self, url, body):
            return '{"assessment": {"failure_probability": 0.4'

        _patch_transport(truncated_text)
        try:
            response = analyze(testclient)
            assert response.status_code == 502
            assert "not valid JSON" in response.json()["detail"]
            assert self._row_count(factory) == 0
        finally:
            _unpatch_transport()

    def test_boolean_in_numeric_field_is_rejected(self):
        """Booleans masquerading as numbers must fail strict validation."""
        bad_probability = {**VALID_ASSESSMENT, "failure_probability": True}
        with pytest.raises(AIPredictorError, match="failure_probability"):
            validate_assessment({"assessment": bad_probability})
        bad_confidence = {**VALID_ASSESSMENT, "confidence": False}
        with pytest.raises(AIPredictorError, match="confidence"):
            validate_assessment({"assessment": bad_confidence})

    def test_absent_required_field_is_rejected(self):
        """A missing (absent, not just null) required field must fail."""
        bad = {k: v for k, v in VALID_ASSESSMENT.items() if k != "recommended_action"}
        with pytest.raises(AIPredictorError, match="recommended_action"):
            validate_assessment({"assessment": bad})


# ============================================================================
# 4. Idempotency
# ============================================================================

class TestIdempotency:
    def test_repeated_analysis_does_not_duplicate_rows(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        calls = []

        def counting(self, telemetry):
            calls.append(1)
            return _always_valid(self, telemetry)

        _patch_analyze(counting)
        try:
            first = analyze(testclient)
            second = analyze(testclient)
            assert first.status_code == 201
            assert second.status_code == 200  # replay, not a new creation
            assert first.json()["id"] == second.json()["id"]
            assert len(calls) == 1
        finally:
            _unpatch_analyze()

        with factory() as db:
            assert db.query(Prediction).count() == 1

    def test_new_telemetry_creates_a_new_prediction(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory, reading_count=1)

        _patch_analyze(_always_valid)
        try:
            first = analyze(testclient)
            assert first.status_code == 201
        finally:
            _unpatch_analyze()

        # Newer telemetry arrives => input changes => a new analysis is allowed.
        seed_machine(
            factory,
            temperature=95.0,
            timestamp=datetime(2026, 3, 1, 13, 0, 0, tzinfo=timezone.utc),
        )
        _patch_analyze(_always_valid)
        try:
            second = analyze(testclient)
            assert second.status_code == 201
            assert second.json()["id"] != first.json()["id"]
        finally:
            _unpatch_analyze()


# ============================================================================
# 5. Full provider pipeline: real extraction + validation (transport faked)
# ============================================================================

class TestFullProviderPipeline:
    def test_valid_envelope_flows_through_real_parsing_to_persistence(self, client):
        """End-to-end with ONLY the transport faked: the real envelope extraction,
        model-text JSON parsing, and validate_assessment() all execute."""
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)

        captured = {}

        def valid_transport(self, url, body):
            captured["url"] = url
            captured["body"] = body
            return json.dumps(gemini_envelope(VALID_ASSESSMENT))

        _patch_transport(valid_transport)
        try:
            response = analyze(testclient)
        finally:
            _unpatch_transport()

        assert response.status_code == 201, response.text
        # The real request builder produced the official REST URL and prompt.
        assert captured["url"].endswith("/v1beta/models/gemini-2.5-flash:generateContent")
        prompt_text = captured["body"]["contents"][0]["parts"][0]["text"]
        assert "78.5" in prompt_text  # real DB telemetry reached the prompt
        # Response validated through the real path and persisted.
        body = response.json()
        assert body["failure_probability"] == 0.42
        assert body["health_status"] == "warning"
        assert body["provider"] == "gemini"
        with factory() as db:
            stored = db.query(Prediction).one()
            assert stored.model_version == MODEL_ID
            assert json.loads(stored.explanation_data)["provider"] == "gemini"


# ============================================================================
# 6. Request configuration: documented structured-output + thinking contract
# ============================================================================

class TestGeminiRequestContract:
    """The generateContent request body must carry the currently documented
    structured-output and thinking/output-budget configuration (production
    non-JSON-response fix for thinking-default Gemini 3.x Flash)."""

    def _captured_body(self, client):
        testclient, factory = client
        get_settings().gemini_api_key = "test-key"
        seed_machine(factory)
        captured = {}

        def recorder(self, url, body):
            captured["url"] = url
            captured["body"] = body
            return json.dumps(gemini_envelope(VALID_ASSESSMENT))

        _patch_transport(recorder)
        try:
            response = analyze(testclient)
        finally:
            _unpatch_transport()
        assert response.status_code == 201, response.text
        return captured

    def test_request_requires_structured_json_output(self, client):
        body = self._captured_body(client)["body"]
        config = body["generationConfig"]
        assert config["responseMimeType"] == "application/json"
        schema = config["responseSchema"]
        assert schema["type"] == "object"
        assert "assessment" in schema.get("required", [])
        assessment = schema["properties"]["assessment"]
        assert assessment["type"] == "object"
        for field in (
            "failure_probability",
            "health_status",
            "likely_component",
            "severity",
            "explanation",
            "recommended_action",
            "confidence",
        ):
            assert field in assessment["properties"], field
            assert field in assessment.get("required", []), field
        assert assessment["properties"]["health_status"]["enum"] == [
            "healthy", "warning", "faulted", "unknown"
        ]
        assert assessment["properties"]["severity"]["enum"] == [
            "nominal", "minor", "major", "critical"
        ]

    def test_request_uses_documented_thinking_and_output_budget(self, client):
        body = self._captured_body(client)["body"]
        config = body["generationConfig"]
        # Explicit thinking level instead of a small token cap (official docs).
        assert config["thinkingConfig"]["thinkingLevel"] == "low"
        # Enough budget for thinking plus the complete assessment JSON.
        assert config["maxOutputTokens"] >= 2048
        # Sampling parameters deprecated 2026-07-21 must stay absent.
        for deprecated in ("temperature", "topP", "topK"):
            assert deprecated not in config


# ============================================================================
# 7. Regression: train-model refusal unchanged
# ============================================================================

class TestTrainModelUnchanged:
    def test_insufficient_ground_truth_refusal_still_works(self, client):
        testclient, factory = client
        seed_machine(factory, with_readings=False)
        response = testclient.post(
            "/api/train-model", json={}, headers={"X-API-Key": TEST_KEY}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is False
        assert body["refusal"] == "insufficient_labeled_data"
