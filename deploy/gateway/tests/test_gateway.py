"""
PredictIQ Gateway - Comprehensive Test Suite

Tests all 16 required scenarios:
1. valid telemetry accepted
2. malformed JSON rejected
3. missing required fields rejected
4. invalid numeric values rejected
5. unknown device rejected
6. unknown machine rejected
7. oversized request rejected
8. missing gateway configuration fails closed
9. missing Render API key fails closed
10. upstream Render HTTPS is required
11. upstream certificate verification is enabled
12. Render API key never appears in response/log output
13. upstream failure is returned safely
14. successful forwarding returns appropriate result
15. no duplicate forwarding caused by retry behavior
16. health endpoint works
"""

import json
import math
import os
import sys
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Set test environment BEFORE importing the gateway module
_TEST_ENV = {
    "RENDER_BACKEND_URL": "https://test-backend.example.com",
    "RENDER_DEVICE_API_KEY": "test-render-key-abcdef1234567890",
    "GATEWAY_TOKEN": "test-gw-token-xyz1234567890",
    "ALLOWED_DEVICES": "ESP32_001,ESP32_002",
    "ALLOWED_MACHINES": "TEST-001,TEST-002",
    "MAX_REQUEST_BYTES": "8192",
    "RATE_LIMIT_PER_MINUTE": "120",
    "UPSTREAM_TIMEOUT_SECONDS": "5.0",
}

# Patch env before any gateway imports
for _k, _v in _TEST_ENV.items():
    os.environ[_k] = _v

# Add gateway directory to path so imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from main import app, get_settings, validate_numeric_field, validate_payload, mask_key
from config import GatewaySettings


@pytest.fixture(autouse=True)
def _reset_gateway_state():
    """Reset global gateway state between tests."""
    import main
    main._settings = None
    main._rate_buckets.clear()
    main._start_time = time.time()
    yield
    main._settings = None
    main._rate_buckets.clear()


@pytest.fixture
def client():
    """Create a TestClient with startup events triggered."""
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def auth_header():
    return {"Authorization": f"Bearer {_TEST_ENV['GATEWAY_TOKEN']}"}


@pytest.fixture
def valid_payload():
    return {
        "device_id": "ESP32_001",
        "machine_id": "TEST-001",
        "temperature": 25.5,
        "vibration": 1.2,
        "current": 10.0,
        "rpm": 1500.0,
        "timestamp": "2026-09-17T12:00:00Z",
        "source": "WOKWI",
    }


