"""
Phase 3 — cross-organization isolation and role enforcement.

Two real organizations (Acme, Globex) with separate users, machines, devices,
telemetry, alerts, predictions, maintenance and feedback rows are seeded into an
in-memory database. Every assertion is made against the real API and the real
database layer: no authorization dependency is mocked.

Company A must never see or touch Company B's records, even when it knows
Company B's identifiers.
"""

from datetime import datetime, timedelta, timezone

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
    MaintenanceRecord,
    Prediction,
)
from backend.app.main import app
from backend.tests.tenant_utils import (
    OUTSIDER,
    USER_A,
    USER_B,
    auth_headers,
    install_auth,
    seed_device,
    seed_machine,
    seed_membership,
    seed_organization,
    seed_reading,
)

DEVICE_KEY = "isolation-device-key"
OPERATOR_PASSWORD = "isolation-operator-password"
OPERATOR_SECRET = "isolation-operator-secret"

NOW = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def env(monkeypatch):
    install_auth(monkeypatch)
    get_settings().device_api_key = DEVICE_KEY
    get_settings().operator_password = OPERATOR_PASSWORD
    get_settings().operator_session_secret = OPERATOR_SECRET
    auth_module._WARNED_UNCONFIGURED = False

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    with factory() as db:
        org_a = seed_organization(db, "acme", name="Acme")
        org_b = seed_organization(db, "globex", name="Globex")
        seed_membership(db, org_a, "owner", user_id=USER_A)
        seed_membership(db, org_b, "owner", user_id=USER_B)

        machine_a = seed_machine(db, org_a, "M-A", name="Acme pump")
        machine_b = seed_machine(db, org_b, "M-B", name="Globex pump")
        device_a = seed_device(db, org_a, machine_a, "D-A")
        device_b = seed_device(db, org_b, machine_b, "D-B")
        seed_reading(db, org_a, machine_a, device_a, timestamp=NOW, temperature=50, vibration=2, current=5, rpm=1450)
        seed_reading(db, org_b, machine_b, device_b, timestamp=NOW, temperature=60, vibration=3, current=6, rpm=1460)

        alert_a = Alert(
            organization_id=org_a.id, machine_id="M-A", alert_type="TEMPERATURE_HIGH",
            severity="Warning", message="Acme alert", status="ACTIVE",
        )
        alert_b = Alert(
            organization_id=org_b.id, machine_id="M-B", alert_type="TEMPERATURE_HIGH",
            severity="Warning", message="Globex alert", status="ACTIVE",
        )
        prediction_a = Prediction(
            organization_id=org_a.id, machine_id="M-A", timestamp=NOW,
            failure_probability=0.4, component="Bearing", is_prototype=True,
        )
        prediction_b = Prediction(
            organization_id=org_b.id, machine_id="M-B", timestamp=NOW,
            failure_probability=0.8, component="Bearing", is_prototype=True,
        )
        maintenance_a = MaintenanceRecord(
            organization_id=org_a.id, machine_id="M-A", component="Bearing", failure_type="Wear",
            issue_description="Acme noise", maintenance_action="Replace", technician="T-A",
            status="Completed",
        )
        maintenance_b = MaintenanceRecord(
            organization_id=org_b.id, machine_id="M-B", component="Bearing", failure_type="Wear",
            issue_description="Globex noise", maintenance_action="Replace", technician="T-B",
            status="Completed",
        )
        db.add_all([alert_a, alert_b, prediction_a, prediction_b, maintenance_a, maintenance_b])
        db.commit()
        ids = {
            "org_a": str(org_a.id),
            "org_b": str(org_b.id),
            "alert_a": alert_a.id,
            "alert_b": alert_b.id,
            "prediction_a": prediction_a.id,
            "prediction_b": prediction_b.id,
            "maintenance_a": maintenance_a.id,
            "maintenance_b": maintenance_b.id,
        }

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield {"client": TestClient(app), "factory": factory, **ids}
    finally:
        get_settings().device_api_key = ""
        get_settings().operator_password = ""
        get_settings().operator_session_secret = ""
        auth_module._WARNED_UNCONFIGURED = False
        app.dependency_overrides.pop(get_db, None)


def _feedback_body(machine_id, **overrides) -> dict:
    body = {
        "machine_id": machine_id,
        "observed_condition": "Inspected after alert",
        "severity": "Warning",
        "outcome": "Confirmed",
    }
    body.update(overrides)
    return body


