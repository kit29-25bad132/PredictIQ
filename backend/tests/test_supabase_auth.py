"""
Supabase access-token verification tests (Phase 1).

No network, no live Supabase: a local EC P-256 key pair stands in for the
project's signing key and the JWKS fetch is monkeypatched.

Covered:
- a valid token yields a verified identity at GET /api/me
- missing / malformed / expired / not-yet-valid / wrong-issuer / wrong-audience
  / wrong-signature / "none" / HS256-confusion tokens are rejected with 401
- JWKS outage (cold and expired-cache) fails CLOSED with 503
- signing keys are cached, rotated keys are picked up on unknown kid, and an
  unknown kid is rejected after exactly one refresh
- unconfigured Supabase authentication returns 503
- device API-key auth and operator session auth are unchanged and independent
- Phase 1 does NOT change route access (reads stay public)
"""

import base64
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core import auth as auth_module
from backend.app.core import supabase_auth
from backend.app.core.config import get_settings
from backend.app.db.database import Base, get_db
from backend.app.main import app

PROJECT_URL = "https://urxzbcwhrbulbsnvapom.supabase.co"
ISSUER = PROJECT_URL + "/auth/v1"
AUDIENCE = "authenticated"
KID = "73ad422d-f973-4046-9f6c-da63dd06e506"
KID_ROTATED = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
SUB = "3f0f4b9d-2a3c-4d5e-8a11-0c1d2e3f4a5b"
EMAIL = "engineer@example.com"


# ============================================================================
# Token / key helpers
# ============================================================================

@pytest.fixture(scope="module")
def signing_key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(scope="module")
def other_key():
    return ec.generate_private_key(ec.SECP256R1())


def _jwk(private_key, kid=KID) -> dict:
    public = json.loads(ECAlgorithm.to_jwk(private_key.public_key()))
    public.update({"alg": "ES256", "use": "sig", "kid": kid, "key_ops": ["verify"], "ext": True})
    return public


def _claims(**overrides) -> dict:
    now = int(time.time())
    claims = {
        "sub": SUB,
        "aud": AUDIENCE,
        "iss": ISSUER,
        "iat": now - 10,
        "exp": now + 3600,
        "role": "authenticated",
        "email": EMAIL,
        "email_verified": True,
    }
    claims.update(overrides)
    return {key: value for key, value in claims.items() if value is not None}


def _token(private_key, kid=KID, algorithm="ES256", **overrides) -> str:
    return jwt.encode(_claims(**overrides), private_key, algorithm=algorithm, headers={"kid": kid})


