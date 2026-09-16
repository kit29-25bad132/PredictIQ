"""
Predict IQ - V1 FastAPI backend entrypoint.

Loads all runtime configuration through the V1 config module instead of
scattered module-level environment access.

System endpoints:
- GET  /api/health          Liveness + authoritative system snapshot (typed).
- GET  /api/health/detailed Subsystem detail (DB connectivity).
- GET  /api/ready           Readiness (DB connectivity, see api/health.py).
- GET  /api/stats           Fleet statistics from PostgreSQL (dashboard KPIs).

Read endpoints are public by design (the dashboard has no user accounts yet);
every mutating endpoint is gated by the API-key write gate (app/core/auth.py).
"""

from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
import uvicorn

from backend.app.core.auth import API_KEY_HEADER, _warn_unconfigured_once
from backend.app.core.config import get_settings
from backend.app.db.database import get_db, SessionLocal
from backend.app.db.models import (
    Alert,
    Device,
    Machine,
    MaintenanceRecord,
    SensorReading,
)
from backend.app.api import alerts, machines, maintenance, predictions, sensors, feedback, health

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Honest startup signal: log once whether the write gate is active so an
    # unauthenticated deployment is visible in container logs, not silent.
    if settings.device_api_key:
        print(f"Write-gate ACTIVE: mutating endpoints require the '{API_KEY_HEADER}' header.")
    else:
        _warn_unconfigured_once()
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
app.include_router(alerts.router, prefix="/api")
app.include_router(maintenance.router, prefix="/api")
app.include_router(predictions.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(health.router, prefix="/api")


def _liveness_db():
    """DB dependency for liveness endpoints: yields None when no DB is configured.

    /api/health is a liveness probe and must keep answering (with zeros and
    database=NOT_CONFIGURED) even without a database; /api/ready is the strict
    readiness check that actually fails when the DB is unreachable.
    """
    if SessionLocal is None:
        yield None
        return
    yield from get_db()


@app.get("/api/health", tags=["System Health"], summary="Check backend health")
def health_check(db: Any = Depends(_liveness_db)) -> Dict[str, Any]:
    """
    Authoritative liveness + identity snapshot consumed by the frontend
    (``frontend/src/services/api.ts:getHealth``). Field names are the contract;
    do not rename without updating that client.

    Uses the request-scoped session via Depends(get_db) so deployment-specific
    session overrides (tests, alternate engines) are honored.
    """
    return {
        "status": "ok",
        "system": "Predict IQ V1 Backend",
        "version": app.version,
        "environment": settings.environment,
        "timestamp": _utc_now_iso(),
        "database": "PostgreSQL" if SessionLocal is not None else "NOT_CONFIGURED",
        "active_machines": _safe_count(func.count(Machine.id), Machine, db),
        "registered_devices": _safe_count(func.count(Device.id), Device, db),
        "connected_esp32_devices": _safe_connected_devices(db),
        "total_sensor_readings": _safe_count(func.count(SensorReading.id), SensorReading, db),
    }


@app.get("/api/stats", response_model=dict, tags=["System Health"], summary="Fleet statistics from PostgreSQL")
def fleet_stats(db: Any = Depends(_liveness_db)) -> Dict[str, Any]:
    """
    DB-backed fleet KPIs for the dashboard (``api.ts:getFleetStats``).
    Every value is computed from real rows — never hardcoded.
    Degrades to honest zero values when the database is unreachable so the UI
    shows an empty fleet instead of lying.
    """
    active_devices = _safe_connected_devices(db)
    total_readings = _safe_count(func.count(SensorReading.id), SensorReading, db)
    return {
        "total_machines": _safe_count(func.count(Machine.id), Machine, db),
        "total_devices": _safe_count(func.count(Device.id), Device, db),
        "connected_devices": active_devices,
        "total_sensor_readings": total_readings,
        "total_maintenance_records": _safe_count(func.count(MaintenanceRecord.id), MaintenanceRecord, db),
        "active_alerts": _safe_active_alerts(db),
        "data_collection_status": "ACTIVE" if active_devices > 0 else "WAITING",
    }


def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _safe_count(statement, model, db: Any) -> int:
    """Count rows; no database or an unreachable one yields 0 rather than a 500 on a liveness probe."""
    if db is None:
        return 0
    try:
        return int(db.query(statement).scalar() or 0)
    except Exception:
        return 0


def _safe_connected_devices(db: Any) -> int:
    from datetime import datetime, timedelta, timezone

    if db is None:
        return 0
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.device_timeout_seconds)
        return int(
            db.query(func.count(Device.id))
            .filter(Device.last_seen >= cutoff)
            .scalar()
            or 0
        )
    except Exception:
        return 0


def _safe_active_alerts(db: Any) -> int:
    if db is None:
        return 0
    try:
        return int(
            db.query(func.count(Alert.id))
            .filter(Alert.status == "ACTIVE")
            .scalar()
            or 0
        )
    except Exception:
        return 0


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
