"""Public read-only demo API - security, isolation and copied-data tests.

Every test runs through the real FastAPI app and the real SQLite schema. A
source organization with production-like machines, devices and historical
records is copied into the dedicated demo organization with the provisioning
service. A separate unselected asset proves only explicitly selected machines
are copied.

Coverage:
* no-authentication reads (overview, machines, readings, predictions, alerts,
  maintenance, data-status, model-status);
* demo-only copied data and provenance (MANUAL_DEMO, no device);
* uniform 404 for unknown and non-demo machine ids;
* explicit rejection of organization selector parameters;
* pagination and invalid parameters;
* no write surface (405) and no leaked fields/source identifiers;
* authenticated endpoints still require authentication;
* rate limiting;
* explicit source selection, idempotency and scoped refresh.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api import public_demo
from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.core.public_demo import (
    PUBLIC_DEMO_ORGANIZATION_ID,
    PUBLIC_DEMO_ORGANIZATION_NAME,
    PUBLIC_DEMO_ORGANIZATION_SLUG,
)
from backend.app.core.rate_limit import SlidingWindowRateLimiter
from backend.app.db.database import Base, get_db
from backend.app.db.models import (
    Alert,
    DemoSession,
    Machine,
    MaintenanceRecord,
    Organization,
    Prediction,
    SensorReading,
)
from backend.app.main import app
from backend.app.services.public_demo_dataset import (
    DEFAULT_PUBLIC_LOCATION,
    DEFAULT_TECHNICIAN_LABEL,
    copy_public_demo_from_source,
    public_demo_counts,
    public_machine_id_for,
    resolve_source_organization,
)
from backend.tests.tenant_utils import (
    OUTSIDER,
    install_auth,
    seed_device,
    seed_machine,
    seed_membership,
    seed_organization,
)

SOURCE_MACHINE_IDS = ["PROD-001", "PROD-002", "PROD-003", "PROD-004"]
UNSELECTED_MACHINE_ID = "PROD-UNSELECTED"
READINGS_PER_MACHINE = 48
DEMO_MACHINE_IDS = sorted(
    public_machine_id_for(machine_id) for machine_id in SOURCE_MACHINE_IDS
)
DEMO_READING_COUNT = len(SOURCE_MACHINE_IDS) * READINGS_PER_MACHINE
PRODUCTION_MACHINE_ID = "PROD-001"
PRODUCTION_DEVICE_ID = "PROD-001-DEV"


def _seed_source_records(
    db,
    organization,
    machine_ids,
    *,
    readings_per_machine: int = READINGS_PER_MACHINE,
):
    """Seed production-like source rows in one transaction."""
    now = datetime.now(timezone.utc)
    machines = []
    for index, machine_id in enumerate(machine_ids):
        machine = seed_machine(
            db,
            organization,
            machine_id,
            name=f"Production Pump {index + 1}",
            type="Pump",
            location=f"Secret Bay {index + 1}",
            status="Healthy",
            rated_rpm=1500.0,
            rated_current=12.0,
            max_temp=90.0,
            max_vibration=4.5,
        )
        device = seed_device(
            db,
            organization,
            machine,
            device_id=f"{machine_id}-DEV",
            source="REAL_HARDWARE",
        )
        for number in range(readings_per_machine):
            db.add(
                SensorReading(
                    organization_id=organization.id,
                    machine_id=machine.machine_id,
                    device_id=device.device_id,
                    timestamp=now
                    - timedelta(minutes=readings_per_machine - number),
                    temperature=60.0 + index + number / 100.0,
                    vibration=1.0 + number / 100.0,
                    current=10.0 + index,
                    rpm=1450.0,
                    source="REAL_HARDWARE",
                )
            )
        db.add(
            Alert(
                organization_id=organization.id,
                machine_id=machine.machine_id,
                alert_type=f"source_alert_{machine.machine_id}",
                severity="Critical",
                message=(
                    f"Source alert for {machine.machine_id} from "
                    f"{device.device_id} at {organization.name}"
                ),
                status="ACTIVE",
                created_at=now,
            )
        )
        db.add(
            Prediction(
                organization_id=organization.id,
                machine_id=machine.machine_id,
                timestamp=now,
                failure_probability=0.4 + index / 100.0,
                component="Bearing",
                remaining_life_days=30,
                confidence=0.8,
                explanation=f"Source model explanation for {machine.machine_id}",
                recommended_action="Inspect bearing",
                model_version="physics-rule-v1",
                is_prototype=True,
                input_hash=f"source-hash-{machine.machine_id}",
                created_at=now,
            )
        )
        db.add(
            MaintenanceRecord(
                organization_id=organization.id,
                machine_id=machine.machine_id,
                component="Bearing",
                failure_type="Wear",
                issue_description=(
                    f"Source-only issue for {machine.machine_id} from "
                    f"{device.device_id}"
                ),
                maintenance_action=f"Source-only action for {machine.machine_id}",
                technician="Alice Secret",
                status="Completed",
                maintenance_date=now,
                created_at=now,
            )
        )
        machines.append(machine)
    db.commit()
    return machines


def _copy_selected(db, source_organization_id, **overrides):
    return copy_public_demo_from_source(
        db,
        source_organization_id,
        machine_ids=SOURCE_MACHINE_IDS,
        readings_per_machine=0,
        **overrides,
    )


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
    production = seed_organization(db, "production-customer", name="Production Customer")
    seed_membership(db, production, "owner", user_id=OUTSIDER)
    _seed_source_records(db, production, SOURCE_MACHINE_IDS)
    _seed_source_records(db, production, [UNSELECTED_MACHINE_ID], readings_per_machine=1)
    _copy_selected(db, production.id)

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
            "source_organization_id": production.id,
        }
    finally:
        app.dependency_overrides.pop(get_db, None)
        public_demo.reset_rate_limiter()
        get_settings().device_api_key = ""


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
    assert "historical" in body["dataset"]["notice"].lower()
    assert "simulated" not in body["dataset"]["notice"].lower()
    assert body["stats"]["total_machines"] == len(DEMO_MACHINE_IDS)
    # Demo machines can never own hardware devices.
    assert body["stats"]["total_devices"] == 0
    assert body["stats"]["connected_devices"] == 0
    assert body["stats"]["data_collection_status"] == "DEMO_DATASET"
    assert body["stats"]["total_sensor_readings"] == DEMO_READING_COUNT
    assert body["stats"]["active_alerts"] >= 1
    assert body["stats"]["total_maintenance_records"] >= len(DEMO_MACHINE_IDS)
    # No tenant identifiers leave the server on this contract.
    assert "organization_id" not in body
    assert env["production_id"] not in res.text


def test_combined_snapshot_is_public_and_demo_scoped(env):
    client = env["client"]
    res = client.get("/api/public/demo")
    assert res.status_code == 200, res.text
    body = res.json()

    assert set(body) == {
        "machines",
        "sensor_readings",
        "alerts",
        "predictions",
        "maintenance_records",
    }
    assert [item["machine_id"] for item in body["machines"]] == DEMO_MACHINE_IDS
    assert all(item["is_demo"] is True for item in body["machines"])
    assert len(body["sensor_readings"]) == DEMO_READING_COUNT
    assert all(
        item["source"] == "MANUAL_DEMO" and item["device_id"] is None
        for item in body["sensor_readings"]
    )
    assert len(body["alerts"]) >= 1
    assert all(item["machine_id"] in DEMO_MACHINE_IDS for item in body["alerts"])
    assert env["production_id"] not in res.text
    assert PRODUCTION_MACHINE_ID not in res.text


def test_machine_listing_and_detail_are_public(env):
    client = env["client"]
    listing = client.get("/api/public/demo/machines")
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["total"] == len(DEMO_MACHINE_IDS)
    assert [item["machine_id"] for item in body["items"]] == DEMO_MACHINE_IDS
    assert all(item["is_demo"] is True for item in body["items"])
    assert all(item["devices"] == [] for item in body["items"])
    assert all(item["location"] == DEFAULT_PUBLIC_LOCATION for item in body["items"])
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
    assert all(
        item["technician"] == DEFAULT_TECHNICIAN_LABEL
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
    assert body["total"] == DEMO_READING_COUNT
    assert len(body["items"]) == body["total"]
    assert all(item["source"] == "MANUAL_DEMO" for item in body["items"])
    assert all(item["device_id"] is None for item in body["items"])
    assert all(item["machine_id"] in DEMO_MACHINE_IDS for item in body["items"])
    # Chronological (oldest -> newest) like the authenticated history contract.
    timestamps = [item["timestamp"] for item in body["items"]]
    assert timestamps == sorted(timestamps)


# ============================================================================
# 2. Isolation: source data can never be reached
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
        assert "Alice Secret" not in text, endpoint
        assert "Secret Bay" not in text, endpoint
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
    assert readings.json()["total"] == DEMO_READING_COUNT

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
def test_provisioning_is_idempotent_and_refresh_is_scoped(env):
    factory = env["factory"]
    db = factory()
    try:
        counts = public_demo_counts(db)
        assert counts["machines"] == len(DEMO_MACHINE_IDS)
        assert counts["sessions"] == len(DEMO_MACHINE_IDS)
        assert counts["readings"] == DEMO_READING_COUNT

        source_readings_before = [
            (row.id, row.machine_id, row.timestamp, row.temperature, row.device_id)
            for row in db.query(SensorReading)
            .filter(SensorReading.organization_id == env["source_organization_id"])
            .order_by(SensorReading.id)
            .all()
        ]
        source_technicians_before = [
            row.technician
            for row in db.query(MaintenanceRecord)
            .filter(
                MaintenanceRecord.organization_id == env["source_organization_id"]
            )
            .order_by(MaintenanceRecord.id)
            .all()
        ]

        again = _copy_selected(db, env["source_organization_id"])
        assert again == counts, "Re-running provisioning must not duplicate demo rows."

        refreshed = _copy_selected(db, env["source_organization_id"], refresh=True)
        assert refreshed == counts

        source_readings_after = [
            (row.id, row.machine_id, row.timestamp, row.temperature, row.device_id)
            for row in db.query(SensorReading)
            .filter(SensorReading.organization_id == env["source_organization_id"])
            .order_by(SensorReading.id)
            .all()
        ]
        assert source_readings_after == source_readings_before
        assert (
            [
                row.technician
                for row in db.query(MaintenanceRecord)
                .filter(
                    MaintenanceRecord.organization_id
                    == env["source_organization_id"]
                )
                .order_by(MaintenanceRecord.id)
                .all()
            ]
            == source_technicians_before
        )

        demo_machines = (
            db.query(Machine)
            .filter(Machine.organization_id == PUBLIC_DEMO_ORGANIZATION_ID)
            .all()
        )
        assert len(demo_machines) == len(DEMO_MACHINE_IDS)
        assert all(machine.is_demo is True for machine in demo_machines)
        assert all(machine.location == DEFAULT_PUBLIC_LOCATION for machine in demo_machines)
        assert all(machine.machine_id in DEMO_MACHINE_IDS for machine in demo_machines)
        assert all(
            source_id not in machine.machine_id
            for machine in demo_machines
            for source_id in SOURCE_MACHINE_IDS
        )
        assert public_machine_id_for(UNSELECTED_MACHINE_ID) not in {
            machine.machine_id for machine in demo_machines
        }

        sessions = (
            db.query(DemoSession)
            .filter(DemoSession.organization_id == PUBLIC_DEMO_ORGANIZATION_ID)
            .all()
        )
        assert len(sessions) == len(DEMO_MACHINE_IDS)
        assert all(session.status == "ACTIVE" for session in sessions)
        assert all(session.created_by is None for session in sessions)
        assert {session.machine_id for session in sessions} == set(DEMO_MACHINE_IDS)

        demo_readings = (
            db.query(SensorReading)
            .filter(SensorReading.organization_id == PUBLIC_DEMO_ORGANIZATION_ID)
            .all()
        )
        assert demo_readings
        assert all(row.source == "MANUAL_DEMO" for row in demo_readings)
        assert all(row.device_id is None for row in demo_readings)
        assert all(row.demo_session_id is not None for row in demo_readings)

        demo_maintenance = (
            db.query(MaintenanceRecord)
            .filter(
                MaintenanceRecord.organization_id == PUBLIC_DEMO_ORGANIZATION_ID
            )
            .all()
        )
        assert demo_maintenance
        assert all(
            record.technician == DEFAULT_TECHNICIAN_LABEL
            for record in demo_maintenance
        )
        assert all("Alice Secret" not in (record.issue_description or "") for record in demo_maintenance)
        assert all(
            source_id not in (record.issue_description or "")
            for record in demo_maintenance
            for source_id in SOURCE_MACHINE_IDS
        )

        # The demo org itself is the only extra tenant.
        assert (
            db.query(Organization)
            .filter(Organization.slug == PUBLIC_DEMO_ORGANIZATION_SLUG)
            .count()
            == 1
        )
        assert (
            db.query(Organization)
            .filter(Organization.slug == "production-customer")
            .count()
            == 1
        )
    finally:
        db.close()


def test_copy_requires_explicit_source_and_machines(env):
    db = env["factory"]()
    try:
        with pytest.raises(ValueError):
            resolve_source_organization(db)

        with pytest.raises(ValueError):
            resolve_source_organization(db, organization_id=PUBLIC_DEMO_ORGANIZATION_ID)

        with pytest.raises(ValueError):
            copy_public_demo_from_source(
                db, env["source_organization_id"], machine_ids=[]
            )

        with pytest.raises(ValueError):
            copy_public_demo_from_source(
                db, env["source_organization_id"], machine_ids=["UNKNOWN"]
            )
    finally:
        db.close()


def test_copy_refuses_public_machine_id_owned_by_another_organization():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()
    try:
        source = seed_organization(db, "source-customer")
        _seed_source_records(db, source, ["SRC-1"], readings_per_machine=1)

        other = seed_organization(db, "other-customer")
        seed_machine(
            db,
            other,
            public_machine_id_for("SRC-1"),
            name="Collision",
        )

        with pytest.raises(RuntimeError):
            copy_public_demo_from_source(
                db, source.id, machine_ids=["SRC-1"], readings_per_machine=1
            )
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
