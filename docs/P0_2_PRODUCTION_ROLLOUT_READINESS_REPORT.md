# P0.2 production rollout readiness and demonstration verification

**Status:** READY FOR A REVIEWED DEPLOYMENT; not production-verified.  
**Scope date:** 2026-11-26.  
**Production URL supplied for review:** `https://predictiq-neon.vercel.app/dashboard`.

## 1. P0 implementation verification

The current diff matches `docs/P0_AUTHENTICATION_UNIFICATION_REPORT.md`.

The original production failure had one direct cause: the frontend established a valid Supabase session but sent normal user mutations to `/api/operator/*` without a JWT, relying on an unrelated HMAC cookie. The current frontend no longer has an operator request transport or operator login UI. Browser mutations use the existing authenticated organization routes and attach the centrally managed Supabase access token.

The existing `/api/organizations/ensure` implementation already covers new and existing users without a membership. It derives the verified JWT subject, reuses an active membership when present, creates a personal organization plus owner membership only when no membership exists, and serializes concurrent creation using a PostgreSQL advisory lock. Workspace state is cleared when sessions change or log out.

## 2. Additional P0.2 correction

The deployment environment template incorrectly stated that all mutations need `DEVICE_API_KEY`. This could lead to an insecure or non-working rollout. The template now accurately distinguishes:

- `DEVICE_API_KEY`: device-only ingestion/heartbeat/prediction-analysis paths; never browser-exposed.
- Supabase JWT plus verified organization membership: ordinary human workspace reads and writes.
- legacy operator configuration: backend-only platform-governance compatibility, with no SPA consumer.

No production setting, credential, database row, migration, deployment, commit, or push was changed.

## 3. Manual telemetry trace

`POST /api/manual-sensor-data` accepts a validated measurement only after `require_org_member` resolves the verified user and organization. It finds the target machine with both `machine_id` and `organization_id`; foreign or unknown machines return 404. The server—not the browser—sets:

```
source = MANUAL_INPUT
device_id = NULL
demo_session_id = NULL
```

The endpoint persists the reading, calls the existing `evaluate_reading` health engine, and commits the resulting machine state, alerts, and eligible prototype prediction in the same request flow. Complete abnormal manual readings are eligible for the existing health-engine prediction cooldown and receive `physics-rule-v1`/`is_prototype=true`; no duplicate engine was introduced. Existing machine history endpoints retrieve `SensorReading` rows regardless of this new valid provenance. Maintenance and feedback remain tenant-scoped existing workflows.

Alembic revision `011_manual_input_provenance` extends the source/coherence database checks. It preserves WOKWI and REAL_HARDWARE requirements for a registered device and keeps MANUAL_DEMO session-bound. MANUAL_INPUT cannot claim either physical device or demo identity.

## 4. Deployment topology evidence

| Component | Evidence-backed conclusion | Status |
|---|---|---|
| Frontend | `frontend/vercel.json` and the locally present `frontend/api/index.ts` implement a Vercel SPA plus same-origin `/api/*` serverless proxy. The supplied public hostname is a Vercel hostname. | Static evidence / supplied URL |
| API proxy | The local Vercel function forwards requests unchanged to runtime `BACKEND_ORIGIN`, with a 25-second timeout. **However, `frontend/api/index.ts` is currently untracked by Git. A commit/Git-triggered Vercel deployment would omit it unless it is intentionally added first.** | Blocked for commit-based rollout |
| Backend host/provider | Not identified in repository configuration. | Unknown; do not guess |
| PostgreSQL host/provider | Not identified in repository configuration. Docker Compose documents an optional self-hosted PostgreSQL 16 stack only. | Unknown; do not guess |
| Supabase project/configuration | Required through public frontend values and backend JWKS/issuer settings, but actual project configuration was not supplied. | Unknown; do not guess |
| Production endpoint result | Web inspection was unavailable in this environment; no deployed health/readiness response was observed. | Not verified |

## 5. Migration rollout requirements

Migration `011_manual_input_provenance` is additive: it changes only the two `sensor_readings` checks. It does not rewrite existing data. Downgrade refuses if `MANUAL_INPUT` rows exist, avoiding silent data loss.

Before authorization to apply it, the deployment owner must take a verified backup and confirm the target revision:

```bash
# On the backend deployment host/container; DATABASE_URL must name the intended database.
pg_dump --format=custom --no-owner --file predictiq-pre-011.backup "$DATABASE_URL"
alembic current
alembic heads
```

After explicit authorization and only against the confirmed target database:

