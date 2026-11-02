"""Authenticated organization onboarding, selection, and personal workspace provisioning.

Organizations and memberships remain the tenant boundary. Normal onboarding never
shows them: ``POST /organizations/ensure`` derives the user from the verified
Supabase JWT and guarantees a workspace exists, creating a personal one (owner
membership) on first sign-in. It is idempotent and safe under concurrent calls.
"""

import re
import secrets
import threading
import uuid
from contextlib import contextmanager
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.core.supabase_auth import AuthenticatedUser, require_supabase_user
from backend.app.core.tenant import ORGANIZATION_HEADER
from backend.app.db.database import get_db
from backend.app.db.models import Organization, OrganizationMembership

router = APIRouter(prefix="/organizations", tags=["Organizations"])
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

PERSONAL_WORKSPACE_NAME = "My Workspace"

# Per-user serialization used when the database cannot provide an advisory lock
# (SQLite in tests/local demos). PostgreSQL always uses the advisory lock.
_PROCESS_LOCKS: dict[str, threading.Lock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=2, max_length=80)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = " ".join(value.split()).strip()
        if len(value) < 2:
            raise ValueError("Organization name must contain at least 2 characters.")
        return value

    @field_validator("slug")
    @classmethod
    def normalize_slug(cls, value: str) -> str:
        value = value.strip().lower()
        if not SLUG_RE.fullmatch(value):
            raise ValueError("Slug must use lowercase letters, numbers, and single hyphens.")
        return value


class OrganizationSummary(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    role: str
    status: str


def _summary(org: Organization, membership: OrganizationMembership) -> OrganizationSummary:
    return OrganizationSummary(id=org.id, name=org.name, slug=org.slug, role=membership.role, status=org.status)


# ============================================================================
# WORKSPACE PROVISIONING
# ============================================================================


def _process_lock(user_id: uuid.UUID) -> threading.Lock:
    key = str(user_id)
    with _PROCESS_LOCKS_GUARD:
        lock = _PROCESS_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _PROCESS_LOCKS[key] = lock
        return lock


@contextmanager
def _workspace_lock(db: Session, user_id: uuid.UUID):
    """Serialize provisioning per user across requests and (on PostgreSQL) processes.

    PostgreSQL: a transaction-scoped advisory lock keyed by the user UUID, released
    on commit/rollback. Other dialects: a process-wide lock (tests, SQLite demos).
    """
    bind = db.get_bind()
    dialect = getattr(getattr(bind, "dialect", None), "name", "")
    if dialect == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": user_id.int & 0x7FFFFFFFFFFFFFFF},
        )
        yield
        return

    lock = _process_lock(user_id)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()


def _active_memberships(
    db: Session, user_id: uuid.UUID
) -> List[Tuple[Organization, OrganizationMembership]]:
    """All active memberships of the user, joined with their organization.

    Organization status is not filtered here: callers distinguish "no workspace"
    from "workspace exists but is not active".
    """
    return (
        db.query(Organization, OrganizationMembership)
        .join(OrganizationMembership, OrganizationMembership.organization_id == Organization.id)
        .filter(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status == "active",
        )
        .all()
    )


def _has_any_membership(db: Session, user_id: uuid.UUID) -> bool:
    return (
        db.query(OrganizationMembership.id)
        .filter(OrganizationMembership.user_id == user_id)
        .first()
        is not None
    )


def _new_personal_workspace(
    db: Session, user_id: uuid.UUID
) -> Tuple[Organization, OrganizationMembership]:
    """Create the workspace and its owner membership in ONE transaction.

    The slug is random and non-personal (no email, name, or user identifier), so
    nothing about the account leaks through a publicly visible slug.
    """
    org = Organization(
        name=PERSONAL_WORKSPACE_NAME,
        slug=f"ws-{secrets.token_hex(6)}",
        status="active",
    )
    db.add(org)
    db.flush()

    membership = OrganizationMembership(
        organization_id=org.id,
        user_id=user_id,
        role="owner",
        status="active",
    )
    db.add(membership)
    db.commit()
    db.refresh(org)
    db.refresh(membership)
    return org, membership


