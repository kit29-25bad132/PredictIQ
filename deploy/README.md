# PredictIQ Deployment (Phase 8)

This directory holds the complete deployment configuration for the PredictIQ V1 platform.

## Status

| Component | Status |
|-----------|--------|
| Dockerfile (frontend) | Implemented — builds React/Vite frontend + Node server |
| Dockerfile.backend | Implemented — builds FastAPI backend with migrations |
| docker-compose.yml | Implemented — complete stack: frontend + backend + database |
| Backend service | Real FastAPI image with Alembic migrations |
| Database service | PostgreSQL 16 with persistent volume |
| Healthchecks | Backend `/api/ready`, database `pg_isready` |
| Environment template | `deploy/.env.example` with all required variables |
| TLS / Reverse Proxy | Not configured — see TLS_SETUP.md |
| Deployment verification | **PENDING** live infrastructure |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Docker Network                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   Reverse Proxy (optional)           │   │
│  │            TLS termination for production            │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                           │                                  │
│  ┌────────────────────────┴─────────────────────────────┐  │
│  │                    Frontend Service                   │  │
│  │  React/Vite Dashboard on port 3000                   │  │
│  │  Environment: VITE_API_URL → Backend URL             │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────┴─────────────────────────────┐  │
│  │                    Backend Service                    │  │
│  │  FastAPI on port 8000                                │  │
│  │  - Migrations run on startup (Alembic)               │  │
│  │  - Health: /api/health (alive)                       │  │
│  │  - Ready:  /api/ready (DB check)                     │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────┴─────────────────────────────┐  │
│  │                   Database Service                    │  │
│  │  PostgreSQL 16 on port 5432                          │  │
│  │  Persistent volume: postgres_data                    │  │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Files

- `Dockerfile` — builds the React/Vite frontend + server.ts into a Node image
- `Dockerfile.backend` — builds the FastAPI backend with Python dependencies
- `docker-compose.yml` — orchestrates all three services with healthchecks
- `entrypoint.sh` — backend startup script that runs migrations before FastAPI
- `.env.example` — environment variable templates (no real values)
- `TLS_SETUP.md` — TLS configuration guide for production deployment
- `README.md` — this file

## Required Environment Variables

Copy `deploy/.env.example` to `.env` and configure:

### Database (Required)

```bash
# PostgreSQL connection for backend
DATABASE_URL=postgresql+psycopg://predictiq:CHANGE_ME_PASSWORD@database:5432/predictiq

# libpq sslmode: the local compose PostgreSQL has no TLS -> "disable".
# Managed/remote production databases should use "require" (backend default).
DB_SSLMODE=disable

# Or individual settings (used if DATABASE_URL is empty)
DB_USER=predictiq
DB_PASSWORD=CHANGE_ME_PASSWORD
DB_NAME=predictiq
DB_PORT=5432
```

### Application Settings

```bash
APP_ENV=production
BACKEND_PORT=8000
FRONTEND_PORT=3000
```

### Frontend API Configuration