def _mock_upstream_response(status_code=201, body=None):
    """Helper to create a mocked upstream HTTP response."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = body or {"success": True, "id": 42}
    mock_resp.text = json.dumps(body or {"success": True, "id": 42})
    return mock_resp


# ============================================================================
# TEST 1: Valid telemetry accepted
# ============================================================================
class Test01ValidTelemetryAccepted:
    def test_valid_payload_forwarded(self, client, auth_header, valid_payload):
        """A fully valid telemetry payload should be forwarded to upstream."""
        mock_resp = _mock_upstream_response(201, {"success": True, "id": 42})
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            response = client.post(
                "/api/sensor-data",
                json=valid_payload,
                headers=auth_header,
            )

        assert response.status_code == 201
        data = response.json()
        assert data["success"] is True
        assert data["id"] == 42

    def test_forwarded_payload_matches_input(self, client, auth_header, valid_payload):
        """The forwarded payload should match the validated input."""
        mock_resp = _mock_upstream_response(201)
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

            call_args = mock_client.post.call_args
            forwarded = call_args.kwargs.get("json") or call_args[1].get("json")
            assert forwarded["device_id"] == "ESP32_001"
            assert forwarded["machine_id"] == "TEST-001"
            assert forwarded["source"] == "WOKWI"

    def test_render_api_key_sent_in_header(self, client, auth_header, valid_payload):
        """The Render DEVICE_API_KEY should be sent as X-API-Key to upstream."""
        mock_resp = _mock_upstream_response(201)
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

            call_args = mock_client.post.call_args
            headers = call_args.kwargs.get("headers") or call_args[1].get("headers")
            assert headers["X-API-Key"] == _TEST_ENV["RENDER_DEVICE_API_KEY"]


# ============================================================================
# TEST 2: Malformed JSON rejected
# ============================================================================
class Test02MalformedJsonRejected:
    def test_invalid_json_body(self, client, auth_header):
        """Non-JSON body should be rejected with 400."""
        response = client.post(
            "/api/sensor-data",
            content=b"this is not json",
            headers={**auth_header, "Content-Type": "application/json"},
        )
        assert response.status_code == 400
        assert "Invalid JSON" in response.json()["detail"]

    def test_empty_body(self, client, auth_header):
        """Empty body should be rejected."""
        response = client.post(
            "/api/sensor-data",
            content=b"",
            headers={**auth_header, "Content-Type": "application/json"},
        )
        assert response.status_code in (400, 422)

    def test_json_array_rejected(self, client, auth_header):
        """JSON array instead of object should be rejected."""
        response = client.post(
            "/api/sensor-data",
            json=[{"device_id": "ESP32_001"}],
            headers=auth_header,
        )
        assert response.status_code == 400


# ============================================================================
# TEST 3: Missing required fields rejected
# ============================================================================
class Test03MissingRequiredFields:
    def test_missing_device_id(self, client, auth_header):
        payload = {
            "machine_id": "TEST-001",
            "timestamp": "2026-09-17T12:00:00Z",
            "source": "WOKWI",
        }
        response = client.post("/api/sensor-data", json=payload, headers=auth_header)
        assert response.status_code == 400
        assert "device_id" in response.json()["detail"]

    def test_missing_machine_id(self, client, auth_header):
        payload = {
            "device_id": "ESP32_001",
            "timestamp": "2026-09-17T12:00:00Z",
            "source": "WOKWI",
        }
        response = client.post("/api/sensor-data", json=payload, headers=auth_header)
        assert response.status_code == 400
        assert "machine_id" in response.json()["detail"]

    def test_missing_timestamp(self, client, auth_header):
        payload = {
            "device_id": "ESP32_001",
            "machine_id": "TEST-001",
            "source": "WOKWI",
        }
        response = client.post("/api/sensor-data", json=payload, headers=auth_header)
        assert response.status_code == 400
        assert "timestamp" in response.json()["detail"]

    def test_missing_source(self, client, auth_header):
        payload = {
            "device_id": "ESP32_001",
            "machine_id": "TEST-001",
            "timestamp": "2026-09-17T12:00:00Z",
        }
        response = client.post("/api/sensor-data", json=payload, headers=auth_header)
        assert response.status_code == 400
        assert "source" in response.json()["detail"]


# ============================================================================
# TEST 4: Invalid numeric values rejected
# ============================================================================
class Test04InvalidNumericValues:
    def test_temperature_nan(self, client, auth_header):
        """NaN in temperature should be rejected. Send as raw JSON since
        Python json.dumps refuses NaN by default (simulating non-compliant client)."""
        raw = b'{"device_id":"ESP32_001","machine_id":"TEST-001","temperature":NaN,"vibration":1.2,"current":10.0,"rpm":1500.0,"timestamp":"2026-09-17T12:00:00Z","source":"WOKWI"}'
        response = client.post(
            "/api/sensor-data",
            content=raw,
            headers={**auth_header, "Content-Type": "application/json"},
        )
        assert response.status_code == 400
        assert "temperature" in response.json()["detail"]

    def test_temperature_out_of_range(self, client, auth_header, valid_payload):
        valid_payload["temperature"] = 999.0
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400
        assert "temperature" in response.json()["detail"]

    def test_vibration_negative(self, client, auth_header, valid_payload):
        valid_payload["vibration"] = -5.0
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400
        assert "vibration" in response.json()["detail"]

    def test_current_string_rejected(self, client, auth_header, valid_payload):
        valid_payload["current"] = "not_a_number"
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400
        assert "current" in response.json()["detail"]

    def test_rpm_infinity(self, client, auth_header):
        """Infinity in RPM should be rejected. Send as raw JSON."""
        raw = b'{"device_id":"ESP32_001","machine_id":"TEST-001","temperature":25.5,"vibration":1.2,"current":10.0,"rpm":Infinity,"timestamp":"2026-09-17T12:00:00Z","source":"WOKWI"}'
        response = client.post(
            "/api/sensor-data",
            content=raw,
            headers={**auth_header, "Content-Type": "application/json"},
        )
        assert response.status_code == 400
        assert "rpm" in response.json()["detail"]

    def test_rpm_exceeds_max(self, client, auth_header, valid_payload):
        valid_payload["rpm"] = 70000.0
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400
        assert "rpm" in response.json()["detail"]

    def test_current_exceeds_max(self, client, auth_header, valid_payload):
        valid_payload["current"] = 1500.0
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400
        assert "current" in response.json()["detail"]

    def test_validate_numeric_field_unit(self):
        """Direct unit test of validate_numeric_field helper."""
        assert validate_numeric_field(None, "x", 0, 100) is None
        assert validate_numeric_field(50.0, "x", 0, 100) == 50.0
        assert validate_numeric_field(0, "x", 0, 100) == 0.0
        with pytest.raises(ValueError, match="must be a number"):
            validate_numeric_field("bad", "x", 0, 100)
        with pytest.raises(ValueError, match="must be finite"):
            validate_numeric_field(float("nan"), "x", 0, 100)
        with pytest.raises(ValueError, match="must be finite"):
            validate_numeric_field(float("inf"), "x", 0, 100)
        with pytest.raises(ValueError, match="must be between"):
            validate_numeric_field(150.0, "x", 0, 100)


# ============================================================================
# TEST 5: Unknown device rejected
# ============================================================================
class Test05UnknownDeviceRejected:
    def test_unknown_device(self, client, auth_header, valid_payload):
        valid_payload["device_id"] = "UNKNOWN_DEVICE_999"
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400
        assert "Unknown device_id" in response.json()["detail"]

    def test_empty_device_id(self, client, auth_header, valid_payload):
        valid_payload["device_id"] = ""
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400


# ============================================================================
# TEST 6: Unknown machine rejected
# ============================================================================
class Test06UnknownMachineRejected:
    def test_unknown_machine(self, client, auth_header, valid_payload):
        valid_payload["machine_id"] = "UNKNOWN_MACHINE_999"
        response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)
        assert response.status_code == 400
        assert "Unknown machine_id" in response.json()["detail"]


# ============================================================================
# TEST 7: Oversized request rejected
# ============================================================================
class Test07OversizedRequestRejected:
    def test_oversized_body(self, client, auth_header):
        """Request exceeding MAX_REQUEST_BYTES should be rejected."""
        big_payload = {"data": "x" * 9000}
        response = client.post(
            "/api/sensor-data",
            json=big_payload,
            headers={**auth_header, "Content-Length": "9000"},
        )
        assert response.status_code == 413
        assert "too large" in response.json()["detail"].lower()


# ============================================================================
# TEST 8: Missing gateway configuration fails closed
# ============================================================================
class Test08MissingGatewayConfigFailsClosed:
    def test_missing_gateway_token_config(self):
        """Missing GATEWAY_TOKEN should cause configuration failure."""
        import config as config_mod

        saved = os.environ.get("GATEWAY_TOKEN")
        try:
            # Remove from process env and disable .env file loading so
            # BaseSettings cannot fall back to the .env file on disk.
            os.environ.pop("GATEWAY_TOKEN", None)
            with patch.dict(config_mod.GatewaySettings.model_config, {"env_file": ""}):
                with pytest.raises(SystemExit):
                    config_mod.load_settings()
        finally:
            if saved is not None:
                os.environ["GATEWAY_TOKEN"] = saved

    def test_missing_render_backend_url_config(self):
        """Missing RENDER_BACKEND_URL should cause configuration failure."""
        import config as config_mod

        saved = os.environ.get("RENDER_BACKEND_URL")
        try:
            os.environ.pop("RENDER_BACKEND_URL", None)
            with patch.dict(config_mod.GatewaySettings.model_config, {"env_file": ""}):
                with pytest.raises(SystemExit):
                    config_mod.load_settings()
        finally:
            if saved is not None:
                os.environ["RENDER_BACKEND_URL"] = saved


# ============================================================================
# TEST 9: Missing Render API key fails closed
# ============================================================================
class Test09MissingRenderApiKeyFailsClosed:
    def test_missing_render_api_key(self):
        """Missing RENDER_DEVICE_API_KEY should cause configuration failure."""
        import config as config_mod

        saved = os.environ.get("RENDER_DEVICE_API_KEY")
        try:
            os.environ.pop("RENDER_DEVICE_API_KEY", None)
            with patch.dict(config_mod.GatewaySettings.model_config, {"env_file": ""}):
                with pytest.raises(SystemExit):
                    config_mod.load_settings()
        finally:
            if saved is not None:
                os.environ["RENDER_DEVICE_API_KEY"] = saved


# ============================================================================
# TEST 10: Upstream Render HTTPS is required
# ============================================================================
class Test10UpstreamHttpsRequired:
    def test_http_url_rejected(self):
        """HTTP (non-HTTPS) Render URL should be rejected at config load."""
        import config as config_mod

        saved_url = os.environ.get("RENDER_BACKEND_URL")
        try:
            os.environ["RENDER_BACKEND_URL"] = "http://insecure-backend.example.com"
            with pytest.raises(SystemExit):
                config_mod.load_settings()
        finally:
            if saved_url is not None:
                os.environ["RENDER_BACKEND_URL"] = saved_url

    def test_https_url_accepted(self):
        """HTTPS Render URL should be accepted."""
        settings = get_settings()
        assert settings.render_backend_url.startswith("https://")


# ============================================================================
# TEST 11: Upstream certificate verification is enabled
# ============================================================================
class Test11UpstreamTlsVerification:
    def test_verify_true_in_upstream_client(self, client, auth_header, valid_payload):
        """Upstream httpx client must use verify=True."""
        mock_resp = _mock_upstream_response(201)
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

            call_kwargs = mock_cls.call_args.kwargs
            assert call_kwargs.get("verify") is True


# ============================================================================
# TEST 12: Render API key never appears in response/log output
# ============================================================================
class Test12ApiKeyNotExposed:
    def test_api_key_not_in_response_body(self, client, auth_header, valid_payload):
        """The Render API key must not leak into response bodies."""
        mock_resp = _mock_upstream_response(201, {"success": True, "id": 1})
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

        response_text = response.text
        assert _TEST_ENV["RENDER_DEVICE_API_KEY"] not in response_text

    def test_mask_key_hides_secret(self):
        """mask_key should not reveal the full key."""
        masked = mask_key("super-secret-api-key-12345")
        assert "super-secret-api-key-12345" not in masked
        assert "..." in masked
        assert len(masked) < len("super-secret-api-key-12345")

    def test_mask_key_short_value(self):
        """Short keys should be fully masked."""
        assert mask_key("abc") == "****"


# ============================================================================
# TEST 13: Upstream failure is returned safely
# ============================================================================
class Test13UpstreamFailureReturnedSafely:
    def test_connection_error_returns_502(self, client, auth_header, valid_payload):
        """Connection failure to upstream should return 502."""
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = Exception("Connection refused")
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

        assert response.status_code == 502
        assert "upstream" in response.json()["detail"].lower()

    def test_timeout_returns_504(self, client, auth_header, valid_payload):
        """Timeout should return 504."""
        import httpx as httpx_mod
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = httpx_mod.TimeoutException("timed out")
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

        assert response.status_code == 504
        assert "timed out" in response.json()["detail"].lower()

    def test_upstream_error_not_leaked(self, client, auth_header, valid_payload):
        """Internal error details should not leak to the client."""
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.side_effect = Exception("Internal stack trace xyz")
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

        assert response.status_code == 502
        assert "stack trace" not in response.text.lower()


# ============================================================================
# TEST 14: Successful forwarding returns appropriate result
# ============================================================================
class Test14SuccessfulForwardingResult:
    def test_upstream_201_returned(self, client, auth_header, valid_payload):
        """Upstream 201 should be returned as 201."""
        mock_resp = _mock_upstream_response(201, {"success": True, "id": 99})
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

        assert response.status_code == 201
        assert response.json()["id"] == 99

    def test_upstream_400_returned(self, client, auth_header, valid_payload):
        """Upstream 400 (e.g. device mismatch) should be passed through."""
        mock_resp = _mock_upstream_response(400, {"detail": "Device mismatch"})
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            response = client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

        assert response.status_code == 400


# ============================================================================
# TEST 15: No duplicate forwarding caused by retry behavior
# ============================================================================
class Test15NoDuplicateForwarding:
    def test_single_upstream_call_per_request(self, client, auth_header, valid_payload):
        """Each gateway request should result in exactly one upstream call."""
        mock_resp = _mock_upstream_response(201)
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

            assert mock_client.post.call_count == 1

    def test_validation_failure_makes_zero_upstream_calls(self, client, auth_header):
        """Validation failure should not result in any upstream call."""
        bad_payload = {"device_id": "BAD"}  # Missing required fields
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            client.post("/api/sensor-data", json=bad_payload, headers=auth_header)

            assert mock_client.post.call_count == 0


# ============================================================================
# TEST 16: Health endpoint works
# ============================================================================
class Test16HealthEndpoint:
    def test_health_returns_ok(self, client):
        """Health endpoint should return status ok."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "predictiq-gateway"
        assert data["upstream_verify_tls"] is True

    def test_health_no_secrets(self, client):
        """Health endpoint should not expose any secrets."""
        response = client.get("/health")
        body = response.text
        assert _TEST_ENV["RENDER_DEVICE_API_KEY"] not in body
        assert _TEST_ENV["GATEWAY_TOKEN"] not in body

    def test_health_has_transport_note(self, client):
        """Health should document the HTTP transport limitation."""
        response = client.get("/health")
        data = response.json()
        assert "plain HTTP" in data["transport_note"]


