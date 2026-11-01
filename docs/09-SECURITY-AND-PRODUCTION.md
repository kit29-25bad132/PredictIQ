# PredictIQ — Security & Production
## Status: PLANNED / LOCKED DIRECTION

### Prototype
- no secrets in Git
- environment variables
- input validation
- deliberate CORS
- safe error handling

## Authentication & Authorization (Phase 3)

Three independent transports; none of them can satisfy another:

| Transport | Credential | Used by |
|---|---|---|
| User | Supabase JWT (`Authorization: Bearer`) + `X-Organization-Id` selector | organization-scoped reads/writes |
| Device | `X-API-Key: <DEVICE_API_KEY>` (`Bearer` alias) | telemetry ingest, `/api/predict`, `/api/predictions/analyze`, heartbeat |
| Operator | signed HttpOnly session cookie (`POST /api/auth/login`) | `/api/operator/*`, simulation-config mutations, `POST /api/train-model`, `GET /api/model-evaluation` |

Rules enforced by `backend/app/core/tenant.py`:

- Organization endpoints require a verified Supabase JWT **and** an active
  membership in the selected organization (looked up per request — revocation
  takes effect immediately).
- No selector + exactly one active membership → that organization; multiple →
  **400**; none → **403**; foreign/suspended selection → uniform **404**.
- Roles: `owner`/`admin` manage machines and devices; `member` reads and may
  create maintenance/feedback and acknowledge/resolve alerts.
- Every tenant-owned row (8 tables) is scoped by `organization_id` in SQL;
  client-supplied `organization_id` values are never consulted.
- Private GET reads require authentication; `GET /api/health` and
  `GET /api/ready` remain public for the landing page and probes.

**Known limitation (device spoofing):** device authentication is still a single
shared key (`DEVICE_API_KEY`), not per-device identity. Any key holder can
submit telemetry for any *registered* `device_id` (Phase 3 added: unknown
device IDs are rejected, and a device may only write to its own machine and
organization). Per-device credentials and key-rotation tooling remain out of
scope; treat device attribution as advisory evidence rather than authenticated
identity.

**Model training policy:** PredictIQ runs ONE platform-global model. Training
(`POST /api/train-model`) and evaluation (`GET /api/model-evaluation`) are
operator-only and deliberately pool curated feedback across organizations — no
per-organization model is built from mixed tenants, and no tenant can trigger
or influence training. Per-organization models would need a separate approved
design.

## Database TLS

`DB_SSLMODE` (libpq sslmode) is environment-owned, never hardcoded:

- Backend default: `require` — protects managed/remote production databases.
- The local docker-compose PostgreSQL has no TLS: set `DB_SSLMODE=disable` in
  `deploy/.env` (the compose file passes it through explicitly).
- Never weaken a production connection silently; any deviation from `require`
  must be a deliberate, documented environment setting.

### Production
- HTTPS
- authenticated APIs
- device authentication
- authorization/roles
- organization isolation
- audit logs
- secure secret management
- rate limiting where appropriate
- backups
- monitoring
- model governance
