"""
Predict IQ - Operator Authentication Endpoints

Provides session-based authentication for browser/operator writes:
- POST /api/auth/login  — authenticate with operator password, set HttpOnly session cookie
- POST /api/auth/logout — clear session cookie
- GET  /api/auth/session — check if current session is valid

No secrets are exposed to the browser. The session cookie contains only an
HMAC-signed expiry timestamp — never the password, never the secret key.
"""

import secrets as _secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from backend.app.core.auth import (
    SESSION_COOKIE_NAME,
    create_operator_session_token,
    set_operator_session_cookie,
    clear_operator_session_cookie,
    verify_operator_session_token,
    _extract_session_token,
)
from backend.app.core.config import get_settings

router = APIRouter(tags=["Operator Authentication"])


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    success: bool
    message: str


class SessionResponse(BaseModel):
    authenticated: bool
    message: str


@router.post("/auth/login", response_model=LoginResponse, summary="Authenticate operator and set session cookie")
def login(payload: LoginRequest, response: Response) -> LoginResponse:
    """
    Validates the operator password and sets a signed HttpOnly session cookie.

    The cookie is:
    - HttpOnly: inaccessible to JavaScript (XSS protection)
    - Secure: HTTPS-only in production (prevents MITM)
    - SameSite: None in production (cross-origin Vercel→Render), Lax in dev
    - Path: / (covers all API routes)
    - Max-Age: configured via OPERATOR_SESSION_TTL_SECONDS (default 24h)
    """
    settings = get_settings()

    if not settings.operator_password:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Operator authentication is not configured on this server.",
        )

    if not _secrets.compare_digest(payload.password, settings.operator_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid operator password.",
        )

    token = create_operator_session_token(
        settings.operator_session_ttl_seconds,
        settings.operator_session_secret,
    )

    is_production = settings.environment == "production"
    set_operator_session_cookie(response, token, settings.operator_session_ttl_seconds, is_production)

    return LoginResponse(success=True, message="Operator session established.")


@router.post("/auth/logout", response_model=LoginResponse, summary="Clear operator session cookie")
def logout(response: Response) -> LoginResponse:
    """Clears the operator session cookie."""
    settings = get_settings()
    is_production = settings.environment == "production"
    clear_operator_session_cookie(response, is_production)
    return LoginResponse(success=False, message="Operator session cleared.")


@router.get("/auth/session", response_model=SessionResponse, summary="Check operator session validity")
def check_session(request: Request) -> SessionResponse:
    """Returns whether the current session cookie is valid and not expired."""
    settings = get_settings()

    token = _extract_session_token(request)
    if token is None:
        return SessionResponse(authenticated=False, message="No active session.")

    if not verify_operator_session_token(token, settings.operator_session_secret):
        return SessionResponse(authenticated=False, message="Session expired or invalid.")

    return SessionResponse(authenticated=True, message="Operator session active.")
