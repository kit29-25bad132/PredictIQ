"""Predict IQ - Public demo scope resolution.

The public demo is a *dataset*, not a second authorization system. It is one
dedicated organization whose machines are demo machines (``is_demo=True``) and
whose telemetry uses ``MANUAL_DEMO`` provenance. Every public demo query filters
on the values below, so an unauthenticated visitor can never select, reach, or
infer another tenant:

* the organization is resolved from a fixed UUID **and** verified slug, never
  from a request header, body, or query parameter;
* no public endpoint accepts an organization selector (requests that try are
  rejected explicitly);
* machines must belong to that organization and carry ``is_demo=True``.

If the dataset has not been provisioned, the public endpoints answer 503 rather
than falling back to any production data.
"""

from __future__ import annotations

import uuid
from typing import Mapping, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.app.db.models import Organization

# Fixed identity of the demo tenant. Deliberately distinct from the legacy org
# UUID used by migration 009; no production row can share it.
PUBLIC_DEMO_ORGANIZATION_ID = uuid.UUID("00000000-0000-4000-8000-0000000000de")
PUBLIC_DEMO_ORGANIZATION_SLUG = "public-demo"
PUBLIC_DEMO_ORGANIZATION_NAME = "PredictIQ Public Demo"

PUBLIC_DEMO_DATASET_LABEL = "Public Demo Fleet (simulated dataset)"
PUBLIC_DEMO_PROVENANCE = "MANUAL_DEMO"

PUBLIC_DEMO_NOTICE = (
    "This is a read-only demonstration dataset. Machines, readings, predictions, "
    "alerts, and maintenance records are simulated demo records stored in the "
    "PredictIQ PostgreSQL schema - they are not live machine telemetry and do "
    "not belong to any customer organization."
)

# Query parameters that would allow a caller to try to choose another tenant.
FORBIDDEN_SELECTOR_PARAMS = ("organization_id", "org_id", "organization")


def resolve_public_demo_organization(db: Session) -> Optional[Organization]:
    """Return the demo organization, or ``None`` when it is not provisioned.

    Resolution is by fixed UUID *and* slug so a collision or a hand-created
    organization can never be mistaken for the demo tenant.
    """
    org = db.get(Organization, PUBLIC_DEMO_ORGANIZATION_ID)
    if org is None or org.slug != PUBLIC_DEMO_ORGANIZATION_SLUG:
        return None
    return org


def reject_organization_selector(params: Mapping[str, str]) -> None:
    """Refuse any attempt to name an organization on a public endpoint."""
    for name in FORBIDDEN_SELECTOR_PARAMS:
        if name in params:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The public demo endpoints are bound to the demo dataset; "
                "organization selection is not supported.",
            )
