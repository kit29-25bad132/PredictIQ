"""Regression tests: startup must not create or migrate the schema."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_application_lifespan_does_not_create_tables():
    source = (REPO_ROOT / "backend" / "app" / "main.py").read_text(encoding="utf-8")
    assert "create_all" not in source


def test_container_entrypoint_does_not_run_migrations():
    source = (REPO_ROOT / "deploy" / "entrypoint.sh").read_text(encoding="utf-8")
    assert "alembic upgrade" not in source
    assert "create_all" not in source


def test_explicit_migration_helper_is_the_only_repo_migration_entrypoint():
    source = (REPO_ROOT / "deploy" / "migrate.sh").read_text(encoding="utf-8")
    assert "alembic current" in source
    assert "alembic upgrade head" in source
