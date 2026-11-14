"""Public read-only demo API - security, isolation and contract tests.

Every test runs through the real FastAPI app and the real SQLite schema. A
production-looking organization is seeded alongside the demo dataset to prove
the unauthenticated endpoints cannot see or touch it.

Coverage:
* no-authentication reads (overview, machines, readings, predictions, alerts,
  maintenance, data-status, model-status);
* demo-only data isolation and provenance (MANUAL_DEMO, no device);
* uniform 404 for unknown and non-demo machine ids;
* explicit rejection of organization selector parameters;
* pagination and invalid parameters;
* no write surface (405) and no leaked fields;
* authenticated endpoints still require authentication;
* rate limiting.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api import public_demo
from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.core.public_demo import PUBLIC_DEMO_ORGANIZATION_ID
from backend.app.core.rate_limit import SlidingWindowRateLimiter
from backend.app.db.database import Base, get_db
from backend.app.db.models import (
    Alert,
    MaintenanceRecord,
    Organization,
    Prediction,
    SensorReading,
)
from backend.app.main import app
from backend.app.services.public_demo_dataset import (
    MACHINE_BLUEPRINTS,
    public_demo_counts,
    seed_public_demo_dataset,
)
from backend.tests.tenant_utils import (
    OUTSIDER,
    install_auth,
    seed_device,
    seed_machine,
    seed_membership,
    seed_organization,
    seed_reading,
)

DEMO_MACHINE_IDS = [blueprint["machine_id"] for blueprint in MACHINE_BLUEPRINTS]
PRODUCTION_MACHINE_ID = "PROD-001"
PRODUCTION_DEVICE_ID = "PROD-DEV-01"


@pytest.fixture
def env(monkeypatch):
    install_auth(monkeypatch)
    get_settings().device_api_key = "public-demo-device-key"
    auth_module._WARNED_UNCONFIGURED = False

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    db = factory()
    seed_public_demo_dataset(db)

    # A production-looking tenant that must never be reachable from /public/demo.
    production = seed_organization(db, "production-customer", name="Production Customer")
    seed_membership(db, production, "owner", user_id=OUTSIDER)
    machine = seed_machine(
        db, production, PRODUCTION_MACHINE_ID, name="Production Pump (private)"
    )
    device = seed_device(db, production, machine, PRODUCTION_DEVICE_ID)
    seed_reading(
        db,
        production,
        machine,
        device,
        temperature=61.0,
        vibration=2.2,
        current=9.5,
        rpm=1460.0,
        source="REAL_HARDWARE",
    )
    now = datetime.now(timezone.utc)
    db.add(
        Alert(
            organization_id=production.id,
            machine_id=PRODUCTION_MACHINE_ID,
            alert_type="production_only",
            severity="Critical",
            message="PRODUCTION ONLY ALERT",
            status="ACTIVE",
            created_at=now,
        )
    )
    db.add(
        Prediction(
            organization_id=production.id,
            machine_id=PRODUCTION_MACHINE_ID,
            timestamp=now,
            failure_probability=0.99,
            component="PRODUCTION ONLY COMPONENT",
            is_prototype=True,
            created_at=now,
        )
    )
    db.add(
        MaintenanceRecord(
            organization_id=production.id,
            machine_id=PRODUCTION_MACHINE_ID,
            component="PRODUCTION ONLY COMPONENT",
            issue_description="PRODUCTION ONLY WORK ORDER",
            maintenance_action="PRODUCTION ONLY ACTION",
            technician="PRODUCTION ONLY TECHNICIAN",
            status="Completed",
            maintenance_date=now,
            created_at=now,
        )
    )
    db.commit()
    production_id = str(production.id)
    db.close()

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    public_demo.reset_rate_limiter()
    monkeypatch.setattr(
        public_demo, "_RATE_LIMITER", SlidingWindowRateLimiter(1000, 60)
    )
    client = TestClient(app)  # deliberately no auth headers

    try:
        yield {
            "client": client,
            "factory": factory,
            "production_id": production_id,
        }
    finally:
        app.dependency_overrides.pop(get_db, None)
        public_demo.reset_rate_limiter()
        get_settings().device_api_key = ""


def _demo_session(factory):
    return factory()


# ============================================================================
# 1. Unauthenticated access
# ============================================================================
def test_overview_is_public_and_labelled(env):
    client = env["client"]
    res = client.get("/api/public/demo/overview")
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["mode"] == "PUBLIC_DEMO"
    assert body["dataset"]["provenance"] == "MANUAL_DEMO"
    assert body["dataset"]["hardware_telemetry"] is False
    assert body["dataset"]["read_only"] is True
    assert "simulated" in body["dataset"]["notice"].lower()
    assert body["stats"]["total_machines"] == len(DEMO_MACHINE_IDS)
    # Demo machines can never own hardware devices.
    assert body["stats"]["total_devices"] == 0
    assert body["stats"]["connected_devices"] == 0
    assert body["stats"]["data_collection_status"] == "DEMO_DATASET"
    assert body["stats"]["total_sensor_readings"] == len(
        DEMO_MACHINE_IDS
    ) * 48
    assert body["stats"]["active_alerts"] >= 1
    assert body["stats"]["total_maintenance_records"] >= len(DEMO_MACHINE_IDS)
    # No tenant identifiers leave the server on this contract.
    assert "organization_id" not in body
    assert env["production_id"] not in res.text


def test_machine_listing_and_detail_are_public(env):
    client = env["client"]
    listing = client.get("/api/public/demo/machines")
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["total"] == len(DEMO_MACHINE_IDS)
    assert [item["machine_id"] for item in body["items"]] == DEMO_MACHINE_IDS
    assert all(item["is_demo"] is True for item in body["items"])
    assert all(item["devices"] == [] for item in body["items"])
    assert all(item["latest_reading"] is not None for item in body["items"])
    assert all(
        item["latest_reading"]["source"] == "MANUAL_DEMO" for item in body["items"]
    )

    detail = client.get(f"/api/public/demo/machines/{DEMO_MACHINE_IDS[0]}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["machine_id"] == DEMO_MACHINE_IDS[0]

    latest = client.get(f"/api/public/demo/machines/{DEMO_MACHINE_IDS[0]}/latest")
    assert latest.status_code == 200
    assert latest.json()["source"] == "MANUAL_DEMO"
    assert latest.json()["device_id"] is None


def test_predictions_alerts_maintenance_and_status_are_public(env):
    client = env["client"]

    predictions = client.get("/api/public/demo/predictions")
    assert predictions.status_code == 200
    assert predictions.json()["total"] >= len(DEMO_MACHINE_IDS)
    first = predictions.json()["items"][0]
    assert "failure_probability" in first
    assert first["prediction_available"] is True
    assert first["model_version"] == "physics-rule-v1"
    assert isinstance(first["contributing_factors"], list)

    per_machine = client.get(
        f"/api/public/demo/machines/{DEMO_MACHINE_IDS[2]}/prediction"
    )
    assert per_machine.status_code == 200
    assert per_machine.json()["machine_id"] == DEMO_MACHINE_IDS[2]

    alerts = client.get("/api/public/demo/alerts")
    assert alerts.status_code == 200
    assert alerts.json()["total"] >= len(DEMO_MACHINE_IDS)
    assert {item["machine_id"] for item in alerts.json()["items"]} <= set(
        DEMO_MACHINE_IDS
    )

    active = client.get("/api/public/demo/alerts?status_filter=ACTIVE")
    assert active.status_code == 200
    assert all(item["status"] == "ACTIVE" for item in active.json()["items"])

    maintenance = client.get("/api/public/demo/maintenance")
    assert maintenance.status_code == 200
    assert maintenance.json()["total"] >= len(DEMO_MACHINE_IDS)
    assert all(
        item["machine_id"] in DEMO_MACHINE_IDS
        for item in maintenance.json()["items"]
    )

    data_status = client.get("/api/public/demo/data-status")
    assert data_status.status_code == 200
    assert data_status.json()["sensor_status"] == "DEMO"
    assert data_status.json()["data_collection"] == "DEMO"
    assert data_status.json()["demo_mode"] is True

    model_status = client.get("/api/public/demo/model-status")
    assert model_status.status_code == 200
    assert model_status.json()["demo_mode"] is True
    # Cross-tenant governance metadata (dataset sizes, metrics) stays private.
    assert "dataset_size" not in model_status.json()
    assert "evaluation_dataset_size" not in model_status.json()
    assert "metrics" not in model_status.json()


def test_readings_are_demo_provenance_only(env):
    client = env["client"]
    res = client.get("/api/public/demo/readings?limit=200")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == len(DEMO_MACHINE_IDS) * 48
    assert len(body["items"]) == body["total"]
    assert all(item["source"] == "MANUAL_DEMO" for item in body["items"])
    assert all(item["device_id"] is None for item in body["items"])
    assert all(item["machine_id"] in DEMO_MACHINE_IDS for item in body["items"])
    # Chronological (oldest -> newest) like the authenticated history contract.
    timestamps = [item["timestamp"] for item in body["items"]]
    assert timestamps == sorted(timestamps)


# ============================================================================
# 2. Isolation: production data can never be reached
# ============================================================================
def test_production_data_never_appears(env):
    client = env["client"]
    endpoints = [
        "/api/public/demo/overview",
        "/api/public/demo/machines",
        "/api/public/demo/machines?limit=200",
        "/api/public/demo/readings?limit=200",
        "/api/public/demo/predictions",
        "/api/public/demo/alerts",
        "/api/public/demo/maintenance",
        "/api/public/demo/data-status",
    ]
    for endpoint in endpoints:
        res = client.get(endpoint)
        assert res.status_code == 200, endpoint
        text = res.text
        assert PRODUCTION_MACHINE_ID not in text, endpoint
        assert PRODUCTION_DEVICE_ID not in text, endpoint
        assert "PRODUCTION ONLY" not in text, endpoint
        assert env["production_id"] not in text, endpoint

    assert client.get(f"/api/public/demo/machines/{PRODUCTION_MACHINE_ID}").status_code == 404
    assert (
        client.get(
            f"/api/public/demo/machines/{PRODUCTION_MACHINE_ID}/prediction"
        ).status_code
        == 404
    )
    assert (
        client.get(f"/api/public/demo/readings?machine_id={PRODUCTION_MACHINE_ID}").status_code
        == 404
    )
    assert (
        client.get(f"/api/public/demo/predictions?machine_id={PRODUCTION_MACHINE_ID}").status_code
        == 404
    )
    assert (
        client.get(f"/api/public/demo/alerts?machine_id={PRODUCTION_MACHINE_ID}").status_code
        == 404
    )
    assert (
        client.get(
            f"/api/public/demo/maintenance?machine_id={PRODUCTION_MACHINE_ID}"
        ).status_code
        == 404
    )


@pytest.mark.parametrize("machine_id", ["UNKNOWN-999", "PROD-001", "demo-001"])
def test_unknown_or_non_demo_machine_ids_are_404(env, machine_id):
    client = env["client"]
    for suffix in ("", "/latest", "/prediction"):
        res = client.get(f"/api/public/demo/machines/{machine_id}{suffix}")
        assert res.status_code == 404, (suffix, res.text)
        assert "not found" in res.json()["detail"].lower()


def test_organization_selector_is_rejected(env):
    client = env["client"]
    for endpoint in (
        "/api/public/demo/overview",
        "/api/public/demo/machines",
        "/api/public/demo/readings",
        "/api/public/demo/predictions",
        "/api/public/demo/alerts",
        "/api/public/demo/maintenance",
    ):
        separator = "&" if "?" in endpoint else "?"
        res = client.get(
            f"{endpoint}{separator}organization_id={env['production_id']}"
        )
        assert res.status_code == 400, (endpoint, res.text)
        assert "organization selection is not supported" in res.json()["detail"].lower()
        assert env["production_id"] not in res.text

    # An organization header is not consulted either: the demo scope is fixed.
    res = client.get(
        "/api/public/demo/machines", headers={"X-Organization-Id": env["production_id"]}
    )
    assert res.status_code == 200
    assert [item["machine_id"] for item in res.json()["items"]] == DEMO_MACHINE_IDS


# ============================================================================
# 3. Pagination and parameter validation
# ============================================================================
def test_pagination_and_invalid_parameters(env):
    client = env["client"]

    page = client.get("/api/public/demo/machines?limit=2&offset=1")
    assert page.status_code == 200
    assert page.json()["total"] == len(DEMO_MACHINE_IDS)
    assert [item["machine_id"] for item in page.json()["items"]] == DEMO_MACHINE_IDS[1:3]
    assert page.json()["limit"] == 2 and page.json()["offset"] == 1

    readings = client.get("/api/public/demo/readings?limit=5&offset=10")
    assert readings.status_code == 200
    assert len(readings.json()["items"]) == 5
    assert readings.json()["total"] == len(DEMO_MACHINE_IDS) * 48

    for query in ("limit=0", "limit=201", "offset=-1", "status_filter=BOGUS"):
        endpoint = (
            "/api/public/demo/alerts"
            if query.startswith("status_filter")
            else "/api/public/demo/readings"
        )
        res = client.get(f"{endpoint}?{query}")
        assert res.status_code == 422, (query, res.text)


# ============================================================================
# 4. Read-only surface
# ============================================================================
def test_public_demo_has_no_write_endpoints(env):
    client = env["client"]
    for method, path in (
        ("post", "/api/public/demo/machines"),
        ("post", "/api/public/demo/readings"),
        ("post", "/api/public/demo/alerts/1/acknowledge"),
        ("post", "/api/public/demo/alerts/1/resolve"),
        ("post", "/api/public/demo/maintenance"),
        ("put", "/api/public/demo/machines/DM-001"),
        ("patch", "/api/public/demo/machines/DM-001"),
        ("delete", "/api/public/demo/machines/DM-001"),
    ):
        res = client.request(method.upper(), path, content=b"{}")
        assert res.status_code in (404, 405), (method, path, res.status_code)

    db = env["factory"]()
    try:
        counts_before = public_demo_counts(db)
    finally:
        db.close()

    for method, path in (("post", "/api/public/demo/machines"),):
        getattr(client, method)(path, json={"machine_id": "DM-999"})

    db = env["factory"]()
    try:
        assert public_demo_counts(db) == counts_before
    finally:
        db.close()


def test_authenticated_endpoints_still_require_authentication(env):
    client = env["client"]
    assert client.get("/api/machines").status_code == 401
    assert client.get("/api/alerts").status_code == 401
    assert client.get("/api/maintenance").status_code == 401
    assert client.get("/api/stats").status_code == 401
    # Supplying a device-style credential must not open user endpoints.
    assert (
        client.get("/api/machines", headers={"X-API-Key": "public-demo-device-key"}).status_code
        == 401
    )


# ============================================================================
# 5. Dataset provisioning discipline
# ============================================================================
def test_seeding_is_idempotent_and_reset_is_scoped(env):
    factory = env["factory"]
    db = factory()
    try:
        counts = public_demo_counts(db)
        assert counts["machines"] == len(DEMO_MACHINE_IDS)
        assert counts["sessions"] == len(DEMO_MACHINE_IDS)

        again = seed_public_demo_dataset(db)
        assert again == counts, "Re-running the seeder must not duplicate demo rows."

        production_before = (
            db.query(SensorReading)
            .filter(SensorReading.machine_id == PRODUCTION_MACHINE_ID)
            .count()
        )

        reset_counts = seed_public_demo_dataset(db, reset=True)
        assert reset_counts == counts

        production_after = (
            db.query(SensorReading)
            .filter(SensorReading.machine_id == PRODUCTION_MACHINE_ID)
            .count()
        )
        assert production_after == production_before == 1
        assert (
            db.query(Organization).filter(Organization.slug == "production-customer").count()
            == 1
        )

        demo_org_readings = (
            db.query(SensorReading)
            .filter(SensorReading.organization_id == PUBLIC_DEMO_ORGANIZATION_ID)
            .all()
        )
        assert demo_org_readings
        assert all(row.source == "MANUAL_DEMO" for row in demo_org_readings)
        assert all(row.device_id is None for row in demo_org_readings)
        assert all(row.demo_session_id is not None for row in demo_org_readings)
    finally:
        db.close()


def test_seeder_refuses_machine_id_owned_by_another_organization():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()
    try:
        production = seed_organization(db, "other-customer")
        # A production asset that collides with a demo blueprint ID must abort
        # the seed before anything is written into the reserved demo org.
        seed_machine(db, production, DEMO_MACHINE_IDS[0], name="Collision")
        with pytest.raises(RuntimeError):
            seed_public_demo_dataset(db)
        assert db.get(Organization, PUBLIC_DEMO_ORGANIZATION_ID) is None
    finally:
        db.close()


# ============================================================================
# 6. Rate limiting
# ============================================================================
def test_rate_limit_is_enforced(env, monkeypatch):
    monkeypatch.setattr(
        public_demo, "_RATE_LIMITER", SlidingWindowRateLimiter(2, 60)
    )
    client = env["client"]
    assert client.get("/api/public/demo/overview").status_code == 200
    second = client.get("/api/public/demo/overview")
    assert second.status_code == 200
    assert second.headers["X-RateLimit-Remaining"] == "0"

    third = client.get("/api/public/demo/overview")
    assert third.status_code == 429
    assert int(third.headers["Retry-After"]) >= 1
    assert "too many" in third.json()["detail"].lower()


def test_rate_limiter_unit_isolation():
    limiter = SlidingWindowRateLimiter(2, 10)
    assert limiter.check("a", now=0.0) == (True, 1, 0)
    assert limiter.check("a", now=1.0) == (True, 0, 0)
    allowed, remaining, retry_after = limiter.check("a", now=2.0)
    assert allowed is False and remaining == 0 and retry_after >= 1
    # Other clients are unaffected.
    assert limiter.check("b", now=2.0) == (True, 1, 0)
    # Window expiry releases the quota.
    assert limiter.check("a", now=12.0) == (True, 1, 0)
