"""
Predict IQ - Alembic Migration Environment
Loads database connection from environment variables and maps target_metadata from SQLAlchemy models.
"""

from logging.config import fileConfig
import os
import sys
from dotenv import load_dotenv

from sqlalchemy import (
    Column,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Table,
    engine_from_config,
    inspect,
    pool,
    text,
)
from alembic import context
from alembic.ddl.postgresql import PostgresqlImpl


class PredictIQPostgresqlImpl(PostgresqlImpl):
    __dialect__ = "postgresql"

    def version_table_impl(
        self,
        *,
        version_table: str,
        version_table_schema: str | None,
        version_table_pk: bool,
        **kw: object,
    ) -> Table:
        if not self.as_sql and self.connection is not None:
            inspector = inspect(self.connection)
            if inspector.has_table(version_table, schema=version_table_schema):
                version_column = next(
                    column
                    for column in inspector.get_columns(
                        version_table, schema=version_table_schema
                    )
                    if column["name"] == "version_num"
                )
                if getattr(version_column["type"], "length", None) < 255:
                    self.connection.execute(
                        text(
                            "ALTER TABLE alembic_version "
                            "ALTER COLUMN version_num TYPE VARCHAR(255)"
                        )
                    )

        version_table_obj = Table(
            version_table,
            MetaData(),
            Column("version_num", String(255), nullable=False),
            schema=version_table_schema,
        )
        if version_table_pk:
            version_table_obj.append_constraint(
                PrimaryKeyConstraint(
                    "version_num", name=f"{version_table}_pkc"
                )
            )
        return version_table_obj

# Ensure current working directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

# this is the Alembic Config object
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Add your model's MetaData object here for 'autogenerate' support
from backend.app.db.database import Base, DATABASE_URL
import backend.app.db.models  # Ensure models are imported
target_metadata = Base.metadata

# Reuse the verified PostgreSQL connection configuration without duplicating credentials.
config.set_main_option("sqlalchemy.url", DATABASE_URL.replace("%", "%%"))

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
