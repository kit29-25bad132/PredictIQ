# PredictIQ — Meta Global AI Developer Hackathon Implementation Plan

**Status:** Planning only. No hackathon feature described here is implemented yet.
**Scope:** Documentation. This file records intent, architecture, safety rules, and acceptance criteria. It does not modify application code.
**Evidence basis:** Repository state on branch `main` at commit `c1535a5`, working tree clean at the time of writing. Functionality marked "implemented" was verified by reading the repository source, configuration, migrations, and tests — not by executing the system during this documentation pass.

---

## 1. Project Overview

### 1.1 Purpose

PredictIQ is an IoT predictive-maintenance platform for rotating industrial machinery such as pumps and motors. It ingests machine telemetry (temperature, vibration, current, and RPM), stores it, evaluates machine health, produces maintenance alerts and risk assessments, and presents machine state to operators and technicians through a web dashboard.

The problem it addresses is the gap between raw condition-monitoring data and maintenance action. Industrial teams can collect sensor data, but turning that data into a defensible diagnosis — what is degrading, how severe it is, what evidence supports that conclusion, and what a technician should inspect — usually depends on scarce expert interpretation. PredictIQ's existing design keeps the deterministic evaluation separate from any external AI analysis, so the system can explain a machine's condition without inventing measurements or silently replacing its own rules.

### 1.2 Existing architecture in the repository

The repository already contains a complete vertical slice, with explicit boundaries:

```text
ESP32-S3 firmware (physical path)  ─┐
Wokwi ESP32-S3 simulation          ─┴─► HTTP/HTTPS ─► FastAPI backend
                                                        │
                                                        ├─► PostgreSQL (Alembic-managed schema)
                                                        ├─► Deterministic health engine
                                                        ├─► Deterministic prediction / XAI engine
                                                        ├─► External AI provider (Google Gemini today)
                                                        └─► React/Vite dashboard
```

Verified components:

| Layer | Location | What exists |
| --- | --- | --- |
| Device firmware | `firmware/esp32/` | ESP32-S3 Arduino/PlatformIO firmware: Wi-Fi manager, NTP time, sensor reads, API client, heartbeat |
| Device simulation | `firmware/wokwi/` | Wokwi ESP32-S3 project with temperature, vibration, current, and RPM components |
| Transport | `deploy/gateway/` | Local Wokwi-to-cloud gateway (development transport adapter) |
| Backend API | `backend/app/` | FastAPI routers for telemetry, machines, devices, alerts, predictions, maintenance, feedback, auth, organizations, assistant, simulation |
| Database | `backend/alembic/versions/001`–`009` | PostgreSQL schema: machines, devices, sensor readings, predictions, alerts, maintenance, feedback, organizations, simulation configs |
| Deterministic health | `backend/app/services/health_engine.py` | Threshold evaluation, machine status, alert production, automatic prototype prediction |
| Deterministic prediction | `ml/prediction.py`, `ml/explainability.py`, `ml/recommendation.py` | `physics-rule-v1` risk scoring, component attribution, reasons, recommended action |
| External AI | `backend/app/services/ai_provider.py` | Google Gemini REST provider with strict structured-output validation |
| AI assistant | `backend/app/api/assistant.py` | Text chat grounded in the latest stored telemetry and active alerts |
| Frontend | `frontend/src/` | React/Vite dashboard: live monitoring, machines, machine detail/3D view, predictions, alerts, maintenance, feedback, sensor data, settings |
| Tests / CI | `backend/tests/`, `.github/workflows/ci.yml` | Backend pytest suites and a CI job that runs pytest plus frontend lint |

The architecture is locked in `docs/01-ARCHITECTURE.md` and the V1 migration record. The hackathon work must extend these boundaries, not replace them.

---

## 2. Hackathon Track

### 2.1 Track

**Indie Developer Track**, under the **Push the Frontier** theme.

### 2.2 Why PredictIQ fits this track