```bash
./deploy/migrate.sh
# Expected final revision: 011_manual_input_provenance (head)
alembic current
```

For the repository Docker deployment path, the equivalent command is:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec backend /migrate.sh
```

Do not run a downgrade while MANUAL_INPUT data exists. Roll back application images/release first; restore the verified backup or follow an approved data-retention process before any database downgrade.

## 6. Exact deployment sequence (authorization boundary)

1. Confirm backup success, actual `DATABASE_URL` target, and current Alembic revision.
2. Set backend production variables: `APP_ENV=production`, `DATABASE_URL`, `DB_SSLMODE=require` for a managed remote DB, `DEVICE_API_KEY`, `CORS_ORIGINS=https://predictiq-neon.vercel.app`, `SUPABASE_URL`, `SUPABASE_JWKS_URL`/issuer if overridden, and audience. Never put secrets in Vercel `VITE_*` variables.
3. Apply migration 011 using the approved command above.
4. Deploy the backend image/release using the actual backend provider procedure, then verify `GET /api/health` and `GET /api/ready` through its intended public/proxied path.
5. Set Vercel server runtime `BACKEND_ORIGIN` to the backend HTTPS origin. Set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as public frontend build values.
6. First add and review `frontend/api/index.ts`; it is required by the Vercel rewrite but is not currently Git-tracked. Then, after explicit authorization, deploy frontend with `cd frontend && vercel --prod`, or use the linked repository’s CI deployment trigger. A Git commit/push is necessary only if the Vercel project is configured for Git-triggered deployments; that linkage was not available locally.
7. Verify production in a controlled demonstration workspace before using DRDO demo accounts.

## 7. Actual local verification

| Check | Result |
|---|---|
| P0.2 manual-workflow regression | `backend/tests/test_human_auth_mutations.py`: 3 passed. Includes owner machine creation without operator cookie, manual tenant/provenance isolation, and critical manual telemetry creating health/alert/prototype prediction artifacts. |
| Telemetry validation | `backend/tests/test_telemetry_contract.py` plus P0.2 tests: 66 passed, one upstream TestClient deprecation warning. |
| Frontend TypeScript | `npm --prefix frontend run lint`: passed. |
| Frontend production build | `npm run build` (from `frontend`): passed; Vite emitted only its large-chunk warning. |
| Full backend suite | 360 tests collected; execution reached 100%, but exited nonzero because this Windows environment denied pytest access to its isolated base-temp directories. Five PostgreSQL migration tests were skipped because no disposable `MIGRATION_TEST_DATABASE_URL` was configured. This is not production evidence. |
| Production browser/API/database | Not performed; no credentials, authorized test accounts, database target, or backend provider access were supplied. |

## 8. Production acceptance checklist

The following must be performed by an authorized operator with two disposable demonstration accounts. Mark an item verified only with observed result.

- [ ] Account A signup/signin, session restore, JWT refresh, logout/signin.
- [ ] Account A receives/reuses exactly one personal workspace.
- [ ] Account A registers a machine and sees it after refresh/relogin.
- [ ] Account A submits normal, warning, and critical manual measurements; each shows `MANUAL_INPUT`.
- [ ] Warning/critical reading produces the expected health state, alert, and eligible prototype prediction.
- [ ] Account A acknowledges/resolves an alert, creates/completes maintenance, and stores feedback.
- [ ] Account A sees historical readings, alerts, prediction, maintenance, and feedback after refresh.
- [ ] Account B gets a distinct workspace and cannot read or mutate Account A resources with direct API IDs or headers.
- [ ] Missing/invalid JWT is rejected for private routes; missing/invalid device credentials are rejected for device paths.
- [ ] Public demo remains read-only and isolated.
- [ ] Backend readiness and frontend same-origin proxy remain healthy after deployment.

## 9. Remaining blockers and required user actions

1. Add and review `frontend/api/index.ts` before any commit-based frontend deployment; otherwise the `/api/*` Vercel rewrite has no versioned serverless handler.
2. Supply or access the actual backend host/provider, PostgreSQL provider, and Vercel project settings to verify the live topology.
3. Authorize a database backup, migration, backend release, Vercel release, and designated disposable demo accounts before any production mutation.
4. Provide a disposable PostgreSQL migration-test database to execute revisions 009–011 end-to-end.
5. Resolve this host’s pytest temporary-directory ACL issue before treating a full-suite run as green.

The application is locally prepared for rollout, but the live demonstration is **not verified** until the checklist is completed against the deployed environment.
