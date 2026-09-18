"""
PredictIQ Gateway - Edge Transport Adapter

Accepts Wokwi telemetry over plain HTTP (Wokwi TLS limitation) and forwards
validated payloads to the Render backend over HTTPS with full certificate
verification.

Security model:
- Wokwi -> Gateway: application-level GATEWAY_TOKEN (Bearer token)
- Gateway -> Render: RENDER_DEVICE_API_KEY (X-API-Key header, never exposed)
- Gateway validates: JSON structure, required fields, numeric ranges,
  device/machine allowlists, request size
- Gateway does NOT: calculate health, generate predictions, write to database,
  store telemetry permanently

Transport limitation:
- Wokwi -> Gateway is plain HTTP. This is a DEMO/PROVIDE transport path only.
- Gateway -> Render is HTTPS with full TLS certificate verification.
- The Render DEVICE_API_KEY never leaves the gateway server environment.
"""

import json
import logging
import math
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from config import GatewaySettings, load_settings

# ---------------------------------------------------------------------------
# Logging (no secrets)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("predictiq.gateway")

# ---------------------------------------------------------------------------
# Application state
# ---------------------------------------------------------------------------
_settings: Optional[GatewaySettings] = None
_start_time: float = 0.0

# Simple in-memory rate limiter (per-IP, rolling window)
_rate_buckets: Dict[str, List[float]] = {}


def get_settings() -> GatewaySettings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def validate_numeric_field(
    value: Any, name: str, min_val: float, max_val: float
) -> Optional[float]:
    """Validate a numeric sensor field. Returns float or raises ValueError."""
    if value is None:
        return None
    if not isinstance(value, (int, float)):
        raise ValueError(f"'{name}' must be a number, got {type(value).__name__}")
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"'{name}' must be finite, got {value}")
    if value < min_val or value > max_val:
        raise ValueError(f"'{name}' must be between {min_val} and {max_val}, got {value}")
    return float(value)


def validate_timestamp(ts: Any) -> str:
    """Validate and normalize a timestamp. Returns ISO string or raises."""
    if not isinstance(ts, str):
        raise ValueError(f"'timestamp' must be a string, got {type(ts).__name__}")
    if len(ts) > 64:
        raise ValueError("'timestamp' exceeds maximum length")
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, TypeError) as exc:
        raise ValueError(f"'timestamp' is not a valid ISO-8601 timestamp: {exc}")
    if dt.tzinfo is None:
        raise ValueError("'timestamp' must include timezone information (use Z suffix)")
    return ts


def validate_payload(body: Dict[str, Any], settings: GatewaySettings) -> Dict[str, Any]:
    """Validate a telemetry payload against the backend schema semantics.

    Returns validated data dict or raises ValueError.
    """
    errors: List[str] = []

    # Required fields
    for field in ("device_id", "machine_id", "timestamp", "source"):
        if field not in body or body[field] is None:
            errors.append(f"Missing required field: '{field}'")
    if errors:
        raise ValueError("; ".join(errors))

    device_id = body["device_id"]
    machine_id = body["machine_id"]
    source = body["source"]

    # String field validation
    if not isinstance(device_id, str) or len(device_id) == 0:
        raise ValueError("'device_id' must be a non-empty string")
    if len(device_id) > 100:
        raise ValueError("'device_id' exceeds maximum length of 100")
    if not isinstance(machine_id, str) or len(machine_id) == 0:
        raise ValueError("'machine_id' must be a non-empty string")
    if len(machine_id) > 50:
        raise ValueError("'machine_id' exceeds maximum length of 50")
    if source not in ("WOKWI", "REAL_HARDWARE"):
        raise ValueError(f"'source' must be 'WOKWI' or 'REAL_HARDWARE', got '{source}'")

    # Allowlist checks
    if device_id not in settings.allowed_devices_set:
        raise ValueError(f"Unknown device_id: '{device_id}'")
    if machine_id not in settings.allowed_machines_set:
        raise ValueError(f"Unknown machine_id: '{machine_id}'")

    # Timestamp
    try:
        validated_ts = validate_timestamp(body["timestamp"])
    except ValueError as exc:
        raise ValueError(str(exc))

    # Numeric sensor fields
    validated: Dict[str, Any] = {
        "device_id": device_id,
        "machine_id": machine_id,
        "timestamp": validated_ts,
        "source": source,
    }

    sensor_fields = {
        "temperature": (settings.temp_min, settings.temp_max),
        "vibration": (settings.vibration_min, settings.vibration_max),
        "current": (settings.current_min, settings.current_max),
        "rpm": (settings.rpm_min, settings.rpm_max),
    }

    for field_name, (lo, hi) in sensor_fields.items():
        try:
            validated[field_name] = validate_numeric_field(
                body.get(field_name), field_name, lo, hi
            )
        except ValueError as exc:
            errors.append(str(exc))

    if errors:
        raise ValueError("; ".join(errors))

    return validated


def check_rate_limit(ip: str, settings: GatewaySettings) -> None:
    """Simple sliding-window rate limiter. Raises HTTPException(429) if exceeded."""
    now = time.time()
    window = 60.0
    bucket = _rate_buckets.setdefault(ip, [])
    # Remove old entries
    _rate_buckets[ip] = [t for t in bucket if now - t < window]
    if len(_rate_buckets[ip]) >= settings.rate_limit_per_minute:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    _rate_buckets[ip].append(now)


def verify_gateway_token(authorization: Optional[str]) -> None:
    """Verify the Wokwi-supplied gateway token. Raises 401/403."""
    settings = get_settings()
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Missing gateway authentication. Send 'Authorization: Bearer <token>'.",
        )
    token = authorization
    if token.startswith("Bearer "):
        token = token[len("Bearer "):]
    token = token.strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing gateway authentication token.",
        )
    import secrets
    if not secrets.compare_digest(token, settings.gateway_token):
        raise HTTPException(
            status_code=403,
            detail="Invalid gateway token.",
        )


def mask_key(key: str) -> str:
    """Mask a secret key for logging. Shows first 4 and last 4 chars."""
    if len(key) <= 8:
        return "****"
    return f"{key[:4]}...{key[-4:]}"


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="PredictIQ Gateway",
    description=(
        "Edge transport adapter: accepts Wokwi telemetry over HTTP, "
        "forwards validated payloads to Render backend over HTTPS."
    ),
    version="1.0.0",
    docs_url="/docs",
)


@app.on_event("startup")
async def startup() -> None:
    global _start_time
    _start_time = time.time()
    settings = get_settings()
    logger.info("PredictIQ Gateway started")
    logger.info("Render backend: %s", settings.render_backend_url)
    logger.info("Render API key: %s", mask_key(settings.render_device_api_key))
    logger.info("Gateway token configured: %s", mask_key(settings.gateway_token))
    logger.info("Allowed devices: %s", settings.allowed_devices_set)
    logger.info("Allowed machines: %s", settings.allowed_machines_set)