def _multiple_workspaces_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Multiple workspaces are available for this account; send X-Organization-Id to choose one.",
    )


def ensure_personal_workspace(
    db: Session,
    user_id: uuid.UUID,
    requested_organization: Optional[str],
) -> OrganizationSummary:
    """Guarantee the user has a usable workspace; return it.

    Zero memberships -> create a personal workspace + owner membership.
    One membership  -> reuse it.
    Multiple        -> honor a valid ``X-Organization-Id`` selection, otherwise
                       fail safely (never pick an arbitrary tenant).
    """
    with _workspace_lock(db, user_id):
        rows = _active_memberships(db, user_id)
        usable = [(org, membership) for org, membership in rows if org.status == "active"]

        if requested_organization:
            try:
                requested_id = uuid.UUID(str(requested_organization).strip())
            except (ValueError, AttributeError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid X-Organization-Id header.",
                )
            selected = next(
                ((org, membership) for org, membership in rows if org.id == requested_id),
                None,
            )
            if selected is None:
                # Uniform denial: never disclose whether the workspace exists.
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Organization not found or access denied.",
                )
            org, membership = selected
            if org.status != "active":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Organization is not active.",
                )
            return _summary(org, membership)

        if len(usable) == 1:
            return _summary(*usable[0])
        if len(usable) > 1:
            raise _multiple_workspaces_error()

        # Memberships exist but none of their organizations is active. Do not
        # reassign the user or silently create a second tenant.
        if _has_any_membership(db, user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Organization is not active.",
            )

        try:
            org, membership = _new_personal_workspace(db, user_id)
        except IntegrityError:
            # A concurrent request won the race: roll back our insert and reuse
            # the workspace it created.
            db.rollback()
            rows = _active_memberships(db, user_id)
            usable = [(org, membership) for org, membership in rows if org.status == "active"]
            if len(usable) == 1:
                return _summary(*usable[0])
            if len(usable) > 1:
                raise _multiple_workspaces_error()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Workspace initialization could not be completed. Please retry.",
            )

        return _summary(org, membership)


# ============================================================================
# ENDPOINTS
# ============================================================================


@router.get("", response_model=list[OrganizationSummary])
def list_organizations(
    user: AuthenticatedUser = Depends(require_supabase_user),
    db: Session = Depends(get_db),
) -> list[OrganizationSummary]:
    user_id = uuid.UUID(user.user_id)
    rows = (
        db.query(Organization, OrganizationMembership)
        .join(OrganizationMembership, OrganizationMembership.organization_id == Organization.id)
        .filter(OrganizationMembership.user_id == user_id, OrganizationMembership.status == "active")
        .order_by(Organization.name.asc())
        .all()
    )
    return [_summary(org, membership) for org, membership in rows]


@router.post("/ensure", response_model=OrganizationSummary)
def ensure_workspace(
    request: Request,
    user: AuthenticatedUser = Depends(require_supabase_user),
    db: Session = Depends(get_db),
) -> OrganizationSummary:
    """Idempotently return the caller's workspace, creating a personal one if needed.

    Identity comes ONLY from the verified JWT. No body field is accepted, so a
    client can never name an owner, an organization, or another user's tenant.
    """
    try:
        user_id = uuid.UUID(user.user_id)
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated subject is invalid.",
        ) from exc
    return ensure_personal_workspace(db, user_id, request.headers.get(ORGANIZATION_HEADER))


@router.post("", response_model=OrganizationSummary, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate,
    user: AuthenticatedUser = Depends(require_supabase_user),
    db: Session = Depends(get_db),
) -> OrganizationSummary:
    """Create an organization and its owner membership atomically."""
    try:
        user_id = uuid.UUID(user.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Authenticated subject is invalid.") from exc

    org = Organization(name=payload.name, slug=payload.slug, status="active")
    try:
        db.add(org)
        db.flush()
        membership = OrganizationMembership(
            organization_id=org.id, user_id=user_id, role="owner", status="active"
        )
        db.add(membership)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Organization slug is already in use.") from exc
    db.refresh(org)
    return _summary(org, membership)
