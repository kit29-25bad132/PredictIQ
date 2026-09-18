# PredictIQ Gateway - Edge Transport Adapter

## Purpose

The gateway bridges Wokwi IoT telemetry to the Render backend when direct HTTPS
from Wokwi fails. Wokwi's TLS stack (mbedTLS) fails before completing a TLS
handshake with all tested HTTPS endpoints (Render, example.com, Vercel). The
gateway runs on a cloud host that **can** complete HTTPS to Render.

## Data Flow

```
Wokwi (HTTP) -> Gateway (HTTP) -> Render Backend (HTTPS) -> Supabase PostgreSQL
```

1. Wokwi sends telemetry as plain HTTP POST with `Authorization: Bearer <GATEWAY_TOKEN>`
2. Gateway validates: JSON structure, required fields, numeric ranges, device/machine allowlists
3. Gateway forwards validated payload to Render over HTTPS with `X-API-Key` header
4. Render authenticates, stores in Supabase, runs health/prediction/alert pipeline
5. Gateway returns Render's HTTP status to Wokwi

## Transport Limitation

**Wokwi -> Gateway is plain HTTP.** This is a DEMO/PROVIDE transport path only.

- The GATEWAY_TOKEN is sent in plaintext over HTTP
- Wokwi TLS is broken (mbedTLS handshake fails before HTTP)
- Gateway -> Render is HTTPS with full certificate verification
- The Render DEVICE_API_KEY never leaves the gateway server

For production-grade encrypted transport, Wokwi TLS must be fixed or a
different transport mechanism (e.g., MQTT over TLS) must be used.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RENDER_BACKEND_URL` | Yes | Render backend URL (HTTPS only) |
| `RENDER_DEVICE_API_KEY` | Yes | Backend DEVICE_API_KEY (never exposed to Wokwi) |
| `GATEWAY_TOKEN` | Yes | Application-level token for Wokwi auth |
| `ALLOWED_DEVICES` | No | Comma-separated device_id allowlist (default: ESP32_001) |
| `ALLOWED_MACHINES` | No | Comma-separated machine_id allowlist (default: TEST-001) |
| `MAX_REQUEST_BYTES` | No | Max request body size (default: 8192) |
| `RATE_LIMIT_PER_MINUTE` | No | Rate limit per IP (default: 120) |
| `UPSTREAM_TIMEOUT_SECONDS` | No | Render request timeout (default: 10.0) |

## Security Model

- **Wokwi -> Gateway**: `Authorization: Bearer <GATEWAY_TOKEN>` (application-level)
- **Gateway -> Render**: `X-API-Key: <RENDER_DEVICE_API_KEY>` (server-side only)
- Gateway validates all fields against backend schema semantics
- Gateway rejects: malformed JSON, missing fields, out-of-range values, unknown devices/machines
- Gateway does NOT: calculate health, generate predictions, write to database
- Request size limits, rate limits, upstream timeout
- Fail closed on missing configuration

## Running Locally

```bash
cd deploy/gateway
cp .env.example .env
# Edit .env with real values
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 9000
```

## Running with Docker

```bash
cd deploy/gateway
docker build -t predictiq-gateway .
docker run -p 9000:9000 \
  -e RENDER_BACKEND_URL=https://predictiq-backend-771t.onrender.com \
  -e RENDER_DEVICE_API_KEY=<your-key> \
  -e GATEWAY_TOKEN=<your-token> \
  predictiq-gateway
```

## Wokwi Firmware Configuration

In `firmware/wokwi/src/config.h`:
```cpp
#define API_BASE_URL "http://<your-gateway-host>:9000"  // Plain HTTP for gateway
#define GATEWAY_TOKEN "<your-gateway-token>"             // Gateway auth token
```

Build with:
```bash
GATEWAY_TOKEN=<token> pio run -e esp32-s3-devkitc-1
```

## Verification Procedure

1. Start gateway locally with test configuration
2. Run gateway tests: `cd deploy/gateway/tests && python -m pytest -v`
3. Send test telemetry via curl to gateway `/api/sensor-data`
4. Verify gateway forwards to Render and returns Render's response
5. Check Render backend for new sensor reading
6. Verify frontend shows new data
