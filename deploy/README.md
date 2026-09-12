# PredictIQ Deployment (Phase 7 skeleton)

This directory holds the deployment skeleton for the PredictIQ V1 platform.

## Status

| Component | Status |
|-----------|--------|
| Dockerfile (frontend) | Implemented — builds frontend + Node server |
| docker-compose.yml | Implemented — frontend + placeholder backend |
| Backend service | Placeholder — replace with real FastAPI image |
| Deployment verification | **PENDING** live infrastructure |

## Files

- `Dockerfile` — builds the React/Vite frontend + server.ts into a Node image.
- `docker-compose.yml` — wires frontend + placeholder backend with env injection.
- `.env.example` (root) — environment variable templates (no real values).

## Secrets

No secrets are committed. All values are injected via `.env` (gitignored) or
runtime environment. See root `.env.example` for variable names.

## Next steps (Phase 8)

- Replace the backend placeholder with the real FastAPI image/build.
- Add healthchecks and readiness probes.
- Configure TLS termination (reverse proxy / ingress) for HTTPS.
- Wire the real DATABASE_URL and backend credentials at deployment time.
