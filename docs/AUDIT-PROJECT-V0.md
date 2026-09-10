# PredictIQ — Project V0 Engineering Audit

**Audit date:** 2026-09-10
**Audited target:** `audit/projectv0/predict-iq/`
**Source of truth:** `docs/00` … `docs/11` (locked PredictIQ documentation)
**Auditor role:** read-only analysis. No project files were modified, refactored, deleted, or run against production systems.

> Status key used throughout: **IMPLEMENTED / WORKING / PARTIALLY WORKING / BROKEN / UNTESTED / PLACEHOLDER / MISSING**. Where something could not be verified by execution, the report says **"Unable to verify"** and states exactly why.

---

## 1. Executive Summary

The existing project at `audit/projectv0/predict-iq/` is a **well-structured but incomplete prototype** of the PredictIQ idea. It already contains a surprisingly large amount of what the locked charter requires: a FastAPI backend with real input validation, a PostgreSQL schema with migrations, a polished React dashboard, an ESP32/Wokwi simulation that emits real (simulated) sensor values, and an `ai/` module containing genuine scikit-learn code. The team's "real-data-first / zero-fake-data" discipline is unusually strong and appears in the README, the code comments, and the UI copy.

However, **the system is not end-to-end** and cannot yet demonstrate the core PredictIQ loop (telemetry → health → prediction → explanation → alert → maintenance → feedback → ground truth):

1. **There is no alert producer.** The `alerts` table and alert API exist, but nothing in the codebase ever creates an alert. The health/anomaly engine that should generate alerts is missing.
2. **There is no health engine wired to telemetry.** `machines.status` stays `Healthy` (or whatever it was set to) forever; nothing computes NORMAL/WARNING/CRITICAL from readings.
3. **The AI/ML engine is disconnected.** `ai/prediction.py` contains a full inference pipeline (sklearn model + rule-based RUL/confidence + XAI), but no API route ever calls `prediction_service.predict()`. The prediction endpoints deliberately return "Not available" stubs. `/api/train-model` exists and trains a real RandomForest, but its labels are derived from threshold rules (maintenance records are collected but never used as labels), and its reported metrics are not trustworthy (can trivially report 100% accuracy / F1).
4. **The feedback/ground-truth loop does not exist.** Maintenance records are simple work orders. There is no `prediction_id` link, no `actual_fault`, `root_cause`, `severity`, `outcome`, `prediction_correct`, no prediction-vs-reality comparison, and no ground-truth dataset management.
5. **Frontend bugs hide real functionality.** The prediction outcome cards render hardcoded "Not available" text even when a prediction object was fetched; the Machines table reads API fields that don't exist (`current_reading`, `latest_prediction`) and falls back to a hardcoded **"150 Days"** RUL value, which contradicts the locked "never invent RUL" rule.
6. **Wokwi telemetry units do not match the API contract.** Vibration is sent as raw MPU6050 acceleration magnitude (m/s²) labeled mm/s, and current is sent as raw ADC counts (0–4095) that exceed the backend's physical bound of 1000 A and would be **rejected with 422**. This violates ADR-002 (same telemetry contract).
7. **The project has no git history.** All implementation files are untracked; the repository contains a single commit. ADR-008 ("git history matters") is not satisfied.
8. **Secrets exist on disk** in `.env` / `backend/.env` (Supabase connection credentials, a Supabase secret key, and a real ngrok authtoken). The files are gitignored, but the credentials must be treated as exposed and rotated.
9. **No automated tests, no Docker, no CI/CD.** Only `backend/test_db.py` (a connectivity script) and `npm run lint` (tsc typecheck, which **passes**). The backend cannot be executed in this environment: the bundled `.venv` is broken (points to a missing Python interpreter) and system Python lacks the dependencies, so runtime behavior of the API/DB layer was verified statically only.
10. **Two firmware targets exist** (`esp32/` for real hardware, `wokwi/` for simulation). The real-hardware firmware is honest about having no sensors wired (all `NOT_CONFIGURED`) but incorrectly labels itself `source: "WOKWI"`. The last recorded Wokwi run (`wokwi/wokwi-debug.txt`) shows TLS handshake failures against the configured ngrok tunnel and a timeout — the Wokwi→backend path was not verified working at audit time.

**Bottom line:** the project is a strong **KEEP/REFACTOR foundation** for the backend schema, the dashboard UI, and the real-hardware firmware skeleton, but the intelligence layer, alerting, and feedback loop must be **built or rebuilt**, and Wokwi's telemetry contract must be **repaired** before the end-to-end demo can pass the locked Definition of Done.

---

## 2. Repository Inventory

The audited tree (generated files grouped):

```
audit/projectv0/predict-iq/
├── README.md                  # Project README; documents staging posture, run steps, verification order
├── package.json               # Frontend + server deps; scripts: dev/build/start/clean/lint
├── bun.lock  +  package-lock.json   # Two lockfiles (bun + npm); package.json "name": "react-example"
├── vite.config.ts             # Vite + React + Tailwind 4 plugin config
├── tsconfig.json              # TS 5.8, bundler resolution, noEmit
├── index.html                 # SPA shell
├── server.ts                  # Express server; serves Vite middleware in dev, dist/ in prod
├── metadata.json              # AI Studio metadata; declares Gemini capability
├── .env.example               # Root env template (DATABASE_URL, CORS, VITE_API_URL)
├── .env                       # LOCAL FILE — real credentials (gitignored) — see Security
├── .gitignore                 # ignores node_modules, dist, .env*, __pycache__, etc.
│
├── backend/                   # FastAPI backend
│   ├── main.py                # App factory, CORS, /api/health, /api/stats, router mounting
│   ├── requirements.txt       # Python deps (no dev/test deps)
│   ├── test_db.py             # DB connectivity script (the only "test" file)
│   ├── .env.example / .env    # DB env template / local real values
│   ├── api/                   # routers: sensors.py, machines.py, predictions.py, alerts.py, maintenance.py
│   ├── database/              # database.py (engine/session), models.py (ORM), init_db.py (dead code)
│   ├── schemas/sensor.py      # ACTIVE Pydantic schemas (input validation + responses)
│   ├── models/schemas.py      # DEAD duplicate schemas (never imported)
│   └── services/prediction_service.py  # adapter to ai/ (only get_status + train_model are used)
│
├── ai/                        # ML/XAI module (pure Python, standalone)
│   ├── __init__.py            # package exports
│   ├── prediction.py          # inference service: model predict_proba + rule-based RUL/confidence/components
│   ├── training.py            # RandomForest training pipeline from DB readings (threshold labels)
│   ├── explainability.py      # SHAP-if-available, otherwise physics-based attribution + reasons
│   ├── feature_engineering.py # 10-feature vector builder
│   ├── data_validation.py     # physical envelope validation + dataset quality audit
│   ├── recommendation.py      # rule-based maintenance recommendation strings
│   └── model/README.md        # docs; NO trained model artifacts present
│
├── alembic/                   # migrations
│   ├── alembic.ini, env.py    # loads URL from backend.database.database
│   └── versions/001_initial_schema.py, 002_device_source.py
│
├── supabase/schema.sql        # SQL DDL mirror of migrations (structure only, no inserts)
│
├── src/                       # React frontend (TypeScript)
│   ├── main.tsx, App.tsx      # entry, nav shell, 4s polling, toasts, modals
│   ├── index.css              # `@import "tailwindcss";` only
│   ├── types.ts               # shared interfaces
│   ├── services/api.ts        # API client (fetch, base URL config, localStorage override)
│   ├── components/            # Header, Sidebar, MetricCard, MachineCard, ShapAttributionBar (unused),
│   │                          # ManualSensorModal, AddMachineModal
│   └── pages/                 # Dashboard, Machines, MachineDetails, LiveMonitoring, Predictions,
│                              # Maintenance, Alerts, SensorData, Settings
│
├── esp32/                     # Real-hardware firmware (Arduino)
│   ├── predict_iq_esp32.ino   # setup/loop; heartbeat + sampling tasks
│   ├── config.h               # Wi-Fi/API/IDs/timers; SENSOR_SOURCE="WOKWI" (bug)
│   ├── sensors.{h,cpp}        # all 4 sensors return NOT_CONFIGURED (drivers are commented hooks)
│   ├── wifi_manager.{h,cpp}   # non-blocking reconnect
│   ├── api_client.{h,cpp}     # HTTP JSON client, X-Device-API-Key header (placeholder)
│   └── README.md              # wiring/build docs
│
├── wokwi/                     # Wokwi simulation (PlatformIO)
│   ├── diagram.json           # ESP32-S3 + DS18B20 + MPU6050 + potentiometer + clock generator
│   ├── platformio.ini, wokwi.toml
│   ├── src/                   # main.cpp + sensors/api_client/wifi_manager modules
│   ├── src/api_client.cpp.backup-20260907   # pre-TLS-fix backup copy
│   ├── README.md              # documents unit caveats honestly
│   ├── wokwi-debug.txt        # last recorded run: SSL errors + timeout (UTF-16 log)
│   └── .pio/                  # built firmware.bin + libdeps (build artifacts)
│
├── dist/, public/             # build artifacts (committed on disk)
└── .venv/                     # BROKEN virtualenv (base interpreter path no longer exists)
```

