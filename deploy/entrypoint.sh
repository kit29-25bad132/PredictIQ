#!/bin/bash
set -e

echo "=== PredictIQ Backend Entrypoint ==="
echo "Starting backend service initialization..."

# Run Alembic migrations to bring database schema up to date.
# This ensures the migration chain 001 -> 002 -> ... -> 006 is applied.
# alembic.ini and alembic/ are copied to /app by deploy/Dockerfile.backend,
# so `alembic upgrade head` resolves script_location=alembic correctly.
echo "Running database migrations..."
cd /app

# Diagnostics: prove the migration assets and app path exist before attempting
# the upgrade, so a packaging regression fails with a readable message.
if [ ! -f alembic.ini ]; then
    echo "ERROR: /app/alembic.ini not found. deploy/Dockerfile.backend must COPY backend/alembic.ini."
    exit 1
fi
if [ ! -d alembic/versions ]; then
    echo "ERROR: /app/alembic/versions not found. deploy/Dockerfile.backend must COPY backend/alembic."
    exit 1
fi
python -c "import backend.app.main" || {
    echo "ERROR: backend.app.main is not importable from /app (app path must be backend.app.main:app)."
    exit 1
}

alembic upgrade head

if [ $? -ne 0 ]; then
    echo "ERROR: Database migration failed. Aborting startup."
    exit 1
fi

echo "Database migrations completed successfully."

# Start the FastAPI application with the provided command
echo "Starting FastAPI application..."
exec "$@"