# ============================================================================
# 1. Authentication is mandatory for private endpoints
# ============================================================================
class TestPrivateEndpointsRequireAuthentication:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/machines",
            "/api/machines/M-A",
            "/api/devices",
            "/api/devices/D-A",
            "/api/sensor-data",
            "/api/machines/M-A/latest",
            "/api/machines/M-A/history",
            "/api/alerts",
            "/api/maintenance",
            "/api/feedback",
            "/api/predictions",
            "/api/machines/M-A/prediction",
            "/api/stats",
            "/api/model-status",
        ],
    )
    def test_get_requires_authentication(self, env, path):
        assert env["client"].get(path).status_code == 401

    def test_writes_require_authentication(self, env):
        client = env["client"]
        assert client.post("/api/machines", json={"machine_id": "M-NEW", "name": "N", "type": "Pump", "location": "B"}).status_code == 401
        assert client.post("/api/devices", json={"device_id": "D-NEW", "machine_id": "M-A"}).status_code == 401
        assert client.post("/api/maintenance", json=_feedback_body("M-A")).status_code == 401
        assert client.post("/api/feedback", json=_feedback_body("M-A")).status_code == 401
        assert client.post("/api/assistant/chat", json={"machine_id": "M-A", "message": "hi"}).status_code == 401

    def test_genuinely_public_endpoints_stay_public(self, env):
        assert env["client"].get("/api/health").status_code == 200
        assert env["client"].get("/api/ready").status_code in (200, 503)


# ============================================================================
# 2. Organization resolution
# ============================================================================
class TestOrganizationResolution:
    def test_single_membership_is_selected_without_header(self, env):
        response = env["client"].get("/api/machines", headers=auth_headers(USER_A))
        assert response.status_code == 200
        assert [m["machine_id"] for m in response.json()] == ["M-A"]

    def test_multiple_memberships_require_an_explicit_selector(self, env):
        import uuid

        from backend.app.db.models import Organization

        with env["factory"]() as db:
            org = db.get(Organization, uuid.UUID(env["org_b"]))
            seed_membership(db, org, "member", user_id=USER_A)
        assert env["client"].get("/api/machines", headers=auth_headers(USER_A)).status_code == 400
        chosen = env["client"].get("/api/machines", headers=auth_headers(USER_A, env["org_b"]))
        assert chosen.status_code == 200
        assert [m["machine_id"] for m in chosen.json()] == ["M-B"]

    def test_invalid_organization_header_is_rejected(self, env):
        assert (
            env["client"].get("/api/machines", headers=auth_headers(USER_A, "not-a-uuid")).status_code
            == 400
        )

    def test_foreign_organization_header_is_denied_uniformly(self, env):
        response = env["client"].get("/api/machines", headers=auth_headers(USER_A, env["org_b"]))
        assert response.status_code == 404

    def test_user_without_any_membership_is_denied(self, env):
        assert env["client"].get("/api/machines", headers=auth_headers(OUTSIDER)).status_code == 403
        assert (
            env["client"].get("/api/machines", headers=auth_headers(OUTSIDER, env["org_a"])).status_code
            == 404
        )

    def test_suspended_organization_is_denied(self, env):
        import uuid

        from backend.app.db.models import Organization

        with env["factory"]() as db:
            org = db.get(Organization, uuid.UUID(env["org_a"]))
            org.status = "suspended"
            db.commit()
        assert (
            env["client"].get("/api/machines", headers=auth_headers(USER_A, env["org_a"])).status_code
            == 403
        )

    @pytest.mark.parametrize("status", ["suspended", "removed", "invited"])
    def test_inactive_membership_is_denied(self, env, status):
        from backend.app.db.models import OrganizationMembership

        with env["factory"]() as db:
            membership = (
                db.query(OrganizationMembership)
                .filter(OrganizationMembership.user_id == USER_A)
                .one()
            )
            membership.status = status
            db.commit()
        # With a selector the denial is uniform (404); without one it is 403.
        assert (
            env["client"].get("/api/machines", headers=auth_headers(USER_A, env["org_a"])).status_code
            == 404
        )
        assert env["client"].get("/api/machines", headers=auth_headers(USER_A)).status_code == 403

    def test_membership_revocation_takes_effect_immediately(self, env):
        """No cached authorization: revoke and the very next request is denied."""
        from backend.app.db.models import OrganizationMembership

        assert env["client"].get("/api/machines", headers=auth_headers(USER_A)).status_code == 200
        with env["factory"]() as db:
            membership = (
                db.query(OrganizationMembership)
                .filter(OrganizationMembership.user_id == USER_A)
                .one()
            )
            membership.status = "removed"
            db.commit()
        assert env["client"].get("/api/machines", headers=auth_headers(USER_A)).status_code == 403