**Counts:** ~80 tracked-in-index files; 13 locked docs in `docs/`; 1 Python test script; 0 real test files; 0 Docker/CI files.

### Notable duplicates / dead code
- `backend/models/schemas.py` — full duplicate schema module, **never imported** (confirmed by search).
- `backend/database/init_db.py` — prints instructions, never referenced.
- `src/components/ShapAttributionBar.tsx` — complete XAI UI component, **never imported** by any page.
- `esp32/` vs `wokwi/src/` — two nearly identical firmware implementations that have already diverged (TLS handling, sensor reading shape).
- `wokwi/src/api_client.cpp.backup-20260907` — committed backup file.
- `metadata.json` declares `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` and `package.json` declares `@google/genai`, but **no usage** of genai/Gemini exists in `src/`.

---

## 3. Technology Stack

| Layer | Technology | Version evidence |
| --- | --- | --- |
| Frontend | React + TypeScript | react ^19.0.1, typescript ~5.8.2 (package.json) |
| Build | Vite + esbuild + tsx | vite ^6.2.3, esbuild ^0.25.0, tsx ^4.21.0 |
| Styling | Tailwind CSS v4 | tailwindcss ^4.1.14 via @tailwindcss/vite |
| Charts | Recharts | recharts ^3.10.1 |
| Icons/animations | lucide-react, motion | ^0.546.0, ^12.23.24 |
| Frontend server | Express (serves Vite middleware / dist) | express ^4.21.2 |
| Backend | FastAPI | installed 0.141.1 (req >=0.110.0) |
| ASGI server | uvicorn[standard] | installed 0.52.4 |
| Validation | Pydantic v2 + pydantic-settings | installed 2.13.5 / 2.15.0 |
| ORM | SQLAlchemy 2 | installed 2.0.52 |
| Migrations | Alembic | installed 1.19.2 |
| Database | PostgreSQL (Supabase) | psycopg 3.3.5 binary driver; `sslmode=require` |
| Data/ML | pandas 3.0.5, numpy 2.5.2, scikit-learn 1.9.0, joblib 1.6.0 | venv site-packages |
| XAI | SHAP — **NOT installed**, not in requirements | explainability.py falls back to physics attribution |
| Firmware (real) | Arduino C++ for ESP32 (ESP-WROOM-32 / ESP32-S3) | esp32/ tree |
| Firmware (sim) | PlatformIO + Arduino for esp32-s3-devkitc-1 | wokwi/platformio.ini |
| Sim libs | ArduinoJson 7.3, OneWire 2.3.8, DallasTemperature 3.11.0, Adafruit MPU6050 2.2.6, Adafruit Unified Sensor 1.1.14 | platformio.ini + .pio/libdeps |
| Simulation | Wokwi CLI 0.26.1 (API 1.0.0-20260906) | wokwi-debug.txt |
| Auth | None | — |
| Containerization | None | no Dockerfile / compose |
| CI/CD | None | no workflows |
| Testing | None (tsc typecheck only) | — |

**Determinable versions (installed in the broken `.venv`, from `site-packages`):** FastAPI 0.141.1, SQLAlchemy 2.0.52, Pydantic 2.13.5, Alembic 1.19.2, uvicorn 0.52.4, psycopg 3.3.5, scikit-learn 1.9.0, numpy 2.5.2, pandas 3.0.5, joblib 1.6.0. The `requirements.txt` floor versions are older; the venv satisfies them.

---

## 4. Existing Architecture (what is actually implemented)

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                      WOKWI (simulation)                   │
                    │  ESP32-S3 DevKitC-1  ·  DS18B20 (temp, static 24°C)      │
                    │  MPU6050 (vib = raw accel magnitude, m/s²)               │
                    │  Potentiometer (current = raw ADC 0–4095)  ← UNIT DRIFT  │
                    │  Clock gen 10 Hz (rpm ≈ 600)                             │
                    └──────────────────────────┬───────────────────────────────┘
                                               │ HTTPS (tunnel) · source:"WOKWI"
                                               ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │        REAL ESP32 FIRMWARE (esp32/) — all sensors        │
                    │        report NOT_CONFIGURED → heartbeats only,          │
                    │        telemetry skipped when no sensor has a value      │
                    └──────────────────────────┬───────────────────────────────┘
                                               │ HTTP (LAN) · source:"WOKWI" (bug)
                                               ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │              FastAPI backend (backend/main.py)           │
                    │  routers: sensors · machines · predictions · alerts ·    │
                    │  maintenance · + /api/health · /api/stats ·              │
                    │  /api/data-status · /api/model-status                    │
                    │  NO authentication · NO alert producer · NO health       │
                    │  engine wired to telemetry                               │
                    └──────────────┬───────────────────────┬───────────────────┘
                                   ▼                       ▼
                    ┌───────────────────────────┐  ┌───────────────────────────┐
                    │   PostgreSQL (Supabase)   │  │   ai/ module (sklearn)    │
                    │  6 tables + indexes       │  │  train-model writes       │
                    │  (migrations + schema.sql)│  │  joblib + metadata, but   │
                    └──────────────┬────────────┘  │  NO route calls predict() │
                                   │               └───────────────────────────┘
                                   ▼
                    ┌──────────────────────────────────────────────────────────┐
                    │   React dashboard (src/) — 9 pages, 4 s polling,         │
                    │   charts (recharts), machine cards, maintenance log,     │
                    │   alerts list (read-only), settings with cURL samples    │
                    └──────────────────────────────────────────────────────────┘
