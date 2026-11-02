"""Phase 5 finalization: personal workspace provisioning security and concurrency."""

import re
import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api import organizations
from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import Organization, OrganizationMembership
from backend.app.main import app
from backend.tests.tenant_utils import (
    USER_A,
    USER_B,
    auth_headers,
    install_auth,
    seed_membership,
    seed_organization,
)


@pytest.fixture
def workspace_api(monkeypatch):
    install_auth(monkeypatch)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app), factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        get_settings().device_api_key = ""
        get_settings().operator_password = ""
        get_settings().operator_session_secret = ""
        auth_module._WARNED_UNCONFIGURED = False
        engine.dispose()


def _ensure(client, user=USER_A, organization_id=None):
    return client.post(
        "/api/organizations/ensure",
        headers=auth_headers(user, organization_id=organization_id),
    )


def test_new_user_receives_personal_workspace(workspace_api):
    client, factory = workspace_api
    response = _ensure(client)
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "My Workspace"
    assert body["role"] == "owner"
    assert body["status"] == "active"
    assert body["slug"].startswith("ws-")
    assert re.fullmatch(r"ws-[0-9a-f]{12}", body["slug"]), "slug is random, non-personal and URL-safe"
    with factory() as db:
        assert db.query(Organization).count() == 1
        assert str(db.query(Organization).one().id) == body["id"]


def test_owner_membership_is_created(workspace_api):
    client, factory = workspace_api
    created = _ensure(client).json()
    with factory() as db:
        membership = db.query(OrganizationMembership).one()
        assert membership.user_id == USER_A
        assert membership.role == "owner"
        assert membership.status == "active"
        assert str(membership.organization_id) == created["id"]


def test_repeated_initialization_returns_same_workspace(workspace_api):
    client, factory = workspace_api
    first = _ensure(client)
    second = _ensure(client)
    third = _ensure(client)
    assert first.status_code == second.status_code == third.status_code == 200
    assert first.json()["id"] == second.json()["id"] == third.json()["id"]
    with factory() as db:
        assert db.query(Organization).count() == 1
        assert db.query(OrganizationMembership).count() == 1


def test_existing_membership_is_reused(workspace_api):
    client, factory = workspace_api
    with factory() as db:
        org = seed_organization(db, "existing")
        seed_membership(db, org, user_id=USER_A, role="admin")
        existing_id = str(org.id)
    response = _ensure(client)
    assert response.status_code == 200
    assert response.json()["id"] == existing_id
    assert response.json()["role"] == "admin"
    with factory() as db:
        assert db.query(Organization).count() == 1


def test_multiple_memberships_require_explicit_selection(workspace_api):
    client, factory = workspace_api
    with factory() as db:
        first = seed_organization(db, "first")
        second = seed_organization(db, "second")
        seed_membership(db, first, user_id=USER_A)
        seed_membership(db, second, user_id=USER_A)
        first_id, second_id = str(first.id), str(second.id)

    ambiguous = _ensure(client)
    assert ambiguous.status_code == 400
    assert "X-Organization-Id" in ambiguous.json()["detail"]

    chosen = _ensure(client, organization_id=second_id)
    assert chosen.status_code == 200
    assert chosen.json()["id"] == second_id

    # A header naming another user's workspace is denied without disclosure.
    foreign = _ensure(client, user=USER_B, organization_id=first_id)
    assert foreign.status_code == 404

    with factory() as db:
        assert db.query(Organization).count() == 2
        assert db.query(OrganizationMembership).count() == 2


