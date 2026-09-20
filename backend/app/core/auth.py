"""
Predict IQ - Write-Gate Authentication (API key) and Operator Session Auth.

Two independent authentication paths coexist:

1. **Device auth** (``require_api_key``): every mutating or device-facing
   endpoint requires a caller-supplied API key that must match the
   server-configured ``DEVICE_API_KEY``.  This gates ESP32/Wokwi devices and
   the gateway proxy.

2. **Operator session** (``require_operator_session``): the browser SPA
   authenticates via a signed HttpOnly cookie set by ``POST /api/auth/login``.
   The cookie never contains secrets readable by JavaScript; it is an
   HMAC-signed ``session=<expiry>.<signature>`` value validated server-side.
   This allows browser-initiated operator writes without exposing
   ``DEVICE_API_KEY``.

Both paths are mutually exclusive — device endpoints use ``require_api_key``
only, operator endpoints use ``require_operator_session`` only.
"""

import hashlib
import hmac
import logging
import secrets
import time
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response, status

from backend.app.core.config import get_settings

logger = logging.getLogger(__name__)

API_KEY_HEADER = "X-API-Key"
SESSION_COOKIE_NAME = "predictiq_session"
SESSION_SIGNED_PREFIX = "session="

_WARNED_UNCONFIGURED = False


# ---------------------------------------------------------------------------
# Device API-key authentication (unchanged)
# ---------------------------------------------------------------------------

def _warn_unconfigured_once() -> None:
    """Log exactly one startup warning when the write gate is disabled."""
    global _WARNED_UNCONFIGURED
    if not _WARNED_UNCONFIGURED:
        logger.warning(
            "DEVICE_API_KEY is not configured: the API write gate is DISABLED "
            "(anonymous writes accepted). Set DEVICE_API_KEY in production."
        )
        _WARNED_UNCONFIGURED = True


def _extract_api_key(request: Request) -> Optional[str]:
    header_value = request.headers.get(API_KEY_HEADER)
    if header_value:
        return header_value.strip()
    # Devices and curl samples commonly use the standard Bearer scheme; accept
    # it as an alias so firmware needs only one mechanism.
    authorization = request.headers.get("Authorization")
    if authorization and authorization.startswith("Bearer "):
        candidate = authorization[len("Bearer "):].strip()
        return candidate or None
    return None


def require_api_key(request: Request) -> None:
    """FastAPI dependency enforcing the configured API key on write endpoints.

    - Server has no key configured -> gate open (development only; warns once).
    - Missing credential            -> 401 Unauthorized.
    - Wrong credential              -> 403 Forbidden.
    """
    settings = get_settings()
    expected = settings.device_api_key

    if not expected:
        _warn_unconfigured_once()
        return

    supplied = _extract_api_key(request)
    if supplied is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key. Send it in the 'X-API-Key' header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key for write access.",
            headers={"WWW-Authenticate": "ApiKey"},
        )


def api_key_dependency() -> Depends:  # pragma: no cover - typing helper
    """Return the dependency instance for router decorators."""
    return Depends(require_api_key)


# Shared dependency instance used by device-facing routers.
write_gate = Depends(require_api_key)


# ---------------------------------------------------------------------------
# Operator session authentication (browser cookie)
# ---------------------------------------------------------------------------

def _sign_session_value(value: str, secret: str) -> str:
    """HMAC-SHA256 sign a value. Returns hex digest."""
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def create_operator_session_token(ttl_seconds: int, secret: str) -> str:
    """Create a signed session token: ``<expiry>.<hmac>``."""
    expiry = int(time.time()) + ttl_seconds
    payload = str(expiry)
    sig = _sign_session_value(payload, secret)
    return f"{payload}.{sig}"


def verify_operator_session_token(token: str, secret: str) -> bool:
    """Verify a signed session token. Returns True if valid and not expired."""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return False
        payload, sig = parts
        expected_sig = _sign_session_value(payload, secret)
        if not hmac.compare_digest(sig, expected_sig):
            return False
        expiry = int(payload)
        return time.time() < expiry
    except (ValueError, TypeError):
        return False


def set_operator_session_cookie(response: Response, token: str, max_age: int, is_production: bool) -> None:
    """Set the session cookie on the response."""
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=f"{SESSION_SIGNED_PREFIX}{token}",
        max_age=max_age,
        httponly=True,
        secure=is_production,
        samesite="none" if is_production else "lax",
        path="/",
    )


def clear_operator_session_cookie(response: Response, is_production: bool) -> None:
    """Clear the session cookie."""
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=is_production,
        samesite="none" if is_production else "lax",
        path="/",
    )


def _extract_session_token(request: Request) -> Optional[str]:
    """Extract the session token value from the cookie header.

    Starlette's ``set_cookie`` wraps values containing ``=`` in double-quotes
    (RFC 6265 permits ``DQUOTE *cookie-octet DQUOTE``).  Browsers unquote
    automatically, but not all HTTP clients do.  We strip surrounding quotes
    defensively so the ``session=`` prefix match works in every case.
    """
    cookie_header = request.headers.get("cookie", "")
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(f"{SESSION_COOKIE_NAME}="):
            value = part[len(SESSION_COOKIE_NAME) + 1:]
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            if value.startswith(SESSION_SIGNED_PREFIX):
                return value[len(SESSION_SIGNED_PREFIX):]
    return None


def require_operator_session(request: Request) -> None:
    """FastAPI dependency enforcing a valid operator session cookie.

    - Missing or invalid cookie -> 401 Unauthorized.
    - Expired cookie            -> 401 Unauthorized.
    - Valid cookie              -> passes.
    """
    settings = get_settings()
    secret = settings.operator_session_secret

    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Operator session authentication is not configured.",
        )

    token = _extract_session_token(request)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Operator session required. Log in first.",
        )

    if not verify_operator_session_token(token, secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Operator session expired or invalid. Log in again.",
        )


# Shared dependency instance used by operator-facing routers.
operator_gate = Depends(require_operator_session)
