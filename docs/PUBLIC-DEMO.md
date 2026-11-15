# Public Demo Dashboard (PUBLIC_DEMO_MODE)

PredictIQ has two strictly separated experiences that share one product UI:

| | NORMAL_MODE | PUBLIC_DEMO_MODE |
|---|---|---|
| Entry | `/signin`, `/signup`, Google OAuth | `/demo` (also `/demo/<section>`) |
| Identity | Verified Supabase JWT | None |
| Tenant | Caller's active organization membership | Fixed demo organization only |
| Data | Organization's PostgreSQL rows | Historical records copied from an explicitly selected source organization |
| Writes | Role-gated as before | None (no routes, UI hidden) |
| Providers | `AuthProvider`, workspace initializer, alarm/simulation | `DemoProvider` (+ local alarm state only) |

The demo reuses the existing layout (`Sidebar`, `Header`, dashboard pages) and
only swaps the read service, hides mutation controls, and adds a persistent
DEMO MODE banner. There is no second dashboard implementation. The default
provisioning copies historical rows; an optional standalone seed can generate
clearly labeled simulated demo telemetry when no suitable source exists.

## 1. Public demo API

All routes are `GET`-only, require no credentials, are rate limited per client
IP, and are bound to the demo organization. They never accept an organization
identifier: `organization_id`, `org_id` or `organization` in the query string
returns `400`.

| Endpoint | Returns |
|---|---|
| `GET /api/public/demo` | Combined read-only snapshot: `machines`, `sensor_readings`, `alerts`, `predictions`, `maintenance_records` |
| `GET /api/public/demo/overview` | `mode`, dataset disclosure, `FleetStatsResponse` |
| `GET /api/public/demo/machines?limit&offset` | Paginated `MachineResponse` list (demo machines only) |
| `GET /api/public/demo/machines/{machine_id}` | One `MachineResponse` |
| `GET /api/public/demo/machines/{machine_id}/latest` | Latest demo `SensorReadingResponse` |
| `GET /api/public/demo/readings?machine_id&limit&offset` | Paginated demo readings (oldest -> newest) |
| `GET /api/public/demo/data-status` | Data-status contract, `sensor_status="DEMO"`, `demo_mode=true` |
| `GET /api/public/demo/predictions?machine_id&limit&offset` | Paginated `PredictionResponse` list |
| `GET /api/public/demo/machines/{machine_id}/prediction` | Latest demo prediction (or explicit "insufficient data") |
| `GET /api/public/demo/model-status` | Platform model readiness, `demo_mode=true` |
| `GET /api/public/demo/alerts?machine_id&status_filter&limit&offset` | Paginated `AlertResponse` list |
| `GET /api/public/demo/maintenance?machine_id&limit&offset` | Paginated `MaintenanceResponse` list |

Pagination defaults: `limit=50` (1-200), `offset=0` (0-5000); out-of-range values
return `422`. List responses are `{ items, total, limit, offset }`.

`GET /api/public/demo` returns one payload for the `/demo` dashboard. Its
reading window ends at the newest demo reading and spans 24 hours, with at most
50 readings per machine and at most 50 rows per alert/prediction/maintenance
section. Its top-level keys are exactly the five named above.

Responses reuse the authenticated schemas. No organization ids, memberships,
devices, credentials, original machine ids or technician personal data are
exposed. All copied readings carry `source="MANUAL_DEMO"` and `device_id=null`.

Rate limiting is configured by `PUBLIC_DEMO_RATE_LIMIT_REQUESTS` (default 90) and
`PUBLIC_DEMO_RATE_LIMIT_WINDOW_SECONDS` (default 60). It is in-process (per
worker); `429` responses include `Retry-After`.

Database failures are reduced to a generic `503`; internal errors are never
returned to visitors. If the demo dataset is not provisioned the API answers
`503` instead of falling back to any production data.

## 2. Demo dataset provisioning

The demo organization is an isolated copy of selected historical production
rows, not a generated dataset:

* organization `public-demo` (`00000000-0000-4000-8000-0000000000de`);
* one or more explicitly selected source machines, copied with `is_demo=true`;
* one ACTIVE `demo_sessions` row per copied machine (required by the
  `MANUAL_DEMO` provenance constraint);
