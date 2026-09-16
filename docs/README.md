# PredictIQ

AI-powered edge predictive-maintenance platform that detects machine failures before they happen.

## V1 Architecture

```text
ESP32 / Wokwi
      |
      | HTTPS + X-API-Key
      v
Render Backend (FastAPI)
      |
      +----> Supabase PostgreSQL
      |
      +----> Gemini API
      |
      v
React Frontend (Vercel)
```

## V1 Capabilities

- Real sensor telemetry ingestion
- Device and machine authentication
- PostgreSQL-backed telemetry persistence
- Telemetry health and risk evaluation
- Alert generation and acknowledgement
- Persisted prototype predictions
- Gemini predictive analysis
- Prediction idempotency
- Explainability / heuristic attribution
- Feedback and ground-truth workflow
- Honest model evaluation
- Health and readiness endpoints
- CORS allowlisting
- HTTPS/TLS verification
- Docker-based local runtime
- GitHub Actions CI

## Production Services

| Component | Role |
|---|---|
| Frontend | React + Vite |
| Backend | FastAPI |
| Database | Supabase PostgreSQL |
| AI provider | Google Gemini |
| Backend hosting | Render |
| Frontend hosting | Vercel |
| Firmware/simulation | ESP32 / Wokwi |

Production credentials and API keys are supplied through environment variables and are not committed to the repository.

## Frontend

The frontend is located in `frontend/`.

```bash
cd frontend
npm ci
npm run build
```

For development:

```bash
npm run dev
```

API configuration precedence:

1. `localStorage["predictiq_custom_api"]`
2. `VITE_API_URL`
3. same-origin `/api`

For Vercel, configure:

```text
VITE_API_URL=https://<production-backend-origin>
```

`VITE_API_URL` is a build-time setting, so changing it requires a new frontend deployment.

## Backend

The backend exposes:

```text
GET /api/health
GET /api/ready
```

FastAPI API documentation is available while the backend is running.

## Docker

The repository contains Docker configuration for the local application stack.

The backend container starts FastAPI with:

```text
uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

Production database connections require SSL.

## Security

PredictIQ V1 is designed to fail closed.

- Mutating API endpoints require API-key authentication.
- Authentication comparisons use constant-time comparison.
- CORS uses an explicit origin allowlist.
- Production database connections require TLS.
- TLS certificate verification remains enabled.
- No HTTP fallback is used for production telemetry.
- No TLS verification bypass is used.
- Production secrets are supplied through environment variables.
- No production credentials or API keys belong in frontend source code.

## Telemetry Reality

Production data must come from genuine application/device activity.

PredictIQ does not fabricate telemetry, prediction confidence, model accuracy, RUL, or model artifacts.

The verified production telemetry is genuine application data. The existing Wokwi reading is historical/stale, and the application correctly reports the device as offline/waiting rather than presenting stale telemetry as fresh live data.

## AI Verification

Gemini integration is connected to the production prediction workflow and has been verified against real production data.

Prediction persistence and deterministic idempotent replay have been verified.

A fresh Gemini inference generated from newly arriving Wokwi telemetry has not been verified because the live Wokwi-to-cloud telemetry path remains blocked.

## Wokwi Status

The live path:

```text
Wokwi → HTTPS → Render → Supabase
```

remains **BLOCKED / UNRESOLVED**.

Verified diagnostic behavior:

- Wi-Fi connection succeeds.
- DNS resolution succeeds.
- TCP connection to port 443 succeeds.
- TLS handshake terminates before the server certificate is received.
- The behavior has been observed against both a public HTTPS endpoint and the Render endpoint.
- The exact root cause has not been established because complete packet-level evidence could not be obtained from the available Wokwi execution environment.

No security workaround has been introduced.

Specifically:

- No `setInsecure()` was introduced.
- No HTTP fallback was introduced.
- No TLS downgrade was introduced.
- No certificate-verification bypass was introduced.
- No production backend workaround was introduced.

Fresh live Wokwi telemetry must not be represented as verified until a complete:

```text
Wokwi → HTTPS → Render → Supabase
```

flow is observed.

## CI

GitHub Actions validates the backend and frontend.

The V1 release PR has four required checks:

- Backend pull-request CI
- Backend push CI
- Frontend pull-request CI
- Frontend push CI

All four passed for the V1 release PR.

## V1 Release Status

PredictIQ V1 is the frozen production baseline.

Release commit:

```text
a599b3204b90725f38702868da2414c6e67b9e26
```

Known limitations:

1. Fresh Wokwi-to-cloud telemetry remains blocked/unresolved.
2. Fresh Gemini inference after the latest deployment has not been independently verified; deterministic replay of an existing real prediction has been verified.
3. The V1 production dataset is intentionally small and is not a statistically sufficient training corpus.

These limitations are documented rather than hidden or replaced with fabricated results.

## Release Discipline

The V1 baseline is frozen.

Future Wokwi investigation, infrastructure changes, model improvements, or other functional work should be performed in a separate development branch/version unless the V1 release is intentionally reopened.

## Repository Branches

- `main` — release/integration branch
- `v1` — V1 development/release branch

Promoting V1 to `main` must preserve the verified V1 baseline.

## License

Add the project's applicable license here if/when one is selected.