```

**Data flow actually implemented (partial loop):**
`Wokwi/ESP32 → POST /api/sensor-data → PostgreSQL sensor_readings → GET endpoints → React dashboard (live + history)`. Heartbeats maintain `devices.last_seen`. Maintenance records and alerts are CRUD-only; alerts have **no creator**. Predictions/health/XAI are computed only by an engine that is never invoked by the API.

**Communication paths:** HTTPS (Wokwi, TLS verification disabled) / HTTP (real firmware, LAN). JSON over REST. No MQTT. No WebSockets — "live" is 4 s polling.

**External services:** Supabase PostgreSQL (the only external service). A transient ngrok tunnel URL is hardcoded in `wokwi/src/config.h`.

**Deployment boundaries:** backend = uvicorn on :8000; frontend = express/vite on :3000; DB = Supabase. No containerization; Wokwi requires a public tunnel or deployed backend.

---

## 5. Feature Matrix (vs locked `docs/02-FEATURES.md`)

| PredictIQ Feature | Existing? | Working? | Evidence | Decision |
| --- | --- | --- | --- | --- |
| Machine management | YES | WORKING | `POST/GET /api/machines`, `AddMachineModal`; auto-provisioned on first telemetry too | KEEP |
| Device management | YES | WORKING | `POST/GET /api/devices`, heartbeat, status computed from `last_seen` | KEEP |
| Temperature telemetry | YES | WORKING | `POST /api/sensor-data` validation (-50…300 °C); DS18B20 in Wokwi | KEEP |
| Vibration telemetry | PARTIAL | PARTIALLY WORKING | Stored and charted, but Wokwi sends **acceleration magnitude (m/s²)** labeled mm/s — unit contract broken | REFACTOR |
| Current telemetry | PARTIAL | BROKEN (Wokwi) | Wokwi sends raw ADC 0–4095; backend bound is ≤1000 A → **422 rejection** for most pot positions | REFACTOR |
| RPM telemetry | YES | WORKING | Wokwi pulse counter (10 Hz → ~600 RPM), validated ≤60000 | KEEP |
| Live monitoring | YES | WORKING | `LiveMonitoringPage` 1–5 s polling of `/machines/{id}/sensor-data` | KEEP |
| Historical monitoring | YES | WORKING | `MachineDetailsPage` charts from `/machines/{id}/history` + `/sensor-data` | KEEP |
| Health status (NORMAL/WARNING/CRITICAL) | PARTIAL | NOT WORKING | `machines.status` never updated from telemetry; no health engine wired; UI shows "NOMINAL HEALTH" by default | REBUILD |
| Anomaly detection | PARTIAL | NOT WORKING | Rule logic exists in `ai/prediction.py` + `ai/data_validation.py` but is **not invoked by any route**; no alert created | REBUILD |
| Failure prediction | PARTIAL | NOT WORKING | `POST /api/predict` returns a fixed "Not available" stub; real engine disconnected | REFACTOR |
| Explainability | PARTIAL | NOT WORKING | `ai/explainability.py` + `ShapAttributionBar` exist; nothing renders predictions; SHAP not installed | REFACTOR |
| Alerts | PARTIAL | BROKEN | `alerts` table + GET/acknowledge/resolve exist, but **nothing creates alerts** (no producer, no creation endpoint) | REBUILD |
| Maintenance records | YES | WORKING | `POST/GET /api/maintenance`; `MaintenancePage` CRUD; updates machine status | KEEP/REFACTOR |
| Technician feedback | NO | MISSING | No feedback schema, table, or endpoint | REBUILD |
| Root-cause capture | NO | MISSING | No `root_cause` / `actual_fault` / diagnosis fields anywhere | REBUILD |
| Prediction-vs-reality | NO | MISSING | No link between predictions and maintenance outcomes | REBUILD |
| Ground truth | PARTIAL | NOT WORKING | `maintenance_records` exists and is labeled "ground truth" in UI, but has no structured GT fields and is not used as training labels | REFACTOR |
| Learning dataset | PARTIAL | NOT WORKING | Training reads DB, but labels come from thresholds; `failure_events` from maintenance are collected and **never used**; no dataset versioning | REBUILD |
| Wokwi workflow | YES | PARTIALLY WORKING | Sim builds and runs (firmware.bin present), but last recorded run failed TLS to tunnel; unit drift in payload | REFACTOR |
| Online workflow | PARTIAL | UNTESTED | No Docker/CI; needs tunnel or host; Wokwi→API path unverified at audit time | REFACTOR |
| RUL | NO | MISSING | `ai/prediction.py` computes formulaic RUL but it is unreachable; UI shows hardcoded "150 Days" fallback (violates no-fake-RUL) | REBUILD |
| Edge AI | NO | MISSING | None (production-stage feature; not expected in prototype) | — |
| Fleet management | PARTIAL | WORKING (basic) | `/api/stats`, fleet dashboard grid, CSV export; no fleet-level analytics | KEEP |

---

## 6. Backend Audit

**Framework / entry point:** FastAPI app assembled in `backend/main.py`, launched via `python -m uvicorn backend.main:app` (port 8000). Lifespan handler verifies `SELECT 1` and prints engine URL with password hidden. Version string `4.0.0`.

**Route inventory (all under `/api`):**

| Method & path | Router | Status |
| --- | --- | --- |
| GET `/api/health` | main.py | WORKING (verifies `SELECT 1`) |
| GET `/api/stats` | main.py | WORKING (aggregate counts) |
| POST `/api/sensor-data` | sensors.py | WORKING (validation + upsert) |
| GET `/api/sensor-data` | sensors.py | WORKING |
| GET `/api/machines/{id}/latest`, `/history`, `/sensor-data` | sensors.py | WORKING |
| GET/POST `/api/machines`, GET `/api/machines/{id}` | machines.py | WORKING |
| GET/POST `/api/devices`, GET `/api/devices/{id}`, `/{id}/status` | machines.py | WORKING |
| POST `/api/devices/heartbeat` | machines.py | WORKING (upserts device + machine) |
| GET `/api/alerts`, POST `/api/alerts/{id}/acknowledge`, `/resolve` | alerts.py | WORKING but **no producer** |
| GET/POST `/api/maintenance` | maintenance.py | WORKING |
| GET `/api/model-status` | predictions.py | WORKING (reads ai/training status) |
| POST `/api/train-model` | predictions.py | WORKING as coded (see ML audit for data-quality issues) |
| GET `/api/machines/{id}/prediction` | predictions.py | PARTIAL (returns latest stored prediction or stub) |
| POST `/api/predict` | predictions.py | PLACEHOLDER (always returns "Not available") |
| GET `/api/data-status` | sensors.py | WORKING |

**Request/response models & validation — GOOD.** `backend/schemas/sensor.py` is the active schema module: `SensorDataInput` requires `device_id`, `machine_id`, `timestamp`, all four readings, and `source ∈ {WOKWI, REAL_HARDWARE}`; rejects NaN/Inf, enforces physical ranges (temp −50…300 °C, vibration 0…100 mm/s, current 0…1000 A, rpm 0…60000). FastAPI 422s on violations.

**Error handling — ADEQUATE.** Ingest wraps DB work in try/rollback, maps `SQLAlchemyError` to 503 and `HTTPException` re-raised. Heartbeat catches a broad `Exception` → 503. No global exception handler / structured error logging.

**Logging — MINIMAL.** Only `print()` statements. No logging config, no request logging.

**CORS — INSECURE DEFAULT.** `CORS_ORIGINS` defaults to `"*"`; middleware sets `allow_credentials=True` together with `*` (browsers reject credentialed wildcard CORS; and it allows any origin uncredentialed). Deliberate CORS is a locked prototype requirement — currently it is *not* deliberate by default.

**Authentication — NONE.** Every endpoint is unauthenticated. `ESP32_SECRET_TOKEN` is documented in `backend/.env.example` but **never referenced in code**; firmware sends an `X-Device-API-Key` header with a placeholder value that the backend never checks. Device identity is a self-declared string (`device_id`), spoofable.

**Service layer — PARTIAL.** `backend/services/prediction_service.py` bridges to `ai/`, but only `get_status()` and `train_model()` are used by routes. `predict()` is dead code (confirmed: no route or test calls it).

**Business logic gaps:**
- No health/anomaly evaluation on ingest — telemetry is stored, nothing is derived from it.
- No alert creation anywhere.
- No prediction persistence path (`/api/predict` doesn't store; nothing calls it).
- Machine auto-provisioning on telemetry (`name = f"Asset {id}"`) silently creates machines with generic metadata.
- `maintenance.py` flips `machines.status` to `Maintenance`/`Healthy` — the **only** place machine status changes.

**API consistency issues:**
- `get_machine_prediction` has no `response_model`; returns either a `PredictionResponse` or a hand-built dict with different keys (`status`, `prediction` strings vs typed fields).
- `execute_prediction(payload: dict)` takes an untyped dict — no validation.
- Duplicated `compute_device_status`/`get_device_computed_status` in `machines.py` and `sensors.py`.
- Two schema modules named `schemas/sensor.py` (active) and `models/schemas.py` (dead) — confusing.
- Settings page sample cURLs omit required `source`/`timestamp` → they would 422 (frontend doc bug).
- `datetime.utcnow()` is used throughout (deprecated in Python 3.12+; the project venv targets 3.14).

---

## 7. Database Audit

**Technology:** PostgreSQL via Supabase. Connection built in `backend/database/database.py` from `DATABASE_URL` or component vars; `sslmode=require`, pool settings from env. **Schema** maintained by Alembic (2 migrations) with a parallel hand-written DDL in `supabase/schema.sql` (currently in sync, structure only).

**Tables (6):**

| Table | Key columns | Notes |
| --- | --- | --- |
| `machines` | id PK, machine_id unique, name, type, location, status, created_at | FKs use **string machine_id** |
| `devices` | id PK, device_id unique, machine_id FK, device_type, firmware_version, status, last_seen, source, created_at | heartbeat state lives here |
| `sensor_readings` | id PK, machine_id/device_id FKs, timestamp, temperature, vibration, current, rpm, source, created_at | composite indexes on (machine_id, timestamp), (device_id, timestamp) — GOOD |
| `maintenance_records` | id PK, machine_id FK, component, failure_type, issue_description, maintenance_action, technician, status, failure_date, maintenance_date, created_at | treated as "ground truth" but is a work order |
| `predictions` | id PK, machine_id FK, timestamp, failure_probability, component, remaining_life_days, confidence, explanation, recommended_action, model_version, created_at | no rows are ever written by current code |
| `alerts` | id PK, machine_id FK, alert_type, severity, message, status, created_at, resolved_at | no rows are ever written by current code |

**Indexes:** good coverage for time-series reads (timestamp, machine_id+timestamp, device_id+timestamp, alert machine+created, prediction machine+timestamp).

**Constraints:** NOT NULLs, unique machine_id/device_id, cascade deletes, FK integrity. **No CHECK constraints** on status enums (`Healthy/Warning/Critical/Maintenance`, `ACTIVE/ACKNOWLEDGED/RESOLVED`, `WOKWI/REAL_HARDWARE`) — invalid strings would pass.

**Timestamps — RISK.** Schema columns are `DateTime` (naive). Ingest stores `payload.timestamp` (an *aware* datetime when Wokwi sends `...Z`) into `sensor_readings.timestamp`, while `created_at` uses naive `datetime.utcnow()`. Comparisons in status logic use naive `datetime.utcnow()` against values read back from naive columns. This *likely* works only if the session/DB timezone is UTC; mixing aware writes and naive defaults is fragile. **Unable to verify** against a live DB (no DB access at audit time) — flag for a normalization migration (`timestamptz`).

**Can the schema support the full PredictIQ loop? NO.** The prediction→maintenance→feedback→ground-truth loop needs:
- a `prediction_id` reference on maintenance/feedback records;
- structured feedback fields (`actual_fault`, `root_cause`, `symptoms`, `action_taken`, `parts_replaced`, `severity`, `outcome`, `prediction_correct`, technician notes, timestamps);
- a prediction-vs-reality comparison store (predicted vs actual per machine/date);
- ground-truth/dataset bookkeeping (dataset version, label source, curation status);
- machine specifications (rated_rpm, rated_current, max_temp, max_vibration) — currently **not stored at all** even though the UI collects them and the ML engine needs them;
- alert severity/threshold configuration.

All of the above are MISSING.

---

## 8. Frontend Audit

**Framework:** React 19 + TypeScript, Vite, Tailwind v4, Recharts. 9 pages in `src/pages/`, 7 components. State is local `useState` per page + `App.tsx`-level fleet state; no router library (tab-based navigation); no state-management library (fine at this size). Polling: fleet every 4 s, live monitor 1–5 s, alerts 5 s.

**What works:**
- Dashboard with KPI cards, search/filter, machine grid; fleet stats from `/api/stats`.
- Machines list (table + grid), machine details with 4 live gauges and history charts (temp/vib/current/RPM).
- Live monitoring stream + packet log.
- Maintenance log with modal form.
- Alerts list with acknowledge/resolve actions.
- Sensor data table with CSV export.
- Settings page: custom API URL override (persisted in localStorage), health probe, cURL samples (one buggy — missing `source`/`timestamp`).
- Manual telemetry entry modal (real values, stored to DB) — the demo path that works today.
- Error/empty states are generally present and honest ("No fake synthetic waveforms are generated").

**What is broken / misleading:**
1. **Prediction display is dead.** `MachineDetailsPage` fetches `prediction` but renders four hardcoded "Not available" cards; the fetched object is never used. Same static "Not available" cards in `PredictionsPage`.
2. **Machines table reads non-existent API fields.** `MachinesPage` uses `m.current_reading`, `m.latest_prediction`, `m.esp32_device_id` — the API returns `latest_reading`, `devices`, and no `esp32_device_id`. Result: AI risk column always "Not available", and RUL column shows a **hardcoded "150 Days"** fallback — a direct violation of the locked "never invent RUL" rule.
3. **`ShapAttributionBar` (full XAI UI) is never used** — dead component.
4. **Machine specs are dropped.** `AddMachineModal` sends `specifications` (rated RPM/current, max temp/vib, bearing type); the backend `MachineCreate` schema has no such field and Pydantic v2 silently ignores extras → thresholds never persist. The ML engine then uses hardcoded defaults (1450 RPM / 10 A / 75 °C / 4.5 mm/s).
5. **`App.tsx` hardcodes initial `selectedMachineId='M001'`** and `criticalMachinesCount={0}` for the sidebar badge.
6. Sidebar footer hardcodes "Model: PhysicsRule v2.4" and "API Gateway ONLINE" regardless of actual state (cosmetic but misleading).
7. Frontend types diverge from API shapes (e.g., `DataCollectionStatus.sensor_status` typed `CONNECTED/OFFLINE` vs API `ONLINE/OFFLINE`).

**Reuse verdict:** The UI is a genuinely solid, modern dashboard foundation — **KEEP and extend** (wire predictions/health/XAI, fix field mismatches, remove the "150 Days" fallback). No frontend tests exist.

---

## 9. ESP32 / Wokwi Audit

### Real-hardware firmware (`esp32/`)
- **IMPLEMENTED as a skeleton, WORKING only for heartbeats.** Modular `sensors.{h,cpp}` has clean status enum (`CONNECTED/DISCONNECTED/ERROR/NOT_CONFIGURED`) and all four drivers are commented-out hooks — on real hardware today every sensor returns `NOT_CONFIGURED`, so `sendSensorTelemetry()` skips `/api/sensor-data` and sends heartbeats only. This is honest and matches the README's zero-fake-data policy.
- **Contract bug:** `config.h` sets `SENSOR_SOURCE "WOKWI"` — real hardware would label itself WOKWI. Must be `REAL_HARDWARE` (or configurable).
- **Contract mismatch:** `api_client.cpp` builds a payload with *only the valid fields*, but the backend `SensorDataInput` requires **all four** readings — a device with 3 of 4 sensors connected would get 422. Partial-reading support is missing on the API side.
- Sends `X-Device-API-Key` with a placeholder token; backend ignores it (auth placeholder).
- NTP gate for telemetry (no timestamp → skip) is good. Non-blocking loop, watchdog-friendly `delay(10)`.
- Uses plain HTTP on LAN (acceptable for prototype; no secrets in payload).

### Wokwi simulation (`wokwi/`)
- Board ESP32-S3 DevKitC-1; sensors: DS18B20 (static 24 °C), MPU6050, potentiometer (labeled "current"), 10 Hz clock generator (RPM). Firmware compiled (`.pio/build/.../firmware.bin` exists) with libdeps installed.
- **Unit drift vs the locked telemetry contract (ADR-002 violation):**
  - Vibration is sent as **raw acceleration magnitude in m/s²** but displayed/stored as mm/s. The API accepts it numerically (0–100 bound) but the units are physically wrong.
  - Current is sent as **raw ADC count 0–4095** (potentiometer default 2048). Backend bound is 0–1000 A → **the default Wokwi current reading is rejected with 422**.
  - The Wokwi README acknowledges both ("No vibration-velocity calibration is invented", "raw ADC value … no ACS712 component"), which is honest but means the simulation cannot currently satisfy the contract as-is.
- **TLS:** `api_client.cpp` uses `WiFiClientSecure` + `client.setInsecure()` (documented as test-only for ngrok). The backup file predates the `setInsecure` fix.
- **Last recorded run failed:** `wokwi/wokwi-debug.txt` shows repeated `start_ssl_client: -80 UNKNOWN ERROR` TLS errors against the configured ngrok URL and a 60 s simulation timeout. Whether the current `setInsecure()` code fixes this **could not be verified** (no live tunnel; tunnel URL in `config.h` is transient and will expire).
- **Config:** `API_BASE_URL` hardcodes a specific ngrok URL; Wi-Fi = `Wokwi-GUEST`; heartbeat 30 s; sample 5 s. Fine structure, needs deployment-owned config.

### Verdict
Firmware code structure is **KEEP/REFACTOR**; the Wokwi sensor→payload mapping must be **fixed to emit contract units** (calibrate vibration to mm/s RMS scale, map ADC to plausible amperes, or change the backend bounds deliberately and document the mapping). ADR-002 is currently violated.

---

## 10. AI/ML Audit

This section carefully separates **real ML**, **rule-based logic**, and **placeholders**:

### What is real
- `ai/training.py`: genuine scikit-learn `RandomForestClassifier` pipeline — feature extraction from DB readings, `.fit()`, optional `cross_val_score`, `joblib.dump`, metadata JSON. Invoked by `POST /api/train-model`.
- `ai/prediction.py`: real inference path `model.predict_proba()` when a model artifact exists; feature vector via `ai/feature_engineering.py` (10 features).
- `ai/explainability.py`: real `shap.TreeExplainer` **if SHAP were installed** — it is **not** in `requirements.txt` and not installed, so the code always takes the physics-attribution fallback today.

### What is rule-based (not ML)
- Component diagnosis thresholds (`v_norm > 1.2 && t_norm > 1.0 → Bearing`, etc.).
- **RUL formula** (probability-bucketed 1–90 days interpolation) — a deterministic formula, not a learned estimate.
- **Confidence formula** (`0.82 + 0.14·|p−0.5|·2`, clamped 0.75–0.96) — invented, not a calibration metric. This conflicts with the locked rule "Never invent accuracy, confidence, or RUL".
- Physics-based failure probability (`_compute_physics_prob`, sigmoid of normalized stress).
- `recommendation.py` string generation; `data_validation.py` envelope checks.

### What is placeholder / disconnected
- No API route calls the prediction engine (dead `predict()` path). `POST /api/predict` returns a fixed stub. `/api/machines/{id}/prediction` returns "Not available" unless a row exists in `predictions` — which nothing ever writes.
- `ai/model/` contains **no trained artifacts** (README only).
- `get_model_status()` reports "trained" only if metadata+joblib exist — honest, but unreachable in practice without manual training.

### Data-quality problems in training
- **Labels are threshold rules, not ground truth.** In `training.py`, `is_failed = 1 if v > max_vib·1.2 or t > max_temp·1.15`, and component labels are threshold branches. The `failure_events` parsed from maintenance records are **built but never used** — the maintenance "ground truth" is ignored by the labeler.
- **Metrics can be trivially perfect.** With fewer than 5 samples, or a single class, `cv_scores = [1.0]` → accuracy 1.0 and `f1_score = accuracy` (a fake F1); metadata writes `"validation_status": "Passed"`. Violates the locked governance rules ("never invent accuracy").
- No train/validation/test split, no feature parity check, no dataset versioning, no evaluation report.
- `MIN_READINGS_TO_TRAIN = 20` is far below anything meaningful.
- Machine specs come from hardcoded defaults because they are never persisted (see Frontend/Database audits).

### Verdict
The `ai/` module is a **useful foundation to refactor**, not production ML. For the prototype, the locked strategy says Level 1 (deterministic rules, honestly labeled) is acceptable — the current system's *public* behavior ("Not available") is honest — but the internal engine would emit invented confidence/RUL if wired up. Reconnect it deliberately, label outputs as prototype/rule-based, fix labeling to use real maintenance ground truth, and never report fake F1/accuracy.

---

## 11. Maintenance & Feedback Loop Audit

Traced against the locked loop (docs/03):

| Step | Status | Evidence |
| --- | --- | --- |
| Prediction | NOT WORKING | Engine disconnected; `/api/predict` stub; `predictions` table never written |
| Alert | BROKEN | No producer; only list/acknowledge/resolve |
| Technician inspection | PARTIAL | `MaintenancePage` modal (issue description, action, component, tech, status) |
| Actual diagnosis | MISSING | No diagnosis field beyond free-text `issue_description` |
| Root cause | MISSING | No `root_cause` field |
| Repair | PARTIAL | `maintenance_action` free text |
| Outcome | MISSING | Only status strings (Scheduled/In Progress/Completed) |
| Feedback | MISSING | No feedback endpoint or schema |
| Ground truth | PARTIAL/NOT WORKING | `maintenance_records` called "ground truth" in UI, but not structured and **ignored by training labels** |

Field check against the locked list (`actual_fault`, `root_cause`, `diagnosis`, `action_taken`, `parts_replaced`, `severity`, `outcome`, `technician_notes`, `prediction_id`, `prediction_correct`): **none of these exist**. `MaintenanceCreate`/`MaintenanceResponse` (backend/schemas/sensor.py) contain only `component`, `failure_type`, `issue_description`, `maintenance_action`, `technician`, `status`, `failure_date`, `maintenance_date`.

**Conclusion:** "maintenance" exists as a work-order log; **the feedback loop does not exist.** This is the single biggest differentiator gap versus the locked product.

---

## 12. Testing Audit

| Test type | Exists? | Result |
| --- | --- | --- |
| Unit tests | NO | — |
| API/integration tests | NO | — |
| Frontend tests | NO | — |
| Firmware tests | NO | — |
| ML evaluation | NO | — |
| E2E | NO | — |
| Type check | `npm run lint` (tsc --noEmit) | **PASSED** (0 errors) |
| Python syntax | all 5,611 `.py` files parsed (excluding .venv/.pio) | **PASSED** |
| DB connectivity script | `backend/test_db.py` | **Could not run** — requires the live Supabase credentials and working interpreter (see below) |

**Why the backend could not be executed:**
- The bundled `.venv` is broken: `python.exe` references `C:\Users\SRI_CS\AppData\Local\Programs\Python\Python314\python.exe`, which no longer exists ("did not find executable").
- System `python` (3.14) has none of the dependencies (`ModuleNotFoundError: fastapi`, `dotenv`, …).
- Installing dependencies (system-wide or a fresh venv inside the project) would modify the environment/project, which this read-only audit must not do.

Therefore: **runtime behavior of the FastAPI app, DB session, and end-to-end flow is UNTESTED/UNVERIFIED in this audit**; all backend findings are from code inspection, which is reported explicitly as static analysis. The acceptance rule ("end-to-end demo must work without manually editing database records") **cannot currently be met or demonstrated**.

---

## 13. Deployment Audit

| Concern | Status |
| --- | --- |
| Docker / docker-compose | NONE |
| CI/CD (GitHub Actions etc.) | NONE |
| Cloud config (Fly/Render/Vercel/etc.) | NONE |
| Frontend deployment | Express server (`dist/server.cjs`) + built `dist/`; works as static SPA server |
| Backend deployment | `uvicorn backend.main:app`; env-driven |
| Database | Supabase (external), `sslmode=require` |
| Wokwi reachability | Requires public HTTPS tunnel or deployed backend; ngrok URL hardcoded in `wokwi/src/config.h` (transient) |
| CORS | Default `*` + credentials (insecure default) |
| Secrets | `.env` files gitignored (good) but contain real credentials on disk (see Security) |
| Production readiness | **NOT PRODUCTION-READY** |

Classification: **LOCAL** (dev machine) and **SIMULATED** (Wokwi) only. **ONLINE** is architecturally possible (tunnel/deploy + VITE_API_URL) but was **unverified** at audit time, and there is no repeatable deployment story.

---

## 14. Security Audit

> No secret values are reproduced in this report. Locations and types are listed so the team can rotate/remove them.

| Finding | Location | Severity | Detail |
| --- | --- | --- | --- |
| Real database credentials on disk | `.env` (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`); `backend/.env` (`DB_HOST/PORT/NAME/USER/PASSWORD`) | HIGH | Files are gitignored (not committed), but any copy/share/backup exposes them. Rotate the Supabase service-role/secret key and DB password; keep secrets out of the repo tree entirely (env-only, injected at deploy). |
| Real ngrok authtoken stored in `.env` | `.env` (an `ngrok config add-authtoken …` command line embedded in the env file) | HIGH | A live tunnel token embedded in a config file; also a sign of shell output pasted into the file. Rotate the ngrok token. |
| PowerShell command line embedded in env file | `backend/.env` (`$env:WOKWI_CLI_TOKEN = …`) | MEDIUM | Leftover terminal session text; remove; env files must be key=value only. |
| No authentication on any endpoint | all `/api/*` | HIGH (prototype-acceptable, but flag) | Anyone can POST telemetry/maintenance/alerts or read all data. Locked docs list auth as production; prototype should at least gate writes. |
| Device auth placeholder | `ESP32_SECRET_TOKEN` defined but unused; firmware sends `X-Device-API-Key` with placeholder; backend never checks it | HIGH | Devices are self-identifying; spoofable. Either implement the token check or remove the dead config. |
| CORS wildcard + credentials | `backend/main.py` default `CORS_ORIGINS=*`, `allow_credentials=True` | MEDIUM | Insecure default; browsers reject credentialed `*` anyway. Restrict origins deliberately. |
| TLS verification disabled | `wokwi/src/api_client.cpp` `client.setInsecure()` | MEDIUM | Documented test-only; never ship to production hardware. |
| Placeholder API key literal | `esp32/config.h` `DEVICE_API_KEY "YOUR_SECURE_DEVICE_API_KEY_HERE"` | LOW | Placeholder only; no secret value. |
| SQL injection | — | NONE FOUND | All queries via SQLAlchemy ORM / parameterized `text()` (`SELECT 1`, `SELECT version()`). |
| Sensitive data in logs/payloads | — | LOW | Heartbeat/telemetry payloads are printed to serial/console; no credentials included. |