@app.get("/health")
async def health() -> Dict[str, Any]:
    """Health check endpoint. No secrets exposed."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": "predictiq-gateway",
        "version": "1.0.0",
        "uptime_seconds": round(time.time() - _start_time, 1) if _start_time else 0,
        "render_backend": settings.render_backend_url,
        "upstream_verify_tls": True,
        "transport_note": "Wokwi -> Gateway is plain HTTP (Wokwi TLS limitation). "
        "Gateway -> Render is HTTPS with full certificate verification.",
    }


@app.post("/api/sensor-data")
async def ingest_sensor_data(request: Request) -> Response:
    """Accept telemetry from Wokwi and forward to Render backend.

    Flow:
    1. Verify gateway token (Bearer auth)
    2. Rate limit check
    3. Request size check
    4. Parse and validate JSON
    5. Validate fields against backend schema
    6. Forward to Render with DEVICE_API_KEY
    7. Return upstream response to Wokwi
    """
    settings = get_settings()

    # 1. Authentication
    verify_gateway_token(request.headers.get("authorization"))

    # 2. Rate limit
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip, settings)

    # 3. Request size
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings.max_request_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Request too large. Maximum: {settings.max_request_bytes} bytes.",
        )

    # 4. Parse JSON
    try:
        body = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse request body: {exc}")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    # 5. Validate payload
    try:
        validated = validate_payload(body, settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # 6. Forward to Render
    upstream_url = f"{settings.render_backend_url.rstrip('/')}/api/sensor-data"
    logger.info(
        "Forwarding telemetry: device=%s machine=%s source=%s -> %s",
        validated["device_id"],
        validated["machine_id"],
        validated["source"],
        upstream_url,
    )

    try:
        async with httpx.AsyncClient(
            verify=True,
            timeout=httpx.Timeout(settings.upstream_timeout_seconds),
        ) as client:
            response = await client.post(
                upstream_url,
                json=validated,
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": settings.render_device_api_key,
                },
            )
    except httpx.ConnectError as exc:
        logger.error("Upstream connection failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Upstream Render backend is unreachable.",
        )
    except httpx.TimeoutException as exc:
        logger.error("Upstream timeout: %s", exc)
        raise HTTPException(
            status_code=504,
            detail=f"Upstream Render backend timed out after {settings.upstream_timeout_seconds}s.",
        )
    except httpx.TooManyRedirects:
        raise HTTPException(status_code=502, detail="Upstream redirected too many times.")
    except Exception as exc:
        logger.error("Upstream error: %s", exc)
        raise HTTPException(status_code=502, detail="Upstream request failed.")

    # 7. Return upstream response
    try:
        upstream_body = response.json()
    except Exception:
        upstream_body = {"raw_response": response.text[:512]}

    return JSONResponse(
        status_code=response.status_code,
        content=upstream_body,
    )


@app.post("/api/devices/heartbeat")
async def forward_heartbeat(request: Request) -> Response:
    """Forward heartbeat to Render backend."""
    settings = get_settings()

    verify_gateway_token(request.headers.get("authorization"))

    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(client_ip, settings)

    try:
        body = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object")

    # Validate required heartbeat fields
    for field in ("device_id", "machine_id", "source"):
        if field not in body:
            raise HTTPException(status_code=400, detail=f"Missing required field: '{field}'")

    device_id = body.get("device_id", "")
    machine_id = body.get("machine_id", "")
    if device_id not in settings.allowed_devices_set:
        raise HTTPException(status_code=400, detail=f"Unknown device_id: '{device_id}'")
    if machine_id not in settings.allowed_machines_set:
        raise HTTPException(status_code=400, detail=f"Unknown machine_id: '{machine_id}'")

    upstream_url = f"{settings.render_backend_url.rstrip('/')}/api/devices/heartbeat"

    try:
        async with httpx.AsyncClient(
            verify=True,
            timeout=httpx.Timeout(settings.upstream_timeout_seconds),
        ) as client:
            response = await client.post(
                upstream_url,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": settings.render_device_api_key,
                },
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Upstream Render backend is unreachable.")
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail=f"Upstream Render backend timed out after {settings.upstream_timeout_seconds}s.",
        )
    except Exception as exc:
        logger.error("Upstream heartbeat error: %s", exc)
        raise HTTPException(status_code=502, detail="Upstream request failed.")

    try:
        upstream_body = response.json()
    except Exception:
        upstream_body = {"raw_response": response.text[:512]}

    return JSONResponse(status_code=response.status_code, content=upstream_body)


# ---------------------------------------------------------------------------
# Run directly
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run(
        "main:app",
        host=s.host,
        port=s.port,
        reload=s.reload,
    )