def test_concurrent_initialization_creates_one_workspace(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'workspace.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    results, errors = [], []
    barrier = threading.Barrier(4)

    def worker():
        with factory() as db:
            try:
                barrier.wait(timeout=5)
                results.append(organizations.ensure_personal_workspace(db, USER_A, None).id)
            except Exception as exc:  # pragma: no cover - surfaced via assertions
                errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not errors, errors
    assert len(results) == 4
    assert len(set(results)) == 1, "concurrent requests must resolve to one workspace"
    with factory() as db:
        assert db.query(Organization).count() == 1
        assert db.query(OrganizationMembership).filter_by(user_id=USER_A).count() == 1
    engine.dispose()


def test_unauthenticated_initialization_is_rejected(workspace_api):
    client, _ = workspace_api
    assert client.post("/api/organizations/ensure").status_code == 401


def test_client_cannot_specify_owner_role_or_organization(workspace_api):
    client, factory = workspace_api
    response = client.post(
        "/api/organizations/ensure",
        headers=auth_headers(USER_A),
        json={
            "user_id": str(USER_B),
            "role": "member",
            "organization_id": str(uuid.uuid4()),
            "owner_id": str(USER_B),
        },
    )
    assert response.status_code == 200
    with factory() as db:
        membership = db.query(OrganizationMembership).one()
        assert membership.user_id == USER_A
        assert membership.role == "owner"
        assert str(membership.organization_id) == response.json()["id"]
        # No second workspace was created for the spoofed identity.
        assert db.query(OrganizationMembership).filter_by(user_id=USER_B).count() == 0


def test_cross_tenant_access_remains_rejected(workspace_api):
    client, factory = workspace_api
    with factory() as db:
        org_a = seed_organization(db, "tenant-a")
        seed_membership(db, org_a, user_id=USER_A)
        org_a_id = str(org_a.id)

    created = _ensure(client, user=USER_B)
    assert created.status_code == 200
    assert created.json()["id"] != org_a_id

    # USER_B holding USER_A's workspace id is denied by the membership check.
    denied = client.get("/api/alerts", headers=auth_headers(USER_B, organization_id=org_a_id))
    assert denied.status_code == 404

    allowed = client.get("/api/alerts", headers=auth_headers(USER_A))
    assert allowed.status_code == 200
    assert allowed.json() == []


def test_rollback_leaves_no_partial_workspace(workspace_api, monkeypatch):
    client, factory = workspace_api

    def failing_create(db, user_id):
        org = Organization(name="My Workspace", slug="ws-rollback", status="active")
        db.add(org)
        db.flush()
        db.add(
            OrganizationMembership(
                organization_id=org.id, user_id=user_id, role="owner", status="active"
            )
        )
        raise IntegrityError("INSERT", {}, Exception("simulated conflict"))

    monkeypatch.setattr(organizations, "_new_personal_workspace", failing_create)
    response = _ensure(client)
    assert response.status_code == 503
    with factory() as db:
        assert db.query(Organization).count() == 0
        assert db.query(OrganizationMembership).count() == 0


def test_conflict_recovery_returns_the_workspace_created_by_the_winner(workspace_api, monkeypatch):
    client, factory = workspace_api
    winner_id = uuid.uuid4()

    def racing_create(db, user_id):
        # Simulate a concurrent request committing between our membership check
        # and our insert, so our own insert loses on the unique constraint.
        with factory() as other:
            org = Organization(id=winner_id, name="My Workspace", slug="ws-winner", status="active")
            other.add(org)
            other.flush()
            other.add(
                OrganizationMembership(
                    organization_id=winner_id, user_id=user_id, role="owner", status="active"
                )
            )
            other.commit()
        raise IntegrityError("INSERT", {}, Exception("simulated unique violation"))

    monkeypatch.setattr(organizations, "_new_personal_workspace", racing_create)
    response = _ensure(client)
    assert response.status_code == 200
    assert response.json()["id"] == str(winner_id)
    with factory() as db:
        assert db.query(Organization).count() == 1
        assert db.query(OrganizationMembership).count() == 1


def test_listing_still_only_returns_the_callers_memberships(workspace_api):
    client, _ = workspace_api
    _ensure(client, user=USER_A)
    _ensure(client, user=USER_B)

    listing = client.get("/api/organizations", headers=auth_headers(USER_A))
    assert listing.status_code == 200
    assert len(listing.json()) == 1
    assert listing.json()[0]["role"] == "owner"