**Note:** because `.env` is gitignored, none of these values appear in git history. The exposure risk is local-disk/backup/copy leakage, plus the fact that they are real credentials on a dev machine.

---

## 15. Code Quality Audit

**Strengths (concrete):**
- Clean layered backend: routers → services → database; schemas centralized in one active module.
- Good input validation with physical bounds and NaN/Inf rejection (`backend/schemas/sensor.py`).
- Strong, consistent honesty discipline: comments, README, UI copy, and firmware all refuse to fabricate data; Wokwi README openly documents unit limitations.
- Indexed time-series schema; composite indexes for the main query paths.
- Non-blocking firmware loop, modular sensor/WiFi/API separation in both firmware targets.
- Frontend is well-organized (pages/components/services), consistent dark theme, good empty/error states, tsc-clean.

**Weaknesses (concrete):**
- **Dead code:** `backend/models/schemas.py`, `backend/database/init_db.py`, `ShapAttributionBar.tsx`, `prediction_service.predict()`, `POST /api/predict`, `@google/genai` dependency, `.backup` file.
- **Duplication:** two device-status functions; two firmware implementations diverged; two lockfiles; two schema sources (alembic + supabase/schema.sql) that must be kept in sync manually.
- **Frontend/backend contract drift:** field names (`current_reading` vs `latest_reading`), types (`ONLINE` vs `CONNECTED`), settings cURL samples that fail validation, hardcoded "150 Days".
- **Silent data loss:** `specifications` payload silently ignored by Pydantic (machine thresholds lost); UI never notices.
- **Unsafe/ambiguous typing:** `execute_prediction(payload: dict)`, prediction endpoint returning two different shapes, `import.meta as any`.
- **Naming:** two different `models.py`/`schemas.py` modules with overlapping names.
- **Config sprawl:** `SENSOR_SOURCE` hardcoded per-target; ngrok URL in firmware; `DEVICE_TIMEOUT_SECONDS` duplicated as module-level constants in two routers instead of one config module.
- **Deprecated APIs:** `datetime.utcnow()` everywhere; `Config.from_attributes` (v2) used via deprecated `from_orm`.
- **Versioning:** package name `react-example`, metadata claims Gemini capability with no implementation, FastAPI app version `4.0.0` vs README "staging".