The frontend uses a RUNTIME /api reverse proxy (VITE_API_URL is build-time-only
and cannot be changed after the bundle is built — see "Frontend ↔ Backend
Connection" below):

```bash
# Target the Node frontend server proxies /api requests to (runtime env var).
# Inside the compose network the backend service is reachable as "backend".
BACKEND_ORIGIN=http://backend:8000
```

For local (non-Docker) development, run `npm run dev` in `frontend/` with
`BACKEND_ORIGIN=http://localhost:8000` (the default).

### Security

```bash
# Device API key for write-gate authentication
# Set a strong random value in production
DEVICE_API_KEY=CHANGE_ME_DEVICE_KEY

# CORS origins - comma-separated list of allowed browser origins
# Must include your frontend URL(s)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Database Migration Strategy

### Approach: Pre-startup Migration

The backend container runs database migrations **before** starting the FastAPI application.

**How it works:**

1. Container starts → `entrypoint.sh` executes
2. `alembic upgrade head` runs to apply any pending migrations (alembic.ini and
   alembic/ are copied to /app by the Dockerfile — the entrypoint verifies this)
3. If migrations succeed → FastAPI starts (`backend.app.main:app`)
4. If migrations fail → container exits with error

**Migration Chain:**

```
001_initial_schema → 002_device_source → 003_timestamptz_and_machine_specs
→ 004_enum_check_constraints → 005_prediction_prototype_fields
→ 006_feedback_ground_truth
```

**Important Notes:**

- Do NOT modify existing migrations (001-006)
- The migration chain is designed to be applied incrementally
- New migrations should be added with `alembic revision --autogenerate`
- The database volume persists data across container restarts

**Why this approach:**

- Ensures database schema is always up-to-date before the app starts
- Fails fast if migrations have issues (container won't start)
- No need to modify application startup code
- Alembic handles the migration order automatically

## Health and Readiness

### Endpoints

| Endpoint | Purpose | Checks |
|----------|---------|--------|
| `/api/health` | Application alive | Returns status without DB check |
| `/api/ready` | Deployment readiness | **Actually checks database connectivity** |
| `/api/health/detailed` | Detailed status | All subsystem checks with details |

### Docker Healthchecks

**Backend:**
```yaml
healthcheck:
  test: ["CMD", "python", "-c", "urllib.request.urlopen('http://localhost:8000/api/ready')"]
  interval: 30s
  timeout: 10s
  start_period: 40s  # Time for migrations to complete
  retries: 3
```

**Database:**
```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U predictiq -d predictiq"]
  interval: 10s
  timeout: 5s
  retries: 5
```

### Readiness Behavior

- `/api/ready` returns **200 OK** only when the database is reachable
- Returns **503 Service Unavailable** if database check fails
- The frontend container waits for backend to be healthy before starting
- The backend waits for database to be healthy before starting

**No readiness is fabricated.** The `/api/ready` endpoint performs a real database query.

## Starting the Deployment

### Prerequisites

- Docker and Docker Compose installed
- Git repository cloned
- Environment variables configured in `.env`

### Quick Start

```bash
# 1. Copy environment template
cp deploy/.env.example .env

# 2. Edit .env with your values (especially passwords!)

# 3. Build and start all services
docker compose -f deploy/docker-compose.yml up --build -d

# 4. Check service status
docker compose -f deploy/docker-compose.yml ps

# 5. View logs
docker compose -f deploy/docker-compose.yml logs -f
```

### Step-by-Step

```bash
# Build images
docker compose -f deploy/docker-compose.yml build

# Start services in background
docker compose -f deploy/docker-compose.yml up -d

# Wait for services to be healthy (migrations take ~10-30 seconds)
sleep 30

# Verify all services are running
docker compose -f deploy/docker-compose.yml ps

# Check backend health
curl http://localhost:8000/api/health

# Check backend readiness (should return 200 after DB is ready)
curl http://localhost:8000/api/ready

# Access the frontend dashboard
# Open http://localhost:3000 in your browser
```

### Using the Already-Built Frontend

If the frontend has already been built (e.g., in development), you can skip the build:

```bash
# Use pre-built frontend dist
docker compose -f deploy/docker-compose.yml up -d
```

The frontend Dockerfile will use the existing `dist/` directory if available.

## Stopping the Deployment

```bash
# Stop all services (preserve database data)
docker compose -f deploy/docker-compose.yml stop

# Stop and remove containers (preserve database volume)
docker compose -f deploy/docker-compose.yml down

# Stop, remove containers AND database volume (DESTROYS DATA)
docker compose -f deploy/docker-compose.yml down -v
```

**Warning:** The `-v` flag removes the persistent database volume and all data.

## Inspecting Logs

```bash
# All services
docker compose -f deploy/docker-compose.yml logs -f

# Specific service
docker compose -f deploy/docker-compose.yml logs -f backend
docker compose -f deploy/docker-compose.yml logs -f frontend
docker compose -f deploy/docker-compose.yml logs -f database

# Follow logs in real-time
docker compose -f deploy/docker-compose.yml logs -f --tail=100

# Check backend migration output
docker compose -f deploy/docker-compose.yml logs backend | grep -i migration
```

## Frontend ↔ Backend Connection

### How It Works

1. The Vite bundle is built with NO absolute API URL, so the browser calls
   same-origin `/api/...` paths
2. The Node frontend server (`server.prod.ts`, compiled to `dist/server.cjs`)
   proxies every `/api/*` request to `BACKEND_ORIGIN` (runtime environment)
3. `BACKEND_ORIGIN` is set to `http://backend:8000` in docker-compose; change it
   per environment WITHOUT rebuilding the frontend image
4. (`VITE_API_URL` remains supported only for the pre-existing
   localStorage/custom-URL escape hatch in `api.ts`; it is no longer the
   deployment mechanism — runtime env vars cannot modify a built Vite bundle)

### Configuration Scenarios

**Local Docker Development:**
```bash
VITE_API_URL=http://localhost:8000
```
The frontend makes API calls to `http://localhost:8000/api/*`

**Production with Reverse Proxy:**
```bash
VITE_API_URL=https://predictiq.example.com
```
The frontend makes API calls to `https://predictiq.example.com/api/*`
The reverse proxy routes `/api/*` to the backend service.

**Same-Origin (Reverse Proxy serves both):**
```bash
# VITE_API_URL not set or empty
```
The frontend uses relative URLs (`/api/*`) and the reverse proxy handles routing.

### Runtime Configuration

The frontend container receives `BACKEND_ORIGIN` at runtime (compose passes it
through); no frontend rebuild is needed when the backend URL changes:
```bash
docker compose -f deploy/docker-compose.yml up -d --env-file .env
```

### Secrets and Frontend

**No secrets are exposed to the frontend.** The frontend only receives:
- `VITE_API_URL` — the API endpoint URL (not a secret)

Secrets like `DATABASE_URL`, `DEVICE_API_KEY`, and `DB_PASSWORD` remain on the backend only.

## TLS Configuration

TLS termination is **NOT configured** in the current skeleton.

See `TLS_SETUP.md` for:
- Production TLS options (reverse proxy, cloud load balancer)
- Certificate acquisition (Let's Encrypt, cloud providers)
- Required configuration changes
- Verification checklist

**TLS is deployment-environment dependent and requires:**
- A real domain name
- Valid TLS certificates
- Reverse proxy or load balancer configuration

Do not claim TLS is configured without completing the verification checklist in TLS_SETUP.md.

## Demo Scenarios

The following six demo scenarios are documented from `docs/V1-MIGRATION-PLAN.md` (§4, Phase 8).

**Important:** These scenarios should pass **without manually editing database records**.
Use the API and UI to drive the scenarios.

### Demo 1: Normal Operation

**Starting State:**
- Application deployed and running
- No machines registered

**Action:**
1. Register a machine via UI or API: `POST /api/machines`
2. Register a device: `POST /api/devices`
3. Send normal telemetry: `POST /api/sensor-data` with healthy values
4. Observe dashboard shows machine with normal status

**Expected Backend Result:**
- Machine created in database
- Device created and linked to machine
- Sensor readings stored
- Machine status remains "Healthy"
- No alerts generated

**Expected Frontend Result:**
- Dashboard displays the registered machine
- Live monitoring shows telemetry values
- No alerts in alert panel

**Verification Method:**
```bash
# Check machine exists
curl http://localhost:8000/api/machines

# Check device status
curl http://localhost:8000/api/devices

# Check recent readings
curl http://localhost:8000/api/sensor-data?limit=5

# Verify no alerts
curl http://localhost:8000/api/alerts
```

---

### Demo 2: Degradation Scenario

**Starting State:**
- Machine registered with specifications (rated_rpm, max_temp, max_vibration, etc.)
- Device connected and sending normal telemetry

**Action:**
1. Send telemetry with elevated values (e.g., temperature above max_temp threshold)
2. Observe health engine evaluation
3. Check machine status changes to "Warning"
4. Check for ACTIVE alert creation

**Expected Backend Result:**
- Health engine evaluates reading against machine specs
- Machine status changes from "Healthy" to "Warning"
- One ACTIVE alert created (deduplicated - not one per reading)
- Alert has appropriate severity (Warning for moderate exceedance)

**Expected Frontend Result:**
- Machine card shows "Warning" status
- Alert panel shows new ACTIVE alert
- Dashboard reflects the degradation

**Verification Method:**
```bash
# Send elevated temperature reading
curl -X POST http://localhost:8000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "timestamp": "2026-01-01T00:00:00Z",
    "temperature": 95.0,
    "vibration": 3.0,
    "current": 8.0,
    "rpm": 1450,
    "source": "WOKWI"
  }'

# Check machine status
curl http://localhost:8000/api/machines/MOTOR-001

# Check alerts
curl http://localhost:8000/api/alerts?status_filter=ACTIVE
```

---

### Demo 3: Critical/Failure Scenario

**Starting State:**
- Machine in Warning state with active alert
- Device still connected

**Action:**
1. Send telemetry with critical values (e.g., temperature well above max, vibration high)
2. Observe health engine evaluation
3. Check machine status changes to "Critical"
4. Verify new CRITICAL alert created (separate from Warning alert)
5. Optionally trigger a prediction

**Expected Backend Result:**
- Machine status escalates to "Critical"
- New CRITICAL severity alert created
- Existing Warning alert remains (not automatically resolved)
- Prediction generated if all four sensor channels present

**Expected Frontend Result:**
- Machine card shows "Critical" status (red/alert styling)
- Multiple alerts visible (Warning + Critical)
- Prediction card shows failure probability if available

**Verification Method:**
```bash
# Send critical readings
curl -X POST http://localhost:8000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "PIQ-ESP32-001",
    "machine_id": "MOTOR-001",
    "timestamp": "2026-01-01T00:01:00Z",
    "temperature": 120.0,
    "vibration": 8.0,
    "current": 15.0,
    "rpm": 1800,
    "source": "WOKWI"
  }'

# Check escalated status
curl http://localhost:8000/api/machines/MOTOR-001

# Check all alerts
curl http://localhost:8000/api/alerts

# Check prediction
curl http://localhost:8000/api/machines/MOTOR-001/prediction
```

---

### Demo 4: Offline Device Scenario

**Starting State:**
- Device connected and sending telemetry regularly
- Machine showing latest readings

**Action:**
1. Stop sending telemetry from the device (simulate disconnect)
2. Wait for device timeout period (default: 60 seconds)
3. Check device status changes to OFFLINE
4. Check machine still exists but no new readings

**Expected Backend Result:**
- Device `last_seen` not updated
- After timeout, device status computed as "OFFLINE"
- Machine remains in database with last known status
- No new sensor readings

**Expected Frontend Result:**
- Device status shows "OFFLINE"
- Dashboard indicates no recent data
- Data collection status shows "WAITING"

**Verification Method:**
```bash
# Check device status (should be ONLINE initially)
curl http://localhost:8000/api/devices/PIQ-ESP32-001/status

# Wait 60+ seconds without sending telemetry

# Check device status again (should be OFFLINE)
curl http://localhost:8000/api/devices/PIQ-ESP32-001/status

# Check data status
curl http://localhost:8000/api/data-status
```

---

### Demo 5: Maintenance + Feedback Loop

**Starting State:**
- Machine in Critical state with active alert
- Prediction generated for the machine

**Action:**
1. Create a maintenance record: `POST /api/maintenance`
2. Create feedback/ground-truth record linked to:
   - The machine
   - The prediction (prediction_id)
   - The alert (alert_id)
   - Optionally the maintenance record
3. Include technician-observed data:
   - observed_condition
   - actual_fault
   - root_cause
   - symptoms
   - action_taken
   - parts_replaced
   - severity
   - outcome (Confirmed/Not Confirmed/Cancelled)
   - prediction_correct (true/false)

**Expected Backend Result:**
- Maintenance record created
- Feedback record created with all links
- Feedback linked to prediction for prediction-vs-reality tracking
- Ground truth stored for future ML training

**Expected Frontend Result:**
- Maintenance page shows new work order
- Feedback form captures technician observations
- Prediction-vs-reality view can compare prediction to actual outcome

**Verification Method:**
```bash
# Create maintenance record
curl -X POST http://localhost:8000/api/maintenance \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "MOTOR-001",
    "component": "Bearing",
    "failure_type": "Spalling",
    "issue_description": "Elevated vibration and temperature",
    "maintenance_action": "Replaced drive-end bearing",
    "technician": "Tech1",
    "status": "Completed"
  }'

# Create feedback record linked to prediction and alert
curl -X POST http://localhost:8000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "machine_id": "MOTOR-001",
    "prediction_id": 1,
    "alert_id": 1,
    "maintenance_record_id": 1,
    "observed_condition": "Bearing noise and elevated temperature",
    "actual_fault": "Bearing spalling",
    "root_cause": "Insufficient lubrication",
    "symptoms": "High vibration, high temperature",
    "action_taken": "Replaced bearing",
    "parts_replaced": "Drive-end bearing, seal",
    "severity": "Critical",
    "outcome": "Confirmed",
    "technician_notes": "Bearing showed clear spalling pattern",
    "prediction_correct": true,
    "feedback_source": "MANUAL"
  }'

# Verify feedback stored
curl http://localhost:8000/api/feedback

# Check prediction-vs-reality (via evaluation endpoint)
curl http://localhost:8000/api/model-evaluation
```

---

### Demo 6: Real Hardware Device (Optional)

**Starting State:**
- Real ESP32-S3 device with sensors configured (Phase 7 complete)
- Device connected to network with access to backend

**Action:**
1. Configure device firmware with deployment backend URL
2. Device sends telemetry with `source: "REAL_HARDWARE"`
3. Observe telemetry ingestion and health evaluation

**Expected Backend Result:**
- Telemetry accepted with `source: "REAL_HARDWARE"`
- Device registered as REAL_HARDWARE source
- Health evaluation works identically to Wokwi source
- No difference in backend behavior based on source

**Expected Frontend Result:**
- Device shows as REAL_HARDWARE source
- Telemetry displayed same as any other source
- Dashboard doesn't distinguish between simulation and real hardware

**Verification Method:**
```bash
# Check device source
curl http://localhost:8000/api/devices

# Verify REAL_HARDWARE source is recorded
curl http://localhost:8000/api/sensor-data?limit=10 | grep REAL_HARDWARE
```

**Note:** This scenario requires actual Phase 7 hardware implementation.
If hardware is not available, this scenario is documented but not executable.

---

## Verification Status

### What Has Been Verified

| Item | Status | Notes |
|------|--------|-------|
| Backend Dockerfile syntax | ✅ Verified | Build context correct, no syntax errors |
| Backend entrypoint script | ✅ Verified | Runs migrations, then starts app |
| Frontend Dockerfile | ✅ Existing | From Phase 7, unchanged |
| docker-compose.yml syntax | ⏳ Config validation | Run `docker compose config` to verify |
| Health endpoints | ✅ Code verified | `/api/health`, `/api/ready`, `/api/health/detailed` implemented |
| Database migration chain | ✅ Code verified | 001→006 chain intact, entrypoint runs `alembic upgrade head` |
| Environment templates | ✅ Created | `deploy/.env.example` with all variables |
| Frontend API configuration | ✅ Existing | Uses `VITE_API_URL`, no hardcoded URLs |

### What Remains Deployment-Environment Dependent

| Item | Status | Requires |
|------|--------|----------|
| Docker image build | ⏳ Pending | Docker runtime |
| Container startup | ⏳ Pending | Docker runtime, database accessible |
| Migration execution | ⏳ Pending | Database running, migrations apply cleanly |
| Healthcheck operation | ⏳ Pending | Containers running, endpoints responding |
| Frontend → Backend connectivity | ⏳ Pending | Both containers running, network configured |
| End-to-end demo scenarios | ⏳ Pending | Full stack running, no manual DB edits |
| TLS termination | ⏳ Pending | Domain, certificates, reverse proxy |
| Real hardware telemetry | ⏳ Pending | Phase 7 hardware, network access to backend |

### Static Validation vs. Runtime Verification

**Static validation (code review, config check):**
- ✅ Dockerfile syntax
- ✅ docker-compose.yml structure
- ✅ Health endpoint implementation
- ✅ Environment template completeness
- ✅ No secrets in code

**Runtime verification (requires Docker):**
- ⏳ Container builds succeed
- ⏳ Containers start without errors
- ⏳ Migrations apply successfully
- ⏳ Health endpoints respond correctly
- ⏳ Frontend reaches backend
- ⏳ Demo scenarios pass

## Deployment Checklist

Before deploying to production:

- [ ] All environment variables configured with real values
- [ ] Database password changed from placeholder
- [ ] DEVICE_API_KEY set to strong random value
- [ ] CORS_ORIGINS set to production frontend URLs
- [ ] VITE_API_URL set to production URL (with HTTPS if TLS configured)
- [ ] TLS configured (see TLS_SETUP.md) if exposing to internet
- [ ] Database backups configured
- [ ] Log aggregation configured (optional)
- [ ] Monitoring/alerts for container health (optional)
- [ ] Rollback procedure documented

## Rollback Notes

### Database Migration Rollback

Alembic supports downgrading migrations:

```bash
# Connect to the backend container
docker compose -f deploy/docker-compose.yml exec backend bash

# Downgrade to specific revision
alembic downgrade <revision_id>

# Or downgrade one step
alembic downgrade -1
```

**Warning:** Downgrading may lose data if migrations removed columns or tables.
Always test rollback procedures in a non-production environment first.

### Container Rollback

To rollback to a previous image version:

```bash
# Stop current containers
docker compose -f deploy/docker-compose.yml down

# Edit docker-compose.yml to use previous image tag

# Restart
docker compose -f deploy/docker-compose.yml up -d
```

## Security Notes

1. **Never commit `.env` files** — they are gitignored for a reason
2. **Rotate credentials** before first deployment
3. **Use strong passwords** for database
4. **Restrict CORS** to your actual frontend domains
5. **Enable write-gate** with DEVICE_API_KEY in production
6. **TLS required** for any internet-facing deployment
7. **No secrets in Docker images** — all via environment variables

## Troubleshooting

### Backend won't start

```bash
# Check logs for migration errors
docker compose -f deploy/docker-compose.yml logs backend

# Common issues:
# - DATABASE_URL incorrect or database not reachable
# - Migration failure (check alembic output)
# - Port conflict (8000 already in use)
```

### Frontend can't reach backend

```bash
# Check BACKEND_ORIGIN is correct
docker compose -f deploy/docker-compose.yml exec frontend env | grep BACKEND_ORIGIN

# Check backend is healthy
curl http://localhost:8000/api/ready

# Check CORS settings allow the frontend origin
```

### Database connection fails

```bash
# Check database is running
docker compose -f deploy/docker-compose.yml ps database

# Check database logs
docker compose -f deploy/docker-compose.yml logs database

# Verify credentials in .env match database service environment
```

### Migrations not applying

```bash
# Check migration history
docker compose -f deploy/docker-compose.yml exec backend alembic current

# Run migrations manually to see errors
docker compose -f deploy/docker-compose.yml exec backend alembic upgrade head
```