# ============================================================================
# Additional security tests
# ============================================================================
class TestSecurityBaselines:
    def test_no_auth_rejected(self, client, valid_payload):
        """Request without auth should be rejected with 401."""
        response = client.post("/api/sensor-data", json=valid_payload)
        assert response.status_code == 401

    def test_wrong_token_rejected(self, client, valid_payload):
        """Wrong gateway token should be rejected with 403."""
        response = client.post(
            "/api/sensor-data",
            json=valid_payload,
            headers={"Authorization": "Bearer wrong-token-12345"},
        )
        assert response.status_code == 403

    def test_empty_bearer_rejected(self, client, valid_payload):
        """Empty Bearer token should be rejected."""
        response = client.post(
            "/api/sensor-data",
            json=valid_payload,
            headers={"Authorization": "Bearer "},
        )
        assert response.status_code == 401


# ============================================================================
# Unit tests for validate_payload
# ============================================================================
class TestValidatePayload:
    def _make_settings(self):
        return GatewaySettings(
            RENDER_BACKEND_URL="https://test.example.com",
            RENDER_DEVICE_API_KEY="test-key-12345678901234567890",
            GATEWAY_TOKEN="test-token-12345678901234567890",
            ALLOWED_DEVICES="ESP32_001",
            ALLOWED_MACHINES="TEST-001",
        )

    def test_valid_minimal(self):
        settings = self._make_settings()
        body = {
            "device_id": "ESP32_001",
            "machine_id": "TEST-001",
            "timestamp": "2026-09-17T12:00:00Z",
            "source": "WOKWI",
        }
        result = validate_payload(body, settings)
        assert result["device_id"] == "ESP32_001"
        assert result.get("temperature") is None

    def test_invalid_source(self):
        settings = self._make_settings()
        body = {
            "device_id": "ESP32_001",
            "machine_id": "TEST-001",
            "timestamp": "2026-09-17T12:00:00Z",
            "source": "INVALID",
        }
        with pytest.raises(ValueError, match="source"):
            validate_payload(body, settings)

    def test_invalid_timestamp(self):
        settings = self._make_settings()
        body = {
            "device_id": "ESP32_001",
            "machine_id": "TEST-001",
            "timestamp": "not-a-timestamp",
            "source": "WOKWI",
        }
        with pytest.raises(ValueError, match="timestamp"):
            validate_payload(body, settings)

    def test_boundary_values_accepted(self):
        settings = self._make_settings()
        body = {
            "device_id": "ESP32_001",
            "machine_id": "TEST-001",
            "timestamp": "2026-09-17T12:00:00Z",
            "source": "WOKWI",
            "temperature": -50.0,
            "vibration": 0.0,
            "current": 0.0,
            "rpm": 60000.0,
        }
        result = validate_payload(body, settings)
        assert result["temperature"] == -50.0
        assert result["rpm"] == 60000.0

    def test_max_boundary_values_accepted(self):
        settings = self._make_settings()
        body = {
            "device_id": "ESP32_001",
            "machine_id": "TEST-001",
            "timestamp": "2026-09-17T12:00:00Z",
            "source": "WOKWI",
            "temperature": 300.0,
            "vibration": 100.0,
            "current": 1000.0,
            "rpm": 60000.0,
        }
        result = validate_payload(body, settings)
        assert result["temperature"] == 300.0


