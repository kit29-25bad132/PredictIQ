"""Regression tests for ordinary Supabase-user mutation paths.

The browser must use the JWT/organization routes directly: no operator cookie is
accepted or required for an owner's workspace actions.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core.tenant import OrganizationContext, require_org_admin, require_org_member
from backend.app.db.database import Base, get_db
from backend.app.db.models import Alert, Machine, Organization, OrganizationMembership, Prediction, SensorReading
from backend.app.main import app


def _client_for(org_id: uuid.UUID):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    context = OrganizationContext(
        organization_id=org_id,
        user_id=str(uuid.uuid4()),
        role="owner",
        organization_slug="workspace",
        organization_name="Workspace",
    )
    app.dependency_overrides[require_org_member] = lambda: context
    app.dependency_overrides[require_org_admin] = lambda: context
    return TestClient(app), factory


def _seed_machine(factory, org_id: uuid.UUID, machine_id: str = "M-ONE"):
    db = factory()
    try:
        db.add(Organization(id=org_id, name="Workspace", slug=f"ws-{org_id.hex[:8]}", status="active"))
        db.add(Machine(organization_id=org_id, machine_id=machine_id, name="Pump", type="Pump", location="Bay"))
        db.commit()
    finally:
        db.close()


def test_workspace_owner_can_register_machine_without_operator_cookie():
    org_id = uuid.uuid4()
    client, _factory = _client_for(org_id)
    try:
        response = client.post(
            "/api/machines",
            json={"machine_id": "M-NEW", "name": "New pump", "type": "Pump", "location": "Bay 2"},
        )
        assert response.status_code == 201, response.text
        assert response.json()["machine_id"] == "M-NEW"
    finally:
        app.dependency_overrides.clear()


def test_manual_input_is_workspace_scoped_and_never_claims_hardware_provenance():
    org_id = uuid.uuid4()
    client, factory = _client_for(org_id)
    _seed_machine(factory, org_id)
    try:
        response = client.post(
            "/api/manual-sensor-data",
            json={"machine_id": "M-ONE", "temperature": 30, "vibration": 0.4, "current": 2, "rpm": 1450},
        )
        assert response.status_code == 201, response.text
        db = factory()
        try:
            reading = db.query(SensorReading).one()
            assert reading.organization_id == org_id
            assert reading.source == "MANUAL_INPUT"
            assert reading.device_id is None
            assert reading.demo_session_id is None
        finally:
            db.close()

        denied = client.post(
            "/api/manual-sensor-data",
            json={"machine_id": "OTHER-ORG", "temperature": 30, "vibration": 0.4, "current": 2, "rpm": 1450},
        )
        assert denied.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_manual_critical_input_reuses_health_alert_and_prediction_pipeline():
    org_id = uuid.uuid4()
    client, factory = _client_for(org_id)
    _seed_machine(factory, org_id)
    try:
        response = client.post(
            "/api/manual-sensor-data",
            json={"machine_id": "M-ONE", "temperature": 95, "vibration": 6, "current": 13, "rpm": 1100},
        )
        assert response.status_code == 201, response.text
        db = factory()
        try:
            machine = db.query(Machine).filter_by(machine_id="M-ONE").one()
            assert machine.status == "Critical"
            alerts = db.query(Alert).filter_by(organization_id=org_id, machine_id="M-ONE").all()
            assert alerts
            prediction = db.query(Prediction).filter_by(organization_id=org_id, machine_id="M-ONE").one()
            assert prediction.is_prototype is True
            assert prediction.model_version == "physics-rule-v1"
        finally:
            db.close()
    finally:
        app.dependency_overrides.clear()
