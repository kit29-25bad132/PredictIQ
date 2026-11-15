#!/bin/bash
# Explicit schema migration helper. Never invoked automatically by the backend
# entrypoint. Run this yourself against the intended database, after approval.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set. Refusing to run migrations without an explicit target." >&2
    exit 1
fi

# Work from the directory that contains alembic.ini. In the backend image the
# assets live at /app; when run from the repository they live at the repo root.
if [ -f alembic.ini ] && [ -d alembic/versions ]; then
    :
elif [ -f /app/alembic.ini ] && [ -d /app/alembic/versions ]; then
    cd /app
else
    echo "ERROR: alembic.ini and alembic/versions were not found." >&2
    exit 1
fi

echo "Applying Alembic migrations to the explicitly configured DATABASE_URL."
echo "Revision before:"
alembic current

echo "Upgrading to head..."
alembic upgrade head

echo "Revision after:"
alembic current
echo "Migrations complete. This script did not seed any application data."
