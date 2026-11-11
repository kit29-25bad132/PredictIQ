# Demo Sessions (MANUAL_DEMO)

Phase 1 adds a third, fully isolated telemetry source: `MANUAL_DEMO`. It is
used by controlled product demos and never mixes with `WOKWI` or
`REAL_HARDWARE` data.

## Model

| Object | Rule |
| --- | --- |
| `demo_sessions` | One row per session. Owned by an organization; `machine_id` is unique, so each session has its own dedicated machine. `status` is `ACTIVE` or `CLOSED`. |
| `machines.is_demo` | `true` only for demo machines. Hidden from `GET /api/machines` unless `include_demo=true`. |
| `sensor_readings.source` | `WOKWI`, `REAL_HARDWARE` or `MANUAL_DEMO`. |
| `MANUAL_DEMO` reading | `device_id IS NULL` **and** `demo_session_id IS NOT NULL`. Enforced by `ck_sensor_readings_demo_coherence`. |
| Device reading | `device_id IS NOT NULL` **and** `demo_session_id IS NULL`. |
| `alerts` / `predictions` | `demo_session_id` is stamped for demo-generated rows. |

The composite foreign key `(organization_id, demo_session_id)` makes it
impossible to attach a demo record to another organization's session.

## Roles

| Action | Minimum role |
| --- | --- |
| Create / activate / close / reset a session | owner or admin |
| List / read sessions, ingest demo readings | any active member |

All resolution uses the verified Supabase identity + database membership. The
`X-Organization-Id` header is only a selector; it never grants access.

## Endpoints

All paths are under `/api` and require a Supabase Bearer token.

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/demo-sessions` | admin | Create an `ACTIVE` session + dedicated demo machine |
| GET | `/demo-sessions?status=ACTIVE\|CLOSED` | member | List sessions in the caller's organization |
| GET | `/demo-sessions/{id}` | member | Read one session (cross-org → 404) |
| POST | `/demo-sessions/{id}/activate` | admin | Set `ACTIVE`, clear `closed_at` |
| POST | `/demo-sessions/{id}/close` | admin | Set `CLOSED` + `closed_at` (idempotent) |
| POST | `/demo-sessions/{id}/readings` | member | Ingest MANUAL_DEMO telemetry (409 if closed) |
| POST | `/demo-sessions/{id}/reset` | admin | Delete this session's demo data (explicit confirmation) |

### Reading body

```json
{"temperature": 40.0, "vibration": 1.0, "current": 2.0, "rpm": 1450.0,
 "timestamp": "2026-11-11T12:00:00Z", "note": "optional"}
```

At least one channel is required. Bounds and NaN/Inf validation are the same as
device telemetry. `device_id`, `source` and `demo_session_id` are rejected in
the body (`extra="forbid"`); the server derives them. `note` is accepted for
operator context but is **not persisted** (Phase 1 adds no note column).

The normal health engine runs on each demo reading: demo machines can move to
`Warning`/`Critical`, and generated alerts/predictions are stamped with the
session id.

### Reset body

```json
{"confirm": true, "confirm_session_name": "<exact session name>"}
```

Reset deletes, in one transaction, `predictions → alerts → readings` filtered by
`organization_id = caller` **and** `demo_session_id = session` (readings also
require `source = MANUAL_DEMO`). It then sets the demo machine back to
`Healthy`. It never touches devices, real machines, WOKWI/REAL_HARDWARE data or
other demo sessions. The session status is unchanged.

## Isolation guarantees

- `POST /api/sensor-data`, `POST /api/devices` and `POST /api/devices/heartbeat`
  reject demo machines with `400`.
- `POST /api/feedback` rejects demo machines, so demo data cannot enter the
  ground-truth pool.
- `GET /api/machines` hides demo machines by default (`include_demo=true` opts
  in); `MachineResponse.is_demo` exposes the flag.
- `/api/stats`, `/api/health` and `/api/data-status` exclude demo machines and
  `MANUAL_DEMO` readings.
- `GET /api/model-evaluation` / training sample collection excludes demo
  machines and demo-stamped predictions.
- The device contract is unchanged: `SensorDataInput`, `DeviceHeartbeatInput`
  and `Device.source` still accept only `WOKWI` / `REAL_HARDWARE`.

## Migration 010

`backend/alembic/versions/010_manual_demo_source.py` (`down_revision =
009_organizations_and_tenancy`) is additive.

Upgrade preflight:

- no unknown `sensor_readings.source` values;
- zero rows with `device_id IS NULL` before it becomes nullable;
- zero rows with `demo_session_id` already set;
- row-count snapshot for machines/readings/alerts/predictions/feedback.

Upgrade post-check: counts unchanged and every new `demo_session_id` still
`NULL`. Existing rows are never rewritten.

Downgrade **refuses** while demo data exists (any `demo_sessions` row or
`MANUAL_DEMO` reading) and reports the counts. To downgrade:

1. reset/purge demo sessions with explicit approval, or
2. restore a verified `pg_dump`/PITR backup.

`deploy/entrypoint.sh` runs `alembic upgrade head` automatically, so applying
this migration in production is a deployment-time schema change requiring
explicit approval. This repository's Phase 1 work does not migrate any
production database.

## Testing

- `backend/tests/test_manual_demo.py` — lifecycle, roles, tenant isolation,
  provenance, alert/prediction stamping, device-path rejection, scoped reset,
  stats/data-status/ML exclusion.
- `backend/tests/test_simulation_scoping.py` — simulation config org scoping.
- `backend/tests/test_migration_010_postgres.py` — real PostgreSQL upgrade,
  coherence checks, downgrade refusal and clean re-upgrade. Set
  `MIGRATION_TEST_DATABASE_URL` to a disposable database; otherwise it is
  reported as **skipped**, not passed.
