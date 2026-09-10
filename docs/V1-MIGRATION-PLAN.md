# PredictIQ — V1 Migration Plan

**Status:** PLANNING ONLY — nothing implemented, nothing approved yet.
**Inputs:** `docs/00-PROJECT-CHARTER.md` … `docs/11-DIRECTORY-GUIDE.md` (locked scope) and `docs/AUDIT-PROJECT-V0.md` (V0 audit, 2026-09-10).
**Constraints honored by this plan:**
- `audit/projectv0/predict-iq/` is the **frozen reference implementation**. V0 is not modified, copied, moved, refactored, or deleted by this plan.
- This document is a **plan only**: no implementation code is created, no database or schema changes, no firmware or frontend changes.
- No claim of "works" is made where the audit could not verify it; **"Unable to verify"** statuses are carried forward explicitly (§14).

**Target workflow this plan must deliver (the acceptance spine):**

```text
Wokwi → ESP32-S3 → temperature/vibration/current/RPM → telemetry API
→ PostgreSQL → health engine → prediction → explanation → alert
→ dashboard → maintenance → technician feedback → actual root cause
→ ground truth → model evaluation
```

---

## 1. Executive Summary

V0 (`audit/projectv0/predict-iq/`) is a **well-structured, honest, but incomplete prototype**. It delivers roughly the first third of the locked workflow: Wokwi/ESP32 telemetry reaches the API, is validated (`backend/schemas/sensor.py`), and is stored in PostgreSQL with a sound indexed schema; the React dashboard displays live and historical data; maintenance work-order CRUD exists. The audit classifies the backend core, dashboard, and firmware skeletons as **KEEP/REFACTOR foundations**.

The rest of the locked loop **does not exist or is disconnected**:

- **No alert producer and no health engine wired to telemetry** — the `alerts` table has CRUD but nothing ever creates a row; `machines.status` never changes from telemetry (audit TD-1).
- **The AI/ML engine is unreachable** — no route calls `prediction_service.predict()`; `POST /api/predict` returns a stub; the `predictions` table is never written; and if wired up as-is, the engine would emit **invented confidence and formula RUL**, and training can report **fake 100% accuracy/F1** (audit TD-3).
- **The feedback/ground-truth loop — the product differentiator — is entirely missing** (audit TD-2): no `prediction_id` link, no `actual_fault`/`root_cause`/`severity`/`outcome` fields, no `/api/feedback`.
- **The telemetry contract is violated by Wokwi** (ADR-002; audit TD-4): vibration is sent as raw MPU6050 acceleration (m/s²) labeled mm/s, and current is sent as raw ADC counts 0–4095, which the backend's 0–1000 A bound **rejects with 422** for most pot positions.
- **Security debt**: real Supabase credentials and an ngrok authtoken sit in local `.env` files (rotation required, audit TD-6); CORS defaults to `*` with credentials; the device-token config is dead.
- **No tests, no CI, no Docker, no meaningful git history** (all code untracked; audit TD-7/TD-8). The backend **was never executed** at audit time (broken `.venv`) — runtime behavior is **"Unable to verify"**, and the last recorded Wokwi run shows TLS failures against a transient ngrok tunnel.

**Migration verdict:** V1 is a **reuse-first migration with surgical rebuilds**. KEEP the honest plumbing (ingestion, validation, ORM schema, migrations, Wokwi wiring/loop, alerts CRUD, dashboard shell, explainability, `ShapAttributionBar`). REFACTOR the disconnected engine into an honest Level-1 (deterministic, labeled prototype) service. REBUILD the missing differentiators (health engine, alert producer, feedback/ground truth, deployment, tests). REPLACE nothing wholesale except stub/fake behaviors. The nine phases below reach the full locked workflow end-to-end, with a dedicated **Phase 0.5 telemetry-contract verification gate** before anything downstream is built.

---

## 2. V0 → V1 Architecture Mapping

### 2.1 V0 architecture (as audited — what actually runs today)

```text
Wokwi (units drift) ─┐
                     ├→ ngrok tunnel (TLS unverified) → FastAPI (no auth, CORS *)
Real ESP32 (no sensors)┘        │  POST /api/sensor-data (validated)
                                ▼
                     PostgreSQL/Supabase (6 tables, Alembic 001–002)
                                │
                ┌───────────────┴─────────────────┐
                ▼                                 ▼
     React dashboard (4 s polling)      ai/ module (sklearn) — DISCONNECTED
     live/history/maintenance/alerts    (no route calls predict(); predictions
     (prediction cards = placeholders)   and alerts tables never written)
```

Known gaps marked by the audit: no health evaluation on ingest, no alert producer, no feedback/ground truth, no deployment story.

### 2.2 V1 target architecture

```text
                    ┌──────────────────────────────┐
Wokwi (fixed units) │ firmware/wokwi  ESP32-S3     │  temperature · vibration · current · rpm
Real ESP32-S3 ──────┤ firmware/esp32 (Phase 7)     │  one telemetry contract (ADR-002)
                    └──────────────┬───────────────┘
                                   │ HTTPS · source: WOKWI | REAL_HARDWARE
                                   ▼
                    ┌──────────────────────────────┐
                    │ backend/app (FastAPI)        │
                    │  telemetry API (validation)  │
                    │      → health_engine.py      │  NORMAL / WARNING / CRITICAL
                    │      → alert producer        │  alerts lifecycle (producer + CRUD)
                    │      → prediction service    │  honest Level-1, persisted, is_prototype
                    │      → explainability        │  contributors + reasons (ShapAttributionBar)
                    └──────────────┬───────────────┘
                                   ▼
                    PostgreSQL (Alembic: 001,002 kept + 003+ new:
                    timestamptz, machine specs, feedback/ground truth)
                                   ▼
                    frontend/ (React dashboard: real values, no placeholders)
                                   ▼
                    maintenance → /api/feedback (root cause, outcome,
                    prediction_correct) → curated ground truth
                                   ▼
                    ml/ evaluation (real labels, honest metrics, versioned)
```

### 2.3 Mapping decisions

| V0 concept | V1 target | Change |
| --- | --- | --- |
| `backend/` (FastAPI, routers, schemas, database) | `backend/app/{api,db,schemas,services,core}` | Rehomed + single schema module + central config |
| `ai/` standalone ML module | `backend/app/services/` (prediction/health) + `ml/` (training/evaluation) | Engine reconnected; training separated and gated |
| `alembic/` + `supabase/schema.sql` | `backend/alembic/` only | Alembic becomes single schema authority; schema.sql generated or dropped |
| `src/` React app | `frontend/` | Same app; placeholder rendering fixed |
| `esp32/` + `wokwi/` | `firmware/esp32/` + `firmware/wokwi/` | One contract; shared client structure; no backup files |
| No tests/CI/deploy | `backend/tests/`, CI, `deploy/` | Built new (REBUILD) |

