# PredictIQ — Security & Production
## Status: PLANNED / LOCKED DIRECTION

### Prototype
- no secrets in Git
- environment variables
- input validation
- deliberate CORS
- safe error handling

## Write-Gate Authentication (implemented in V1)

Every mutating endpoint requires the shared write-gate key:

- Server config: `DEVICE_API_KEY` (env). Empty means the gate is OPEN and the
  backend logs a startup warning — acceptable only in local development.
- Client sends `X-API-Key: <key>` (the ESP32/Wokwi firmware does this
  automatically when its `DEVICE_API_KEY` is set). `Authorization: Bearer <key>`
  is accepted as an alias.
- Missing credential → **401**; wrong credential → **403**.
- Gated endpoints: `POST /api/sensor-data`, `/api/predict`, `/api/feedback`,
  `/api/maintenance`, `/api/machines`, `/api/devices`, `/api/devices/heartbeat`,
  `/api/train-model`, and alert acknowledge/resolve. GET reads stay public so
  the dashboard works without credentials.

**Known limitation (device spoofing):** the V1 gate is a single shared key, not
per-device identity. Any key holder can submit telemetry for ANY `device_id`.
Per-device credentials, server-side device-ownership enforcement on ingest, and
key-rotation tooling are explicitly out of V1 scope. Interim mitigations: keep
the key secret, restrict network exposure, and treat device attribution as
advisory evidence rather than authenticated identity.

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
