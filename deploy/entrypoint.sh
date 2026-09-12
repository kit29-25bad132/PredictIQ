#!/bin/bash
set -e

echo "=== PredictIQ Backend Entrypoint ==="
echo "Starting backend service initialization..."

# Run Alembic migrations to bring database schema up to date
# This ensures the migration chain 001 → 002 → ... → 006 is applied
echo "Running database migrations..."
cd /app
alembic upgrade head

if [ $? -ne 0 ]; then
    echo "ERROR: Database migration failed. Aborting startup."
    exit 1
fi

echo "Database migrations completed successfully."

# Start the FastAPI application with the provided command
echo "Starting FastAPI application..."
exec "$@"