- **Frontier problem, not a demo wrapper.** The project targets industrial predictive maintenance, where the hard part is not generating text but producing a trustworthy conclusion from real, imperfect machine data.
- **AI is placed where it adds value without owning the truth.** The deterministic engine remains the authority on health state; AI is used for interpretation, explanation, and technician assistance. This is a more defensible frontier use of AI than replacing a rules engine with a language model.
- **Grounded, tool-using agent design.** The planned flagship feature gives the model only verified machine context retrieved from the database, and the planned secondary feature adds read-only tools. The model's job is to reason over evidence, not to recall or invent it.
- **Real hardware path.** The repository already separates simulation from the physical ESP32-S3 path, so the hackathon can demonstrate a real device-to-database-to-model loop rather than a static fixture.
- **Voice-first technician assistance.** Maintenance work happens at the machine, often with gloved hands and no keyboard. Voice is a genuinely appropriate interface for this domain, not a novelty.

The "Push the Frontier" framing in this plan is about evidence-grounded machine intelligence and a voice-first field interface. It is not a claim that the current repository already delivers either.

---

## 3. Existing Work Before the Hackathon

This section separates what the repository verifiably contains from what is incomplete or unverified. Status is based on static inspection of source and configuration in this repository at commit `c1535a5`.

### 3.1 Implemented (verified in source)

| Capability | Evidence | Notes |
| --- | --- | --- |
| Telemetry ingestion with device authentication | `backend/app/api/sensors.py` (`POST /api/sensor-data`), `backend/app/core/auth.py` | Requires a registered device and the device API key; rejects unknown machine/device and device–machine mismatches; derives organization from the device row |
| Telemetry validation contract | `backend/app/schemas/sensor.py` | Temperature −50…300 °C, vibration 0…100 mm/s, current 0…1000 A, RPM 0…60000; `source` limited to `WOKWI` or `REAL_HARDWARE`; missing channels allowed for partial readings |
| PostgreSQL persistence | `backend/app/db/models.py`, `backend/alembic/versions/` | Machines, devices, sensor readings, predictions, alerts, maintenance records, feedback/ground truth, organizations, simulation configs |
| Multi-tenant scoping | `backend/app/core/tenant.py`, migration `009_organizations_and_tenancy.py` | Organization-scoped reads and writes; Supabase JWT verification for user identity; operator session for privileged writes; device API key for telemetry |
| Deterministic health evaluation | `backend/app/services/health_engine.py` | Per-channel ratio thresholds (WARNING at 1.0× limit, CRITICAL at 1.2× limit), RPM deviation thresholds (10% / 20%), machine status update |
| Alert production | `backend/app/services/health_engine.py` | Persists ACTIVE alerts for temperature, vibration, current, and RPM; suppresses duplicates within a 5-minute window |
| Automatic prototype prediction | `backend/app/services/health_engine.py` | On WARNING/CRITICAL with all four channels present; one prediction per machine per 10-minute telemetry window; prediction failure is logged and does not fail ingestion |
| Deterministic prediction and explanation | `ml/prediction.py`, `ml/explainability.py`, `ml/recommendation.py` | `physics-rule-v1`; explicit `is_prototype=True`; component attribution, feature importance, reasons, recommended action; no RUL output |
| Gemini integration | `backend/app/services/ai_provider.py`, `backend/app/api/predictions.py` | Google Generative Language REST API; strict JSON response schema; semantic validation of every field; fail-closed on missing key or provider error; SHA-256 input hash prevents duplicate analyses |
| Assistant chat over real machine context | `backend/app/api/assistant.py`, `frontend/src/pages/Machine3DViewPage.tsx` | Sends the latest stored reading, machine limits, and active alerts to Gemini; returns 502 when the provider fails |
| Dashboard backed by API data | `frontend/src/pages/`, `frontend/src/services/api.ts` | Pages for dashboard, live monitoring, machines, machine detail/3D view, predictions, alerts, maintenance, feedback, sensor data, settings; data fetched from backend endpoints |
| ML governance and evaluation code | `ml/train.py`, `backend/app/services/model_evaluation.py`, `POST /api/train-model`, `GET /api/model-evaluation` | Operator-only training and evaluation over curated feedback; refuses training without sufficient ground truth |
| Firmware and simulation | `firmware/esp32/`, `firmware/wokwi/` | Physical-path firmware modules and a Wokwi project with documented wiring and simulation calibrations |
| Automated checks | `.github/workflows/ci.yml`, `backend/tests/` | CI runs backend pytest and frontend lint; 18 backend test modules exist |

### 3.2 Partially implemented

