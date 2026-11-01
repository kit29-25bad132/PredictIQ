"""
Predict IQ - Authenticated User Identity Endpoints

Phase 1 scope: prove that a Supabase access token can be verified end-to-end
and exposed as identity. No existing route authorization is changed here, and
no organization context exists yet (Phase 3).

The response never includes the access token, refresh token, or any claim
beyond public identity fields.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.app.core.supabase_auth import AuthenticatedUser, require_supabase_user

router = APIRouter(tags=["User Identity"])


class CurrentUserResponse(BaseModel):
    authenticated: bool = Field(default=True, description="Always true: the token was verified")
    user_id: str = Field(..., description="Verified Supabase auth.users.id (JWT subject)")
    email: Optional[str] = None
    role: Optional[str] = Field(default=None, description="Supabase role claim, not an app role")
    audience: Optional[str] = None
    issuer: Optional[str] = None
    issued_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


@router.get(
    "/me",
    response_model=CurrentUserResponse,
    summary="Current authenticated user identity",
)
def read_current_user(
    user: AuthenticatedUser = Depends(require_supabase_user),
) -> CurrentUserResponse:
    """Return the identity derived from a verified Supabase access token.

    Authorization is decided backend-side only; the frontend is never trusted
    for identity. Organization membership and role checks arrive in Phase 3.
    """
    return CurrentUserResponse(
        user_id=user.user_id,
        email=user.email,
        role=user.role,
        audience=user.audience,
        issuer=user.issuer,
        issued_at=user.issued_at,
        expires_at=user.expires_at,
    )
