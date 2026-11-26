# P0 authentication unification report

## Root cause

Supabase authentication, JWT attachment/refresh, and idempotent personal-workspace provisioning were already implemented. The failure was a split browser-write transport:

- `AuthContext` configured `api` with the current Supabase access token and initialized `/api/organizations/ensure`.
- Normal routes such as `POST /api/machines` already use verified JWT plus organization-role authorization.
- `frontend/src/services/api.ts` nonetheless sent every browser mutation to `/api/operator/*` through an HMAC operator-cookie transport with no JWT.

Thus a signed-in Supabase user correctly had no operator cookie and received `Operator session required. Log in first.`

## Implemented change

Ordinary browser operations now use the established JWT/tenant routes:

- machines: `POST /api/machines`
- devices: `POST /api/devices`
- maintenance: `POST /api/maintenance`
- alerts: `POST /api/alerts/{id}/acknowledge|resolve`
- feedback: `POST /api/feedback`
- simulation configuration: `POST /api/machines/{id}/simulation-config` and reset

The frontend no longer has an operator-cookie transport or operator login/session methods, and the Alerts UI no longer asks for a backend operator password. Tokens continue to be supplied centrally by `AuthContext`, refreshed once after a 401, and organization selection remains a server-verified header hint.

Legacy operator routes remain backend-only platform-governance compatibility surfaces. They have no frontend consumer after this change; they were not made anonymous or repurposed for normal users. Device ingestion remains separately API-key authenticated.

## Workspace onboarding

No new onboarding implementation was required. `POST /api/organizations/ensure` already resolves the verified JWT subject, serializes provisioning with a PostgreSQL advisory lock (or local process lock), creates an owner membership only when none exists, and never adopts unrelated data.

## Manual telemetry provenance

`POST /api/manual-sensor-data` is new. It requires an organization membership, scopes the target machine to that organization, uses server-selected `MANUAL_INPUT` provenance, and writes no device id. Alembic revision `011_manual_input_provenance` extends source/coherence checks without rewriting data. This means typed readings cannot be shown as ESP32 hardware telemetry.

## Dashboard correctness

The dashboard now identifies an authenticated workspace rather than always reporting an anonymous/public session. Its alarm-status bar displays `WAITING FOR TELEMETRY` when no reading exists; it no longer calls an absence of readings nominal health. Manual input is visibly labelled as authenticated manual input.

## Verification

- `npm run lint`: passed.
- `pytest backend/tests/test_human_auth_mutations.py backend/tests/test_telemetry_contract.py -q -p no:cacheprovider`: **65 passed**, one third-party deprecation warning.
- `npm run build`: passed outside the sandbox after the required build-helper permission; Vite reported only its existing large-chunk warning.
- The frontend `tsx` standalone test launcher could not run inside this Windows sandbox because esbuild helper spawning returned `EPERM`; the production build succeeded when the helper was permitted.
- PostgreSQL migration execution, real Supabase login, two-account isolation against deployment, and deployed Vercel verification were not performed because no authorized deployment credentials or isolated database were provided.

## Deployment requirements

1. Apply Alembic revision `011_manual_input_provenance` through the reviewed migration process before exposing manual input.
2. Deploy backend and frontend together so the new endpoint and browser routes are compatible.
3. Confirm production Supabase issuer/JWKS/audience configuration, Vercel `VITE_API_URL`, and backend CORS include the production frontend origin.
4. Verify Account A and Account B using authorized demonstration accounts; do not use production records without authorization.

## Rollback

Roll back the frontend/backend deployment together. Alembic downgrade from revision 011 deliberately refuses while `MANUAL_INPUT` rows exist; export or apply an approved retention procedure before downgrade. No data is deleted by this change.