| Capability | What exists | What is missing or unverified |
| --- | --- | --- |
| Physical ESP32-S3 sensing | Firmware modules and a documented physical-hardware path | Sensor pin assignments in `firmware/esp32/config.h` are commented placeholders; Wi-Fi credentials and API URL are template values; no physical sensor calibration or hardware run is recorded |
| Device-to-cloud telemetry | Wokwi project, gateway, and backend ingestion path | `firmware/wokwi/README.md` records a historical verification run (2026-09-11) using a temporary tunnel and the test-only `TLS_ALLOW_INSECURE` build; that run was not reproduced during this documentation pass, and it is still a simulation |
| Deployment | Dockerfiles, `docker-compose.yml`, nginx TLS configuration, deployment guide | `deploy/README.md` marks runtime deployment verification as **PENDING live infrastructure**. `docs/README.md` contains production URLs and a "release-ready" status, but those claims were not verified here |
| AI assistant | Text chat UI and backend endpoint grounded in stored telemetry | No voice input or speech output; no tool calling; no citation of specific evidence rows in the response contract |
| ML model | Training/evaluation pipeline and governance rules | `ml/models/` contains only `__init__.py` and `README.md`; no trained model artifact is present, so the system runs on the deterministic engine |

### 3.3 Not implemented / unverified

- **No Meta AI integration of any kind.** A repository-wide search found no Meta AI, Llama, or Meta API client code outside third-party virtual-environment packages. The only external AI provider present is Google Gemini.
- **No evidence-grounded AI context contract.** The current Gemini request includes real telemetry and machine limits, but the response is a free-form assessment; it does not require the model to cite the specific fields it used.
- **No tool-based retrieval.** The model cannot request additional machine data; the backend assembles a fixed context packet.
- **No voice interface.**
- **No visual inspection or image upload workflow.**
- **No verification of live service URLs** or of a running cloud deployment.
- **No test-run result recorded for this plan.** The test suites exist and CI is configured to run them; they were not executed for this documentation-only change.

---

## 4. Hackathon Development Goals

### 4.1 Flagship — Evidence-Grounded Machine Intelligence

Build a backend-assembled **Machine Evidence Packet (MEP)** and require the AI layer to reason only over it.

The packet contains three explicitly separated categories:

1. **Actual measurements** — sensor values read from persisted rows, with device ID, machine ID, timestamp, and source.
2. **Deterministic engine outputs** — health state, per-channel threshold states, alert state, prototype prediction, component attribution, and reasons produced by `physics-rule-v1`.
3. **Provenance** — row identifiers, data freshness, and which channels are present, missing, or stale.

The AI returns an interpretation that must reference the packet. Every factual claim about the machine must map to a field in the packet. The deterministic engine remains the authority on health state; the AI explains, contextualizes, and recommends.

This is the hackathon's central contribution: not "an LLM for maintenance," but a constrained interpretation layer over verified machine evidence.

### 4.2 Meta AI integration

Add Meta AI as the interpretation provider for the evidence packet.

- Integrate behind the existing provider boundary (`AIPredictor` protocol and `get_predictor()` factory in `backend/app/services/ai_provider.py`) so the API layer stays provider-agnostic.
- Select the Meta model and API surface from Meta's official documentation at implementation time. **This plan deliberately names no Meta model, endpoint, parameter, or capability.** None has been verified in this repository, and inventing one would violate the project's honesty rules.
- Keep the Meta credential server-side, in the backend environment only.
- Preserve the current fail-closed behavior: if the provider is unconfigured, unreachable, or returns invalid output, the endpoint returns an explicit error and persists nothing.
- Keep Gemini available as the existing provider until the Meta path passes acceptance criteria; do not remove working behavior to make room for an unverified integration.

### 4.3 Secondary — Voice-first technician assistance

- Add voice capture to the technician assistant so a technician can ask about a machine without typing.
- Transcribe speech on the client or through a speech service, then send the transcript to the existing grounded assistant endpoint.
- Speak the response back when the client supports it.
- Voice is an interface change, not a new source of truth: the transcript is treated as a user question, and the answer is still constrained by the evidence packet.
- Display the transcript and the text answer so the interaction remains auditable and usable in noisy environments.

### 4.4 Secondary — Tool-based machine information retrieval

- Expose read-only tools the model may call for additional verified context, for example: machine profile and limits, latest reading, a bounded reading window, active alerts, latest prediction, maintenance history.
- Tools read through the existing organization-scoped backend services; the model never receives database credentials and never writes.
- Bound every tool call by time range, row limit, and organization scope.
- Record which tools were called and which rows were returned so the final answer remains traceable.

