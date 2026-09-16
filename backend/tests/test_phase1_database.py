from datetime import datetime, timedelta, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from backend.app.api.machines import compute_device_status
from backend.app.db.database import Base
from backend.app.db.models import Machine


ROOT = Path(__file__).parents[1]


def load_migration(name: str):
    path = ROOT / "alembic" / "versions" / name
    spec = spec_from_file_location(name.removesuffix(".py"), path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_chain_contains_phase1_revisions() -> None:
    migration_003 = load_migration("003_timestamptz_and_machine_specs.py")
    migration_004 = load_migration("004_enum_check_constraints.py")

    assert migration_003.down_revision == "002_device_source"
    assert migration_004.down_revision == migration_003.revision


def test_machine_specifications_round_trip_with_timezone_aware_timestamp() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        machine = Machine(
            machine_id="M-PHASE1",
            name="Phase 1 Pump",
            type="Centrifugal Pump",
            location="Bay 1",
            rated_rpm=1450,
            rated_current=10,
            max_temp=75,
            max_vibration=4.5,
            created_at=datetime(2026, 3, 29, 1, 30, tzinfo=timezone.utc),
        )
        session.add(machine)
        session.commit()
        stored = session.query(Machine).one()

    assert stored.rated_rpm == 1450
    assert stored.rated_current == 10
    assert stored.max_temp == 75
    assert stored.max_vibration == 4.5
    assert inspect(engine).get_check_constraints("machines")


def test_device_status_compares_instants_across_timezone_offsets() -> None:
    now = datetime(2026, 3, 29, 3, 0, tzinfo=timezone.utc)
    last_seen = datetime(
        2026,
        3,
        29,
        4,
        0,
        tzinfo=timezone(timedelta(hours=2)),
    )

    assert compute_device_status(last_seen, now=now) == "OFFLINE"