**Open layout question for team decision:** whether V1 rehomes to repo-root `backend/`, `frontend/`, `firmware/`, `ml/`, `deploy/` as shown, or works in place. The matrix in §3 assumes rehoming; rehoming is itself a Phase 0 commit and does not change any KEEP/REFACTOR verdict.

---

## 3. Complete Component Migration Matrix

Decisions: **KEEP** (reuse as-is or near-as-is) / **REFACTOR** (reuse with required changes) / **REPLACE** (V0 artifact exists but its V1 role is filled by a different implementation) / **REBUILD** (nothing usable exists; build new).

Preserved assets required by the team are marked ⭐ and are protected: they are never replaced by rewrites where technically appropriate.

| # | Component | Exact V0 source path | Exact V1 target path | Decision | Dependencies | Risk | Phase |
|---|-----------|----------------------|----------------------|----------|--------------|------|-------|
| 1 | Telemetry ingestion endpoints | `audit/projectv0/predict-iq/backend/api/sensors.py` ⭐ | `backend/app/api/telemetry.py` | **KEEP** (add partial-reading support, config) | schemas, DB | Low | 1 |
| 2 | Telemetry/heartbeat validation schemas | `audit/projectv0/predict-iq/backend/schemas/sensor.py` ⭐ | `backend/app/schemas/telemetry.py` | **KEEP** (single schema module; extend) | Pydantic | Low | 1 |
| 3 | Machine & device + heartbeat API | `audit/projectv0/predict-iq/backend/api/machines.py` | `backend/app/api/machines.py`, `backend/app/api/devices.py` | **KEEP** (dedupe device-status helpers into one service) | DB | Low | 1 |
| 4 | DB engine/session | `audit/projectv0/predict-iq/backend/database/database.py` | `backend/app/db/session.py` | **KEEP** (move URL building into config) | config | Low | 0 |
| 5 | ORM models (6 tables) | `audit/projectv0/predict-iq/backend/database/models.py` ⭐ | `backend/app/db/models.py` | **REFACTOR** (add machine specs, feedback/ground truth, timestamptz, CHECK constraints) | Alembic | Medium | 1 |
| 6 | Alembic migrations | `audit/projectv0/predict-iq/alembic/versions/001_initial_schema.py`, `alembic/versions/002_device_source.py`, `alembic/env.py`, `alembic.ini` ⭐ | `backend/alembic/versions/001…, 002…` (unchanged) + new `003…`+ | **KEEP** existing migrations; **REFACTOR** env into V1 layout | DB | Medium | 1 |
| 7 | SQL DDL mirror | `audit/projectv0/predict-iq/supabase/schema.sql` | (generated from Alembic) or removed | **REPLACE** | Alembic | Low | 1 |
| 8 | Dead schema duplicate | `audit/projectv0/predict-iq/backend/models/schemas.py` | — (not carried) | **REPLACE** (delete in V1; never imported in V0) | — | Low | 0 |
| 9 | Dead DB bootstrap | `audit/projectv0/predict-iq/backend/database/init_db.py` | — (not carried) | **REPLACE** | — | Low | 0 |
| 10 | Prediction API | `audit/projectv0/predict-iq/backend/api/predictions.py` | `backend/app/api/predictions.py` | **REPLACE** (stub responses discarded; endpoints rewritten over real persisted predictions) | prediction service | Medium | 3 |
| 11 | Prediction service adapter | `audit/projectv0/predict-iq/backend/services/prediction_service.py` | `backend/app/services/prediction_service.py` | **REFACTOR** (call the real engine; honest outputs) | ai refactor | Medium | 3 |
| 12 | Prediction engine | `audit/projectv0/predict-iq/ai/prediction.py` | `backend/app/services/prediction_engine.py` | **REFACTOR** (keep physics-prob + rule diagnosis; **drop RUL formula, invented confidence, hardcoded model_version strings**) | feature engineering | Medium | 3 |
| 13 | Explainability (XAI) | `audit/projectv0/predict-iq/ai/explainability.py` ⭐ | `backend/app/services/explainability.py` | **KEEP** (SHAP-if-available + physics attribution fallback; SHAP install is optional) | sklearn/shap | Medium | 3 |
| 14 | Feature engineering | `audit/projectv0/predict-iq/ai/feature_engineering.py` | `ml/features.py` | **KEEP** | numpy/pandas | Low | 3 |
| 15 | Data-envelope validation | `audit/projectv0/predict-iq/ai/data_validation.py` | `ml/data_quality.py` + health-engine thresholds | **KEEP** | — | Low | 2 |
| 16 | Recommendation strings | `audit/projectv0/predict-iq/ai/recommendation.py` | `backend/app/services/recommendations.py` | **KEEP** | prediction engine | Low | 3 |
| 17 | Training pipeline | `audit/projectv0/predict-iq/ai/training.py` | `ml/train.py` | **REFACTOR** (real ground-truth labels, real splits, honest metrics; **not** threshold labels, not `cv_scores=[1.0]`) | ground truth | High | 6 |
| 18 | Model artifact docs | `audit/projectv0/predict-iq/ai/model/README.md` | `ml/models/README.md` | **KEEP** | — | Low | 6 |
| 19 | Alert CRUD + table | `audit/projectv0/predict-iq/backend/api/alerts.py` ⭐, `alerts` table in migrations | `backend/app/api/alerts.py` + table via 001/002 | **KEEP** CRUD; **REBUILD** the missing producer (see #24) | health engine | Low/Medium | 2 |
| 20 | Maintenance work orders | `audit/projectv0/predict-iq/backend/api/maintenance.py` | `backend/app/api/maintenance.py` | **KEEP** (extend with prediction/feedback linkage) | feedback | Low | 5 |
| 21 | Health endpoint, stats, app assembly | `audit/projectv0/predict-iq/backend/main.py` | `backend/app/main.py` | **KEEP** (restrict CORS to deliberate origins; structured logging) | config | Low | 0 |
| 22 | Requirements | `audit/projectv0/predict-iq/backend/requirements.txt` | `backend/requirements.txt` (pinned) + dev extras | **REFACTOR** (pin, add pytest/shap-optional) | — | Low | 0 |
| 23 | DB connectivity script | `audit/projectv0/predict-iq/backend/test_db.py` | superseded by pytest suite | **REPLACE** | — | Low | 0 |
| 24 | **Health engine** | *does not exist* (rule math recoverable from `ai/prediction.py::_compute_physics_prob`, bounds in `ai/data_validation.py`) | `backend/app/services/health_engine.py` | **REBUILD** | telemetry ingest | Medium | 2 |
| 25 | **Alert producer** | *does not exist* | inside `health_engine.py` (+ optional `POST /api/alerts`) | **REBUILD** | health engine | Medium | 2 |
| 26 | **Feedback / ground truth** | *does not exist* | `backend/app/api/feedback.py`, `backend/app/db/models.py` (feedback table), `frontend/src/pages/FeedbackPage.tsx` | **REBUILD** | predictions, maintenance | Medium | 5 |
| 27 | Wokwi simulation — wiring & loop | `audit/projectv0/predict-iq/wokwi/diagram.json` ⭐, `wokwi/src/main.cpp` ⭐, `wokwi/src/wifi_manager.{h,cpp}` ⭐, `wokwi/platformio.ini`, `wokwi/wokwi.toml` | `firmware/wokwi/` (same files) | **KEEP** wiring topology, main loop, WiFi manager | PlatformIO | Low | 1 |
| 28 | Wokwi sensor layer | `audit/projectv0/predict-iq/wokwi/src/sensors.{h,cpp}` | `firmware/wokwi/src/sensors.{h,cpp}` | **REFACTOR** (fix current ADC→A mapping and vibration → mm/s RMS; contract-exact units) | — | Medium | 0.5/1 |
| 29 | Wokwi API client | `audit/projectv0/predict-iq/wokwi/src/api_client.{h,cpp}`, `wokwi/src/config.h` | `firmware/wokwi/src/api_client.{h,cpp}`, config | **REFACTOR** (deployment-owned URL; TLS flag test-only) | WiFi | Medium | 1/8 |
| 30 | Wokwi run evidence | `audit/projectv0/predict-iq/wokwi/wokwi-debug.txt` | reference only; re-run in Phase 0.5 | **KEEP** as evidence of prior TLS failure; live re-test required | tunnel | Medium | 0.5 |
| 31 | Wokwi backup file | `audit/projectv0/predict-iq/wokwi/src/api_client.cpp.backup-20260907` | — (not carried) | **REPLACE** (delete in V1) | — | Low | 0 |
| 32 | Real-hardware firmware | `audit/projectv0/predict-iq/esp32/predict_iq_esp32.ino`, `esp32/config.h`, `esp32/sensors.{h,cpp}`, `esp32/wifi_manager.{h,cpp}`, `esp32/api_client.{h,cpp}` | `firmware/esp32/` | **REFACTOR** (keep NOT_CONFIGURED honesty; fix `SENSOR_SOURCE`→`REAL_HARDWARE`; align payload with partial-reading contract) | hardware | Medium–High | 7 |
| 33 | Frontend app shell | `audit/projectv0/predict-iq/src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/types.ts` | `frontend/src/` | **KEEP** (fix hardcoded `selectedMachineId='M001'`, `criticalMachinesCount={0}`) | api client | Low | 4 |
| 34 | API client | `audit/projectv0/predict-iq/src/services/api.ts` | `frontend/src/services/api.ts` | **KEEP** (extend: predictions, feedback) | backend contract | Low | 4 |
| 35 | Dashboard/live/alerts/sensor pages | `audit/projectv0/predict-iq/src/pages/DashboardPage.tsx`, `LiveMonitoringPage.tsx`, `AlertsPage.tsx`, `SensorDataPage.tsx` | `frontend/src/pages/` | **KEEP** | api client | Low | 4 |
| 36 | Prediction UI | `audit/projectv0/predict-iq/src/pages/MachineDetailsPage.tsx`, `src/pages/PredictionsPage.tsx` | `frontend/src/pages/` | **REFACTOR** (render the real fetched prediction; remove static "Not available" cards) | predictions API | Medium | 4 |
| 37 | Machines page | `audit/projectv0/predict-iq/src/pages/MachinesPage.tsx` | `frontend/src/pages/MachinesPage.tsx` | **REFACTOR** (read real fields `latest_reading`/`devices`; **remove hardcoded "150 Days" RUL**) | api client | Low | 4 |
| 38 | Maintenance UI | `audit/projectv0/predict-iq/src/pages/MaintenancePage.tsx` | `frontend/src/pages/MaintenancePage.tsx` | **KEEP** (link to feedback form) | feedback API | Low | 5 |
| 39 | ShapAttributionBar | `audit/projectv0/predict-iq/src/components/ShapAttributionBar.tsx` ⭐ | `frontend/src/components/ShapAttributionBar.tsx` | **KEEP** and **wire** (dead in V0 — never imported) | explanation data | Low | 4 |
| 40 | Modals, cards, header/sidebar | `audit/projectv0/predict-iq/src/components/AddMachineModal.tsx`, `ManualSensorModal.tsx`, `MachineCard.tsx`, `MetricCard.tsx`, `Header.tsx`, `Sidebar.tsx` | `frontend/src/components/` | **KEEP** AddMachineModal (specs now persisted), ManualSensorModal, MachineCard, MetricCard, Header; **REFACTOR** Sidebar (remove hardcoded "API Gateway ONLINE"/"Model: PhysicsRule v2.4") | api client | Low | 4 |
| 41 | Settings page | `audit/projectv0/predict-iq/src/pages/SettingsPage.tsx` | `frontend/src/pages/SettingsPage.tsx` | **REFACTOR** (fix cURL samples missing `source`/`timestamp`) | — | Low | 4 |
| 42 | Frontend build/server | `audit/projectv0/predict-iq/server.ts`, `vite.config.ts`, `tsconfig.json`, `index.html`, `package.json` | `frontend/` equivalents | **KEEP** (single lockfile — drop one of `bun.lock`/`package-lock.json`) | — | Low | 0 |
| 43 | Tests | *none* (`backend/test_db.py` is a script) | `backend/tests/`, frontend component tests, CI | **REBUILD** | backend | Medium | 0 → all |
| 44 | Config/env | `audit/projectv0/predict-iq/backend/.env.example`, root `.env.example`, scattered `os.getenv` constants | `backend/app/core/config.py` + env templates | **REFACTOR** (one config module: CORS, timeouts, token, bounds) | — | Low | 0 |
| 45 | Deployment | *none* | `deploy/` (Dockerfile(s), compose, CI) | **REBUILD** | all | Medium | 8 |
| 46 | AI Studio metadata | `audit/projectv0/predict-iq/metadata.json`, `@google/genai` dep | — (not carried) | **REPLACE** (declared Gemini capability is unimplemented) | — | Low | 0 |
| 47 | Build artifacts / broken venv | `audit/projectv0/predict-iq/dist/`, `public/`, `.venv/`, `.pio/` | — (not carried; fresh build in V1) | **REPLACE** | — | Low | 0 |

### 3.1 Cross-cutting migration risk register

Per-component risk is in the matrix above; this register covers the migration as a whole (risk × likelihood/impact × mitigation × phase):

| # | Risk | L×I | Mitigation | Phase |
|---|------|-----|------------|-------|
| R1 | Wokwi still cannot reach the backend after the unit fix (TLS/tunnel path was "Unable to verify") | H×H | Phase 0.5 is a hard gate: live recorded round-trip or documented blocker + fallback (LAN HTTP for dev, deployed HTTPS in Phase 8) | 0.5 → 8 |
| R2 | `timestamptz` migration corrupts or shifts stored readings | M×M | Migration tested on fresh DB + staging first; V0 demo DB starts empty per its README, so no precious data | 1 |
| R3 | Health-engine alert spam (one row per reading) | H×M | Deduplication/cooldown per machine+type; boundary tests | 2 |
| R4 | Refactored engine misread as validated ML (trust damage) | M×H | Explicit `is_prototype` flag + UI labeling; "LIVE" claims gated behind Phase 6 evaluation | 3 → 6 |
| R5 | Feedback captured but training still uses threshold labels (loop stays fake) | M×H | Training refuses to run without curated ground-truth labels (test-enforced) | 5 → 6 |
| R6 | Scope creep — re-architecting instead of migrating | M×M | Matrix decisions are binding; KEEP rows keep V0 file structure and behavior | all |
| R7 | Single-owner bottleneck on firmware phases (Wokwi + hardware) | M×M | Phase 7 starts early in parallel (depends only on Phase 1 contract); QA owns contract tests | 0.5 → 7 |
| R8 | Machine specs still silently dropped → wrong thresholds per asset | H×M | Migration 003 adds spec columns; POST /machines round-trip test; modal verified against API | 1 |
| R9 | Exposed credentials used before rotation lands | M×H | Rotation is the first Phase 0 action; CI secret-scan; old values revoked | 0 |
| R10 | Placeholder UI strings survive into the demo | M×M | Component tests assert no "150 Days"/static-card rendering; Phase 4 DoD walkthrough | 4 |

---

## 4. Implementation Order — Phases 0 → 8

Each phase ends in a runnable state and is committed per §12. Dependencies: **0 → 0.5 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**, with two parallelization notes in §5. Phase 7 depends only on Phase 1's contract, and Phase 6 depends only on Phase 5's labels + Phase 1's specs.

### Phase 0 — Foundation/security
**Goal:** a safe, reproducible starting point before any logic moves.
**Work:**
1. Rotate every exposed credential (Supabase service-role/secret key, DB password, ngrok authtoken — audit §14/TD-6) and strip non-key/value leftovers from env files. Keep `.env` gitignored; keep `.env.example` current.
2. Establish V1 skeleton (layout per §2.2), single lockfile, `backend/app/core/config.py` (CORS origins deliberate, `DEVICE_TIMEOUT_SECONDS` deduplicated, telemetry bounds constants), pinned requirements.
3. Remove-at-V1 dead code recorded in matrix rows #8, #9, #31, #46, #47 (in V1's tree only — V0 stays frozen).
4. Pytest scaffold + `tsc --noEmit` + CI skeleton; first contract test stubs.
5. Commit V0 as frozen reference; create V1 branch/structure with meaningful history (ADR-008).
**Phase DoD:** fresh environment can `pip install -r requirements.txt`, run `uvicorn`, run `pytest` (empty suites allowed but green), and `npm run lint` passes; zero secrets in repo; CI executes on push. *(Backend runtime in V0 was "Unable to verify" — Phase 0 is what converts that into a verified green baseline.)*

### Phase 0.5 — Telemetry contract verification *(gate — nothing downstream starts until this passes)*
**Goal:** prove the payload contract end-to-end **before** building health/prediction on top of it.
**Work:** see full plan in §8. In brief: codify the contract as tests; fix Wokwi `readCurrent`/`readVibration` units; decide partial-reading policy; verify a **live** Wokwi → backend → PostgreSQL round-trip and close the TLS question left open by the audit.
**Phase DoD:** automated contract tests pass; a live Wokwi run produces 2xx for all four channels with contract-exact units, and rows appear in PostgreSQL. If the tunnel/TLS path still fails, the phase is **not done** — the audit's "Unable to verify" for the Wokwi path stands until a live pass is recorded.

### Phase 1 — Telemetry pipeline
**Goal:** contract-exact, timestamp-safe, spec-aware storage.
**Work:** migrate `sensors.py` + `schemas/sensor.py` into V1 layout (KEEP ⭐); partial-reading support (Optional numerics with per-field validation — resolves the `esp32/` 3-of-4-sensors 422 problem); Alembic `003`: `timestamptz` normalization, machine specification columns (`rated_rpm`, `rated_current`, `max_temp`, `max_vibration`), CHECK constraints on status/severity/source enums; persist machine specs from `AddMachineModal` (ends the silent Pydantic drop, TD-5); central config.
**Phase DoD:** contract tests + validation unit tests green (valid payload stored; NaN/Inf/out-of-bounds/wrong-source 422; partial payloads accepted per policy); migration 003 runs on a fresh DB and on staging; `machines.specifications` round-trips through POST /machines; device offline status computes from `last_seen` correctly across a DST/tz boundary test.

### Phase 2 — Health + alerts
**Goal:** telemetry produces health state and alerts (audit TD-1 closed).
**Work:** REBUILD `health_engine.py` evaluating each ingested reading against per-machine specs (fallback to documented global defaults until specs exist) → NORMAL/WARNING/CRITICAL, updates `machines.status`; alert producer inserts `alerts` rows with deduplication/cooldown (no spam per reading) reusing the existing alerts table + lifecycle endpoints (KEEP ⭐).
**Phase DoD:** injecting a degradation scenario via `ManualSensorModal` or Wokwi flips machine status to WARNING/CRITICAL **without manual DB edits**, creates exactly one ACTIVE alert per condition window, acknowledge/resolve still work, and unit tests cover threshold boundaries + dedup window.

### Phase 3 — Prediction + explanation
**Goal:** honest, persisted, explainable predictions (audit TD-3 closed).
**Work:** REFACTOR `ai/prediction.py` into a Level-1 deterministic engine: physics-probability + rule diagnosis (reused), **no RUL, no invented confidence, no hardcoded model_version**; persist to `predictions` with `model_version` and an explicit `is_prototype` flag; explanation from `ai/explainability.py` (KEEP ⭐) + recommendations (KEEP); REWRITE `backend/api/predictions.py` endpoints over persisted data with one typed `response_model`.
**Phase DoD:** a degraded machine yields a persisted prediction row with explanation contributors; `GET /api/machines/{id}/prediction` returns the typed object or an explicit "insufficient data" state (never a fabricated value); regression tests assert that no response contains RUL or invented confidence; schema tests pin the response shape.

### Phase 4 — Dashboard wiring
**Goal:** the UI shows only real values.
**Work:** render real predictions in `MachineDetailsPage`/`PredictionsPage` (replacing static "Not available" cards); wire ⭐ `ShapAttributionBar` to explanation data; fix `MachinesPage` field drift (`latest_reading`, `devices`) and delete the hardcoded "150 Days"; Sidebar status derived from real health; fix Settings cURL samples; remove `App.tsx` hardcoded values.
**Phase DoD:** `tsc --noEmit` passes; component tests assert prediction/explanation render from mocked API data and that no component renders a literal "150 Days" or a fabricated status; a manual walkthrough shows dashboard → machine → prediction → explanation → alert with zero placeholder strings.

### Phase 5 — Maintenance + feedback/ground truth
**Goal:** the differentiator — the loop actually closes (audit TD-2 closed).
**Work:** REBUILD feedback schema (machine_id, **prediction_id**, alert_id, observed condition, actual fault/**root cause**, symptoms, action taken, parts replaced, severity, outcome, technician notes, timestamps, **prediction_correct**); `POST/GET /api/feedback`; feedback form in UI opened from an alert/machine with the prediction pre-linked; extend maintenance (KEEP ⭐ CRUD) to link records; prediction-vs-reality comparison view.
**Phase DoD:** the full docs/03 field list is captured per feedback record; a demo run completes alert → inspection → maintenance → feedback with `prediction_correct` stored; a prediction-vs-reality view shows predicted vs found for real records; API tests cover feedback validation and the prediction link.

### Phase 6 — Honest ML/evaluation
**Goal:** training exists, is gated, and cannot lie.
**Work:** REFACTOR `ai/training.py` → `ml/train.py`: labels **only** from curated feedback/ground truth (the V0 code parsed `failure_events` and never used them — that path is dead in V1); train/validation/test split; real precision/recall/F1 on held-out data; refuse to train below labeled-data floors; metadata per docs/06 governance (dataset version, features, metrics, eval date, deployment status); no auto-retrain from feedback (ADR-005).
**Phase DoD:** training with zero labeled positives **fails loudly instead of reporting 100% accuracy**; a governed training run on curated data produces a versioned metadata record; evaluation report reviewed and stored; metrics code has tests proving single-class/low-data cases are rejected, not celebrated.

### Phase 7 — Real hardware
**Goal:** the same contract from a physical ESP32-S3.
**Work:** REFACTOR `firmware/esp32/`: implement the four sensor drivers (replacing `NOT_CONFIGURED` hooks), `SENSOR_SOURCE "REAL_HARDWARE"` (fixes the V0 mislabel), payload aligned with the partial-reading policy from Phase 0.5, keep the honest skip-telemetry-when-no-sensor behavior and NTP gate.
**Phase DoD:** real hardware posts telemetry that passes the same contract tests as Wokwi; `source` is `REAL_HARDWARE`; a sensor-unplugged scenario sends heartbeats only (no partial garbage rows); documentation records the actual wiring used.

### Phase 8 — Deployment/demo
**Goal:** repeatable online deployment and the locked demo scenarios.
**Work:** REBUILD `deploy/`: Dockerfile(s) + compose, deployed backend (Wokwi `config.h` points at the deployment, not a transient ngrok URL), restricted CORS, write-gate auth (write token before public exposure), env-injected secrets only; run all docs/08 scenarios end-to-end.
**Phase DoD:** the six locked scenarios (normal, degradation, critical/failure, offline, maintenance+feedback, plus device-on-real-HW optional) pass **without manually editing database records**; CI green on the deployed commit; rollback note (DB migration down-path) documented.

---

## 5. Team Ownership Recommendation

Small-team assignment (matching the phases; each phase has one accountable owner):

| Role | Owns (phases) | Rationale |
| --- | --- | --- |
| **Backend engineer (lead)** | 0 (config/tests), 1 (API/DB), 2 (health/alerts), 3 (prediction API), 5 (feedback API), 8 (auth/deploy) | Largest share of KEEP/REFACTOR work and all REBUILDs live server-side; lead coordinates contract decisions. |
| **Firmware/embedded engineer** | 0.5 (Wokwi units + live verification), 1 (firmware side of pipeline), 7 (real HW) | Unit fixes, TLS/tunnel verification, and driver work need one owner who can run Wokwi and hardware. |
| **Frontend engineer** | 4 (dashboard wiring), 5 (feedback/prediction-vs-reality UI) | Fixes field drift, wires XAI, builds feedback form. |
| **ML engineer** | 3 (engine honesty), 6 (honest training/evaluation) | Owns the "never invent metrics" discipline and the docs/06 governance record. |
| **QA/DevOps (shared or part-time)** | 0 (CI), 0.5 (contract tests), per-phase DoD verification, 8 (deploy/demo) | Independent verification keeps the DoD honest. |

Parallelization: after Phase 1 completes, **firmware can start Phase 7** (depends only on the contract) and the **ML engineer can prep Phase 6** tooling while backend/frontend run 2→5 sequentially. Phase 0.5 must be a hard gate — building health/prediction on an unverified contract is exactly the failure mode the audit flagged.

---

## 6. Phase-by-Phase Definition of Done (summary table)

| Phase | Done when (verifiable statement) |
| --- | --- |
| 0 — Foundation/security | Fresh env installs + runs; CI green; secrets rotated & absent from repo; single lockfile; config module replaces scattered env reads. |
| 0.5 — Contract verification | Contract test suite passes; **live** Wokwi→API→PostgreSQL round-trip recorded with contract-exact units; TLS path verified (or the blocker is documented with a fallback). |
| 1 — Telemetry pipeline | Validation unit tests green; migration 003 applied; specs persist; partial-reading policy implemented + tested; offline detection tz-safe. |
| 2 — Health + alerts | Degraded telemetry flips machine status and creates a deduplicated ACTIVE alert with no manual DB edits; lifecycle endpoints still pass tests. |
| 3 — Prediction + explanation | Persisted typed predictions with explanations; zero RUL/confidence fabrication (test-enforced); stub endpoints replaced. |
| 4 — Dashboard wiring | No placeholder strings in UI (test-enforced); XAI bars render real contributors; `tsc` clean. |
| 5 — Feedback/ground truth | All docs/03 feedback fields captured and linked to a prediction; prediction-vs-reality view works on real records. |
| 6 — Honest ML/evaluation | Training refuses to run on unlabeled/thin data; governed run produces versioned metrics from held-out data; report reviewed. |
| 7 — Real hardware | Real ESP32-S3 passes the same contract tests with `source=REAL_HARDWARE`; unplugged-sensor scenario degrades gracefully. |
| 8 — Deployment/demo | All docs/08 scenarios pass on the deployment without manual DB edits; CORS restricted; writes gated; secrets env-injected. |

---

## 7. Explicit Do-NOT-Reuse List

These V0 behaviors/artifacts **must not ship in V1**. (V0 itself is untouched — this governs what V1 carries forward.)

| # | Item | Where it lives in V0 | Why it is not reusable |
|---|------|----------------------|------------------------|
| 1 | **Fake ML metrics** | `ai/training.py` — `cv_scores = [1.0]`, `f1_score = accuracy`, `"validation_status": "Passed"` on single-class/tiny data | Trivially reports 100% accuracy/F1; violates docs/06 "never invent accuracy" |
| 2 | **Threshold-only fake training evaluation** | `ai/training.py` — labels from `v > max_vib·1.2 or t > max_temp·1.15` rules; parsed `failure_events` collected but never used | Labels are the model's own rules — circular; real maintenance ground truth is ignored |
| 3 | **Fake RUL** | `ai/prediction.py` RUL formula (1–90-day probability-bucket interpolation); `src/pages/MachinesPage.tsx` hardcoded **"150 Days"** fallback | ADR-006: RUL only after validated degradation data; no data exists |
| 4 | **Invented confidence** | `ai/prediction.py` — `0.82 + 0.14·|p−0.5|·2` clamped 0.75–0.96 | Formula-generated number presented as model confidence |
| 5 | **Prediction stub responses** | `backend/api/predictions.py` — `POST /api/predict` fixed "Not available" dict; untyped `execute_prediction(payload: dict)`; dual-shape response | Placeholder API contract; hides the real engine; inconsistent response shape |
| 6 | **Incorrect vibration units** | `wokwi/src/sensors.cpp` `readVibration()` — MPU6050 acceleration magnitude (m/s²) stored/labeled as mm/s | ADR-002 violation; physically wrong unit from ingest onward |
| 7 | **Incorrect current conversion/range** | `wokwi/src/sensors.cpp` `readCurrent()` — raw ADC 0–4095 sent as amperes; backend bound 0–1000 A → default pot position 422-rejected | Unscaled ADC is not a current; breaks the pipeline at step one |
| 8 | **Fake frontend prediction/RUL values** | `MachineDetailsPage.tsx` / `PredictionsPage.tsx` static "Not available" cards (fetched prediction never rendered); `MachinesPage.tsx` reads of non-existent fields (`current_reading`, `latest_prediction`, `esp32_device_id`) | Misleading UI that hides real functionality; invented values where fields are missing |
| 9 | **Hardcoded machine status** | `machines.status` never derived from telemetry (only maintenance flips it); UI "NOMINAL HEALTH" defaults; `Sidebar.tsx` hardcoded "API Gateway ONLINE" / "Model: PhysicsRule v2.4"; `App.tsx` hardcoded `selectedMachineId='M001'`, `criticalMachinesCount={0}` | Status must be computed from evidence; hardcoded states misrepresent the system |
| 10 | **Mislabeled real-hardware source** | `esp32/config.h` `SENSOR_SOURCE "WOKWI"` | Would corrupt provenance and future ground truth |
| 11 | **Dead/duplicate artifacts** | `backend/models/schemas.py`, `backend/database/init_db.py`, `wokwi/src/api_client.cpp.backup-20260907`, `@google/genai` dependency + `metadata.json` capability claim, second lockfile, `dist/`/`.venv`/`.pio` build outputs | No V1 role; divergence and confusion risk |
| 12 | **Insecure defaults** | `CORS_ORIGINS="*"` + `allow_credentials=True`; `client.setInsecure()` outside a test-only flag; unused `ESP32_SECRET_TOKEN` / placeholder `X-Device-API-Key` | Deliberate CORS and gated writes are locked prototype requirements |

---

## 8. Telemetry Contract Verification Plan (Phase 0.5 detail)

**Contract under test (docs/05 + ADR-002):**

```json
{
  "device_id": "PIQ-ESP32-001",
  "machine_id": "MOTOR-001",
  "timestamp": "2026-01-01T00:00:00Z",
  "temperature": 48.2,
  "vibration": 0.31,
  "current": 1.82,
  "rpm": 1420,
  "source": "WOKWI | REAL_HARDWARE"
}
```

Units: temperature °C, vibration **mm/s RMS**, current **A**, rpm rpm. Bounds: temp −50…300, vibration 0…100, current 0…1000, rpm 0…60000 (from `backend/schemas/sensor.py`; KEEP).

**Verification steps, in order:**

1. **Codify the contract as tests** (backend): parametrized pytest cases for every field — required, type, NaN/Inf rejection, bounds edges, valid/invalid `source`, missing-field behavior. These become the permanent gate used by CI and later by firmware verification.
2. **Fix the Wokwi sensor layer** (`firmware/wokwi/src/sensors.{h,cpp}` in V1):
   - `readCurrent()`: map the potentiometer ADC (0–4095) onto a documented, physically plausible ampere range (e.g., simulate an ACS712-scale signal, 0–20 A), and **document the mapping** in the firmware README. Target: default pot position yields a value the API accepts and a chart that reads like amperes.
   - `readVibration()`: convert MPU6050 acceleration magnitude to an mm/s RMS-scale value with a documented, honest mapping (or switch the Wokwi part/diagram accordingly). The mapping must be labeled as simulation-calibration, not a physical calibration claim.
3. **Decide the partial-reading policy** (team decision, then implement + test): either the backend accepts Optional per-channel readings (preferred; matches the real-device 3-of-4 case) or devices must send all four fields with explicit nulls. One policy, contract tests for it, documented in docs/05 when finalized.
4. **Timestamp check:** Wokwi sends `...Z`; assert stored `sensor_readings.timestamp` survives a round-trip with correct instant semantics after migration 003 (`timestamptz`).
5. **Live end-to-end verification:** run Wokwi against the Phase-0 backend and record: HTTP 2xx per POST, row counts increasing in PostgreSQL, values within bounds, `source=WOKWI`. Re-test the TLS/tunnel path — the audit's last recorded run (`wokwi/wokwi-debug.txt`) shows `start_ssl_client: -80` failures + 60 s timeout and the current `setInsecure()` fix is **"Unable to verify"**; this phase exists to convert that into a pass or a documented blocker with a mitigation (e.g., LAN HTTP for dev, deployed HTTPS in Phase 8).
6. **Real-firmware contract probe (early, cheap):** with real hardware still driver-less, verify its heartbeat + a manual single-channel payload against the same tests, so Phase 7 starts from a proven client path.

**Exit criterion:** contract tests green + recorded live Wokwi pass. **No downstream phase starts otherwise.**

---

## 9. Security Cleanup Plan

| # | Action | V0 evidence (audit §14) | Phase | Verification |
|---|--------|--------------------------|-------|--------------|
| 1 | **Rotate Supabase credentials** — service-role/secret key, DB password | Real values in `.env` (`SUPABASE_SECRET_KEY`, `DATABASE_URL`) and `backend/.env` (`DB_PASSWORD`) on disk; gitignored, but treated as exposed | 0 | New credentials work; old ones revoked; zero old values greppable anywhere |
| 2 | **Rotate ngrok authtoken** and remove it from files | `ngrok config add-authtoken …` line embedded in `.env` | 0 | Token revoked; env file is strictly `KEY=value` |
| 3 | **Scrub env files of shell leftovers** | PowerShell line `$env:WOKWI_CLI_TOKEN = …` in `backend/.env` | 0 | Env templates contain only keys; real values env-injected |
| 4 | **Deliberate CORS** | `main.py` default `*` + `allow_credentials=True` | 0 (dev allowlist) / 8 (deploy allowlist) | Config module holds origins; test asserts disallowed origin is rejected |
| 5 | **Write-gate auth** | No auth on any endpoint; `ESP32_SECRET_TOKEN` defined but never checked; placeholder `X-Device-API-Key` ignored | minimal write token in 0–1; enforced gate in 8 before public exposure | Write endpoints reject missing/invalid token (test); device sends the configured key |
| 6 | **TLS discipline** | `client.setInsecure()` in Wokwi client (test-only for ngrok) | 0.5 flag-gated / 8 replaced by real host cert | `setInsecure` only under a build flag; deployment uses verified TLS |
| 7 | **Secrets hygiene in V1 repo** | `.env` files correctly gitignored in V0 (nothing in git history) | 0 (keep) + CI secret-scan | CI fails on high-entropy/known-secret patterns; `.env.example` has no real values |
| 8 | **Safe error handling & logging** | Broad `Exception` → 503 in heartbeat; `print()` logging only | 0 (structured logging) | No stack traces or connection strings in logs (log redaction test) |
| 9 | **Deprecated/unsafe API usage** | `datetime.utcnow()` everywhere (deprecated); `from_orm` via deprecated alias | 1 (with migration 003) | Code search shows no `utcnow` in V1; tz tests pass |

Prototype posture stays honest: no secrets in git, env vars only, validated inputs, restricted CORS, safe errors — per docs/09.

---

## 10. Complete End-to-End Workflow (target, mapped to migration work)

```text
Wokwi (Phase 0.5/1: fixed units, contract tests)
  → ESP32-S3 (Phase 1: client path verified; Phase 7: real drivers)
    → temperature / vibration / current / RPM (mm/s RMS, A, rpm; source tag honest)
      → telemetry API (Phase 1: KEEP sensors.py ⭐ + schemas/sensor.py ⭐; partial-reading policy)
        → PostgreSQL (Phase 1: KEEP models.py ⭐ + Alembic ⭐; 003 = timestamptz, specs, constraints)
          → health engine (Phase 2: REBUILD; NORMAL/WARNING/CRITICAL from per-machine specs)
            → prediction (Phase 3: honest Level-1, persisted, is_prototype; no fake RUL/confidence)
              → explanation (Phase 3: explainability.py ⭐ + recommendations; contributors stored)
                → alert (Phase 2: producer + alerts CRUD ⭐; lifecycle: ACTIVE→ACKNOWLEDGED→RESOLVED)
                  → dashboard (Phase 4: real values everywhere; ShapAttributionBar ⭐ wired)
                    → maintenance (Phase 5: KEEP work-order CRUD ⭐; linked to prediction/alert)
                      → technician feedback (Phase 5: REBUILD /api/feedback + UI form)
                        → actual root cause (root_cause, actual_fault, parts, outcome, severity)
                          → ground truth (prediction_correct + curated records; ADR-004)
                            → model evaluation (Phase 6: train only on curated labels; honest held-out metrics; governed versioning)
```

Reuse-per-step summary (fastest path):

| Workflow step | Reuse from V0 | New in V1 |
| --- | --- | --- |
| Wokwi → ESP32-S3 | `diagram.json` ⭐, `main.cpp` ⭐, `wifi_manager.*` ⭐ | Fixed `readCurrent`/`readVibration`; contract tests; deployment-owned URL |
| Telemetry API | `api/sensors.py` ⭐ + `schemas/sensor.py` ⭐ | Partial readings; config module |
| PostgreSQL | `models.py` ⭐, Alembic 001/002 ⭐ | Migration 003 (tz, specs, constraints) |
| Health engine | Threshold math from `ai/data_validation.py` / `ai/prediction.py` | `health_engine.py` + status updates |
| Prediction | `feature_engineering.py`, physics-prob math | Honest persisted Level-1 output |
| Explanation | `ai/explainability.py` ⭐ | Response wiring + persistence |
| Alert | `api/alerts.py` ⭐ + `alerts` table ⭐ | The producer |
| Dashboard | `App.tsx`, `DashboardPage`, `LiveMonitoringPage`, `AlertsPage`, `MachineCard` | Fixed prediction/machines pages; XAI wired |
| Maintenance | `api/maintenance.py` ⭐ + `MaintenancePage.tsx` ⭐ | Prediction/alert linkage |
| Feedback → ground truth → evaluation | *(nothing)* | Table, `/api/feedback`, form, prediction-vs-reality, `ml/` evaluation |

---

## 11. Testing Strategy

**Principles:** the contract is executable (Phase 0.5 tests are the permanent gate); every DoD statement in §4/§6 is backed by an automated check where possible; the acceptance rule from docs/08 — *the demo must work without manually editing database records* — is verified by scripted scenario runs, not by belief.

| Layer | Tooling | Scope | Phase introduced |
| --- | --- | --- | --- |
| Contract tests | pytest, parametrized | Payload shape, units, bounds, NaN/Inf, `source`, partial-reading policy; reused verbatim for Wokwi (0.5) and real HW (7) | 0.5 |
| Backend unit | pytest | Validation schemas, health-engine thresholds/dedup, prediction-engine honesty (assert no RUL/confidence fields ever), feedback validation | 0 → 6 |
| API integration | FastAPI `TestClient` + ephemeral DB | Ingest → storage, heartbeat/offline status, alerts lifecycle, predictions read path, maintenance→feedback link | 1 → 5 |
| DB migration tests | Alembic on fresh + staging DBs | 001/002 replay, 003 upgrade/down, timestamptz round-trip, CHECK constraints | 1 |
| ML evaluation tests | pytest on `ml/` | Single-class/thin-data refusal, metric computation against known holdouts, metadata completeness (docs/06 governance fields) | 6 |
| Frontend | `tsc --noEmit` + component tests (Vitest/RTL or equivalent) | Prediction/XAI rendering from mocked API, no placeholder strings ("150 Days", static "Not available", fake sidebar status), feedback form field coverage | 4 → 5 |
| Firmware | PlatformIO build + contract replay of captured payloads | Wokwi build; real-HW payload matches contract tests; `source` correct; unplugged-sensor behavior | 0.5, 7 |
| E2E scenarios | Scripted demo runs against the deployment | The six docs/08 scenarios; no manual DB edits | 8 |

CI (Phase 0, extended each phase): `pip install → pytest → tsc → (later) docker build`. Every phase's DoD includes "CI green".

---

## 12. Git Commit Sequence

Format per docs/07: `type(scope): concise description`; one logical change per commit; build → test → commit; no secrets ever. The exact sequence (paths illustrative for the V1 tree):

**Phase 0**
1. `chore(repo): establish V1 structure and freeze V0 reference`
2. `chore(security): rotate exposed credentials and clean env templates`
3. `feat(config): centralize backend configuration and deliberate CORS`
4. `test(api): add pytest scaffold and CI gates`
5. `chore(repo): adopt single lockfile`

**Phase 0.5**
6. `test(telemetry): codify telemetry contract as executable tests`
7. `fix(wokwi): convert current ADC reading to amperes`
8. `fix(wokwi): emit vibration on mm/s RMS scale`
9. `fix(wokwi): make TLS mode a test-only build flag`
10. `test(wokwi): record live contract verification run`

**Phase 1**
11. `feat(api): accept partial sensor readings per contract policy`
12. `feat(db): normalize timestamps and persist machine specifications`
13. `feat(db): add enum CHECK constraints`
14. `feat(web): persist machine specifications from add-machine form`
15. `test(db): cover migration 003 upgrade and round-trips`

**Phase 2**
16. `feat(health): evaluate machine health on telemetry ingest`
17. `feat(alerts): produce deduplicated alerts from health engine`
18. `test(health): cover thresholds, status transitions, and alert dedup`

**Phase 3**
19. `refactor(ml): extract honest level-1 prediction engine`
20. `feat(api): persist predictions with explanations and prototype flag`
21. `refactor(api): replace prediction stub endpoints with typed responses`
22. `test(api): assert predictions never expose RUL or invented confidence`

**Phase 4**
23. `feat(web): render real predictions and explanations on machine pages`
24. `feat(web): wire ShapAttributionBar to explanation data`
25. `fix(web): remove hardcoded RUL and status placeholders`
26. `fix(web): correct machines-page field names and settings samples`

**Phase 5**
27. `feat(db): add feedback and ground-truth schema`
28. `feat(api): capture technician feedback linked to predictions`
29. `feat(web): add feedback form and prediction-vs-reality view`
30. `test(api): cover feedback validation and prediction linkage`

**Phase 6**
31. `refactor(ml): label training from curated ground truth only`
32. `feat(ml): enforce honest metrics with held-out evaluation`
33. `feat(ml): add governed model metadata and versioning`
34. `test(ml): reject training on single-class or unlabeled data`

**Phase 7**
35. `feat(esp32): implement real sensor drivers`
36. `fix(esp32): label telemetry source as REAL_HARDWARE`
37. `test(esp32): verify firmware payloads against contract tests`

**Phase 8**
38. `feat(deploy): containerize backend and dashboard`
39. `feat(security): gate writes and restrict CORS for deployment`
40. `test(e2e): automate docs/08 demo scenarios`
41. `docs(readme): document V1 run and deployment steps`

Commit 41 closes with docs updates per docs/11 (implementation ↔ docs reconciliation).

---

## 13. Final V1 Definition of Done

Aligned with the locked Prototype DoD (docs/00) and demo rules (docs/08), V1 is done when **all** of the following hold, demonstrated live and without manually editing database records:

1. **Telemetry:** Wokwi (and, after Phase 7, real ESP32-S3) sends contract-exact telemetry for temperature/vibration/current/RPM with correct units and honest `source`; the API validates it; PostgreSQL stores it.
2. **Intelligence:** abnormal/degraded behavior produces machine health (NORMAL/WARNING/CRITICAL), a persisted prediction with an explanation of contributors, and an ACTIVE alert — each traceable and deduplicated.
3. **Dashboard:** live and historical telemetry, real health, real prediction, real explanation render with **zero placeholder values** — no hardcoded "150 Days", no static "Not available" prediction cards, no fabricated status strings; `ShapAttributionBar` shows real contributors.
4. **Maintenance loop:** a technician records maintenance **and** structured feedback (actual fault, root cause, symptoms, action, parts, severity, outcome, `prediction_correct`) linked to the originating prediction; the prediction-vs-reality view shows the comparison.
5. **Honest ML:** training runs only on curated ground truth, refuses thin/single-class data, reports held-out precision/recall/F1 with governed metadata; no invented accuracy, confidence, or RUL anywhere in the system; all prototype outputs labeled as prototype/simulation.
6. **Engineering:** meaningful git history per §12; CI green (typecheck + backend + contract tests); repeatable deployment (Docker/compose) with restricted CORS, gated writes, and env-injected secrets; the six demo scenarios pass end-to-end.

---

## 14. Carried-Forward Verification Limitations ("Unable to verify")

From the audit (§22) — these remain **unconfirmed, not passes**, until the listed phase converts them:

| Item | Audit status | Resolved by |
| --- | --- | --- |
| Backend runtime behavior (app, DB session, ingest) | Never executed; broken `.venv`; static analysis only | Phase 0 (green baseline) |
| Timestamp/timezone behavior against a live DB | Unverified | Phase 1 (migration 003 + tz tests) |
| Wokwi → tunnel TLS path | Last run failed (`-80` SSL errors, timeout); `setInsecure()` fix unverified | Phase 0.5 (live recorded run) |
| `test_db.py` connectivity | Could not run (credentials + interpreter) | Phase 0 (replaced by real tests) |
| Frontend in-browser behavior against a live backend | `tsc` passed; pages not exercised | Phases 4/8 (E2E scenarios) |
| SHAP path in explainability | SHAP not installed; fallback only | Phase 3 (optional install, documented) |

---

*This plan is input for team decision-making. Nothing has been implemented: `audit/projectv0/predict-iq/` remains untouched, and this is the only file created. Approval is required before Phase 0 begins.*