### 4.5 Optional extensions

- **Visual inspection:** attach a photo to a maintenance/feedback record, store it, and let the AI describe what is visible while clearly labeling the description as an observation of an image, not a sensor measurement.
- **Degradation history:** summarize trend direction over persisted readings (for example, whether vibration is rising across a window) and include the window boundaries and sample count. No extrapolated remaining-useful-life claim without validated data.

---

## 5. Technical Architecture

### 5.1 Target architecture for the hackathon

```text
┌──────────────────────────────┐
│ Physical sensors / ESP32-S3  │  temperature · vibration · current · RPM
│ firmware/esp32               │  source = REAL_HARDWARE
└──────────────┬───────────────┘
               │ HTTPS + device API key
               ▼
┌──────────────────────────────┐
│ Backend API (FastAPI)        │
│ backend/app/api/             │  validate → persist → evaluate
└──────┬───────────────┬───────┘
       │               │
       ▼               ▼
┌──────────────┐  ┌──────────────────────────────┐
│ PostgreSQL   │  │ Deterministic engine          │
│ Alembic      │  │ health_engine + physics-rule  │
│ 001–009      │  │ authoritative machine state   │
└──────┬───────┘  └──────────────┬───────────────┘
       │                         │
       └────────────┬────────────┘
                    ▼
        ┌──────────────────────────────┐
        │ Machine Evidence Packet      │  measurements + engine outputs
        │ (assembled server-side)      │  + provenance
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │ Meta AI integration          │  interpretation, explanation,
        │ (planned, provider adapter)  │  recommended inspection
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │ Frontend dashboard           │  live state, evidence, AI answer
        │ React/Vite                   │  voice input/output, history
        └──────────────────────────────┘
```

### 5.2 Component responsibilities

**Physical sensors / ESP32-S3.** Read temperature, vibration, current, and RPM; timestamp with NTP; send telemetry to the backend over HTTPS with the device API key. The physical path already exists in `firmware/esp32/`; the hackathon must verify it on real hardware rather than assume it works. Wokwi remains the fallback demonstration source and must stay tagged `WOKWI`.

**Backend API.** Owns validation, authentication, tenant scoping, persistence, health evaluation, evidence assembly, and AI orchestration. Existing endpoints remain the contract; new hackathon endpoints should be additive.

**Database.** PostgreSQL with Alembic migrations. Sensor readings are the only source of measurement truth. Engine outputs are persisted or recomputed deterministically; AI text is stored separately and never written into measurement columns.

**Deterministic health and prediction engine.** `backend/app/services/health_engine.py` and `ml/prediction.py`. Produces health state, per-channel states, alerts, risk score, component attribution, and reasons. It is deterministic, versioned (`physics-rule-v1`), and explicitly labeled as a prototype baseline rather than a trained model.

**Meta AI integration.** A new provider behind the existing AI boundary. It receives the evidence packet, returns a structured interpretation, and has no database access and no authority to change machine state.

**Frontend dashboard.** Displays stored readings, engine state, evidence, and AI interpretation as separate visual elements. It must show an explicit unavailable state when AI is not configured or fails, rather than a placeholder answer.

---

## 6. AI Safety and Reliability

These rules are requirements, not aspirations. Each has an enforcement point.

### 6.1 The AI must not invent sensor readings

- The AI receives only values read from persisted rows in the evidence packet.
- The response contract requires an `evidence` section that echoes the measurement fields used.
- The backend compares echoed values against the packet before accepting or displaying the response. A mismatch causes the interpretation to be rejected.
- Missing channels are explicit `null` values with a `missing_channels` list. The model is instructed to say data is insufficient rather than estimate a value.
- The model is never asked to "fill in" or "predict" a sensor value.

### 6.2 The AI must not override deterministic health calculations

- `Machine.status` and the deterministic health state are written only by the health engine.
- AI output is stored as an interpretation record, not as machine state.
- If the AI assessment disagrees with the engine, both are shown, with the engine labeled authoritative and the AI labeled advisory.
- No code path may assign an AI-provided status to `Machine.status`, alert severity, or the deterministic risk score.

### 6.3 Separate measurements, engine outputs, and AI interpretations

