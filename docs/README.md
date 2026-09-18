# PredictIQ

## AIoT Predictive Maintenance Platform

PredictIQ is a production-oriented IoT predictive-maintenance system that collects machine telemetry, stores real sensor data, evaluates machine health, generates AI-assisted failure predictions, raises maintenance alerts, and exposes machine state through a web dashboard.

The V1 architecture separates device telemetry, transport, backend processing, persistence, AI inference, and frontend visualization.

> **V1 status:** Release-ready prototype with real cloud infrastructure, real database persistence, real Gemini inference, real telemetry flow, and a cloud-hosted frontend.

---

## Table of Contents

- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [Architecture](#architecture)
- [Data Flow](#data-flow)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Telemetry](#telemetry)
- [Health and Prediction Architecture](#health-and-prediction-architecture)
- [AI / Gemini Integration](#ai--gemini-integration)
- [Alerts and Maintenance](#alerts-and-maintenance)
- [Device Heartbeat and Offline Detection](#device-heartbeat-and-offline-detection)
- [Wokwi Development Path](#wokwi-development-path)
- [Frontend](#frontend)
- [Backend API](#backend-api)
- [Database](#database)
- [Security](#security)
- [Environment Configuration](#environment-configuration)
- [Local Development](#local-development)
- [Testing and Verification](#testing-and-verification)
- [Production Deployment](#production-deployment)
- [Cloud Independence](#cloud-independence)
- [Current V1 Scope](#current-v1-scope)
- [Known V1 Limitations](#known-v1-limitations)
- [Future Extension](#future-extension)
- [Project Principles](#project-principles)
- [License](#license)

---

## Overview

PredictIQ demonstrates an end-to-end predictive-maintenance workflow for connected industrial equipment.

The system receives telemetry containing measurements such as:

- Temperature
- Vibration
- Electrical current
- RPM
- Device ID
- Machine ID
- Timestamp
- Telemetry source

Telemetry is persisted in PostgreSQL and is used by the backend health engine and prediction services.

The platform supports two prediction paths:

1. **Deterministic health/prediction logic** using the V1 physics/rule-based engine.
2. **External AI analysis** using Google's Gemini API.

This separation is intentional. Deterministic health logic provides a predictable baseline, while Gemini provides contextual analysis based on the actual telemetry supplied to the inference request.

---

## Core Capabilities

- Real Wokwi ESP32-S3 telemetry
- Real PostgreSQL persistence through Supabase
- Cloud FastAPI backend on Render
- Gemini AI analysis
- Structured and explainable predictions
- Machine health monitoring
- Threshold-based alert generation
- Device heartbeat and offline detection
- Failure/recovery handling
- Maintenance records
- Prediction feedback
- React/Vite web dashboard
- Vercel cloud deployment
- HTTPS cloud transport
- CORS protection
- Dockerized backend runtime
- Environment-based secret management

---

## Architecture

```text
                    ┌───────────────────────────┐
                    │       Wokwi ESP32-S3      │
                    │     Simulated IoT Device   │
                    └─────────────┬─────────────┘
                                  │
                         HTTP inside Wokwi
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │     Local Wokwi Gateway    │
                    │      Development Only      │
                    └─────────────┬─────────────┘
                                  │
                       HTTPS + verified TLS
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │      Render Backend       │
                    │ FastAPI + Uvicorn + Docker │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │   Supabase PostgreSQL     │
                    │      Persistent Data       │
                    └─────────────┬─────────────┘
                                  │
                       AI analysis when requested
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │      Google Gemini        │
                    │     Gemini 3.6 Flash      │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │     Predictions / XAI     │
                    │ Alerts / Maintenance /    │
                    │ Feedback / Machine State   │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │     Vercel Frontend       │
                    │       React + Vite        │
                    └───────────────────────────┘
```

### Architectural boundary

The local gateway is a **development transport adapter** for Wokwi. It is not the production database, AI service, or business-logic layer.

The production web application remains cloud-hosted:

```text
Vercel → Render → Supabase
```

The development device path is:

```text
Wokwi → Local Gateway → Render
```

---

## Data Flow

### Telemetry

```text
ESP32-S3
   │
   │ real simulated sensor values
   ▼
Wokwi networking
   │
   ▼
Local PredictIQ Gateway
   │
   │ HTTPS
   ▼
Render FastAPI backend
   │
   ├── validate telemetry
   ├── persist SensorReading
   ├── update machine/device state
   ├── evaluate health rules
   └── generate alerts when thresholds require them
   │
   ▼
Supabase PostgreSQL
```

### AI prediction

```text
Latest persisted telemetry
        │
        ▼
Prediction service
        │
        ├── build inference input
        ├── calculate SHA-256 input hash
        └── call Gemini
                │
                ▼
        Gemini 3.6 Flash
                │
                ▼
        Structured prediction
                │
                ▼
        PostgreSQL prediction row
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Device simulation | Wokwi |
| Microcontroller target | ESP32-S3-DevKitC-1 |
| Firmware | C++ / Arduino |
| Firmware build | PlatformIO |
| Device transport adapter | Python / FastAPI |
| Backend | Python / FastAPI |
| ASGI server | Uvicorn |
| Backend container | Docker |
| Production backend hosting | Render |
| Database | PostgreSQL |
| Database hosting | Supabase |
| AI provider | Google Gemini |
| AI model | `gemini-3.6-flash` |
| Frontend | React |
| Frontend tooling | Vite |
| Frontend hosting | Vercel |
| API communication | HTTPS / JSON |
| Gateway-to-backend | HTTPS |
| Wokwi-to-gateway | HTTP |

---

## Repository Structure

```text
PredictIQ/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── ...
│   ├── tests/
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.*
│
├── firmware/
│   └── wokwi/
│       ├── src/
│       ├── platformio.ini
│       ├── wokwi.toml
│       └── ...
│
├── deploy/
│   └── gateway/
│       ├── main.py
│       ├── config.py
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── README.md
│       ├── DEPLOY-GUIDE.md
│       ├── .env.example
│       └── tests/
│
└── README.md
```

---

## Telemetry

Typical telemetry has this shape:

```json
{
  "device_id": "ESP32_001",
  "machine_id": "TEST-001",
  "timestamp": "2026-09-18T08:26:54Z",
  "source": "WOKWI",
  "temperature": 24.0,
  "vibration": 0.0,
  "current": 20.0,
  "rpm": 600.2023
}
```

The example illustrates the schema; production values must originate from an authorized telemetry source.

### Timestamp integrity

The firmware synchronizes time through NTP before sending normal telemetry. The production telemetry path does not use a fake timestamp fallback.

---

## Health and Prediction Architecture

PredictIQ intentionally separates deterministic health evaluation from external AI analysis.

### Deterministic V1 engine

The baseline deterministic engine is identified as:

```text
physics-rule-v1
```

It evaluates machine operating conditions using configured rules and thresholds. It is a deterministic baseline, not a statistically trained machine-learning model.

### Gemini analysis

The separate analysis path invokes Gemini using the latest actual telemetry.

Example metadata:

```text
model_version: gemini:gemini-3.6-flash
source: external_ai
provider: gemini
```

This makes prediction origin explicit.

---

## AI / Gemini Integration

PredictIQ uses Google's Generative Language API for AI-assisted analysis.

The backend:

1. Retrieves relevant real telemetry.
2. Builds the inference input.
3. Computes a SHA-256 hash of that input.
4. Sends the request to Gemini over HTTPS.
5. Parses the structured response.
6. Persists the prediction.
7. Records provider/model metadata.

Example prediction structure:

```json
{
  "failure_probability": 0.95,
  "health_status": "faulted",
  "likely_component": "motor_windings",
  "severity": "critical",
  "confidence": 0.98,
  "model_version": "gemini:gemini-3.6-flash",
  "source": "external_ai",
  "provider": "gemini"
}
```

The values above illustrate the persisted schema and are not static application defaults.

### Provider failure behavior

If the Gemini API key is missing or the provider call fails, the AI request fails explicitly rather than fabricating a prediction.

---

## Alerts and Maintenance

The health engine can generate alerts when telemetry crosses configured operating limits.

Alert evaluation covers:

- Current
- RPM
- Temperature
- Vibration

Alerts are persisted in PostgreSQL and exposed through the backend API.

Maintenance and feedback entities extend the workflow from prediction into operational follow-up and evaluation.

---

## Device Heartbeat and Offline Detection

Devices periodically send heartbeats.

Heartbeat activity is used to maintain device liveness and distinguish:

```text
ONLINE
```

from:

```text
OFFLINE
```

When Wokwi is stopped:

- Heartbeats stop.
- New telemetry stops.
- The cloud backend remains available.
- The frontend remains available.
- Persisted cloud data remains available.
- Device status can transition to offline according to the configured liveness rules.

When Wokwi restarts, heartbeat and telemetry resume.

---

## Wokwi Development Path

The intended local development path is:

```text
VS Code
   │
   ▼
Wokwi ESP32-S3
   │
   ▼
Official local Wokwi relay (`wokwigw.exe`)
   │
   ▼
PredictIQ Local Gateway
   │
   ▼
HTTPS
   │
   ▼
Render Backend
```

The Wokwi configuration uses:

```toml
[wokwi]
version = 1

[net]
gateway = "ws://localhost:9011"
```

The simulated firmware communicates with the local gateway through:

```text
http://host.wokwi.internal:9000
```

### Why HTTP is used locally

Wokwi's local networking environment has limitations around direct HTTPS/TLS connections from the simulated ESP32 environment.

Therefore:

```text
Wokwi → Local Gateway
```

uses HTTP.

The cloud security boundary is preserved at:

```text
Local Gateway → Render
```

which uses HTTPS with certificate verification enabled.

This is a deliberate development transport arrangement, not a production TLS bypass.

> **Important:** Do not use `wokwi-cli` as the normal V1 path. The intended workflow is VS Code Wokwi with the official local relay.

---

## Frontend

The production frontend is hosted on Vercel.

Production URL:

```text
https://predict-iq-nu.vercel.app/
```

The frontend is a React/Vite single-page application.

It communicates directly with the production backend:

```text
Browser
   │
   │ HTTPS
   ▼
Render API
```

There is no requirement for a local Node/Express proxy in production.

The production frontend does not depend on:

```text
localhost
127.0.0.1
```

---

## Backend API

The backend is a FastAPI application served by Uvicorn.

Important operational endpoints include:

```text
GET  /api/health
GET  /api/ready
POST /api/sensor-data
POST /api/devices/heartbeat
POST /api/predictions/analyze
POST /api/predict
```

Additional routes expose machines, predictions, alerts, maintenance information, feedback, and operational status.

The exact API surface is defined by the FastAPI application and its OpenAPI schema.

---

## Database

Production persistence uses PostgreSQL hosted by Supabase.

The database stores operational entities including:

- Machines
- Devices
- Sensor readings
- Predictions
- Alerts
- Maintenance records
- Feedback
- Machine/device status

Production telemetry results in persistent database records rather than an in-memory-only state.

---

## Security

### Authentication

The gateway uses a dedicated application-level Bearer token for Wokwi-to-gateway authentication.

The backend uses a separate device API key for gateway-to-backend authentication.

These credentials are intentionally separate.

### Allowlists

The gateway validates authorized device and machine identifiers.

### Request protection

The gateway enforces:

- JSON validation
- Request-size limits
- Rate limiting
- Upstream timeouts

### TLS

Gateway-to-Render communication uses HTTPS with normal certificate verification.

Production firmware also retains TLS certificate verification.

PredictIQ V1 does **not** use:

```cpp
setInsecure()
```

as a production TLS mechanism.

Temporary TLS diagnostic code used during development was removed from the final V1 path.

### Secret management

Never commit:

- API keys
- Database passwords
- Device API keys
- Gateway tokens
- Gemini API keys
- Production `.env` files

Use environment variables and deployment-platform secret storage.

---

## Environment Configuration

The gateway provides:

```text
deploy/gateway/.env.example
```

Important variables include:

```text
RENDER_BACKEND_URL
RENDER_DEVICE_API_KEY
GATEWAY_TOKEN
ALLOWED_DEVICES
ALLOWED_MACHINES
MAX_REQUEST_BYTES
RATE_LIMIT_PER_MINUTE
UPSTREAM_TIMEOUT_SECONDS
HOST
PORT
```

Backend production configuration includes:

```text
APP_ENV
DATABASE_URL
DB_SSLMODE
DEVICE_API_KEY
CORS_ORIGINS
GEMINI_API_KEY
GEMINI_MODEL
```

Sensitive values must be configured through local environment configuration or deployment secret storage.

---

## Local Development

### Prerequisites

Depending on the component being developed:

- Git
- Python 3.12+
- Node.js / npm
- PlatformIO
- VS Code
- Wokwi VS Code integration
- Docker, when local container testing is required

### Clone

```bash
git clone <repository-url>
cd PredictIQ
```

### Backend

Create a Python environment:

#### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install backend dependencies and configure the required environment variables.

Start FastAPI/Uvicorn using the project's development command.

### Gateway

Move to:

```text
deploy/gateway
```

Create a local `.env` from `.env.example`.

Do not commit `.env`.

Install dependencies and start the gateway on its configured port, normally:

```text
9000
```

### Firmware

Open:

```text
firmware/wokwi
```

Build the ESP32-S3 firmware with PlatformIO.

The Wokwi gateway token is supplied through the build environment. The production backend device key remains server-side.

---

## Testing and Verification

PredictIQ V1 was validated through a staged 12-gate verification process.

| Gate | Area | Verification |
|---|---|---|
| 1 | Local Gateway | Health, auth, validation, real forwarding |
| 2 | Wokwi Connectivity | Wi-Fi, NTP, auth, heartbeat, telemetry |
| 3 | E2E Telemetry | Wokwi → Gateway → Render → Supabase |
| 4 | Heartbeat | Liveness and telemetry continuity |
| 5 | Failure / Recovery | Offline detection and recovery |
| 6 | Real Gemini | Real AI inference and persistence |
| 7 | Alerts / Maintenance / Feedback | Operational workflow |
| 8 | Vercel Frontend | Cloud browser/API integration |
| 9 | Docker | Production container/runtime validation |
| 10 | Cloud Independence | Laptop-independent cloud architecture |
| 11 | Security / Reality / Code Audit | Final security and authenticity checks |
| 12 | Release | V1 release verification |

### Regression testing

Backend and gateway test suites are maintained in the repository.

The gateway verification included comprehensive authentication, validation, forwarding, rate-limit, timeout, and failure-path coverage.

The V1 verification process also included PlatformIO firmware builds and production endpoint checks.

---

## Production Deployment

PredictIQ V1 uses three primary cloud services.

### Render

The FastAPI backend is deployed as a Docker service.

Production backend:

```text
https://predictiq-backend-771t.onrender.com
```

Health and readiness endpoints are available for operational verification.

### Supabase

Production PostgreSQL is hosted by Supabase.

The production database connection uses SSL-required configuration.

### Vercel

The React/Vite frontend is deployed on Vercel.

Production frontend:

```text
https://predict-iq-nu.vercel.app/
```

The browser calls the Render API directly over HTTPS.

---

## Cloud Independence

A core V1 requirement is that the web application must remain usable when the developer laptop is unavailable.

### During development

```text
Wokwi
  ↓
Local Gateway
  ↓
Render
  ↓
Supabase
  ↓
Gemini
  ↓
Vercel
```

### Without the laptop

```text
Vercel
  ↓
Render
  ↓
Supabase
```

The cloud application remains online.

Only the local Wokwi-generated telemetry source becomes unavailable.

The frontend should therefore show the persisted cloud state and device liveness honestly rather than implying that a disconnected device is still transmitting.

---

## Current V1 Scope

V1 includes:

- ESP32-S3 Wokwi simulation
- Real telemetry ingestion
- Local Wokwi gateway
- Cloud FastAPI backend
- Render deployment
- Supabase PostgreSQL
- Machine/device records
- Persistent sensor readings
- Deterministic health engine
- Gemini AI analysis
- Persisted predictions
- Prediction input hashing
- Idempotent AI analysis behavior
- Machine health state
- Alert generation
- Heartbeat/liveness
- Offline/recovery behavior
- Maintenance records
- Feedback records
- React/Vite frontend
- Vercel deployment
- HTTPS cloud transport
- CORS controls
- Docker runtime
- Environment-based secrets
- Staged verification gates

---

## Known V1 Limitations

PredictIQ V1 is a production-oriented prototype, not a finished industrial predictive-maintenance product.

### Wokwi is a simulation

The current device boundary is simulated through Wokwi and is not equivalent to telemetry collected from a physical industrial machine.

The architecture allows a physical device to replace Wokwi later.

### Local gateway is development infrastructure

The local gateway exists to bridge the Wokwi networking limitation. It is not intended to be the permanent production device-ingestion architecture.

### Deterministic rules are not a trained predictive model

`physics-rule-v1` is a deterministic baseline and should not be represented as a statistically trained predictive-maintenance model.

### Gemini is an external dependency

AI analysis depends on Gemini provider availability, quotas, latency, and model behavior.

### Threshold calibration

V1 thresholds are prototype operating rules. They should be calibrated against real historical machine data before high-stakes industrial use.

### Scale

V1 demonstrates a complete working system rather than a horizontally scaled industrial IoT platform.

---

## Future Extension

Potential future versions can add:

- Physical ESP32 sensor deployment
- MQTT or industrial IoT ingestion
- Multiple machines
- Multiple sites
- Time-series optimization
- Historical feature engineering
- Trained predictive models
- Anomaly detection
- Remaining useful life estimation
- Model evaluation pipelines
- Model drift monitoring
- Automated retraining
- Role-based access control
- Production observability
- Structured audit logging
- Queue-based telemetry ingestion
- Scalable device registration
- Industrial protocol integration
- Advanced maintenance workflows

These are future capabilities and are not represented as completed V1 functionality.

---

## Project Principles

### 1. Real over simulated production state

Simulation is allowed at the device boundary. Production database rows and AI results must not be fabricated.

### 2. Explicit system boundaries

Device, gateway, backend, database, AI, and frontend responsibilities remain separated.

### 3. Fail closed

Missing credentials and invalid security configuration should cause explicit failures rather than silently enabling insecure behavior.

### 4. Verified TLS

Development networking constraints must not become a reason to disable production certificate verification.

### 5. Secrets stay out of source

Credentials belong in environment configuration and deployment secret stores.

### 6. Explainability

Predictions should preserve enough metadata to identify:

- What model/provider generated them
- What telemetry was analyzed
- When it was analyzed
- What recommendation was produced

### 7. Observable failure

When a device goes offline or an external AI provider fails, the system should represent that state rather than fabricate successful activity.

### 8. Reproducibility

The staged gate process makes important system behavior independently verifiable.

---

## Operational Summary

```text
1. ESP32-S3 generates telemetry
2. Wokwi simulates the device
3. Official Wokwi relay provides host networking
4. Local gateway authenticates and validates telemetry
5. Gateway sends telemetry over verified HTTPS
6. Render validates and persists telemetry
7. Health engine evaluates machine state
8. Alerts are generated when thresholds require them
9. Gemini analyzes actual persisted telemetry when requested
10. Prediction metadata and input hash are persisted
11. Heartbeats maintain device liveness
12. Offline/recovery state is detected
13. Vercel frontend reads cloud state
14. Users view monitoring, predictions, alerts, and maintenance information
```

---

## V1 Reality Statement

PredictIQ V1 is a **real cloud-connected predictive-maintenance prototype**.

The production path uses:

```text
Real telemetry
      ↓
Real API transport
      ↓
Real PostgreSQL persistence
      ↓
Real health processing
      ↓
Real Gemini API inference
      ↓
Real persisted predictions
      ↓
Real alerts / machine state
      ↓
Real cloud frontend
```

The only simulated component in the normal V1 demonstration path is the **physical device/sensor boundary**, represented by Wokwi.

This distinction is intentional and documented.

---

## License

Add the project's selected license here before public distribution.

If the repository already contains a license file, that license governs the project.

---

## Maintainer Notes

When modifying PredictIQ:

- Preserve the separation between device, gateway, backend, database, AI, and frontend.
- Do not introduce fake production telemetry.
- Do not hardcode production prediction results.
- Do not commit credentials.
- Do not disable TLS verification.
- Keep cloud services independent from the developer laptop.
- Update this README whenever a verified architectural capability changes.