def _b64url(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def jwks(monkeypatch, signing_key):
    """Patch settings + JWKS transport; expose a fetch counter and key store."""
    state = {"calls": 0, "keys": {KID: _jwk(signing_key)}, "fail": False}

    def fake_fetch(url):
        state["calls"] += 1
        if state["fail"]:
            raise supabase_auth.SupabaseAuthUnavailable("simulated JWKS outage")
        return dict(state["keys"])

    monkeypatch.setattr(supabase_auth, "_fetch_jwks", fake_fetch)
    monkeypatch.setattr(get_settings(), "supabase_url", PROJECT_URL)
    monkeypatch.setattr(get_settings(), "supabase_jwks_url", "")
    monkeypatch.setattr(get_settings(), "supabase_jwt_issuer", "")
    monkeypatch.setattr(get_settings(), "supabase_jwt_audience", AUDIENCE)
    monkeypatch.setattr(get_settings(), "supabase_jwks_cache_seconds", 3600)
    monkeypatch.setattr(get_settings(), "supabase_jwt_leeway_seconds", 30)
    supabase_auth.reset_jwks_cache()
    try:
        yield state
    finally:
        supabase_auth.reset_jwks_cache()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
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


# ============================================================================
# 1. Verified identity
# ============================================================================

class TestVerifiedIdentity:
    def test_me_returns_identity_from_verified_token(self, jwks, client, signing_key):
        response = client.get("/api/me", headers=_bearer(_token(signing_key)))
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["authenticated"] is True
        assert body["user_id"] == SUB
        assert body["email"] == EMAIL
        assert body["audience"] == AUDIENCE
        assert body["issuer"] == ISSUER
        assert body["expires_at"] and body["issued_at"]

    def test_me_never_echoes_the_access_token(self, jwks, client, signing_key):
        token = _token(signing_key)
        body = client.get("/api/me", headers=_bearer(token)).json()
        assert token not in json.dumps(body)
        assert "refresh" not in json.dumps(body).lower()

    def test_signing_keys_are_cached_across_requests(self, jwks, client, signing_key):
        for _ in range(3):
            assert client.get("/api/me", headers=_bearer(_token(signing_key))).status_code == 200
        assert jwks["calls"] == 1


# ============================================================================
# 2. Rejected credentials -> 401
# ============================================================================

class TestRejectedCredentials:
    def test_missing_authorization_is_401(self, jwks, client):
        response = client.get("/api/me")
        assert response.status_code == 401
        assert response.headers.get("www-authenticate") == "Bearer"

    def test_non_bearer_scheme_is_401(self, jwks, client, signing_key):
        response = client.get("/api/me", headers={"Authorization": _token(signing_key)})
        assert response.status_code == 401

    def test_malformed_token_is_401(self, jwks, client):
        assert client.get("/api/me", headers=_bearer("not-a-jwt")).status_code == 401
        assert client.get("/api/me", headers=_bearer("abc.def.ghi")).status_code == 401

    def test_expired_token_is_401(self, jwks, client, signing_key):
        now = int(time.time())
        token = _token(signing_key, iat=now - 7200, exp=now - 3600)
        assert client.get("/api/me", headers=_bearer(token)).status_code == 401

    def test_not_yet_valid_token_is_401(self, jwks, client, signing_key):
        token = _token(signing_key, nbf=int(time.time()) + 3600)
        assert client.get("/api/me", headers=_bearer(token)).status_code == 401

    def test_wrong_issuer_is_401(self, jwks, client, signing_key):
        token = _token(signing_key, iss="https://attacker.example.com/auth/v1")
        assert client.get("/api/me", headers=_bearer(token)).status_code == 401

    def test_wrong_audience_is_401(self, jwks, client, signing_key):
        token = _token(signing_key, aud="service_role")
        assert client.get("/api/me", headers=_bearer(token)).status_code == 401

    def test_bad_signature_is_401(self, jwks, client, other_key):
        # Same kid, signed by a key the project never published.
        token = _token(other_key)
        assert client.get("/api/me", headers=_bearer(token)).status_code == 401

    def test_missing_subject_is_401(self, jwks, client, signing_key):
        token = _token(signing_key, sub=None)
        assert client.get("/api/me", headers=_bearer(token)).status_code == 401

    def test_unsigned_none_algorithm_is_401(self, jwks, client):
        unsigned = (
            f"{_b64url({'alg': 'none', 'typ': 'JWT', 'kid': KID})}."
            f"{_b64url(_claims())}."
        )
        assert client.get("/api/me", headers=_bearer(unsigned)).status_code == 401

    def test_hs256_confusion_is_401(self, jwks, client):
        """A token using the public key as an HMAC secret must never verify."""
        token = jwt.encode(
            _claims(), "public-key-material", algorithm="HS256", headers={"kid": KID}
        )
        assert client.get("/api/me", headers=_bearer(token)).status_code == 401

    def test_unknown_kid_is_401_after_one_refresh(self, jwks, client, signing_key):
        assert client.get("/api/me", headers=_bearer(_token(signing_key))).status_code == 200
        assert jwks["calls"] == 1
        response = client.get("/api/me", headers=_bearer(_token(signing_key, kid="unknown-kid")))
        assert response.status_code == 401
        assert jwks["calls"] == 2


# ============================================================================
# 3. Key rotation
# ============================================================================

class TestKeyRotation:
    def test_rotated_key_is_picked_up_then_cached(self, jwks, client, signing_key):
        assert client.get("/api/me", headers=_bearer(_token(signing_key))).status_code == 200
        assert jwks["calls"] == 1

        jwks["keys"][KID_ROTATED] = _jwk(signing_key, KID_ROTATED)
        rotated = _token(signing_key, kid=KID_ROTATED)
        assert client.get("/api/me", headers=_bearer(rotated)).status_code == 200
        assert jwks["calls"] == 2

        # The refreshed key set is cached: no further fetches.
        assert client.get("/api/me", headers=_bearer(rotated)).status_code == 200
        assert jwks["calls"] == 2


# ============================================================================
# 4. Fail closed (503), never anonymous fallback
# ============================================================================

class TestFailClosed:
    def test_jwks_outage_returns_503(self, jwks, client, signing_key):
        jwks["fail"] = True
        response = client.get("/api/me", headers=_bearer(_token(signing_key)))
        assert response.status_code == 503
        assert response.status_code != 200

    def test_expired_cache_outage_returns_503(self, jwks, client, signing_key, monkeypatch):
        assert client.get("/api/me", headers=_bearer(_token(signing_key))).status_code == 200
        assert jwks["calls"] == 1

        monkeypatch.setattr(get_settings(), "supabase_jwks_cache_seconds", 0)
        jwks["fail"] = True
        response = client.get("/api/me", headers=_bearer(_token(signing_key)))
        assert response.status_code == 503
        assert jwks["calls"] == 2

    def test_unconfigured_authentication_returns_503(self, jwks, client, signing_key, monkeypatch):
        monkeypatch.setattr(get_settings(), "supabase_url", "")
        monkeypatch.setattr(get_settings(), "supabase_jwks_url", "")
        response = client.get("/api/me", headers=_bearer(_token(signing_key)))
        assert response.status_code == 503

    def test_public_routes_still_work_when_jwks_is_down(self, jwks, client):
        jwks["fail"] = True
        assert client.get("/api/health").status_code == 200


# ============================================================================
# 5. Existing authentication is untouched and independent
# ============================================================================

class TestExistingAuthUnaffected:
    def test_operator_session_still_works_and_is_not_user_identity(
        self, jwks, client, monkeypatch
    ):
        monkeypatch.setattr(get_settings(), "operator_password", "operator-test-password")
        monkeypatch.setattr(get_settings(), "operator_session_secret", "operator-test-secret")

        login = client.post("/api/auth/login", json={"password": "operator-test-password"})
        assert login.status_code == 200
        assert login.json()["success"] is True

        session = client.get("/api/auth/session")
        assert session.status_code == 200
        assert session.json()["authenticated"] is True

        # An operator cookie is NOT a Supabase user identity.
        assert client.get("/api/me").status_code == 401

    def test_device_api_key_unchanged_and_jwt_is_not_a_device_key(
        self, jwks, db_client, signing_key, monkeypatch
    ):
        client, _ = db_client
        monkeypatch.setattr(get_settings(), "device_api_key", "device-test-key")
        auth_module._WARNED_UNCONFIGURED = False
        try:
            ok = client.post(
                "/api/machines",
                json={"machine_id": "M-P1", "name": "P1", "type": "Pump", "location": "Bay"},
                headers={"X-API-Key": "device-test-key"},
            )
            assert ok.status_code == 201

            rejected = client.post(
                "/api/machines",
                json={"machine_id": "M-P2", "name": "P2", "type": "Pump", "location": "Bay"},
                headers=_bearer(_token(signing_key)),
            )
            assert rejected.status_code == 403
        finally:
            auth_module._WARNED_UNCONFIGURED = False

    def test_reads_remain_public_in_phase_1(self, jwks, db_client):
        """Route access is intentionally unchanged until Phase 3."""
        client, _ = db_client
        assert client.get("/api/machines").status_code == 200
        assert client.get("/api/alerts").status_code == 200
        assert client.get("/api/stats").status_code == 200
        assert client.get("/api/health").status_code == 200
