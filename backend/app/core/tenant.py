"""
Predict IQ - Organization context and role authorization.

Resolution rules (Phase 3)
--------------------------
* A verified Supabase JWT is always required (`require_supabase_user`).
* ``X-Organization-Id`` is only a *requested selector*; membership is looked up
  in the database on every request (no cached authorization, so revocation and
  suspension take effect immediately).
* No header + exactly one active membership -> that organization.
* No header + multiple active memberships -> 400 (client must choose).
* Header without an active membership -> 404 (non-disclosing).
* Suspended/archived organization -> 403.
* Suspended/removed/invited memberships never grant access.
* ``organization_id`` from request bodies/query params is never used.

Role policy
-----------
owner  : full control (machines, devices, members, records)
admin  : machines/devices + records (not owner transfer/deletion)
member : read + maintenance/feedback + alert acknowledge/resolve

Device and operator credentials never flow through this module: they stay in
``core/auth.py`` and remain independent.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional, Tuple

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from backend.app.core.auth import require_operator_session
from backend.app.core.supabase_auth import AuthenticatedUser, require_supabase_user
from backend.app.db.database import get_db
from backend.app.db.models import Organization, OrganizationMembership

ORGANIZATION_HEADER = "X-Organization-Id"

ROLE_OWNER = "owner"
ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"
ALL_ROLES: Tuple[str, ...] = (ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER)


@dataclass(frozen=True)
class OrganizationContext:
    """Immutable, server-derived tenant scope for a single request."""

    organization_id: uuid.UUID
    user_id: str
    role: str
    organization_slug: str
    organization_name: str


def _parse_uuid(value: str, *, detail: str, code: int) -> uuid.UUID:
    try:
        return uuid.UUID(str(value).strip())
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=code, detail=detail)


def _context(membership: OrganizationMembership, org: Organization, user_id: str) -> OrganizationContext:
    return OrganizationContext(
        organization_id=org.id,
        user_id=user_id,
        role=membership.role,
        organization_slug=org.slug,
        organization_name=org.name,
    )


def resolve_organization(
    db: Session, user: AuthenticatedUser, requested_organization: Optional[str]
) -> OrganizationContext:
    """Resolve the caller's organization, or raise 400/403/404."""
    user_uuid = _parse_uuid(
        user.user_id,
        detail="Authenticated subject is not a valid user identifier.",
        code=status.HTTP_401_UNAUTHORIZED,
    )

    active_memberships = (
        db.query(OrganizationMembership)
        .join(Organization, Organization.id == OrganizationMembership.organization_id)
        .filter(
            OrganizationMembership.user_id == user_uuid,
            OrganizationMembership.status == "active",
        )
        .all()
    )

    if requested_organization:
        org_uuid = _parse_uuid(
            requested_organization,
            detail="Invalid X-Organization-Id header.",
            code=status.HTTP_400_BAD_REQUEST,
        )
        membership = next(
            (m for m in active_memberships if m.organization_id == org_uuid), None
        )
        if membership is None:
            # Uniform denial: never disclose whether the organization exists.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found or access denied.",
            )
        org = db.get(Organization, org_uuid)
        if org is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found or access denied.",
            )
        if org.status != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organization is not active.",
            )
        return _context(membership, org, user.user_id)

    # Only active memberships of active organizations are selectable.
    usable = []
    for membership in active_memberships:
        org = db.get(Organization, membership.organization_id)
        if org is not None and org.status == "active":
            usable.append((membership, org))

    if not usable:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active organization membership for this user.",
        )
    if len(usable) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Multiple active organizations; send X-Organization-Id to choose one.",
        )
    membership, org = usable[0]
    return _context(membership, org, user.user_id)


def require_organization(
    request: Request,
    user: AuthenticatedUser = Depends(require_supabase_user),
    db: Session = Depends(get_db),
) -> OrganizationContext:
    """FastAPI dependency: verified Supabase user + verified active membership."""
    return resolve_organization(db, user, request.headers.get(ORGANIZATION_HEADER))


def require_organization_role(*allowed_roles: str):
    """Dependency factory enforcing one of ``allowed_roles``."""

    allowed = tuple(allowed_roles)

    def dependency(
        ctx: OrganizationContext = Depends(require_organization),
    ) -> OrganizationContext:
        if ctx.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient organization role for this operation.",
            )
        return ctx

    return dependency


# Read access is available to every active member.
require_org_member = require_organization_role(ROLE_OWNER, ROLE_ADMIN, ROLE_MEMBER)
# Machine/device administration.
require_org_admin = require_organization_role(ROLE_OWNER, ROLE_ADMIN)
# Organization management (used from Phase 5 onward).
require_org_owner = require_organization_role(ROLE_OWNER)


def require_operator_organization(
    request: Request,
    _operator: None = Depends(require_operator_session),
    db: Session = Depends(get_db),
) -> Organization:
    """Platform operator + explicit active organization selector.

    Operators are platform-level and are NOT organization members. They must
    name the organization explicitly for tenant-creating operations; the value
    is validated against the organizations table, never trusted blindly.
    """
    raw = request.headers.get(ORGANIZATION_HEADER)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Organization-Id is required for this operator operation.",
        )
    org_uuid = _parse_uuid(
        raw, detail="Invalid X-Organization-Id header.", code=status.HTTP_400_BAD_REQUEST
    )
    org = db.get(Organization, org_uuid)
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found.",
        )
    if org.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization is not active.",
        )
    return org
