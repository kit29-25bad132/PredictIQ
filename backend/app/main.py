"""
Predict IQ - V1 FastAPI backend entrypoint.

This Phase 0 scaffold intentionally keeps the app assembly minimal and loads
all runtime configuration through the V1 config module instead of scattered
module-level environment access.
"""

from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend.app.core.config import get_settings
from backend.app.api import machines, sensors

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="Predict IQ - V1 Backend",
    description="V1 backend scaffold for telemetry, health, and ML services.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sensors.router, prefix="/api")
app.include_router(machines.router, prefix="/api")


@app.get("/api/health", tags=["System Health"], summary="Check backend health")
def health_check() -> Dict[str, Any]:
    return {
        "status": "ok",
        "environment": settings.environment,
        "host": settings.host,
        "port": settings.port,
    }


@app.get("/", tags=["Root"])
def root() -> Dict[str, Any]:
    return {
        "app": "Predict IQ",
        "role": "V1 backend scaffold",
        "status": "online",
        "documentation": "/docs",
        "health": "/api/health",
    }


if __name__ == "__main__":
    uvicorn.run(
        "backend.app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )
