"""
Predict IQ - Supabase Auth access-token verification.

Identity only. Supabase Auth issues short-lived, asymmetric JWTs; this module
verifies them against the project's PUBLIC JWKS. It never reads a service-role
key, an anon key, the database password or a JWT secret, and it contacts
nothing except the configured JWKS URL.

Verified signing configuration (read-only probe of
``https://<project>.supabase.co/auth/v1/.well-known/jwks.json``):
one EC P-256 key, ``kty=EC``, ``alg=ES256``, ``use=sig``.

Deliberate security properties
------------------------------
* Algorithm allow-list (ES256/RS256). The token header can never widen it;
  symmetric algorithms (HS256/384/512) and ``none`` are rejected outright,
  which also defeats the classic "use the RSA/EC public key as an HMAC secret"
  confusion attack.
* Signature, issuer, audience (default ``authenticated``), expiry, not-before,
  and subject are all validated. ``sub`` is the only user identity used.
* Signing keys are cached with a TTL and refreshed when an unknown key ID is
  seen, so Supabase key rotation is picked up without a redeploy.
* JWKS retrieval failure fails CLOSED with 503. There is no anonymous fallback.

Independence
------------
This module is intentionally separate from the device API-key gate
(``require_api_key``) and the operator session cookie
(``require_operator_session``). A Supabase access token is never accepted as a
device credential or as an operator session, and vice versa.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional

import httpx
import jwt
from fastapi import HTTPException, Request, status

from backend.app.core.config import get_settings

logger = logging.getLogger(__name__)

# Constant allow-list. Keep in sync with the project's advertised JWKS
# algorithms (ES256 today; RS256 allowed for a future RSA rotation).
ALLOWED_ALGORITHMS: tuple[str, ...] = ("ES256", "RS256")

JWKS_TIMEOUT_SECONDS = 5.0


class SupabaseAuthUnavailable(RuntimeError):
    """Verification infrastructure is unavailable -> API must fail closed (503)."""


class InvalidAccessToken(RuntimeError):
    """Token missing/malformed/expired/untrustworthy -> API must answer 401."""


@dataclass(frozen=True)
class AuthenticatedUser:
    """Identity derived exclusively from a verified Supabase access token."""

    user_id: str
    email: Optional[str] = None
    role: Optional[str] = None
    audience: Optional[str] = None
    issuer: Optional[str] = None
    expires_at: Optional[datetime] = None
    issued_at: Optional[datetime] = None
    claims: Mapping[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class _CachedJwks:
    fetched_at: float
    keys: Dict[str, Dict[str, Any]]


_JWKS_CACHE: Dict[str, _CachedJwks] = {}
_JWKS_LOCK = threading.Lock()


def reset_jwks_cache() -> None:
    """Drop cached signing keys (tests, and future key-rotation hooks)."""
    with _JWKS_LOCK:
        _JWKS_CACHE.clear()


def _fetch_jwks(url: str) -> Dict[str, Dict[str, Any]]:
    """Fetch and index public signing keys by ``kid``.

    Any failure raises ``SupabaseAuthUnavailable`` so callers fail closed.
    The response body contains only public keys and is never logged.
    """
    try:
        response = httpx.get(url, timeout=JWKS_TIMEOUT_SECONDS)
    except Exception as exc:  # network error, DNS, TLS, timeout
        raise SupabaseAuthUnavailable("Signing-key endpoint is unreachable.") from exc

    if response.status_code != 200:
        raise SupabaseAuthUnavailable(
            f"Signing-key endpoint returned HTTP {response.status_code}."
        )

    try:
        payload = response.json()
    except ValueError as exc:
        raise SupabaseAuthUnavailable("Signing-key response was not valid JSON.") from exc

    raw_keys = payload.get("keys") if isinstance(payload, dict) else None
    if not isinstance(raw_keys, list) or not raw_keys:
        raise SupabaseAuthUnavailable("Signing-key response contained no keys.")

    indexed: Dict[str, Dict[str, Any]] = {}
    for key in raw_keys:
        if isinstance(key, dict) and isinstance(key.get("kid"), str) and key["kid"]:
            indexed[key["kid"]] = key

    if not indexed:
        raise SupabaseAuthUnavailable("Signing-key response contained no usable key IDs.")
    return indexed


def _signing_key(jwks_url: str, kid: str, cache_seconds: int) -> Dict[str, Any]:
    """Return the JWK for ``kid``, caching and refreshing as needed.

    - Fresh cache hit -> no network call.
    - Unknown ``kid`` -> exactly one refresh (key rotation), then 401 if absent.
    - Expired cache -> refresh; a retrieval failure is 503 (no stale fallback).
    """
    ttl = max(0, int(cache_seconds))

    with _JWKS_LOCK:
        cached = _JWKS_CACHE.get(jwks_url)
    if cached is not None and (time.time() - cached.fetched_at) < ttl:
        hit = cached.keys.get(kid)
        if hit is not None:
            return hit

    with _JWKS_LOCK:
        cached = _JWKS_CACHE.get(jwks_url)
        fresh = cached is not None and (time.time() - cached.fetched_at) < ttl
        if not fresh or cached is None or kid not in cached.keys:
            keys = _fetch_jwks(jwks_url)  # raises SupabaseAuthUnavailable -> 503
            _JWKS_CACHE[jwks_url] = _CachedJwks(fetched_at=time.time(), keys=keys)
            cached = _JWKS_CACHE[jwks_url]
            logger.info("Refreshed Supabase signing keys (%d key(s)).", len(keys))
        key = cached.keys.get(kid)

    if key is None:
        raise InvalidAccessToken("Token signing key is not recognised.")
    return key


def _as_optional_str(value: Any) -> Optional[str]:
    if isinstance(value, str) and value:
        return value
    if isinstance(value, list) and value and all(isinstance(v, str) for v in value):
        return ",".join(value)
    return None


def _as_optional_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def verify_access_token(token: str) -> AuthenticatedUser:
    """Verify a Supabase access token, or raise.

    Raises ``InvalidAccessToken`` (401) for anything wrong with the credential
    and ``SupabaseAuthUnavailable`` (503) when keys cannot be obtained.
    """
    settings = get_settings()
    jwks_url = settings.supabase_jwks_url_effective
    issuer = settings.supabase_jwt_issuer_effective
    if not jwks_url or not issuer:
        raise SupabaseAuthUnavailable("Supabase authentication is not configured.")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise InvalidAccessToken("Access token is malformed.") from exc

    if not isinstance(header, dict):
        raise InvalidAccessToken("Access token header is malformed.")

    algorithm = header.get("alg")
    if algorithm not in ALLOWED_ALGORITHMS:
        raise InvalidAccessToken("Access token uses an unsupported algorithm.")

    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise InvalidAccessToken("Access token has no signing-key identifier.")

    jwk = _signing_key(jwks_url, kid, settings.supabase_jwks_cache_seconds)
    if jwk.get("use") not in (None, "sig"):
        raise InvalidAccessToken("Signing key is not a signature key.")

    try:
        public_key = jwt.PyJWK(jwk).key
    except jwt.PyJWTError as exc:
        raise SupabaseAuthUnavailable("Signing key could not be loaded.") from exc

    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=list(ALLOWED_ALGORITHMS),
            audience=settings.supabase_jwt_audience,
            issuer=issuer,
            leeway=settings.supabase_jwt_leeway_seconds,
            options={
                "require": ["exp", "sub", "aud", "iss"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_aud": True,
                "verify_iss": True,
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise InvalidAccessToken("Access token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise InvalidAccessToken("Access token failed verification.") from exc

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise InvalidAccessToken("Access token has no subject.")

    return AuthenticatedUser(
        user_id=subject,
        email=_as_optional_str(claims.get("email")),
        role=_as_optional_str(claims.get("role")),
        audience=_as_optional_str(claims.get("aud")),
        issuer=_as_optional_str(claims.get("iss")),
        expires_at=_as_optional_datetime(claims.get("exp")),
        issued_at=_as_optional_datetime(claims.get("iat")),
        claims=claims,
    )


def _extract_bearer_token(request: Request) -> Optional[str]:
    """Read ONLY ``Authorization: Bearer <token>``.

    ``X-API-Key`` is deliberately ignored: device credentials must never be
    interpreted as user identity, and user tokens must never be interpreted as
    device credentials.
    """
    header = request.headers.get("authorization")
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def require_supabase_user(request: Request) -> AuthenticatedUser:
    """FastAPI dependency: a verified Supabase user is required.

    - Not configured           -> 503 (fail closed, never public).
    - Missing/malformed token  -> 401 with ``WWW-Authenticate: Bearer``.
    - Expired/invalid/untrusted token -> 401.
    - JWKS outage              -> 503.
    """
    settings = get_settings()
    if not settings.supabase_jwks_url_effective or not settings.supabase_jwt_issuer_effective:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="User authentication is not configured on this server.",
        )

    token = _extract_bearer_token(request)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Send a Supabase access token as 'Authorization: Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        return verify_access_token(token)
    except SupabaseAuthUnavailable as exc:
        # Generic message: never surface key material or upstream detail.
        logger.error("Supabase token verification unavailable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication verification is temporarily unavailable.",
        ) from exc
    except InvalidAccessToken as exc:
        logger.debug("Rejected Supabase access token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# Shared dependency factory mirroring the existing auth module conventions.
supabase_user_gate = require_supabase_user