Three distinct layers must remain distinguishable in storage, API responses, and UI:

| Layer | Meaning | Authority |
| --- | --- | --- |
| Measurements | Sensor values from a device, with timestamp and source | Factual record |
| Engine outputs | Deterministic health state, alerts, risk score, reasons | Authoritative evaluation |
| AI interpretation | Explanation, context, recommended inspection | Advisory only |

The API response should use separate fields (for example `measurements`, `engine`, `interpretation`) rather than merging them into one prose blob. The UI must not render AI text as if it were a measurement.

### 6.4 Handle API failures and insufficient data

- Missing Meta credentials: return an explicit configuration error; persist nothing; UI shows "AI interpretation unavailable."
- Provider timeout, HTTP error, rate limit, or malformed output: explicit error; no fallback text is fabricated.
- Partial reading (one or more channels missing): the deterministic engine may still evaluate available channels; the AI must be told exactly which channels are missing and must lower confidence or return `unknown`.
- No reading at all: no AI call; return an explicit "no telemetry" response.
- Stale reading: include the reading timestamp and age; the model must acknowledge staleness rather than present old data as current.
- Provider failure must never block telemetry ingestion, health evaluation, or alerting.

### 6.5 Keep API credentials on the backend

- Meta credentials live only in backend environment configuration or the deployment secret store.
- No credential, token, or provider URL containing a secret is sent to the browser, embedded in the frontend bundle, written to firmware, or logged.
- The frontend calls the backend; it never calls the AI provider directly.
- Provider requests use HTTPS with certificate verification enabled.
- Secrets are never included in prompts, error messages returned to clients, or persisted prediction records.

---

## 7. Implementation Roadmap

Each phase has an exit criterion. A phase is not complete until its criterion is demonstrated, not merely coded. All phases below are **not started**.

### Phase 0 — Baseline verification

- Confirm the repository state and branch; record the commit used for the hackathon baseline.
- Run the existing backend test suite and frontend lint; record actual results, including failures.
- Confirm the backend starts with the current configuration and that `/api/health` and `/api/ready` respond as implemented.
- Inventory which environment variables are configured, without printing secret values.

**Exit criterion:** A written baseline record exists stating what passes, what fails, and what could not be run. No capability is assumed.

### Phase 1 — Physical/device-to-backend data verification

- Configure the ESP32-S3 firmware with real Wi-Fi, backend URL, and device credentials.
- Assign and document the actual sensor pins and calibration for temperature, vibration, current, and RPM.
- Register the device and machine through the supported API.
- Verify that a physical reading creates a persisted `SensorReading` row with `source = REAL_HARDWARE`, the correct device/machine linkage, and an NTP-derived timestamp.
- Verify rejection behavior for malformed or out-of-range telemetry.

**Exit criterion:** A real sensor reading is visible as a database row, and the same reading is retrievable through the public read endpoint. If hardware is unavailable, this phase is reported as blocked and the demonstration falls back to Wokwi with that limitation stated.

### Phase 2 — Deterministic engine verification

- Feed controlled readings through the ingest path: normal, warning, critical, partial, and invalid.
- Verify the resulting machine status, per-channel states, alert creation, and cooldown behavior.
- Verify that `physics-rule-v1` output is labeled `is_prototype=True` and contains no RUL or invented confidence.
- Verify predictions are generated only for complete readings and only within the documented cooldown.

**Exit criterion:** Engine outputs are reproducible for known inputs and match the documented thresholds, with results recorded from the running system.

### Phase 3 — Meta AI flagship integration

- Define and implement the Machine Evidence Packet assembly in the backend from persisted rows and engine outputs.
- Implement a Meta AI provider behind the existing provider boundary, using only officially documented model and API details confirmed at implementation time.
- Enforce the structured response contract: evidence echo, interpretation, recommended inspection, confidence, and explicit `insufficient_data` handling.
- Validate the response server-side and reject mismatched or malformed output.
- Persist interpretations separately from measurements and engine outputs.
- Add the evidence view to the dashboard, with engine state labeled authoritative and AI labeled advisory.

**Exit criterion:** For a real stored reading, the backend returns a machine context packet and an AI interpretation that cites fields from that packet; a tampered or mismatched response is rejected; disabling the credential produces an explicit unavailable state with no fabricated output.

