"""Provision the read-only public demo from an explicitly selected source org.

The demo is not generated. It copies selected machines and their historical
telemetry/alerts/predictions/maintenance from a source organization into the
isolated ``public-demo`` organization. The source is never written to.

Discovery is read-only:

    python -m backend.scripts.seed_public_demo --inspect
    python -m backend.scripts.seed_public_demo --inspect \\
        --source-organization-id <uuid>

Provisioning is a two-step, explicit operation:

    python -m backend.scripts.seed_public_demo \\
        --source-organization-id <uuid> --machine-id <source-machine-id> ...

    python -m backend.scripts.seed_public_demo \\
        --source-organization-id <uuid> --all-machines --execute

The second command only runs when ``--execute`` is present. Without it the
script prints exactly what would be copied and writes nothing. A rebuild deletes
only demo-organization rows:

    python -m backend.scripts.seed_public_demo \\
        --source-organization-id <uuid> --all-machines \\
        --refresh --confirm --execute

Safety
------
* The source organization must be named explicitly. The script never guesses a
  tenant and refuses to use the demo organization as its own source.
* ``--machine-id`` is repeatable; ``--all-machines`` is an explicit alternative.
  Machines without copyable readings are skipped by ``--all-machines``.
* Writes ONLY the dedicated demo organization and its ``is_demo=True``
  machines/sessions/readings/alerts/predictions/maintenance.
* A refresh deletes demo rows only and requires ``--confirm``.
* The script prints counts and the source-to-public machine id mapping, never
  credentials or connection strings.
* This is data provisioning, not a schema migration. Migration 010 must have
  been applied by an operator before the demo tables/columns exist.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from typing import Any, Dict, List, Optional, Sequence

from backend.app.core.public_demo import (
    PUBLIC_DEMO_ORGANIZATION_ID,
    PUBLIC_DEMO_ORGANIZATION_SLUG,
)
from backend.app.db.database import SessionLocal
from backend.app.services.public_demo_dataset import (
    DEFAULT_READINGS_PER_MACHINE,
    DEFAULT_TECHNICIAN_LABEL,
    copy_public_demo_from_source,
    public_demo_counts,
    public_machine_id_for,
    resolve_source_organization,
    source_machine_summaries,
    source_organization_summaries,
)


def _print_inventory(rows: List[Dict[str, Any]]) -> None:
    print("Available organizations (read-only inventory):")
    if not rows:
        print("  (none)")
        return
    for row in rows:
        demo = " [public demo]" if row["is_public_demo"] else ""
        print(
            f"  {row['organization_id']}  slug={row['slug']!r}  "
            f"name={row['name']!r}  status={row['status']!r}{demo}"
        )
        print(
            f"    machines={row['machines']} "
            f"with_readings={row['machines_with_readings']} "
            f"readings={row['readings']} alerts={row['alerts']} "
            f"predictions={row['predictions']} maintenance={row['maintenance']} "
            f"latest_reading={row['latest_reading']}"
        )


def _print_machines(rows: List[Dict[str, Any]]) -> None:
    print("Source machines (read-only inventory):")
    if not rows:
        print("  (none)")
        return
    for row in rows:
        print(
            f"  {row['machine_id']!r}  name={row['name']!r} "
            f"type={row['type']!r} status={row['status']!r}"
        )
        print(
            f"    readings={row['readings']} latest_reading={row['latest_reading']} "
            f"alerts={row['alerts']} predictions={row['predictions']} "
            f"maintenance={row['maintenance']}"
        )
        print(f"    public_id={public_machine_id_for(row['machine_id'])}")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Copy real production records into the isolated PredictIQ public demo."
        )
    )
    parser.add_argument(
        "--inspect",
        action="store_true",
        help="Read-only organization/machine inventory; writes nothing.",
    )
    parser.add_argument("--source-organization-id", type=uuid.UUID)
    parser.add_argument("--source-organization-slug")
    parser.add_argument(
        "--machine-id",
        action="append",
        default=[],
        help="Source machine id to copy (repeatable).",
    )
    parser.add_argument(
        "--all-machines",
        action="store_true",
        help="Explicitly select every source machine that has historical readings.",
    )
    parser.add_argument(
        "--readings-per-machine",
        type=int,
        default=DEFAULT_READINGS_PER_MACHINE,
        help=(
            "Number of most recent readings per machine to copy; 0 copies all "
            f"(default {DEFAULT_READINGS_PER_MACHINE})."
        ),
    )
    parser.add_argument("--no-alerts", action="store_true")
    parser.add_argument("--no-predictions", action="store_true")
    parser.add_argument("--no-maintenance", action="store_true")
    parser.add_argument(
        "--preserve-location",
        action="store_true",
        help="Copy source location strings instead of the redacted demo label.",
    )
    parser.add_argument(
        "--technician-label",
        default=DEFAULT_TECHNICIAN_LABEL,
        help="Non-personal technician label written to copied maintenance rows.",
    )
    parser.add_argument(
        "--refresh",
        "--reset",
        dest="refresh",
        action="store_true",
        help="Delete demo-organization rows and rebuild from the selected source.",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required together with --refresh to acknowledge the demo-only delete.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually write rows. Without this flag the command is a dry run.",
    )
    args = parser.parse_args(argv)

    if args.refresh and not args.confirm:
        print(
            "Refusing to refresh: pass --refresh --confirm to delete demo dataset rows.",
            file=sys.stderr,
        )
        return 2
    if args.inspect and args.execute:
        print("Refusing to combine --inspect and --execute.", file=sys.stderr)
        return 2
    if args.all_machines and args.machine_id:
        print(
            "Use either --machine-id or --all-machines, not both.", file=sys.stderr
        )
        return 2
    if args.readings_per_machine < 0:
        print("--readings-per-machine must be >= 0.", file=sys.stderr)
        return 2
    if not args.technician_label.strip():
        print("--technician-label must not be empty.", file=sys.stderr)
        return 2
    if SessionLocal is None:
        print(
            "Database is not configured. Set DATABASE_URL (or complete DB_* settings) first.",
            file=sys.stderr,
        )
        return 1

    session = SessionLocal()
    try:
        has_source_selector = bool(args.source_organization_id) or bool(
            args.source_organization_slug
        )
        if bool(args.source_organization_id) == bool(args.source_organization_slug):
            if not (args.inspect and not has_source_selector):
                raise ValueError(
                    "Provide exactly one of --source-organization-id or "
                    "--source-organization-slug."
                )

        if args.inspect and not has_source_selector:
            _print_inventory(source_organization_summaries(session))
            return 0

        source_org = resolve_source_organization(
            session,
            organization_id=args.source_organization_id,
            slug=args.source_organization_slug,
        )
        summaries = source_machine_summaries(session, source_org.id)

        if args.inspect:
            print(
                f"Source organization: {source_org.id} slug={source_org.slug!r} "
                f"name={source_org.name!r}"
            )
            _print_machines(summaries)
            return 0

        usable = [row for row in summaries if int(row["readings"]) > 0]
        skipped = [row for row in summaries if int(row["readings"]) == 0]
        if args.all_machines:
            selected = usable
        else:
            if not args.machine_id:
                raise ValueError(
                    "Select at least one --machine-id or pass --all-machines "
                    "(use --inspect to see candidates)."
                )
            requested = set(args.machine_id)
            selected = [row for row in summaries if row["machine_id"] in requested]
            missing = sorted(requested - {row["machine_id"] for row in selected})
            if missing:
                raise ValueError(
                    "Selected machines were not found in the source organization: "
                    + ", ".join(missing)
                )
        if not selected:
            raise ValueError("No source machines with historical readings were selected.")

        selected_ids = [row["machine_id"] for row in selected]
        if skipped:
            print(
                "Skipping machines without copyable readings: "
                + ", ".join(row["machine_id"] for row in skipped),
                file=sys.stderr,
            )

        print(
            f"Source organization: {source_org.id} slug={source_org.slug!r} "
            f"name={source_org.name!r}"
        )
        print(
            f"Target demo organization: {PUBLIC_DEMO_ORGANIZATION_ID} "
            f"(slug '{PUBLIC_DEMO_ORGANIZATION_SLUG}')"
        )
        print("Source -> public machine ids:")
        for row in selected:
            print(
                f"  {row['machine_id']!r} -> "
                f"{public_machine_id_for(row['machine_id'])}"
            )
        planned_readings = sum(
            min(int(row["readings"]), args.readings_per_machine)
            if args.readings_per_machine
            else int(row["readings"])
            for row in selected
        )
        print(
            "Planned copy: "
            f"machines={len(selected_ids)} readings={planned_readings} "
            f"alerts={'yes' if not args.no_alerts else 'no'} "
            f"predictions={'yes' if not args.no_predictions else 'no'} "
            f"maintenance={'yes' if not args.no_maintenance else 'no'} "
            f"location={'source' if args.preserve_location else 'redacted'} "
            f"refresh={args.refresh}"
        )

        if not args.execute:
            print("Dry run only: no rows were written. Re-run with --execute to copy.")
            return 0

        before = public_demo_counts(session)
        after = copy_public_demo_from_source(
            session,
            source_org.id,
            machine_ids=selected_ids,
            readings_per_machine=args.readings_per_machine,
            include_alerts=not args.no_alerts,
            include_predictions=not args.no_predictions,
            include_maintenance=not args.no_maintenance,
            redact_location=not args.preserve_location,
            technician_label=args.technician_label,
            refresh=args.refresh,
            commit=True,
        )
    except Exception as exc:  # noqa: BLE001 - CLI must report, not traceback-leak
        session.rollback()
        detail = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
        print(f"Public demo provisioning failed: {detail}", file=sys.stderr)
        if "does not exist" in detail:
            print(
                "The target schema appears older than this code. Apply pending "
                "Alembic revisions explicitly with deploy/migrate.sh first.",
                file=sys.stderr,
            )
        return 1
    finally:
        session.close()

    print(f"Demo rows before: {before}")
    print(f"Demo rows after:  {after}")
    if after["machines"] == 0:
        print("Nothing was copied; inspect the demo organization state.", file=sys.stderr)
        return 1
    print(
        "Public demo dataset ready. It is read-only and served only by "
        "/api/public/demo/*; no authentication is required for those routes."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