* the most recent N readings per machine (default 500, `0` = all), preserving
  original timestamps and values, rewritten as `source=MANUAL_DEMO`,
  `device_id=NULL`, with `demo_session_id` set;
* existing alerts, predictions and maintenance records for the selected
  machines, only when present in the source; no rows are fabricated;
* source machine ids replaced with deterministic `PUB-<hash>` ids;
* source device ids, organization ids, memberships, user ids, feedback and
  credentials are never copied;
* maintenance technician names are replaced with a non-personal label;
* locations are redacted by default (`--preserve-location` is an explicit
  override); known source machine/device/organization identifiers are scrubbed
  from copied free text.

`backend/alembic/versions/010_manual_demo_source.py` must already be applied.
Schema migration is never automatic: `deploy/entrypoint.sh` does not run
Alembic, and the application does not call `create_all`. Use
`deploy/migrate.sh` with an explicit `DATABASE_URL` after approval.

### Select the source organization explicitly

The provisioning script never guesses the source tenant. Start with read-only
inventory commands:

```bash
python -m backend.scripts.seed_public_demo --inspect
python -m backend.scripts.seed_public_demo --inspect \
  --source-organization-id <source-org-uuid>
```

The second command lists source machine ids, reading counts, latest reading
timestamps, and the deterministic public id each machine would receive.

### Dry run, then execute

```bash
# Dry run: shows the source -> public id mapping and planned row counts.
python -m backend.scripts.seed_public_demo \
  --source-organization-id <source-org-uuid> \
  --machine-id <source-machine-id> --machine-id <another-source-machine-id>

# Explicitly copy every source machine that has historical readings.
python -m backend.scripts.seed_public_demo \
  --source-organization-id <source-org-uuid> --all-machines --execute

# Rebuild only the demo organization's rows.
python -m backend.scripts.seed_public_demo \
  --source-organization-id <source-org-uuid> --all-machines \
  --refresh --confirm --execute
```

Without `--execute` the command writes nothing. The source organization is only
read. A refresh deletes only demo-organization rows in one transaction and
requires `--confirm`; the source organization is never modified. Re-running
without `--refresh` is a no-op when the demo dataset already exists.

### Standalone simulated demo seed (no source data)

When no suitable source organization exists, this self-contained seed creates
three `DEMO-MOTOR-00x` machines with 48 hours of hourly simulated readings, one
demo session per machine, and one ACTIVE Warning alert. It writes only inside
the demo organization and never reads or copies customer data.

```bash
# Dry run (default): prints the planned demo-only changes.
python -m backend.scripts.seed_demo_data

# Write / rebuild the demo dataset after approval.
python -m backend.scripts.seed_demo_data --execute
python -m backend.scripts.seed_demo_data --reset --confirm --execute
```

Migration 010 must already be applied. The script refuses to run on an older
schema, never changes schema, and is never run automatically. Re-running without
`--reset` is idempotent.

The API's existing isolation filters already exclude `is_demo` machines,
`MANUAL_DEMO` readings, demo alerts/predictions and demo machines from device
ingestion, heartbeats, fleet stats/data-status and ML evaluation.

## 3. Isolation and security

* Dedicated tenant, resolved by fixed UUID **and** slug. Never from a header,
  body, or query parameter.
* Every machine id is validated against that tenant with `is_demo=true`;
  unknown and non-demo ids return a uniform non-disclosing `404`.
* Read-only by construction: the router registers no POST/PUT/PATCH/DELETE
  routes, so writes answer `405`. The demo UI also hides write controls, and
  `demoApi` exposes no write methods.
* No fake Supabase session and no workspace initialization: `/demo` is rendered
  before `AuthProvider` mounts. The alarm provider is mounted with
  `backendSync={false}` so it never calls authenticated alert endpoints.
* The authenticated API is untouched: `require_supabase_user`,
  `require_org_member`/`require_org_admin`, the device API-key gate, the operator
  session gate, and RLS/service-role handling are unchanged.
* Production source rows are copied read-only into the isolated demo tenant.
  Direct identifiers, devices, credentials, original ids and technician names
  are removed or replaced; source records are never modified.

## 4. Frontend structure

New files:

* `frontend/src/lib/demoMode.ts` - route/read-only helpers.
* `frontend/src/services/dataService.ts` - `FleetDataService` read interface.
* `frontend/src/services/demoApi.ts` - credential-free demo implementation.
* `frontend/src/context/DemoContext.tsx` - demo snapshot provider.
* `frontend/src/components/DemoDashboard.tsx` - demo workbench.
* `frontend/src/components/DemoModeBanner.tsx` - persistent disclosure + CTAs.

