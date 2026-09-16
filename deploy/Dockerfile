# PredictIQ Frontend Deployment (Phase 8)
#
# Builds the React/Vite frontend and the Node production server (server.prod.ts)
# into a single image. The backend (FastAPI + PostgreSQL) is a separate service.
#
# Runtime API architecture (fixes the VITE_API_URL build-time/runtime mismatch):
# - The Vite bundle is built with NO VITE_API_URL, so the browser calls
#   same-origin "/api/..." paths.
# - The Node server (server.prod.ts) proxies /api/* to BACKEND_ORIGIN, a RUNTIME
#   environment variable (e.g. http://backend:8000 inside the compose network).
# - Changing the backend location requires only an env change, never a rebuild.
#
# Status: code-complete; runtime verification pending Docker daemon (see
# deploy/README.md Verification Status).
# No secrets are baked into this image; env is injected at runtime.
FROM node:20-slim AS build
WORKDIR /app

# Copy manifests and install ALL dependencies (dev deps are required to build:
# vite, esbuild, typescript, tailwind plugin).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json ./
COPY frontend/src ./src
COPY frontend/apiProxy.ts frontend/server.prod.ts ./
RUN npm run build

# Runtime stage: compiled server, static assets, and the production
# dependencies the server imports at runtime (express and its deps).
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
