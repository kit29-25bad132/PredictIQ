"""
Predict IQ - FastAPI Backend (PostgreSQL Architecture)
Production-grade REST backend for real ESP32 IoT condition monitoring and predictive maintenance.
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text, desc
import uvicorn

# Load environment
load_dotenv()

from backend.database.database import get_db, engine, Base
import backend.database.models
from backend.database.models import Machine, Device, SensorReading, MaintenanceRecord, Alert
from backend.schemas.sensor import FleetStatsResponse
from backend.api.machines import router as machines_router
from backend.api.sensors import router as sensors_router
from backend.api.predictions import router as predictions_router
from backend.api.alerts import router as alerts_router
from backend.api.maintenance import router as maintenance_router

DEVICE_TIMEOUT_SECONDS = int(os.getenv("DEVICE_TIMEOUT_SECONDS", "60"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Test PostgreSQL connectivity and ensure tables exist
    print("🚀 [Predict IQ Backend] Starting up...")
    print(f"Connecting to PostgreSQL: {engine.url.render_as_string(hide_password=True)}")
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1;"))
        print("✅ [Predict IQ Backend] PostgreSQL database connection verified.")
    except Exception as e:
        print(f"Database connection warning: {e}")
        print("Run Alembic migrations after configuring backend/.env.")
    yield
    print("🛑 [Predict IQ Backend] Shutting down...")

app = FastAPI(
    title="Predict IQ - Real-Data Predictive Maintenance API",
    description=(
        "Production-grade FastAPI backend for Predict IQ powered by PostgreSQL.\n\n"
        "Features:\n"
        "- **Real ESP32 Ingestion**: Ingests time-series sensor readings via `/api/sensor-data`\n"
        "- **PostgreSQL Persistence**: High-performance indexed storage for machines, devices, telemetry, maintenance, and alerts\n"
        "- **Zero Fake Data**: Transparent data collection and ML readiness tracking\n"
        "- **Device Telemetry Tracking**: Live connection status derived from `last_seen` timestamps\n"
    ),
    version="4.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS Configuration
cors_origins_env = os.getenv("CORS_ORIGINS", "*")
allowed_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health Check Endpoint
@app.get("/api/health", tags=["System Health"], summary="Check system and PostgreSQL health")
def health_check(db: Session = Depends(get_db)):
    """
    Returns server operational status, database connectivity, and real asset counts.
    """
    db.execute(text("SELECT 1")).scalar_one()
    return {"status": "ok", "database": "connected"}

# Fleet Stats Endpoint (Summary KPIs for Dashboard)
@app.get("/api/stats", response_model=FleetStatsResponse, tags=["System Health"], summary="Get fleet-wide health statistics")
def get_fleet_stats(db: Session = Depends(get_db)):
    """
    Returns real aggregated metrics directly from PostgreSQL. Never returns fake numbers.
    """
    total_machines = db.query(Machine).count()
    total_devices = db.query(Device).count()
    total_readings = db.query(SensorReading).count()
    total_maint = db.query(MaintenanceRecord).count()
    active_alerts = db.query(Alert).filter(Alert.status == "ACTIVE").count()

    cutoff = datetime.utcnow() - timedelta(seconds=DEVICE_TIMEOUT_SECONDS)
    connected_devices = db.query(Device).filter(Device.last_seen >= cutoff).count()

    status_str = "ACTIVE" if total_readings > 0 and connected_devices > 0 else "WAITING"

    return FleetStatsResponse(
        total_machines=total_machines,
        total_devices=total_devices,
        connected_devices=connected_devices,
        total_sensor_readings=total_readings,
        total_maintenance_records=total_maint,
        active_alerts=active_alerts,
        data_collection_status=status_str
    )

# Include all API routers under /api prefix
app.include_router(machines_router, prefix="/api")
app.include_router(sensors_router, prefix="/api")
app.include_router(predictions_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")
app.include_router(maintenance_router, prefix="/api")

# Root welcome endpoint
@app.get("/", tags=["Root"])
def root():
    return {
        "app": "Predict IQ",
        "role": "PostgreSQL Real-Data Predictive Maintenance Backend",
        "status": "online",
        "database": "PostgreSQL",
        "documentation": "/docs",
        "endpoints": {
            "health": "/api/health",
            "fleet_stats": "/api/stats",
            "data_status": "/api/data-status",
            "machines": "/api/machines",
            "devices": "/api/devices",
            "sensor_ingest": "/api/sensor-data",
            "model_status": "/api/model-status",
            "predictions": "/api/predictions",
            "alerts": "/api/alerts",
            "maintenance": "/api/maintenance"
        }
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"Starting Predict IQ PostgreSQL Backend on http://{host}:{port} ...")
    uvicorn.run("backend.main:app", host=host, port=port, reload=True)