### Phase 4 — Optional secondary features

- **Voice-first assistant:** add speech capture, transcript display, and optional speech output over the existing grounded assistant endpoint. Verify that the transcript cannot introduce measurements that are not in the packet.
- **Tool-based retrieval:** add bounded, read-only tools and log tool calls and returned rows. Verify organization scoping and row limits.
- **Visual inspection:** attach and store inspection images; label AI image descriptions as observations, not measurements.
- **Degradation history:** summarize trends over a stated window and sample count; do not extrapolate RUL.

**Exit criterion:** Each implemented optional feature preserves the three-layer separation and fails safely when its dependency is unavailable.

### Phase 5 — Deployment and end-to-end testing

- Deploy backend, database, and frontend to always-on infrastructure.
- Configure secrets in the deployment platform; confirm none appear in the frontend bundle or logs.
- Run the full demonstration path from the deployed system with no laptop-hosted dependency.
- Execute the acceptance criteria in Section 8 and record actual results.
- Prepare a rollback path and a fallback demonstration if the network, device, or provider fails during judging.

**Exit criterion:** The deployed system serves stored telemetry and a grounded AI interpretation to a browser while the development laptop is powered off, with results recorded.

---

## 8. Testing and Acceptance Criteria

| # | Criterion | How it will be verified | Pass condition |
| --- | --- | --- | --- |
| 1 | Real data reaches the database | Send a device reading through the ingest endpoint; query the persisted row | Row exists with the exact submitted values, device ID, machine ID, timestamp, and source |
| 2 | Backend returns verified machine context | Request the machine context/evidence endpoint for that reading | Response includes the persisted measurement values and deterministic engine outputs with provenance |
| 3 | AI explanations reference that context | Request an interpretation for the same reading | Response cites the reading timestamp and the specific measurement/engine fields used |
| 4 | Invalid or missing data is handled safely | Submit out-of-range values, missing channels, unknown device, stale reading, and an unconfigured provider | Invalid input is rejected; missing channels are labeled; stale data is flagged; AI unavailability is explicit; nothing is fabricated |
| 5 | Frontend displays actual backend results | Compare UI values against the API response for the same machine and reading | Values and timestamps match; measurements, engine state, and AI text are visually distinct |
| 6 | Deployed system works without the laptop | Stop the development machine; open the deployed frontend and query the deployed API | Persisted telemetry and interpretation remain available; device liveness is reported honestly as offline if the device is not transmitting |

Additional verification requirements:

- The AI response validator must be tested with deliberately malformed, out-of-range, and evidence-mismatched payloads.
- The deterministic engine's thresholds must be tested at boundary values.
- Every test result reported must come from an actual run; failures are reported as failures.
- No database row may be hand-edited to make a demonstration pass.

---

## 9. Demo and Submission Plan

### 9.1 Three-minute demonstration

| Time | Content |
| --- | --- |
| 0:00–0:25 | **Problem and system.** PredictIQ turns machine telemetry into a defensible maintenance decision. Show the deployed dashboard, not a slide. |
| 0:25–0:55 | **Real telemetry.** Show a live or recently persisted reading with its timestamp, device ID, and source. If the physical device is connected, show the sensor values changing; state clearly whether the source is `REAL_HARDWARE` or `WOKWI`. |
| 0:55–1:30 | **Deterministic evaluation.** Show the engine's health state, per-channel threshold states, and any alert. Emphasize that this is `physics-rule-v1`, a deterministic prototype baseline, not a trained model. |
| 1:30–2:20 | **Meta AI evidence-grounded interpretation.** Request an explanation for that machine. Show that the answer cites the actual reading and engine outputs, and that it is labeled advisory while the engine remains authoritative. |
| 2:20–2:40 | **Safety behavior.** Demonstrate one failure path: stop the AI provider or request a machine with no telemetry. Show the explicit unavailable/insufficient-data state instead of a fabricated answer. |
| 2:40–3:00 | **Close.** State what was built during the hackathon versus what existed before, and name the next step: real multi-machine data and validated models. |

### 9.2 Demonstration rules

- Show real telemetry, real backend processing, and the working Meta AI integration. Do not use screenshots of results that were not produced by the system.
- Both the device source and the AI provider must be labeled on screen.
- If a component fails during the demo, show the failure state and explain it. Do not switch to a recording that hides it.
- Keep a fallback: a recently persisted reading from the deployed database and a saved API response, clearly labeled as recorded evidence if used.

