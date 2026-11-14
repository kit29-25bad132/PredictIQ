"""Provision the read-only public demo dataset.

Run this against the database that will serve ``/api/public/demo/*``:

    python -m backend.scripts.seed_public_demo            # create if missing
    python -m backend.scripts.seed_public_demo --reset --confirm
                                                          # rebuild the demo rows

Safety
------
* Writes ONLY the dedicated demo organization
  (``00000000-0000-4000-8000-0000000000de`` / slug ``public-demo``) and its
  ``is_demo=True`` machines/sessions/readings/alerts/predictions/maintenance.
* Never reads or deletes rows from another organization; the seeder refuses to
  run at all if a demo machine ID is already owned elsewhere.
* The reset flag is destructive for demo rows only and requires ``--confirm``.
* The script prints counts, never credentials or connection strings.

This is a data provisioning step, not a schema migration: no Alembic revision
is required because the demo dataset uses the existing tables introduced by
migrations 001-010.
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from backend.app.core.public_demo import (
    PUBLIC_DEMO_ORGANIZATION_ID,
    PUBLIC_DEMO_ORGANIZATION_SLUG,
)
from backend.app.db.database import SessionLocal
from backend.app.services.public_demo_dataset import (
    public_demo_counts,
    seed_public_demo_dataset,
)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Provision the PredictIQ public demo dataset (read-only demo org)."
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete and rebuild the demo organization's rows before seeding.",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required together with --reset to acknowledge deleting demo rows.",
    )
    args = parser.parse_args(argv)

    if args.reset and not args.confirm:
        print(
            "Refusing to reset: pass --reset --confirm to delete the demo dataset rows.",
            file=sys.stderr,
        )
        return 2

    if SessionLocal is None:
        print(
            "Database is not configured. Set DATABASE_URL (or complete DB_* settings) first.",
            file=sys.stderr,
        )
        return 1

    print(
        "Seeding public demo organization "
        f"{PUBLIC_DEMO_ORGANIZATION_ID} (slug '{PUBLIC_DEMO_ORGANIZATION_SLUG}')."
    )
    session = SessionLocal()
    try:
        before = public_demo_counts(session)
        counts = seed_public_demo_dataset(session, reset=args.reset)
    except Exception as exc:  # noqa: BLE001 - CLI must report, not traceback-leak
        session.rollback()
        print(f"Demo seeding failed: {exc}", file=sys.stderr)
        return 1
    finally:
        session.close()

    print(f"Demo rows before: {before}")
    print(f"Demo rows after:  {counts}")
    if counts["machines"] == 0:
        print("Nothing was seeded; inspect the demo organization state.", file=sys.stderr)
        return 1
    print(
        "Public demo dataset ready. It is read-only and served only by "
        "/api/public/demo/*; no authentication is required for those routes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