# ============================================================================
# 3. Role boundaries
# ============================================================================
class TestRoleBoundaries:
    def _add_role(self, env, user_id, role):
        import uuid

        from backend.app.db.models import Organization

        with env["factory"]() as db:
            org = db.get(Organization, uuid.UUID(env["org_a"]))
            seed_membership(db, org, role, user_id=user_id)

    def test_member_cannot_register_machine_or_device(self, env):
        self._add_role(env, USER_B, "member")
        headers = auth_headers(USER_B, env["org_a"])
        machine = env["client"].post(
            "/api/machines",
            json={"machine_id": "M-A2", "name": "Second", "type": "Pump", "location": "Bay"},
            headers=headers,
        )
        assert machine.status_code == 403
        device = env["client"].post(
            "/api/devices", json={"device_id": "D-A2", "machine_id": "M-A"}, headers=headers
        )
        assert device.status_code == 403

    def test_member_can_create_maintenance_and_feedback_and_touch_alerts(self, env):
        self._add_role(env, USER_B, "member")
        headers = auth_headers(USER_B, env["org_a"])
        client = env["client"]
        maintenance = client.post(
            "/api/maintenance",
            json={
                "machine_id": "M-A",
                "component": "Bearing",
                "issue_description": "Member noticed noise",
                "maintenance_action": "Inspect",
                "technician": "Member",
            },
            headers=headers,
        )
        assert maintenance.status_code == 201, maintenance.text
        feedback = client.post("/api/feedback", json=_feedback_body("M-A"), headers=headers)
        assert feedback.status_code == 201, feedback.text
        ack = client.post(f"/api/alerts/{env['alert_a']}/acknowledge", headers=headers)
        assert ack.status_code == 200
        assert ack.json()["status"] == "ACKNOWLEDGED"

    def test_admin_can_register_machine_in_own_organization(self, env):
        self._add_role(env, USER_B, "admin")
        response = env["client"].post(
            "/api/machines",
            json={"machine_id": "M-A2", "name": "Second", "type": "Pump", "location": "Bay"},
            headers=auth_headers(USER_B, env["org_a"]),
        )
        assert response.status_code == 201, response.text

    def test_owner_can_register_machine_in_own_organization(self, env):
        response = env["client"].post(
            "/api/machines",
            json={"machine_id": "M-A2", "name": "Second", "type": "Pump", "location": "Bay"},
            headers=auth_headers(USER_A, env["org_a"]),
        )
        assert response.status_code == 201, response.text


