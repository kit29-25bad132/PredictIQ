"""
PredictIQ - Deployment Health & Readiness Endpoints

Provides two distinct endpoints:
- /api/health: Application is alive (always responds, no DB required)
- /api/ready: Application is ready for deployment traffic (checks DB connectivity)

These endpoints are designed for Docker healthchecks and deployment orchestration.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from typing import Any, Dict

from backend.app.db.database import get_db
from backend.app.core.config import get_settings

router = APIRouter(tags=["Deployment Health"])

# Reuse existing health endpoint from main.py for /api/health
# This file adds /api/ready for deployment readiness checks


@router.get(
    "/ready",
    summary="Check deployment readiness",
    description="Returns 200 if the application can serve traffic. "
                "Currently checks database connectivity. Does not fabricate readiness."
)
def check_readiness(db: Any = Depends(get_db)) -> Dict[str, Any]:
    """
    Verify the application is ready to accept traffic.

    Checks performed:
    1. Database connection is alive (actual query, not simulated)

    Returns:
        - 200 OK with readiness status if all checks pass
        - 503 Service Unavailable if any check fails
    """
    checks: Dict[str, Any] = {}

    # Check database connectivity with an actual lightweight query
    try:
        result = db.execute(text("SELECT 1"))
        result.fetchone()
        checks["database"] = {
            "status": "healthy",
            "message": "Database connection verified"
        }
    except SQLAlchemyError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "not_ready",
                "checks": {
                    "database": {
                        "status": "unhealthy",
                        "message": f"Database connection failed: {str(e)}"
                    }
                },
                "message": "Application is not ready: database connection failed"
            }
        )

    return {
        "status": "ready",
        "environment": get_settings().environment,
        "checks": checks,
        "message": "Application is ready to serve traffic"
    }


@router.get(
    "/health/detailed",
    summary="Detailed health check",
    description="Returns detailed health information including all subsystem statuses."
)
def check_detailed_health(db: Any = Depends(get_db)) -> Dict[str, Any]:
    """
    Extended health check with subsystem details.

    Checks:
    1. Application alive
    2. Database connectivity
    """
    checks: Dict[str, Any] = {
        "application": {
            "status": "healthy",
            "message": "Application process running"
        }
    }

    # Database check
    try:
        result = db.execute(text("SELECT 1"))
        result.fetchone()
        checks["database"] = {
            "status": "healthy",
            "message": "Database connection verified"
        }
    except SQLAlchemyError as e:
        checks["database"] = {
            "status": "unhealthy",
            "message": f"Database connection failed: {str(e)}"
        }

    all_healthy = all(
        check.get("status") == "healthy"
        for check in checks.values()
    )

    return {
        "status": "healthy" if all_healthy else "degraded",
        "environment": get_settings().environment,
        "checks": checks,
        "timestamp": None  # Will be populated by FastAPI
    }
