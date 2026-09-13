"""
Predict IQ - Write-Gate Authentication (API key).

Honest, minimal authentication for the V1 prototype posture (docs/09, migration
plan §9.5): every mutating or device-facing endpoint requires a caller-supplied
API key that must match the server-configured ``DEVICE_API_KEY``.

Design decisions (kept deliberately small):

- **One shared key**, not per-user accounts. The deployment template documents
  ``DEVICE_API_KEY`` as the write-gate secret for both devices and operator
  tooling. This is a gate against anonymous writes, not a full identity system.
- **No key configured on the server => gate is OPEN** and a startup warning is
  logged. This keeps local dev and the existing test suite honest without
  pretending the API is protected: the compose deployment template always sets
  a key, and production operators must set one.
- Failures return ``401 Unauthorized`` (missing) or ``403 Forbidden`` (wrong
  credential) — never silent success.
- Comparison uses ``secrets.compare_digest`` to avoid timing oracles.

Remaining documented limitation (device spoofing): possession of the single
shared key lets any holder write as ANY ``device_id``. Per-device credentials
and server-side device registration/ownership checks are out of scope for V1
and remain a known limitation — see docs/09 and the deployment README.
"""

import logging
import secrets
from typing import Optional

from fastapi import Depends, HTTPException, Request, status

from backend.app.core.config import get_settings

logger = logging.getLogger(__name__)

API_KEY_HEADER = "X-API-Key"

_WARNED_UNCONFIGURED = False


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


# Shared dependency instance used by routers.
write_gate = Depends(require_api_key)
