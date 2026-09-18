# PredictIQ Gateway — Render Deployment Guide

## Prerequisites

- GitHub repository pushed (gateway files must be in the repo)
- Render account with access to the existing `predictiq-backend` service
- Existing Render `DEVICE_API_KEY` (from the backend service environment)

## Step 1: Push Gateway Code

```bash
git add deploy/gateway/
git commit -m "feat(gateway): add HTTP→HTTPS transport adapter for Wokwi"
git push
```

## Step 2: Create Render Web Service

1. Go to https://dashboard.render.com/
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `predictiq-gateway`
   - **Runtime**: Docker
   - **Dockerfile Path**: `deploy/gateway/Dockerfile`
   - **Docker Context**: `deploy/gateway`
   - **Instance Type**: Free (or Starter for always-on)
   - **Health Check Path**: `/health`

## Step 3: Set Environment Variables

In the Render service dashboard → **Environment** tab, add:

| Key | Value | Notes |
|-----|-------|-------|
| `RENDER_BACKEND_URL` | `https://predictiq-backend-771t.onrender.com` | HTTPS only |
| `RENDER_DEVICE_API_KEY` | *(paste existing backend key)* | Never expose to Wokwi |
| `GATEWAY_TOKEN` | *(generate: `python -c "import secrets; print(secrets.token_urlsafe(32))"`)* | New random token |
| `ALLOWED_DEVICES` | `ESP32_001` | |
| `ALLOWED_MACHINES` | `TEST-001` | |
| `MAX_REQUEST_BYTES` | `8192` | |
| `RATE_LIMIT_PER_MINUTE` | `120` | |
| `UPSTREAM_TIMEOUT_SECONDS` | `10.0` | |

**CRITICAL**: Do NOT use the backend `DEVICE_API_KEY` as the `GATEWAY_TOKEN`. They must be different values.

## Step 4: Deploy

Click **Create Web Service**. Render will:
1. Pull the repository
2. Build the Docker image
3. Start the gateway on the assigned `PORT`
4. Health check against `/health`

## Step 5: Verify Deployment

### 5a. Health Check
```bash
curl https://predictiq-gateway.onrender.com/health
```
Expected: HTTP 200, JSON with `"status": "ok"`, no secrets.

### 5b. Auth Negative Tests
```bash
# No auth → 401
curl -X POST https://predictiq-gateway.onrender.com/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 401

# Wrong token → 403
curl -X POST https://predictiq-gateway.onrender.com/api/sensor-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong-token" \
  -d '{}'
# Expected: 403
```

### 5c. Real Forwarding Test
```bash
curl -X POST https://predictiq-gateway.onrender.com/api/sensor-data \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GATEWAY_TOKEN" \
  -d '{
    "device_id": "ESP32_001",
    "machine_id": "TEST-001",
    "temperature": 25.5,
    "vibration": 1.2,
    "current": 10.0,
    "rpm": 1500.0,
    "timestamp": "2026-09-17T12:00:00Z",
    "source": "WOKWI"
  }'
```
Expected: HTTP 201 (Render backend accepted the telemetry).

## Step 6: Configure Wokwi Firmware

In `firmware/wokwi/src/config.h`, set:
```cpp
#define API_BASE_URL "http://YOUR-GATEWAY-URL"  // HTTP, not HTTPS
```

Build with:
```bash
GATEWAY_TOKEN=your_gateway_token pio run -e esp32-s3-devkitc-1
```

## Transport Architecture

```
Wokwi ──HTTP──▶ Gateway ──HTTPS──▶ Render ──▶ Supabase
  (unencrypted)   (encrypted + verified)
```

The Wokwi → Gateway leg is unencrypted due to Wokwi TLS limitations.
The Gateway → Render leg is fully encrypted with certificate verification.
The Render DEVICE_API_KEY never leaves the gateway server.