**Type safety:** backend strong (Pydantic); frontend passes `tsc --noEmit` but relies on `any` in several spots.

---

## 16. Reuse Analysis

| Component | Decision | Reason | Effort | Risk |
| --- | --- | --- | --- | --- |
| Backend (FastAPI, routers, validation) | **REFACTOR** | Solid foundation: validation, routers, error handling. Needs: health/anomaly engine wired to ingest, alert producer, prediction persistence, partial-reading support, config module, auth gate. | Medium | Low–Medium |
| Database schema + migrations | **REFACTOR** | Good base and indexes. Needs: `timestamptz` normalization, machine specs columns, feedback/ground-truth + prediction link, alert config, CHECK constraints. | Medium | Medium (data migration) |
| Frontend dashboard | **KEEP** (with fixes) | Polished, modern, mostly honest UI. Fix field mismatches, wire prediction/XAI rendering, remove "150 Days" fallback, remove dead component. | Medium | Low |
| Firmware (esp32 real) | **REFACTOR** | Clean skeleton, honest NOT_CONFIGURED behavior. Fix `SENSOR_SOURCE`, implement sensor drivers, align payload (all-or-partial readings) with API. | Medium | Medium (hardware) |
| Wokwi simulation | **REFACTOR** | Structure and build are fine; telemetry **units must be aligned** with the contract (vibration mm/s mapping, current in A). Verify TLS/tunnel path. | Small–Medium | Medium |
| ML module (`ai/`) | **REFACTOR** | Real sklearn code worth keeping, but reconnect to API, relabel from actual ground truth, honest metrics, remove fake confidence/RUL or label as rule-based prototype. | Medium | Medium |
| Alerts | **REBUILD** | Only CRUD exists; need a producer (health engine), creation endpoint, lifecycle wiring, and thresholds. | Small–Medium | Low |
| Maintenance | **REFACTOR** | Work-order CRUD works; extend to structured feedback fields + prediction link. | Medium | Low |
| Feedback / Ground truth | **REBUILD** | Entirely missing. | Medium | Low |
| Supabase schema.sql | **REFACTOR** | Keep as a deployment convenience but make it generated from Alembic to avoid drift. | Small | Low |
| Docs/README (project) | **KEEP** | Accurate and honest; update when architecture changes. | Small | Low |

