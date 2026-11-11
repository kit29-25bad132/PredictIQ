"""Phase 1 — simulation configuration is organization-scoped.

A machine id from another tenant must resolve to a non-disclosing 404 for GET,
PUT and reset, and mutations require an owner/admin in the caller's own
organization. All tests use in-memory SQLite and real Supabase-style auth.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.database import Base, get_db
from backend.app.db.models import Machine
from backend.app.main import app
from backend.tests.tenant_utils import (
    OUTSIDER,
    USER_A,
    auth_headers,
    install_auth,
    seed_membership,
    seed_organization,
)

PAYLOAD = {
    "motor_powered": True,
    "simulation_mode": "cycling",
    "update_interval_ms": 1000,
}


@pytest.fixture
def env(monkeypatch):
    install_auth(monkeypatch)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    db = factory()
    org_a = seed_organization(db, "sim-scope-a")
    seed_membership(db, org_a, "owner", user_id=USER_A)
    org_b = seed_organization(db, "sim-scope-b")
    seed_membership(db, org_b, "owner", user_id=OUTSIDER)
    for org, machine_id in ((org_a, "M-A"), (org_b, "M-B")):
        db.add(
            Machine(
                organization_id=org.id,
                machine_id=machine_id,
                name=machine_id,
                type="Pump",
                location="Bay 1",
                status="Healthy",
                created_at=datetime.now(timezone.utc),
            )
        )
    db.commit()
    ids = {"org_a": str(org_a.id), "org_b": str(org_b.id)}
    db.close()

    def override_get_db():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield {"client": TestClient(app), "ids": ids}
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_simulation_config_cannot_cross_organizations(env):
    client = env["client"]
    headers_a = auth_headers(USER_A, env["ids"]["org_a"])
    headers_b = auth_headers(OUTSIDER, env["ids"]["org_b"])

    # Own machine is configurable by the owner.
    assert client.get("/api/machines/M-A/simulation-config", headers=headers_a).status_code == 200
    assert client.put(
        "/api/machines/M-A/simulation-config", json=PAYLOAD, headers=headers_a
    ).status_code == 200
    assert client.post(
        "/api/machines/M-A/simulation-config/reset", headers=headers_a
    ).status_code == 200

    # Foreign machine ids are indistinguishable from missing machines.
    assert client.get("/api/machines/M-B/simulation-config", headers=headers_a).status_code == 404
    assert client.put(
        "/api/machines/M-B/simulation-config", json=PAYLOAD, headers=headers_a
    ).status_code == 404
    assert client.post(
        "/api/machines/M-B/simulation-config/reset", headers=headers_a
    ).status_code == 404

    # The other tenant sees its own machine and not A's.
    assert client.get("/api/machines/M-B/simulation-config", headers=headers_b).status_code == 200
    assert client.get("/api/machines/M-A/simulation-config", headers=headers_b).status_code == 404

    # No Supabase identity -> 401 (operator cookies are not organization auth).
    assert client.get("/api/machines/M-A/simulation-config").status_code == 401
    assert client.put("/api/machines/M-A/simulation-config", json=PAYLOAD).status_code == 401