### 9.3 Pre-existing work vs. hackathon-built work

The submission must state this split explicitly:

- **Pre-existing:** telemetry ingestion, database schema and migrations, deterministic health/prediction engine, Gemini provider, alerting, maintenance/feedback workflow, React dashboard, test suites and CI configuration.
- **Hackathon-built:** the Machine Evidence Packet, the Meta AI provider and its validation, the evidence-grounded response contract, the evidence UI, and any implemented voice/tool/visual features.
- **Not claimed:** any feature listed in Section 10 as unverified or unimplemented.

---

## 10. Current Limitations and Future Work

### 10.1 Limitations that must be stated honestly

- **No Meta AI integration exists yet.** The repository currently integrates Google Gemini only. Meta AI is a hackathon goal, not existing functionality.
- **No evidence-grounded response contract exists yet.** The current Gemini analysis is validated for structure and ranges, but it does not require the model to cite specific evidence fields.
- **No voice interface exists.** The assistant is text-only.
- **No tool calling exists.** The backend assembles a fixed context packet.
- **No visual inspection or degradation-history feature exists.** Only the existing telemetry history views are present.
- **The physical device path is unverified.** Firmware exists, but sensor pins are placeholders and no hardware calibration or hardware telemetry run is recorded in the repository.
- **The Wokwi path is a simulation.** Its simulation calibrations are documented as such and are not physical calibration claims.
- **The deterministic engine is a prototype baseline.** `physics-rule-v1` is rule-based, not a trained model, and its thresholds are not calibrated against a validated industrial dataset.
- **No trained ML model artifact is present.** `ml/models/` contains documentation only; training requires sufficient curated ground truth.
- **Deployment status is unverified.** `deploy/README.md` marks runtime verification as pending live infrastructure, and the production URLs in `docs/README.md` were not checked during this documentation pass.
- **Test execution status is unverified for this plan.** The suites exist, but no test run was performed as part of this documentation-only change.
- **No performance, accuracy, uptime, or user-feedback claims are made.** None has been measured or collected.

### 10.2 Future work

- Calibrate thresholds and sensor channels against real machine data.
- Collect and label degradation and failure data; train and validate a model through the existing governance path.
- Add validated remaining-useful-life estimation only when the data supports it.
- Expand tool-based retrieval to richer maintenance history and spare-parts context.
- Add image-based inspection records with explicit separation from sensor evidence.
- Harden deployment, observability, and credential rotation for continuous operation.
- Evaluate the Meta AI interpretation path against a held-out set of real machine readings before making any quality claim.

---

## Appendix — Repository Evidence Index

| Claim area | Primary files inspected |
| --- | --- |
| Telemetry and validation | `backend/app/api/sensors.py`, `backend/app/schemas/sensor.py` |
| Health engine and alerts | `backend/app/services/health_engine.py` |
| Deterministic prediction | `ml/prediction.py`, `ml/explainability.py`, `ml/recommendation.py`, `backend/app/services/prediction_service.py` |
| Existing AI provider | `backend/app/services/ai_provider.py`, `backend/app/api/predictions.py`, `backend/app/core/config.py` |
| Assistant | `backend/app/api/assistant.py`, `frontend/src/pages/Machine3DViewPage.tsx`, `frontend/src/services/api.ts` |
| Database and tenancy | `backend/alembic/versions/001`–`009`, `backend/app/db/models.py`, `backend/app/core/tenant.py` |
| Frontend | `frontend/src/pages/`, `frontend/src/services/api.ts` |
| Firmware | `firmware/esp32/config.h`, `firmware/esp32/README.md`, `firmware/wokwi/README.md` |
| Deployment | `deploy/README.md`, `deploy/docker-compose.yml`, `deploy/TLS_SETUP.md` |
| Tests and CI | `backend/tests/`, `.github/workflows/ci.yml` |
| Existing project documentation | `docs/README.md`, `docs/01-ARCHITECTURE.md`, `docs/02-FEATURES.md`, `docs/04-IMPLEMENTATION-ROADMAP.md`, `docs/06-AI-AND-ML-STRATEGY.md`, `docs/08-TESTING-AND-DEMO.md`, `docs/10-DECISIONS.md` |