# ============================================================================
# 4. Cross-organization isolation (the core requirement)
# ============================================================================
class TestCrossOrganizationIsolation:
    def test_lists_are_isolated(self, env):
        client = env["client"]
        headers_a = auth_headers(USER_A, env["org_a"])
        headers_b = auth_headers(USER_B, env["org_b"])

        machines_a = client.get("/api/machines", headers=headers_a).json()
        machines_b = client.get("/api/machines", headers=headers_b).json()
        assert [m["machine_id"] for m in machines_a] == ["M-A"]
        assert [m["machine_id"] for m in machines_b] == ["M-B"]

        devices_a = client.get("/api/devices", headers=headers_a).json()
        assert [d["device_id"] for d in devices_a] == ["D-A"]

        alerts_a = client.get("/api/alerts", headers=headers_a).json()
        assert [a["id"] for a in alerts_a] == [env["alert_a"]]

        maintenance_a = client.get("/api/maintenance", headers=headers_a).json()
        assert [m["id"] for m in maintenance_a] == [env["maintenance_a"]]

        feedback_b = client.get("/api/feedback", headers=headers_b).json()
        assert feedback_b == []

        predictions_a = client.get("/api/predictions", headers=headers_a).json()
        assert [p["id"] for p in predictions_a] == [env["prediction_a"]]

        readings_a = client.get("/api/sensor-data", headers=headers_a).json()
        assert {r["machine_id"] for r in readings_a} == {"M-A"}

    def test_detail_reads_of_foreign_resources_return_404(self, env):
        client = env["client"]
        headers_a = auth_headers(USER_A, env["org_a"])
        for path in (
            "/api/machines/M-B",
            "/api/devices/D-B",
            "/api/machines/M-B/latest",
            "/api/machines/M-B/history",
            f"/api/feedback/{env['prediction_b']}",  # foreign id in the id slot
            "/api/machines/M-B/prediction",
        ):
            assert client.get(path, headers=headers_a).status_code == 404, path

    def test_knowing_a_foreign_id_does_not_grant_access(self, env):
        """Company A is handed Company B's exact row ids; every one is denied."""
        client = env["client"]
        headers_a = auth_headers(USER_A, env["org_a"])
        for path in (
            f"/api/feedback/{env['prediction_b']}",
            f"/api/alerts/{env['alert_b']}/acknowledge",
            f"/api/alerts/{env['alert_b']}/resolve",
        ):
            method = client.post if "/acknowledge" in path or "/resolve" in path else client.get
            assert method(path, headers=headers_a).status_code == 404, path

    def test_cross_organization_writes_are_rejected(self, env):
        client = env["client"]
        headers_a = auth_headers(USER_A, env["org_a"])
        # Maintenance against a foreign machine.
        maintenance = client.post(
            "/api/maintenance",
            json={
                "machine_id": "M-B",
                "component": "Bearing",
                "issue_description": "Cross-tenant attempt",
                "maintenance_action": "None",
                "technician": "Intruder",
            },
            headers=headers_a,
        )
        assert maintenance.status_code == 404
        # Feedback against a foreign machine and foreign linked records.
        feedback = client.post("/api/feedback", json=_feedback_body("M-B"), headers=headers_a)
        assert feedback.status_code == 404
        feedback_link = client.post(
            "/api/feedback",
            json=_feedback_body("M-A", prediction_id=env["prediction_b"]),
            headers=headers_a,
        )
        assert feedback_link.status_code in (400, 404)
        # Registering a device onto a foreign machine.
        device = client.post(
            "/api/devices", json={"device_id": "D-X", "machine_id": "M-B"}, headers=headers_a
        )
        assert device.status_code == 404

    def test_organization_id_cannot_be_spoofed_through_the_body(self, env):
        client = env["client"]
        created = client.post(
            "/api/machines",
            json={
                "machine_id": "M-SPOOF",
                "name": "Spoof attempt",
                "type": "Pump",
                "location": "Bay",
                "organization_id": env["org_b"],
            },
            headers=auth_headers(USER_A, env["org_a"]),
        )
        assert created.status_code in (201, 422)
        if created.status_code == 201:
            # The row must belong to the caller's organization, not the spoofed one.
            machines_b = client.get("/api/machines", headers=auth_headers(USER_B, env["org_b"])).json()
            assert all(m["machine_id"] != "M-SPOOF" for m in machines_b)
        machines_a = client.get("/api/machines", headers=auth_headers(USER_A, env["org_a"])).json()
        assert any(m["machine_id"] == "M-SPOOF" for m in machines_a) or created.status_code == 422

    def test_assistant_chat_is_organization_scoped(self, env):
        client = env["client"]
        headers_a = auth_headers(USER_A, env["org_a"])
        foreign = client.post(
            "/api/assistant/chat",
            json={"machine_id": "M-B", "message": "What is the vibration?"},
            headers=headers_a,
        )
        assert foreign.status_code == 404

    def test_alert_lifecycle_stays_inside_the_organization(self, env):
        client = env["client"]
        headers_a = auth_headers(USER_A, env["org_a"])
        ack = client.post(f"/api/alerts/{env['alert_a']}/acknowledge", headers=headers_a)
        assert ack.status_code == 200
        resolve = client.post(f"/api/alerts/{env['alert_a']}/resolve", headers=headers_a)
        assert resolve.status_code == 200
        other = client.get("/api/alerts", headers=auth_headers(USER_B, env["org_b"])).json()
        assert [a["id"] for a in other] == [env["alert_b"]]
        assert other[0]["status"] == "ACTIVE"