---

## 17. Technical Debt Register

| ID | Class | Item | Why it matters |
| --- | --- | --- | --- |
| TD-1 | CRITICAL | No alert producer / no health engine | The prototype cannot demonstrate the locked "abnormal behavior → health/alert/prediction" DoD at all. |
| TD-2 | CRITICAL | Feedback/ground-truth loop missing | Core product differentiator absent; training cannot use real labels. |
| TD-3 | CRITICAL | ML engine disconnected + fake metrics possible | Either the system is honest-but-stub ("Not available") or it could emit invented confidence/RUL/F1; the code currently supports the bad path. |
| TD-4 | HIGH | Wokwi telemetry units violate contract (ADC as A, accel as mm/s) | Violates ADR-002; default current reading is rejected 422 by the API. |
| TD-5 | HIGH | Machine specs (rated RPM/current, thresholds) not persisted | UI collects them, backend drops them; ML uses hardcoded defaults for every machine. |
| TD-6 | HIGH | Secrets on disk (Supabase keys, ngrok token) | Credential leakage risk; requires rotation. |
| TD-7 | HIGH | No git history (all code untracked, 1 commit) | ADR-008 violated; no meaningful engineering history; risk of losing provenance. |
| TD-8 | HIGH | No tests / no CI | Nothing protects regressions; backend runtime completely unverified. |
| TD-9 | MEDIUM | Timestamp tz inconsistency (naive vs aware) | Potential offline-status/ordering bugs; unverified against live DB. |
| TD-10 | MEDIUM | Dead code + duplicates (2 schema modules, 2 firmware trees, backup file, unused component/deps) | Maintenance confusion, divergent behavior risk. |
| TD-11 | MEDIUM | Frontend/backend contract drift (field names, "150 Days" fallback, buggy cURL samples) | Misleading UI; can violate the no-fake-RUL rule. |
| TD-12 | MEDIUM | No authentication; device token config unused | Prototype-acceptable but any online exposure is wide open. |
| TD-13 | MEDIUM | CORS default `*` + credentials | Insecure default; blocks legitimate credentialed cross-origin use. |
| TD-14 | LOW | Deprecated APIs (`datetime.utcnow`, `from_orm`), hardcoded model/version strings in UI | Maintenance and honesty polish. |
| TD-15 | LOW | Broken `.venv` committed to disk | Reproducibility issue for the next developer. |