Modified: `App.tsx` (route split), `HomePage.tsx` (Explore Demo CTAs),
`Header.tsx` (demo identity menu, `readOnly`), `Sidebar.tsx` (`hiddenTabs`),
`AlarmContext.tsx` (`backendSync`), `types.ts` (provenance/demo status unions),
and the dashboard pages that fetch data (`DashboardPage`, `MachinesPage`,
`MachineDetailsPage`, `PredictionsPage`, `MaintenancePage`, `AlertsPage`,
`SensorDataPage`) now accept an optional `dataService`/`readOnly`.

Demo sections: Dashboard, Machines, Machine Details, Predictions, Maintenance,
Alerts, Sensor Data. Authenticated-only surfaces (3D twin, Live Monitoring,
Feedback capture, System Status) are hidden because they are bound to
hardware/simulation configuration and write flows.

## 5. Local testing guide

```bash
# 1. Backend environment (local database)
export DATABASE_URL=postgresql+psycopg://...   # or DB_* settings

# 2. Apply schema migrations explicitly (local database only)
./deploy/migrate.sh

# 3. Inspect source organizations and machines (read-only)
python -m backend.scripts.seed_public_demo --inspect
python -m backend.scripts.seed_public_demo --inspect \
  --source-organization-id <local-source-org-uuid>

# 4. Copy real records into the demo organization (local database only)
python -m backend.scripts.seed_public_demo \
  --source-organization-id <local-source-org-uuid> --all-machines --execute

# 5. Run the API
uvicorn backend.app.main:app --reload --port 8000

# 6. Browse the contract without credentials
curl http://localhost:8000/api/public/demo/overview
curl "http://localhost:8000/api/public/demo/machines?limit=2"
curl "http://localhost:8000/api/public/demo/alerts?status_filter=ACTIVE"

# 7. Run the frontend
cd frontend && npm run dev
```

Then in the browser:

1. Open `http://localhost:5173/` (landing). Confirm Explore Demo and Sign In.
2. Click Explore Demo -> `/demo` loads without a login redirect.
3. Refresh `/demo` and `/demo/alerts` - both must stay in the demo.
4. Navigate every demo section; confirm copied data appears and no write
   buttons exist.
5. Confirm the DEMO MODE banner is visible on every section and includes
   "Sign in to your workspace" / "Back to site".
6. Open DevTools -> Network: demo requests go to `/api/public/demo/*`, carry no
   `Authorization`/`X-Organization-Id` header and no cookies.
7. Sign in normally and verify the authenticated dashboard is unchanged.

## 6. Deployment steps (manual, not performed)

1. Confirm the source organization id and selected machines with the read-only
   `--inspect` commands.
2. After explicit approval, apply migration 010 with `deploy/migrate.sh`
   (or `alembic upgrade head`) against the intended database.
3. Set `PUBLIC_DEMO_RATE_LIMIT_REQUESTS` / `..._WINDOW_SECONDS` if defaults are
   unsuitable. No new secrets are required.
4. Dry-run the demo copy, review the source -> public id mapping, then execute
   with `--execute` after approval. It writes only demo rows.
5. Deploy the backend and frontend. `/demo` must not be rewritten to `/` by the
   host - the existing SPA fallback already serves `index.html` for unknown
   paths, so no hosting change is expected.
6. Verify `GET /api/public/demo/overview` is reachable through the production
   proxy and that authenticated endpoints still return `401` without a token.

## 7. Tests

Backend: `backend/tests/test_public_demo.py` covers unauthenticated access,
provenance, isolation from a seeded production-looking tenant, non-demo machine
ids, organization-selector rejection, pagination/validation, absence of write
routes, authenticated-endpoint protection, explicit source selection, copied
data redaction, idempotency, scoped refresh and rate limiting.
`backend/tests/test_startup_no_ddl.py` guards against automatic schema creation
or migration at startup.

Frontend: `frontend/src/tests/publicDemo.test.ts` covers demo routing,
read-only guards, credential-free transport, real error propagation, and
source-level wiring (dispatch before `AuthProvider`, landing CTAs, demo
service/read-only props).