# ============================================================================
# 5. Device authentication and tenant isolation
# ============================================================================
class TestDeviceIsolation:
    def _telemetry(self, device_id, machine_id):
        return {
            "device_id": device_id,
            "machine_id": machine_id,
            "timestamp": "2026-06-01T12:00:00Z",
            "temperature": 50,
            "vibration": 2,
            "current": 5,
            "rpm": 1450,
            "source": "WOKWI",
        }

    def test_unknown_device_is_rejected(self, env):
        response = env["client"].post(
            "/api/sensor-data",
            json=self._telemetry("D-UNKNOWN", "M-A"),
            headers={"X-API-Key": DEVICE_KEY},
        )
        assert response.status_code == 404

    def test_device_cannot_submit_for_another_organizations_machine(self, env):
        response = env["client"].post(
            "/api/sensor-data",
            json=self._telemetry("D-A", "M-B"),
            headers={"X-API-Key": DEVICE_KEY},
        )
        assert response.status_code in (400, 404)

    def test_user_jwt_is_never_a_device_credential(self, env):
        response = env["client"].post(
            "/api/sensor-data",
            json=self._telemetry("D-A", "M-A"),
            headers=auth_headers(USER_A, env["org_a"]),
        )
        assert response.status_code in (401, 403)

    def test_registered_device_ingest_lands_in_its_own_organization(self, env):
        from backend.app.db.models import SensorReading

        response = env["client"].post(
            "/api/sensor-data",
            json=self._telemetry("D-A", "M-A"),
            headers={"X-API-Key": DEVICE_KEY},
        )
        assert response.status_code == 201, response.text
        with env["factory"]() as db:
            latest = (
                db.query(SensorReading)
                .filter(SensorReading.device_id == "D-A")
                .order_by(SensorReading.timestamp.desc())
                .first()
            )
            assert latest is not None
            assert str(latest.organization_id) == env["org_a"]


# ============================================================================
# 6. Operator compatibility (platform, cross-organization, independent)
# ============================================================================
class TestOperatorCompatibility:
    def _login(self, env):
        response = env["client"].post("/api/auth/login", json={"password": OPERATOR_PASSWORD})
        assert response.status_code == 200, response.text

    def test_operator_requires_an_explicit_organization_for_machine_creation(self, env):
        self._login(env)
        response = env["client"].post(
            "/api/operator/machines",
            json={"machine_id": "M-OP", "name": "Operator machine", "type": "Pump", "location": "Bay"},
        )
        assert response.status_code == 400
        named = env["client"].post(
            "/api/operator/machines",
            json={"machine_id": "M-OP", "name": "Operator machine", "type": "Pump", "location": "Bay"},
            headers={"X-Organization-Id": env["org_b"]},
        )
        assert named.status_code == 201, named.text

    def test_operator_can_write_across_organizations(self, env):
        self._login(env)
        client = env["client"]
        assert (
            client.post(
                "/api/operator/maintenance",
                json={
                    "machine_id": "M-A",
                    "component": "Bearing",
                    "issue_description": "Operator note",
                    "maintenance_action": "Inspect",
                    "technician": "Operator",
                },
            ).status_code
            == 201
        )
        assert (
            client.post(
                "/api/operator/feedback", json=_feedback_body("M-B")
            ).status_code
            == 201
        )
        assert client.post(f"/api/operator/alerts/{env['alert_a']}/acknowledge").status_code == 200

    def test_operator_session_is_not_a_user_identity(self, env):
        self._login(env)
        # The operator cookie does not grant organization-user access.
        assert env["client"].get("/api/machines").status_code == 401
        assert env["client"].get("/api/me").status_code == 401

    def test_supabase_user_can_never_train_or_read_evaluation(self, env):
        # The operator gate is configured by the fixture but no session exists,
        # so a tenant user token must still be refused with 401 (not 503).
        headers = auth_headers(USER_A, env["org_a"])
        assert env["client"].post("/api/train-model", json={}, headers=headers).status_code == 401
        assert env["client"].get("/api/model-evaluation", headers=headers).status_code == 401

    def test_operator_can_train_and_read_evaluation(self, env):
        self._login(env)
        client = env["client"]
        evaluation = client.get("/api/model-evaluation")
        assert evaluation.status_code == 200
        training = client.post("/api/train-model", json={})
        assert training.status_code == 200
        assert training.json()["success"] is False  # refuses honestly on thin data


# ============================================================================
# 7. Tenant-owned rows are stamped in the database
# ============================================================================
class TestDatabaseOwnership:
    def test_created_rows_receive_the_verified_organization(self, env):
        from backend.app.db.models import MaintenanceRecord as MR

        client = env["client"]
        created = client.post(
            "/api/maintenance",
            json={
                "machine_id": "M-A",
                "component": "Seal",
                "issue_description": "Leak",
                "maintenance_action": "Replace",
                "technician": "T-A2",
            },
            headers=auth_headers(USER_A, env["org_a"]),
        )
        assert created.status_code == 201, created.text
        record_id = created.json()["id"]
        with env["factory"]() as db:
            record = db.get(MR, record_id)
            assert str(record.organization_id) == env["org_a"]
