"""Phase 5 organization API security and transaction regression tests."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.db.models import Organization, OrganizationMembership
from backend.app.main import app
from backend.tests.tenant_utils import USER_A, USER_B, auth_headers, install_auth, seed_organization, seed_membership


@pytest.fixture
def org_api(monkeypatch):
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


def test_org_list_and_create_are_authenticated(org_api):
    client, _ = org_api
    assert client.get("/api/organizations").status_code == 401
    assert client.post("/api/organizations", json={"name": "Acme", "slug": "acme"}).status_code == 401


def test_create_derives_owner_and_ignores_spoofed_fields(org_api):
    client, factory = org_api
    response = client.post("/api/organizations", headers=auth_headers(USER_A), json={
        "name": "Acme Plant", "slug": "acme-plant", "user_id": str(USER_B), "role": "member",
    })
    assert response.status_code == 201
    with factory() as db:
        org = db.query(Organization).filter_by(slug="acme-plant").one()
        membership = db.query(OrganizationMembership).filter_by(organization_id=org.id).one()
        assert membership.user_id == USER_A
        assert membership.role == "owner"


def test_duplicate_slug_is_conflict_and_does_not_create_second_org(org_api):
    client, factory = org_api
    assert client.post("/api/organizations", headers=auth_headers(USER_A), json={"name": "One", "slug": "same"}).status_code == 201
    response = client.post("/api/organizations", headers=auth_headers(USER_B), json={"name": "Two", "slug": "same"})
    assert response.status_code == 409
    with factory() as db:
        assert db.query(Organization).filter_by(slug="same").count() == 1


def test_list_only_returns_callers_active_memberships(org_api):
    client, factory = org_api
    with factory() as db:
        org_a = seed_organization(db, "a")
        org_b = seed_organization(db, "b")
        seed_membership(db, org_a, user_id=USER_A)
        seed_membership(db, org_b, user_id=USER_B)
    response = client.get("/api/organizations", headers=auth_headers(USER_A))
    assert response.status_code == 200
    assert [item["slug"] for item in response.json()] == ["a"]
