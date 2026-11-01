"""Organization tenancy foundation: organizations, memberships, tenant columns.

Revision ID: 009_organizations_and_tenancy
Revises: 008_simulation_configs_schema_parity

Safety contract
---------------
* Additive only. No business table, column, row or identifier is deleted.
* Preflight probes run FIRST and abort the migration (before any DDL) when
  legacy data cannot be backfilled unambiguously. Nothing is guessed or repaired.
* Every existing row is assigned to the ``legacy`` organization.
* ``machine_id`` / ``device_id`` stay globally unique (firmware and gateway
  workflows depend on those identifiers).
* Organization consistency is enforced in the database by composite foreign
  keys, not only by application code.
* No membership is created for any Supabase user, and the legacy organization
  is never granted automatically.

Downgrade removes only the tenancy artifacts (constraints, indexes, the eight
``organization_id`` columns, and the two new tables). Business data, IDs and
row counts are untouched.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "009_organizations_and_tenancy"
down_revision = "008_simulation_configs_schema_parity"
branch_labels = None
depends_on = None

LEGACY_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"
LEGACY_ORGANIZATION_SLUG = "legacy"
LEGACY_ORGANIZATION_NAME = "Legacy Organization"

TENANT_TABLES = (
    "machines",
    "devices",
    "sensor_readings",
    "maintenance_records",
    "predictions",
    "alerts",
    "feedback_records",
    "simulation_configs",
)

# Composite FK name -> (source table, local cols, referent table, remote cols, ondelete, deferred)
COMPOSITE_FKS = (
    ("fk_devices_organization_machine", "devices",
     ["organization_id", "machine_id"], "machines",
     ["organization_id", "machine_id"], "CASCADE", False),
    ("fk_sensor_readings_organization_machine", "sensor_readings",
     ["organization_id", "machine_id"], "machines",
     ["organization_id", "machine_id"], "CASCADE", False),
    ("fk_sensor_readings_organization_device", "sensor_readings",
     ["organization_id", "device_id"], "devices",
     ["organization_id", "device_id"], "CASCADE", False),
    ("fk_maintenance_records_organization_machine", "maintenance_records",
     ["organization_id", "machine_id"], "machines",
     ["organization_id", "machine_id"], "CASCADE", False),
    ("fk_predictions_organization_machine", "predictions",
     ["organization_id", "machine_id"], "machines",
     ["organization_id", "machine_id"], "CASCADE", False),
    ("fk_alerts_organization_machine", "alerts",
     ["organization_id", "machine_id"], "machines",
     ["organization_id", "machine_id"], "CASCADE", False),
    ("fk_feedback_records_organization_machine", "feedback_records",
     ["organization_id", "machine_id"], "machines",
     ["organization_id", "machine_id"], "CASCADE", False),
    ("fk_simulation_configs_organization_machine", "simulation_configs",
     ["organization_id", "machine_id"], "machines",
     ["organization_id", "machine_id"], "CASCADE", False),
    # Feedback cross-references. Deferred + NO ACTION so the existing
    # single-column ON DELETE SET NULL keys can null the reference first
    # (a composite SET NULL could not null the NOT NULL organization_id).
    ("fk_feedback_records_organization_prediction", "feedback_records",
     ["organization_id", "prediction_id"], "predictions",
     ["organization_id", "id"], None, True),
    ("fk_feedback_records_organization_alert", "feedback_records",
     ["organization_id", "alert_id"], "alerts",
     ["organization_id", "id"], None, True),
    ("fk_feedback_records_organization_maintenance", "feedback_records",
     ["organization_id", "maintenance_record_id"], "maintenance_records",
     ["organization_id", "id"], None, True),
)

UNIQUE_CONSTRAINTS = (
    ("uq_machines_organization_machine", "machines", ["organization_id", "machine_id"]),
    ("uq_devices_organization_device", "devices", ["organization_id", "device_id"]),
    ("uq_predictions_organization_id", "predictions", ["organization_id", "id"]),
    ("uq_alerts_organization_id", "alerts", ["organization_id", "id"]),
    ("uq_maintenance_records_organization_id", "maintenance_records", ["organization_id", "id"]),
)

# Probe name -> SQL that must return 0 rows for the backfill to be unambiguous.
PREFLIGHT_PROBES = (
    ("devices_without_machine",
     "SELECT count(*) FROM devices d LEFT JOIN machines m ON m.machine_id = d.machine_id "
     "WHERE m.machine_id IS NULL"),
    ("readings_without_machine",
     "SELECT count(*) FROM sensor_readings r LEFT JOIN machines m ON m.machine_id = r.machine_id "
     "WHERE m.machine_id IS NULL"),
    ("readings_without_device",
     "SELECT count(*) FROM sensor_readings r LEFT JOIN devices d ON d.device_id = r.device_id "
     "WHERE d.device_id IS NULL"),
    ("readings_device_machine_mismatch",
     "SELECT count(*) FROM sensor_readings r JOIN devices d ON d.device_id = r.device_id "
     "WHERE d.machine_id <> r.machine_id"),
    ("maintenance_without_machine",
     "SELECT count(*) FROM maintenance_records t LEFT JOIN machines m ON m.machine_id = t.machine_id "
     "WHERE m.machine_id IS NULL"),
    ("predictions_without_machine",
     "SELECT count(*) FROM predictions t LEFT JOIN machines m ON m.machine_id = t.machine_id "
     "WHERE m.machine_id IS NULL"),
    ("alerts_without_machine",
     "SELECT count(*) FROM alerts t LEFT JOIN machines m ON m.machine_id = t.machine_id "
     "WHERE m.machine_id IS NULL"),
    ("feedback_without_machine",
     "SELECT count(*) FROM feedback_records t LEFT JOIN machines m ON m.machine_id = t.machine_id "
     "WHERE m.machine_id IS NULL"),
    ("simulation_configs_without_machine",
     "SELECT count(*) FROM simulation_configs t LEFT JOIN machines m ON m.machine_id = t.machine_id "
     "WHERE m.machine_id IS NULL"),
)


def _rows(bind, sql: str) -> int:
    return int(bind.execute(sa.text(sql)).scalar() or 0)


def _preflight(bind) -> None:
    failures = {}
    for name, sql in PREFLIGHT_PROBES:
        count = _rows(bind, sql)
        if count:
            failures[name] = count
    if failures:
        detail = ", ".join(f"{name}={count}" for name, count in sorted(failures.items()))
        raise RuntimeError(
            "Tenancy migration aborted: legacy data cannot be assigned to an "
            f"organization unambiguously ({detail}). No changes were made."
        )


def _snapshot_counts(bind) -> dict:
    return {table: _rows(bind, f"SELECT count(*) FROM {table}") for table in TENANT_TABLES}


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Preflight: abort before any DDL if ownership would be ambiguous.
    _preflight(bind)
    counts_before = _snapshot_counts(bind)

    # 2. Organization tables.
    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("slug", name="uq_organizations_slug"),
        sa.CheckConstraint(
            "status IN ('active', 'suspended', 'archived')",
            name="ck_organizations_status",
        ),
    )

    op.create_table(
        "organization_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Supabase auth.users.id. Intentionally no FK to the provider schema.
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint(
            "organization_id", "user_id", name="uq_organization_memberships_org_user"
        ),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'member')",
            name="ck_organization_memberships_role",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'invited', 'suspended', 'removed')",
            name="ck_organization_memberships_status",
        ),
    )
    op.create_index(
        "ix_organization_memberships_user_status",
        "organization_memberships",
        ["user_id", "status"],
    )
    op.create_index(
        "ix_organization_memberships_org_role",
        "organization_memberships",
        ["organization_id", "role"],
    )

    # 3. Legacy organization (idempotent on slug). No membership is created.
    op.execute(
        sa.text(
            """
            INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
            VALUES (CAST(:id AS uuid), :name, :slug, 'active', now(), now())
            ON CONFLICT (slug) DO NOTHING
            """
        ).bindparams(
            id=LEGACY_ORGANIZATION_ID,
            name=LEGACY_ORGANIZATION_NAME,
            slug=LEGACY_ORGANIZATION_SLUG,
        )
    )

    # 4. Nullable tenant columns + lookup indexes.
    for table in TENANT_TABLES:
        op.add_column(
            table, sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True)
        )
        op.create_index(f"ix_{table}_organization_id", table, ["organization_id"])

    # 5. Backfill from the trusted machine/device relationships.
    op.execute(
        sa.text("UPDATE machines SET organization_id = CAST(:legacy AS uuid) "
                "WHERE organization_id IS NULL").bindparams(legacy=LEGACY_ORGANIZATION_ID)
    )
    for table, join_key in (
        ("devices", "machine_id"),
        ("sensor_readings", "machine_id"),
        ("maintenance_records", "machine_id"),
        ("predictions", "machine_id"),
        ("alerts", "machine_id"),
        ("feedback_records", "machine_id"),
        ("simulation_configs", "machine_id"),
    ):
        op.execute(
            sa.text(
                f"UPDATE {table} t SET organization_id = m.organization_id "
                f"FROM machines m WHERE t.{join_key} = m.machine_id "
                f"AND t.organization_id IS NULL"
            )
        )

    # 6. Every row must now have an owner.
    missing = {
        table: _rows(bind, f"SELECT count(*) FROM {table} WHERE organization_id IS NULL")
        for table in TENANT_TABLES
    }
    unresolved = {table: count for table, count in missing.items() if count}
    if unresolved:
        detail = ", ".join(f"{table}={count}" for table, count in sorted(unresolved.items()))
        raise RuntimeError(
            f"Tenancy backfill incomplete ({detail}); refusing to tighten constraints."
        )

    # 7. Organization-aware unique keys (FK targets).
    for name, table, columns in UNIQUE_CONSTRAINTS:
        op.create_unique_constraint(name, table, columns)

    # 8. Organization-aware composite foreign keys.
    for name, source, local_cols, referent, remote_cols, ondelete, deferred in COMPOSITE_FKS:
        kwargs = {}
        if ondelete:
            kwargs["ondelete"] = ondelete
        if deferred:
            kwargs["deferrable"] = True
            kwargs["initially"] = "DEFERRED"
        op.create_foreign_key(name, source, referent, local_cols, remote_cols, **kwargs)

    # 9. Ownership FKs to organizations (RESTRICT: an org with data cannot be deleted).
    for table in TENANT_TABLES:
        op.create_foreign_key(
            f"fk_{table}_organization", table, "organizations",
            ["organization_id"], ["id"], ondelete="RESTRICT",
        )

    # 10. Tighten to NOT NULL (no server default: the DB now demands an owner).
    for table in TENANT_TABLES:
        op.alter_column(
            table,
            "organization_id",
            existing_type=postgresql.UUID(as_uuid=True),
            nullable=False,
        )

    # 11. Post-check: no row lost, every row owned.
    counts_after = _snapshot_counts(bind)
    if counts_after != counts_before:
        raise RuntimeError(
            f"Row counts changed during tenancy migration: before={counts_before} after={counts_after}"
        )
    for table in TENANT_TABLES:
        if _rows(bind, f"SELECT count(*) FROM {table} WHERE organization_id IS NULL"):
            raise RuntimeError(f"{table} still has rows without an organization.")


def downgrade() -> None:
    bind = op.get_bind()
    counts_before = _snapshot_counts(bind)

    for name, source, *_rest in reversed(COMPOSITE_FKS):
        op.drop_constraint(name, source, type_="foreignkey")

    for table in TENANT_TABLES:
        op.drop_constraint(f"fk_{table}_organization", table, type_="foreignkey")

    for name, table, _columns in reversed(UNIQUE_CONSTRAINTS):
        op.drop_constraint(name, table, type_="unique")

    for table in TENANT_TABLES:
        op.drop_index(f"ix_{table}_organization_id", table_name=table)
        op.drop_column(table, "organization_id")

    op.drop_index("ix_organization_memberships_org_role", table_name="organization_memberships")
    op.drop_index("ix_organization_memberships_user_status", table_name="organization_memberships")
    op.drop_table("organization_memberships")
    op.drop_table("organizations")

    counts_after = _snapshot_counts(bind)
    if counts_after != counts_before:
        raise RuntimeError(
            f"Row counts changed during tenancy downgrade: before={counts_before} after={counts_after}"
        )
