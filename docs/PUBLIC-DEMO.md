# Public Demo Dashboard (PUBLIC_DEMO_MODE)

PredictIQ now has two strictly separated experiences that share one product UI:

| | NORMAL_MODE | PUBLIC_DEMO_MODE |
|---|---|---|
| Entry | `/signin`, `/signup`, Google OAuth | `/demo` (also `/demo/<section>`) |
| Identity | Verified Supabase JWT | None |
| Tenant | Caller's active organization membership | Fixed demo organization only |
| Data | Organization's PostgreSQL rows | Dedicated simulated demo dataset |
| Writes | Role-gated as before | None (no routes, UI hidden) |
| Providers | `AuthProvider`, workspace initializer, alarm/simulation | `DemoProvider` (+ local alarm state only) |

The demo reuses the existing layout (`Sidebar`, `Header`, dashboard pages) and
only swaps the read service, hides mutation controls, and adds a persistent
DEMO MODE banner. There is no second dashboard implementation.

## 1. Public demo API

All routes are `GET`-only, require no credentials, are rate limited per client
IP, and are bound to the demo organization. They never accept an organization
identifier: `organization_id`, `org_id` or `organization` in the query string
returns `400`.

| Endpoint | Returns |
|---|---|
| `GET /api/public/demo/overview` | `mode`, dataset disclosure, `FleetStatsResponse` |
| `GET /api/public/demo/machines?limit&offset` | Paginated `MachineResponse` list (demo machines only) |
| `GET /api/public/demo/machines/{machine_id}` | One `MachineResponse` |
| `GET /api/public/demo/machines/{machine_id}/latest` | Latest demo `SensorReadingResponse` |
| `GET /api/public/demo/readings?machine_id&limit&offset` | Paginated demo readings (oldest → newest) |
| `GET /api/public/demo/data-status` | Data-status contract, `sensor_status="DEMO"`, `demo_mode=true` |
| `GET /api/public/demo/predictions?machine_id&limit&offset` | Paginated `PredictionResponse` list |
| `GET /api/public/demo/machines/{machine_id}/prediction` | Latest demo prediction (or explicit "insufficient data") |
| `GET /api/public/demo/model-status` | Platform model readiness, `demo_mode=true` |
| `GET /api/public/demo/alerts?machine_id&status_filter&limit&offset` | Paginated `AlertResponse` list |
| `GET /api/public/demo/maintenance?machine_id&limit&offset` | Paginated `MaintenanceResponse` list |

Pagination defaults: `limit=50` (1–200), `offset=0` (0–5000); out-of-range values
return `422`. List responses are `{ items, total, limit, offset }`.

Responses reuse the authenticated schemas. No organization ids, memberships,
devices, credentials or technician personal data are exposed. All data carries
`source="MANUAL_DEMO"` and `device_id=null`.

Rate limiting is configured by `PUBLIC_DEMO_RATE_LIMIT_REQUESTS` (default 90) and
`PUBLIC_DEMO_RATE_LIMIT_WINDOW_SECONDS` (default 60). It is in-process (per
worker); `429` responses include `Retry-After`.

Database failures are reduced to a generic `503`; internal errors are never
returned to visitors. If the demo dataset is not provisioned the API answers
`503` instead of falling back to any production data.

## 2. Demo dataset provisioning

The dataset is real PostgreSQL data in the existing schema:

* organization `public-demo` (`00000000-0000-4000-8000-0000000000de`);
* 4 machines with `is_demo=true` (Healthy / Warning / Critical / Maintenance),
  rated specs and realistic locations;
* one ACTIVE `demo_sessions` row per machine (required by the MANUAL_DEMO
  provenance constraint);
* 48 readings per machine (`source=MANUAL_DEMO`, `device_id=NULL`,
  `demo_session_id` set), 5-minute spacing, deterministic series;
* 1 prediction per machine (`physics-rule-v1`, prototype) with explanation
  factors;
* alerts (ACTIVE / ACKNOWLEDGED / RESOLVED) and maintenance records with
  role-based technician labels.

Provision it (never run this against production without approval):

```bash
python -m backend.scripts.seed_public_demo
# Rebuild the demo rows only:
python -m backend.scripts.seed_public_demo --reset --confirm
```

The seeder is idempotent, deletes only demo-organization rows on reset, and
refuses to run if a demo machine ID is already owned by another organization.
Existing authenticated endpoints already exclude `is_demo` machines,
`MANUAL_DEMO` readings, demo alerts/predictions and demo machines from device
ingestion, heartbeats, fleet stats/data-status and ML evaluation.

No Alembic migration is required: the dataset uses tables from migrations
001–010. Only additive configuration variables were added.

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
* Production data is never copied. The dataset is generated from the existing
  models with fictional labels; no anonymization of real records was performed
  or attempted.

## 4. Frontend structure

New files:

* `frontend/src/lib/demoMode.ts` — route/read-only helpers.
* `frontend/src/services/dataService.ts` — `FleetDataService` read interface.
* `frontend/src/services/demoApi.ts` — credential-free demo implementation.
* `frontend/src/context/DemoContext.tsx` — demo snapshot provider.
* `frontend/src/components/DemoDashboard.tsx` — demo workbench.
* `frontend/src/components/DemoModeBanner.tsx` — persistent disclosure + CTAs.

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

# 2. Provision the demo dataset (this deployment only)
python -m backend.scripts.seed_public_demo

# 3. Run the API
uvicorn backend.app.main:app --reload --port 8000

# 4. Browse the contract without credentials
curl http://localhost:8000/api/public/demo/overview
curl "http://localhost:8000/api/public/demo/machines?limit=2"
curl "http://localhost:8000/api/public/demo/alerts?status_filter=ACTIVE"

# 5. Run the frontend
cd frontend && npm run dev
```

Then in the browser:

1. Open `http://localhost:5173/` (landing). Confirm Explore Demo and Sign In.
2. Click Explore Demo → `/demo` loads without a login redirect.
3. Refresh `/demo` and `/demo/alerts` — both must stay in the demo.
4. Navigate every demo section; confirm data appears and no write buttons exist.
5. Confirm the DEMO MODE banner is visible on every section and includes
   "Sign in to your workspace" / "Back to site".
6. Open DevTools → Network: demo requests go to `/api/public/demo/*`, carry no
   `Authorization`/`X-Organization-Id` header and no cookies.
7. Sign in normally and verify the authenticated dashboard is unchanged.

## 6. Deployment steps (manual, not performed)

1. Apply no migration; deploy backend code.
2. Set `PUBLIC_DEMO_RATE_LIMIT_REQUESTS` / `..._WINDOW_SECONDS` if defaults are
   unsuitable. No new secrets are required.
3. Run `python -m backend.scripts.seed_public_demo` once against the target
   database (explicit approval required; it writes only demo rows).
4. Deploy the frontend. `/demo` must not be rewritten to `/` by the host — the
   existing SPA fallback already serves `index.html` for unknown paths, so no
   hosting change is expected.
5. Verify `GET /api/public/demo/overview` is reachable through the production
   proxy and that authenticated endpoints still return `401` without a token.

## 7. Tests

Backend: `backend/tests/test_public_demo.py` (16 tests) covers unauthenticated
access, provenance, isolation from a seeded production-looking tenant,
non-demo machine ids, organization-selector rejection, pagination/validation,
absence of write routes, authenticated-endpoint protection, seeding idempotency
and rate limiting.

Frontend: `frontend/src/tests/publicDemo.test.ts` covers demo routing,
read-only guards, credential-free transport, real error propagation, and
source-level wiring (dispatch before `AuthProvider`, landing CTAs, demo
service/read-only props).