---

## 18. Gaps vs Locked Requirements

**LOCKED:** Wokwi generates telemetry → ESP32 sends it online → API validates → PostgreSQL stores → dashboard live/history → abnormal behavior produces health/alert/prediction → explanation → technician maintenance+feedback → structured ground truth.
**CURRENT:** Wokwi sends telemetry (units off) → API validates → DB stores → dashboard shows it. That's where the chain stops.
**GAP:** health evaluation, alert creation, prediction, explanation surfacing, feedback capture, ground-truth structuring.
**WORK REQUIRED:** health engine on ingest; alert producer + UI; prediction persistence + display; XAI wiring; feedback schema/API/UI; ground-truth table; train on real labels.

**LOCKED (docs/02):** Machine management, device registration & heartbeat, 4-channel telemetry, live/history, NORMAL/WARNING/CRITICAL, anomaly/risk output, alerts lifecycle, prediction explanation, maintenance records, technician diagnosis & root cause, prediction-vs-reality, ground-truth storage, online deployment.
**CURRENT:** machine mgmt ✓, devices+heartbeat ✓, 4-channel telemetry (units broken for 2 channels) ✓/✗, live ✓, history ✓, health ✗, anomaly ✗, risk ✗ (stub), alert lifecycle half (no create) ✗, explanation ✗ (engine unreachable), maintenance ✓, diagnosis/root cause ✗, prediction-vs-reality ✗, ground truth ✗, online ✗ (unverified, no deployment story).