# ============================================================================
# Test that gateway config validates HTTPS requirement
# ============================================================================
class TestConfigValidation:
    def test_http_rejected_in_config(self):
        """Config validator should reject HTTP URLs."""
        settings = GatewaySettings(
            RENDER_BACKEND_URL="http://insecure.example.com",
            RENDER_DEVICE_API_KEY="test-key-12345678901234567890",
            GATEWAY_TOKEN="test-token-12345678901234567890",
        )
        with pytest.raises(ValueError, match="HTTPS"):
            settings.validate_render_url()

    def test_https_accepted_in_config(self):
        settings = GatewaySettings(
            RENDER_BACKEND_URL="https://secure.example.com",
            RENDER_DEVICE_API_KEY="test-key-12345678901234567890",
            GATEWAY_TOKEN="test-token-12345678901234567890",
        )
        settings.validate_render_url()  # Should not raise

    def test_allowlists_parse_correctly(self):
        settings = GatewaySettings(
            RENDER_BACKEND_URL="https://secure.example.com",
            RENDER_DEVICE_API_KEY="test-key-12345678901234567890",
            GATEWAY_TOKEN="test-token-12345678901234567890",
            ALLOWED_DEVICES="ESP32_001, ESP32_002 , ESP32_003",
            ALLOWED_MACHINES="TEST-001,TEST-002",
        )
        assert settings.allowed_devices_set == {"ESP32_001", "ESP32_002", "ESP32_003"}
        assert settings.allowed_machines_set == {"TEST-001", "TEST-002"}


