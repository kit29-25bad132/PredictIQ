"""
Shared helpers for authenticated multi-tenant API tests (Phase 3).

Real ES256 tokens are signed locally and the JWKS transport is monkeypatched, so
authorization runs through the production code path (signature, issuer,
audience, expiry, subject) without any network or live Supabase dependency.
"""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from backend.app.core import supabase_auth
from backend.app.core.config import get_settings
from backend.app.db.models import (
    Device,
    Machine,
    Organization,
    OrganizationMembership,
    SensorReading,
)

PROJECT_URL = "https://urxzbcwhrbulbsnvapom.supabase.co"
ISSUER = PROJECT_URL + "/auth/v1"
AUDIENCE = "authenticated"
KID = "phase3-test-kid"

_KEY = ec.generate_private_key(ec.SECP256R1())

USER_A = uuid.UUID("aaaaaaaa-1111-4111-8111-111111111111")
USER_B = uuid.UUID("bbbbbbbb-2222-4222-8222-222222222222")
OUTSIDER = uuid.UUID("cccccccc-3333-4333-8333-333333333333")


def install_auth(monkeypatch) -> None:
    """Patch Supabase settings + JWKS transport; use with monkeypatch fixture."""
    jwk = json.loads(ECAlgorithm.to_jwk(_KEY.public_key()))
    jwk.update({"alg": "ES256", "use": "sig", "kid": KID, "key_ops": ["verify"], "ext": True})
    monkeypatch.setattr(supabase_auth, "_fetch_jwks", lambda url: {KID: jwk})

    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", PROJECT_URL)
    monkeypatch.setattr(settings, "supabase_jwks_url", "")
    monkeypatch.setattr(settings, "supabase_jwt_issuer", "")
    monkeypatch.setattr(settings, "supabase_jwt_audience", AUDIENCE)
    monkeypatch.setattr(settings, "supabase_jwks_cache_seconds", 3600)
    supabase_auth.reset_jwks_cache()


def make_token(user_id=USER_A, **overrides) -> str:
    now = int(time.time())
    claims = {
        "sub": str(user_id),
        "aud": AUDIENCE,
        "iss": ISSUER,
        "iat": now - 10,
        "exp": now + 3600,
        "role": "authenticated",
        "email": f"{str(user_id)[:8]}@example.com",
    }
    claims.update(overrides)
    return jwt.encode(claims, _KEY, algorithm="ES256", headers={"kid": KID})


def auth_headers(user_id=USER_A, organization_id=None) -> dict:
    headers = {"Authorization": f"Bearer {make_token(user_id)}"}
    if organization_id is not None:
        headers["X-Organization-Id"] = str(organization_id)
    return headers


def seed_organization(db, slug="acme", name=None, status="active", organization_id=None) -> Organization:
    org = Organization(
        id=organization_id or uuid.uuid4(),
        name=name or slug.title(),
        slug=slug,
        status=status,
    )
    db.add(org)
    db.commit()
    return org


def seed_membership(db, organization, role="owner", status="active", user_id=USER_A) -> OrganizationMembership:
    membership = OrganizationMembership(
        id=uuid.uuid4(),
        organization_id=organization.id,
        user_id=uuid.UUID(str(user_id)),
        role=role,
        status=status,
    )
    db.add(membership)
    db.commit()
    return membership


def seed_machine(db, organization, machine_id="M-1", **specs) -> Machine:
    machine = Machine(
        organization_id=organization.id,
        machine_id=machine_id,
        name=specs.pop("name", f"Machine {machine_id}"),
        type=specs.pop("type", "Pump"),
        location=specs.pop("location", "Bay 1"),
        **specs,
    )
    db.add(machine)
    db.commit()
    return machine


def seed_device(db, organization, machine, device_id="D-1", **kwargs) -> Device:
    device = Device(
        organization_id=organization.id,
        device_id=device_id,
        machine_id=machine.machine_id,
        device_type=kwargs.pop("device_type", "ESP32"),
        firmware_version=kwargs.pop("firmware_version", "1.0.0"),
        status=kwargs.pop("status", "ONLINE"),
        last_seen=kwargs.pop("last_seen", datetime.now(timezone.utc)),
        source=kwargs.pop("source", "WOKWI"),
        **kwargs,
    )
    db.add(device)
    db.commit()
    return device


def seed_reading(db, organization, machine, device, **kwargs) -> SensorReading:
    reading = SensorReading(
        organization_id=organization.id,
        machine_id=machine.machine_id,
        device_id=device.device_id,
        timestamp=kwargs.pop("timestamp", datetime.now(timezone.utc)),
        source=kwargs.pop("source", "WOKWI"),
        **kwargs,
    )
    db.add(reading)
    db.commit()
    return reading
