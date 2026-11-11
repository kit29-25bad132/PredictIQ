"""
Phase 1 — controlled MANUAL_DEMO sessions.

Every test runs through the real API and the real SQLite schema (no mocked
authorization). Highlights:

* organization role rules (admin lifecycle, member read/ingest);
* demo machines hidden from the fleet and rejected by device paths;
* MANUAL_DEMO provenance (`device_id` NULL + `demo_session_id` set);
* alerts/predictions stamped with the session;
* scoped, confirmed reset that never touches real telemetry or other sessions;
* stats / data-status / ML evaluation exclusion.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import (
    Alert,
    Device,
    FeedbackRecord,
    Organization,
    Prediction,
    SensorReading,
)
from backend.app.main import app
from backend.app.services.model_evaluation import collect_ground_truth_rows
from backend.tests.tenant_utils import (
    OUTSIDER,
    USER_A,
    USER_B,
    auth_headers,
    install_auth,
    make_token,
    seed_device,
    seed_machine,
    seed_membership,
    seed_organization,
    seed_reading,
)

DEVICE_KEY = "manual-demo-device-key"


@pytest.fixture
def env(monkeypatch):
    install_auth(monkeypatch)
    get_settings().device_api_key = DEVICE_KEY
    auth_module._WARNED_UNCONFIGURED = False

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    db = factory()
    org_a = seed_organization(db, "demo-acme")
    seed_membership(db, org_a, "owner", user_id=USER_A)
    seed_membership(db, org_a, "member", user_id=USER_B)
    org_b = seed_organization(db, "demo-globex")
    seed_membership(db, org_b, "owner", user_id=OUTSIDER)
    ids = {"org_a": str(org_a.id), "org_b": str(org_b.id)}
    db.close()

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    client.headers.update(auth_headers(USER_A, ids["org_a"]))
    try:
        yield {"client": client, "factory": factory, "ids": ids}
    finally:
        app.dependency_overrides.pop(get_db, None)
        get_settings().device_api_key = ""


def _headers(user_id, org_id: str) -> dict:
    return auth_headers(user_id, org_id)


def _create_session(env, name="Bearing demo", label="Demo Rig") -> dict:
    res = env["client"].post(
        "/api/demo-sessions", json={"name": name, "machine_label": label}
    )
    assert res.status_code == 201, res.text
    return res.json()


def _reading_body(**overrides) -> dict:
    body = {"temperature": 40.0, "vibration": 1.0, "current": 2.0, "rpm": 1450.0}
    body.update(overrides)
    return body


# ============================================================================
# 1. Lifecycle, role gate, tenant scoping, machine visibility
# ============================================================================
def test_session_lifecycle_roles_and_machine_visibility(env):
    client = env["client"]
    member = _headers(USER_B, env["ids"]["org_a"])
    foreign = _headers(OUTSIDER, env["ids"]["org_b"])

    assert (
        client.post(
            "/api/demo-sessions", json={"name": "nope"}, headers=member
        ).status_code
        == 403
    )

    session = _create_session(env)
    assert session["status"] == "ACTIVE"
    assert session["machine"]["is_demo"] is True
    assert session["machine"]["machine_id"].startswith("DEMO-")
    assert len(session["machine"]["machine_id"]) == len("DEMO-") + 12
    assert session["counts"] == {"readings": 0, "alerts": 0, "predictions": 0}

    machine_id = session["machine"]["machine_id"]

    # Demo machine hidden from fleet by default, visible on explicit request.
    default_machines = client.get("/api/machines").json()
    assert machine_id not in [m["machine_id"] for m in default_machines]
    with_demo = client.get("/api/machines?include_demo=true").json()
    assert machine_id in [m["machine_id"] for m in with_demo]
    assert next(m for m in with_demo if m["machine_id"] == machine_id)["is_demo"] is True

    # Members can read; tenants outside the org cannot.
    assert client.get("/api/demo-sessions", headers=member).status_code == 200
    assert client.get(f"/api/demo-sessions/{session['id']}", headers=member).status_code == 200
    assert client.get(f"/api/demo-sessions/{session['id']}", headers=foreign).status_code == 404
    assert client.get("/api/demo-sessions", headers=foreign).json() == []

    # Close is idempotent and blocks ingestion until re-activated.
    closed = client.post(f"/api/demo-sessions/{session['id']}/close")
    assert closed.status_code == 200
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["closed_at"] is not None
    assert client.post(f"/api/demo-sessions/{session['id']}/close").status_code == 200

    blocked = client.post(
        f"/api/demo-sessions/{session['id']}/readings",
        json=_reading_body(),
        headers=member,
    )
    assert blocked.status_code == 409

    reopened = client.post(f"/api/demo-sessions/{session['id']}/activate")
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "ACTIVE"
    assert reopened.json()["closed_at"] is None


# ============================================================================
# 2. MANUAL_DEMO provenance + session-stamped alerts/predictions
# ============================================================================
def test_reading_ingest_stamps_session_and_generates_demo_alerts(env):
    client = env["client"]
    member = _headers(USER_B, env["ids"]["org_a"])
    session = _create_session(env)
    session_id = session["id"]

    # Only an explicit, complete payload is accepted; per-channel bounds and
    # device/source smuggling are rejected.
    assert (
        client.post(
            f"/api/demo-sessions/{session_id}/readings", json={}, headers=member
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/demo-sessions/{session_id}/readings",
            json=_reading_body(device_id="ESP32_REAL_001"),
            headers=member,
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/demo-sessions/{session_id}/readings",
            json=_reading_body(temperature=500.0),
            headers=member,
        ).status_code
        == 422
    )

    # Degraded reading produces real alerts + a prototype prediction.
    res = client.post(
        f"/api/demo-sessions/{session_id}/readings",
        json=_reading_body(temperature=95.0, vibration=6.0, current=13.0, rpm=1000.0),
        headers=member,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["success"] is True
    assert body["source"] == "MANUAL_DEMO"
    assert body["demo_session_id"] == session_id
    assert body["machine_id"] == session["machine"]["machine_id"]

    db = env["factory"]()
    try:
        reading = db.query(SensorReading).filter(SensorReading.id == body["id"]).one()
        assert reading.source == "MANUAL_DEMO"
        assert reading.device_id is None
        assert str(reading.demo_session_id) == session_id
        assert str(reading.organization_id) == env["ids"]["org_a"]

        alerts = db.query(Alert).filter(Alert.machine_id == body["machine_id"]).all()
        assert alerts
        assert all(a.demo_session_id is not None for a in alerts)

        predictions = (
            db.query(Prediction).filter(Prediction.machine_id == body["machine_id"]).all()
        )
        assert predictions
        assert all(p.demo_session_id is not None for p in predictions)
    finally:
        db.close()

    detail = client.get(f"/api/demo-sessions/{session_id}", headers=member).json()
    assert detail["counts"]["readings"] == 1
    assert detail["counts"]["alerts"] >= 1
    assert detail["counts"]["predictions"] >= 1


# ============================================================================
# 3. Demo machines reject every device path
# ============================================================================
def test_demo_machine_rejects_device_paths(env):
    client = env["client"]
    session = _create_session(env)
    machine_id = session["machine"]["machine_id"]
    org_id = env["ids"]["org_a"]

    assert (
        client.post(
            "/api/devices",
            json={"device_id": "D-DEMO", "machine_id": machine_id},
        ).status_code
        == 400
    )

    assert (
        client.post(
            "/api/sensor-data",
            json={
                "device_id": "ESP32_REAL_001",
                "machine_id": machine_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "temperature": 30.0,
                "source": "WOKWI",
            },
            headers={"X-API-Key": DEVICE_KEY},
        ).status_code
        == 400
    )

    # Defense in depth: a stray device row on the demo machine cannot heartbeat.
    db = env["factory"]()
    try:
        db.add(
            Device(
                organization_id=uuid.UUID(org_id),
                device_id="D-STRAY",
                machine_id=machine_id,
                device_type="ESP32",
                firmware_version="1.0.0",
                status="OFFLINE",
                source="WOKWI",
            )
        )
        db.commit()
    finally:
        db.close()

    heartbeat = client.post(
        "/api/devices/heartbeat",
        json={
            "device_id": "D-STRAY",
            "machine_id": machine_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "WOKWI",
        },
        headers={"X-API-Key": DEVICE_KEY},
    )
    assert heartbeat.status_code == 400

    feedback = client.post(
        "/api/feedback",
        json={
            "machine_id": machine_id,
            "observed_condition": "demo",
            "severity": "Warning",
            "outcome": "Confirmed",
        },
    )
    assert feedback.status_code == 400


# ============================================================================
# 4. Reset: confirmation, role, and strict session/tenant scoping
# ============================================================================
def test_reset_is_confirmed_and_scoped(env):
    client = env["client"]
    member = _headers(USER_B, env["ids"]["org_a"])
    foreign = _headers(OUTSIDER, env["ids"]["org_b"])
    org_id = env["ids"]["org_a"]

    db = env["factory"]()
    try:
        org = db.get(Organization, uuid.UUID(org_id))
        real = seed_machine(db, org, "REAL-1")
        real_device = seed_device(db, org, real, "D-REAL")
        seed_reading(db, org, real, real_device)
    finally:
        db.close()

    first = _create_session(env, name="Demo One")
    second = _create_session(env, name="Demo Two")
    for session in (first, second):
        res = client.post(
            f"/api/demo-sessions/{session['id']}/readings",
            json=_reading_body(temperature=40.0),
            headers=member,
        )
        assert res.status_code == 201, res.text

    # Wrong confirmation and non-admin are rejected without deleting.
    wrong = client.post(
        f"/api/demo-sessions/{first['id']}/reset",
        json={"confirm": True, "confirm_session_name": "not the name"},
    )
    assert wrong.status_code == 400
    assert client.post(
        f"/api/demo-sessions/{first['id']}/reset",
        json={"confirm": True, "confirm_session_name": first["name"]},
        headers=member,
    ).status_code == 403

    # Cross-organization reset is a non-disclosing 404.
    assert client.post(
        f"/api/demo-sessions/{first['id']}/reset",
        json={"confirm": True, "confirm_session_name": first["name"]},
        headers=foreign,
    ).status_code == 404

    reset = client.post(
        f"/api/demo-sessions/{first['id']}/reset",
        json={"confirm": True, "confirm_session_name": first["name"]},
    )
    assert reset.status_code == 200, reset.text
    deleted = reset.json()["deleted"]
    assert deleted["readings"] >= 1
    assert reset.json()["demo_session_id"] == first["id"]

    db = env["factory"]()
    try:
        remaining_demo = db.query(SensorReading).filter(
            SensorReading.source == "MANUAL_DEMO"
        ).all()
        # Only the second session's demo readings survive.
        assert {str(r.demo_session_id) for r in remaining_demo} == {second["id"]}
        # Real WOKWI telemetry is untouched.
        assert (
            db.query(SensorReading)
            .filter(
                SensorReading.source == "WOKWI",
                SensorReading.organization_id == uuid.UUID(org_id),
            )
            .count()
            == 1
        )
        assert (
            db.query(Alert)
            .filter(Alert.demo_session_id == uuid.UUID(first["id"]))
            .count()
            == 0
        )
    finally:
        db.close()

    # Session status is unchanged and the demo machine returns to Healthy.
    after = client.get(f"/api/demo-sessions/{first['id']}").json()
    assert after["status"] == "ACTIVE"
    assert after["machine"]["status"] == "Healthy"
    assert after["counts"]["readings"] == 0


# ============================================================================
# 5. Fleet stats / data status / ML evaluation exclude demo data
# ============================================================================
def test_stats_and_evaluation_exclude_demo(env):
    client = env["client"]
    org_id = env["ids"]["org_a"]

    db = env["factory"]()
    try:
        org = db.get(Organization, uuid.UUID(org_id))
        real = seed_machine(db, org, "REAL-STAT")
        device = seed_device(db, org, real, "D-STAT")
        seed_reading(db, org, real, device)
        db.add(
            FeedbackRecord(
                organization_id=org.id,
                machine_id="REAL-STAT",
                observed_condition="real",
                severity="Warning",
                outcome="Confirmed",
            )
        )
        db.commit()
    finally:
        db.close()

    session = _create_session(env)
    assert client.post(
        f"/api/demo-sessions/{session['id']}/readings",
        json=_reading_body(),
    ).status_code == 201

    stats = client.get("/api/stats").json()
    assert stats["total_machines"] == 1
    assert stats["total_sensor_readings"] == 1
    assert stats["active_alerts"] == 0

    status = client.get("/api/data-status").json()
    assert status["total_readings"] == 1

    db = env["factory"]()
    try:
        demo_machine_id = session["machine"]["machine_id"]
        db.add(
            FeedbackRecord(
                organization_id=uuid.UUID(org_id),
                machine_id=demo_machine_id,
                observed_condition="demo",
                severity="Warning",
                outcome="Confirmed",
            )
        )
        db.commit()
        rows = collect_ground_truth_rows(db)
        assert {row["machine_id"] for row in rows} == {"REAL-STAT"}
    finally:
        db.close()