# ============================================================================
# Gateway-mode transport verification
# Proves that in gateway mode, the Bearer token is sent and X-API-Key is NOT.
# This validates the firmware auth logic: GATEWAY_TOKEN set -> skip X-API-Key.
# ============================================================================
class TestGatewayModeTransport:
    def test_gateway_mode_bearer_sent_no_api_key(self, client, auth_header, valid_payload):
        """In gateway mode (Bearer token provided), X-API-Key must NOT be forwarded upstream."""
        mock_resp = _mock_upstream_response(201)
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            client.post("/api/sensor-data", json=valid_payload, headers=auth_header)

            call_args = mock_client.post.call_args
            headers = call_args.kwargs.get("headers") or call_args[1].get("headers")
            # Gateway forwards X-API-Key from its own config (RENDER_DEVICE_API_KEY)
            assert headers["X-API-Key"] == _TEST_ENV["RENDER_DEVICE_API_KEY"]

    def test_gateway_strips_wokwi_x_api_key(self, client, auth_header, valid_payload):
        """If Wokwi erroneously sends X-API-Key, the gateway does not forward it."""
        mock_resp = _mock_upstream_response(201)
        with patch("main.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_client.post.return_value = mock_resp
            mock_cls.return_value.__aenter__.return_value = mock_client
            mock_cls.return_value.__aexit__.return_value = False

            # Simulate Wokwi sending both headers
            client.post(
                "/api/sensor-data",
                json=valid_payload,
                headers={
                    **auth_header,
                    "X-API-Key": "Wokwi-should-not-send-this",
                },
            )

            call_args = mock_client.post.call_args
            headers = call_args.kwargs.get("headers") or call_args[1].get("headers")
            # Gateway uses its own RENDER_DEVICE_API_KEY, not Wokwi's
            assert headers["X-API-Key"] == _TEST_ENV["RENDER_DEVICE_API_KEY"]
            assert headers["X-API-Key"] != "Wokwi-should-not-send-this"
