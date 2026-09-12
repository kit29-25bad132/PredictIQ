# PredictIQ Frontend Deployment (Phase 7 skeleton)
#
# Builds the React/Vite frontend and the Node server (server.ts) into a single
# image. The backend (FastAPI + PostgreSQL) is a separate service — not built
# here.
#
# Status: skeleton — deployment verification PENDING live infrastructure.
# No secrets are baked into this image; env is injected at runtime.
FROM node:20-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json ./
COPY frontend/src ./src
COPY frontend/server.ts ./
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "dist/server.cjs"]