**LOCKED (docs/03 feedback fields):** machine_id ✓ (via maintenance), prediction_id ✗, observed condition ✗, actual fault/root cause ✗, symptoms ✗, action taken ✓ (free text), parts replaced ✗, severity ✗, outcome ✗, technician notes ✗, timestamps ✓.
**WORK REQUIRED:** new `maintenance_feedback` table + `/api/feedback` POST/GET + UI form tied to a prediction/alert; training consumes these labels; prediction-vs-reality report.

**LOCKED (docs/05 contract):** `{device_id, machine_id, timestamp, temperature, vibration, current, rpm}` — the backend matches this shape exactly; the **Wokwi firmware** does not (units). Backend validation is stricter than the firmware can satisfy for partial sensors.

**LOCKED (docs/06 AI/ML):** Level 1 prototype = deterministic rules proving the workflow, no industrial claims. The current public posture ("Not available") is Level-0 honest; the internal engine is Level-1-ish but disconnected and with dishonest metric code paths. Production rules (versioning, dataset version, metrics, eval date, deployment status) are only sketched in `metadata.json`.

**LOCKED (docs/08 acceptance):** end-to-end demo without manually editing DB rows — **not met**.

**LOCKED (docs/09 security):** prototype requires no secrets in git ✓ (gitignored), env vars ✓, input validation ✓, deliberate CORS ✗ (wildcard default), safe error handling ✓/~.

**LOCKED (docs/10 ADRs):** ADR-001 Wokwi-first ✓; ADR-002 same contract ✗ (units drift); ADR-003 prototype health before ML ~ (engine exists, unwired); ADR-004 feedback first-class ✗; ADR-005 controlled improvement ~ (no auto-retrain, good); ADR-006 no fake RUL ✗ (UI "150 Days" fallback; engine RUL formula); ADR-007 audit before reuse ✓ (this audit); ADR-008 meaningful git history ✗ (single commit, all code untracked).

---

## 19. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Wokwi telemetry rejected by API (current unit drift) | HIGH | High (demo fails at first step) | Align units; fix `readCurrent`/`readVibration`; add contract tests |
| R2 | Secrets (Supabase + ngrok) already exposed via local files | MEDIUM | High | Rotate now; remove tokens from `.env`; use secret manager at deploy |
| R3 | Timestamp tz bugs corrupt offline/ordering logic | MEDIUM | Medium | Normalize to `timestamptz`; test heartbeat timeout |
| R4 | Backend runtime unverified (no deps, broken venv) | HIGH (for this audit) | Medium | Reproduce in fresh env; add CI that installs and runs tests |
| R5 | Wokwi→tunnel TLS path broken (last log showed SSL errors) | MEDIUM | High | Re-test with current `setInsecure` code and a live tunnel; then replace with real hosting |
| R6 | Train-model reports fake 100% accuracy / fake F1 | MEDIUM (if someone runs it) | High (trust damage) | Require labeled positives, real split, honest metrics; gate training |
| R7 | Machine specs silently dropped → wrong thresholds per asset | HIGH (today) | Medium | Persist specs; remove hardcoded defaults |
| R8 | No auth on any endpoint once exposed online | HIGH (if deployed) | High | Add write-gate token before any online deploy |
| R9 | `predictions`/`alerts` tables accumulate nothing → UI appears broken | HIGH (today) | Medium | Wire producers before demo |

---

## 20. Recommended Implementation Order (based on this audit only)

1. **Rotate exposed secrets; clean `.env` files** (remove ngrok token + PowerShell leftovers). *(0.5 day)*
2. **Repository foundation:** commit the existing code with meaningful history (ADR-008), decide monorepo layout, remove dead code (2 schema modules, init_db, backup file, unused dep), single lockfile.
3. **Reproducible environment + baseline tests:** fresh venv, `pytest` scaffold for validation & API (FastAPI TestClient), CI that runs `tsc --noEmit` + pytest. This unblocks all later steps.
4. **Fix the telemetry contract:** Wokwi units (vibration in mm/s scale, current in A), backend partial-reading support, `SENSOR_SOURCE` fix in `esp32/config.h`, contract tests for the payload.
5. **Normalize database:** `timestamptz`, machine spec columns, CHECK constraints; keep alembic as single source of truth.
6. **Health engine + alert producer:** on ingest, evaluate NORMAL/WARNING/CRITICAL, update `machines.status`, insert `alerts`; alert lifecycle already exists.
7. **Reconnect prediction + explanation:** invoke `prediction_service.predict()` on ingest (Level-1 rules, labeled "prototype"), persist `predictions`, fix MachineDetails/Predictions pages to render real values; remove "150 Days" fallback; wire `ShapAttributionBar`.
8. **Maintenance → feedback → ground truth:** add feedback schema/table/endpoint/UI with `prediction_id`, `actual_fault`, `root_cause`, `severity`, `outcome`, `prediction_correct`; prediction-vs-reality view.
9. **Honest ML:** relabel training from real feedback, real train/validation split, honest metrics; keep rules as Level 1 until real data exists.
10. **Online deployment:** deploy FastAPI + Supabase to a real host (or stable tunnel), point Wokwi at it, verify the full loop end-to-end; restrict CORS; add write auth.
11. **End-to-end demo & prototype release** per docs/08 scenarios (normal, degradation, abnormal, critical, offline, maintenance+feedback).

---

## 21. Final KEEP / REFACTOR / REPLACE / REBUILD Matrix

| Component | Decision | One-line reason |
| --- | --- | --- |
| Backend (FastAPI core, routers, validation) | **REFACTOR** | Strong base; needs health/alerts/prediction wiring and config cleanup |
| Database schema + Alembic | **REFACTOR** | Good schema/indexes; add feedback, specs, tz, constraints |
| Frontend dashboard | **KEEP** (+fixes) | Polished and honest; repair field drift and wire prediction/XAI |
| Firmware (esp32/) | **REFACTOR** | Clean skeleton; fix source tag, implement drivers, align payload |
| Wokwi simulation | **REFACTOR** | Fix telemetry units + verify tunnel path |
| ML module (ai/) | **REFACTOR** | Real code but disconnected; honest labeling/metrics needed |
| Alerts | **REBUILD** | Producer and creation flow entirely missing |
| Maintenance | **REFACTOR** | Work-order CRUD works; extend into feedback |
| Feedback / Ground truth | **REBUILD** | Missing entirely — the differentiator |
| Predictions API | **REBUILD** | Stub only; replace with persisted, honest Level-1 output |
| Deployment (Docker/CI) | **REBUILD** | None exists; build minimal repeatable setup |
| Project docs/README | **KEEP** | Accurate and honest; update alongside changes |

---

## 22. Verification Limitations (explicit)

- **Backend runtime:** not executed. Broken `.venv` (missing base interpreter) and no system dependencies. All backend findings are **static code inspection**.
- **Database behavior:** no connection attempted (requires live credentials and would be a production-adjacent action). Timestamp/timezone concerns are **unverified**.
- **Wokwi live run:** not re-run. Last recorded run (`wokwi-debug.txt`) shows TLS failure + timeout; current code contains a `setInsecure()` fix that may address it — **unable to verify**.
- **Frontend:** `npm run lint` (tsc) passed; pages were not exercised in a browser against a live backend.
- **Training/ML:** pipeline inspected statically; no model artifacts exist; metrics path can produce misleading values by construction.
- Wherever the report says **"Unable to verify"**, treat the statement as unconfirmed, not as a pass.