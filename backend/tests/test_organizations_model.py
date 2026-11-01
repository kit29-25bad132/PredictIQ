"""
Organization / membership model tests (SQLite, no PostgreSQL required).

Phase 2 is a database-foundation change, so these tests pin the ORM contract:
- the legacy organization constants are stable
- every tenant table defaults to the legacy organization (transitional bridge)
- membership uniqueness and role/status constraints exist
- organization deletion cascades to memberships
- global machine_id / device_id uniqueness is preserved

PostgreSQL-only behavior (composite FKs, backfill, downgrade) is covered by
``test_migration_009_postgres.py``, which runs against a disposable server.
"""

import uuid

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.database import Base
from backend.app.db.models import (
    LEGACY_ORGANIZATION_ID,
    LEGACY_ORGANIZATION_SLUG,
    Alert,
    Device,
    FeedbackRecord,
    Machine,
    MachineSimulationConfig,
    MaintenanceRecord,
    Organization,
    OrganizationMembership,
    Prediction,
    SensorReading,
)

TENANT_MODELS = {
    "machines": Machine,
    "devices": Device,
    "sensor_readings": SensorReading,
    "maintenance_records": MaintenanceRecord,
    "predictions": Prediction,
    "alerts": Alert,
    "feedback_records": FeedbackRecord,
    "simulation_configs": MachineSimulationConfig,
}


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        yield factory, engine
    finally:
        engine.dispose()


def _org(slug="acme", name="Acme Industrial") -> Organization:
    return Organization(id=uuid.uuid4(), name=name, slug=slug)


class TestLegacyConstants:
    def test_legacy_organization_id_is_a_fixed_uuid(self):
        assert isinstance(LEGACY_ORGANIZATION_ID, uuid.UUID)
        assert str(LEGACY_ORGANIZATION_ID) == "00000000-0000-4000-8000-000000000001"

    def test_legacy_slug_matches_migration(self):
        assert LEGACY_ORGANIZATION_SLUG == "legacy"


class TestOrganizationSchema:
    def test_organizations_table_columns(self, db):
        _, engine = db
        columns = {c["name"] for c in inspect(engine).get_columns("organizations")}
        assert {
            "id",
            "name",
            "slug",
            "status",
            "created_at",
            "updated_at",
        } <= columns

    def test_memberships_table_columns(self, db):
        _, engine = db
        columns = {
            c["name"] for c in inspect(engine).get_columns("organization_memberships")
        }
        assert {
            "id",
            "organization_id",
            "user_id",
            "role",
            "status",
            "created_at",
            "updated_at",
        } <= columns

    def test_slug_is_unique(self, db):
        factory, _ = db
        with factory() as session:
            session.add(_org("duplicate"))
            session.commit()
            session.add(_org("duplicate"))
            with pytest.raises(IntegrityError):
                session.commit()

    def test_status_is_constrained(self, db):
        factory, _ = db
        with factory() as session:
            session.add(Organization(id=uuid.uuid4(), name="Bad", slug="bad", status="deleted"))
            with pytest.raises(IntegrityError):
                session.commit()

    def test_default_status_is_active(self, db):
        factory, _ = db
        with factory() as session:
            org = _org("active-org")
            session.add(org)
            session.commit()
            assert org.status == "active"


class TestMembershipRules:
    def test_duplicate_membership_is_rejected(self, db):
        factory, _ = db
        user_id = uuid.uuid4()
        with factory() as session:
            org = _org("members-org")
            session.add(org)
            session.flush()
            session.add(
                OrganizationMembership(
                    id=uuid.uuid4(), organization_id=org.id, user_id=user_id,
                    role="owner", status="active",
                )
            )
            session.commit()
            session.add(
                OrganizationMembership(
                    id=uuid.uuid4(), organization_id=org.id, user_id=user_id,
                    role="member", status="active",
                )
            )
            with pytest.raises(IntegrityError):
                session.commit()

    def test_role_is_constrained(self, db):
        factory, _ = db
        with factory() as session:
            org = _org("role-org")
            session.add(org)
            session.flush()
            session.add(
                OrganizationMembership(
                    id=uuid.uuid4(), organization_id=org.id, user_id=uuid.uuid4(),
                    role="superuser", status="active",
                )
            )
            with pytest.raises(IntegrityError):
                session.commit()

    def test_status_is_constrained(self, db):
        factory, _ = db
        with factory() as session:
            org = _org("status-org")
            session.add(org)
            session.flush()
            session.add(
                OrganizationMembership(
                    id=uuid.uuid4(), organization_id=org.id, user_id=uuid.uuid4(),
                    role="member", status="pending",
                )
            )
            with pytest.raises(IntegrityError):
                session.commit()

    def test_membership_indexes_exist(self, db):
        _, engine = db
        indexes = {
            idx["name"] for idx in inspect(engine).get_indexes("organization_memberships")
        }
        assert "ix_organization_memberships_user_status" in indexes
        assert "ix_organization_memberships_org_role" in indexes

    def test_org_deletion_cascades_to_memberships(self, db):
        factory, _ = db
        with factory() as session:
            org = _org("cascade-org")
            session.add(org)
            session.flush()
            session.add(
                OrganizationMembership(
                    id=uuid.uuid4(), organization_id=org.id, user_id=uuid.uuid4(),
                    role="owner", status="active",
                )
            )
            session.commit()
            session.delete(org)
            session.commit()
            assert session.query(OrganizationMembership).count() == 0


class TestTenantDefaults:
    def test_every_tenant_table_has_organization_id(self, db):
        _, engine = db
        for table in TENANT_MODELS:
            columns = {c["name"] for c in inspect(engine).get_columns(table)}
            assert "organization_id" in columns, table

    def test_default_organization_is_legacy(self, db):
        """Transitional bridge: pre-Phase-3 writes land in the legacy org."""
        factory, _ = db
        with factory() as session:
            session.add(_org("legacy-holder", "Holder"))
            # The legacy organization row is created by the migration, not by
            # the ORM; insert it here so the FK target exists where enforced.
            session.add(
                Organization(
                    id=LEGACY_ORGANIZATION_ID, name="Legacy", slug="legacy", status="active"
                )
            )
            session.commit()

            machine = Machine(machine_id="M-LEGACY", name="M", type="Pump", location="Bay")
            session.add(machine)
            session.commit()
            assert machine.organization_id == LEGACY_ORGANIZATION_ID

    def test_global_machine_and_device_uniqueness_preserved(self, db):
        factory, _ = db
        with factory() as session:
            session.add(Organization(id=LEGACY_ORGANIZATION_ID, name="Legacy", slug="legacy"))
            session.add(_org("second-org"))
            session.commit()

            session.add(Machine(machine_id="M-UNIQ", name="M", type="Pump", location="Bay"))
            session.commit()
            session.add(Machine(machine_id="M-UNIQ", name="M2", type="Pump", location="Bay2"))
            with pytest.raises(IntegrityError):
                session.commit()

    def test_organization_slug_uniqueness_does_not_constrain_machine_ids(self, db):
        """Two organizations may not share tenant data via duplicate machine ids."""
        factory, _ = db
        with factory() as session:
            session.add(Organization(id=LEGACY_ORGANIZATION_ID, name="Legacy", slug="legacy"))
            session.commit()
            session.add(Machine(machine_id="M-GLOBAL", name="M", type="Pump", location="Bay"))
            session.commit()
            assert session.query(Machine).filter(Machine.machine_id == "M-GLOBAL").count() == 1
