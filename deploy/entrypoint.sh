#!/bin/bash
set -e

echo "=== PredictIQ Backend Entrypoint ==="
echo "Starting backend service initialization..."

# ---------------------------------------------------------------------------
# Production safety guards (deployment-level enforcement; no application code
# is involved). APP_ENV=production refuses to start an insecure backend:
#   - DEVICE_API_KEY is REQUIRED (write gate must never be silently open).
#   - DATABASE_URL (or the DB_* fallback set) is REQUIRED.
#   - Placeholder values are rejected.
# Local development (APP_ENV != production) keeps the previous behavior.
# ---------------------------------------------------------------------------
if [ "${APP_ENV}" = "production" ]; then
    echo "APP_ENV=production: running deployment safety checks..."

    fail() {
        echo "ERROR: $1" >&2
        echo "Refusing to start an insecure production backend." >&2
        exit 1
    }

    # --- DEVICE_API_KEY: the write gate must be configured -----------------
    if [ -z "${DEVICE_API_KEY}" ]; then
        fail "DEVICE_API_KEY is not set. Every mutating endpoint would accept anonymous writes."
    fi
    if [ "${DEVICE_API_KEY}" = "CHANGE_ME_DEVICE_KEY" ]; then
        fail "DEVICE_API_KEY is still the placeholder from deploy/.env.example. Generate a real key, e.g.: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
    fi
    if [ "${#DEVICE_API_KEY}" -lt 24 ]; then
        fail "DEVICE_API_KEY is too short (${#DEVICE_API_KEY} chars; minimum 24). Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
    fi

    # --- Database connection must be resolvable ----------------------------
    # The backend accepts DATABASE_URL or the DB_* fallback set (local dev
    # only, backend/app/core/config.py); production requires DATABASE_URL.
    if [ -z "${DATABASE_URL}" ]; then
        fail "DATABASE_URL is not set. Production must use an explicit connection string (see deploy/.env.example)."
    fi
    case "${DATABASE_URL}" in
        *CHANGE_ME_PASSWORD*)
            fail "DATABASE_URL still contains the CHANGE_ME_PASSWORD placeholder. Set a real password." ;;
    esac

    # --- Fail fast on a passwordless local socket --------------------------
    case "${DATABASE_URL}" in
        postgresql+psycopg://@*|postgresql://@*)
            fail "DATABASE_URL has no credentials (no user:password before @)." ;;
    esac

    # --- Warn (not fail): TLS to the database ------------------------------
    # The compose-internal PostgreSQL has no TLS, so DB_SSLMODE=disable is
    # legitimate when the host is "database". For anything else (managed or
    # remote DB) an explicit disable weakens the connection on purpose.
    db_host_from_url="$(python - <<'PY'
import os
from urllib.parse import urlparse
url = urlparse(os.environ.get("DATABASE_URL", ""))
print(url.hostname or "")
PY
)"
    if [ "${DB_SSLMODE}" = "disable" ] && [ -n "${db_host_from_url}" ] && [ "${db_host_from_url}" != "database" ]; then
        echo "WARNING: DB_SSLMODE=disable with non-container database host '${db_host_from_url}'." >&2
        echo "         Traffic to the database will be unencrypted. Use DB_SSLMODE=require" >&2
        echo "         unless you really mean this." >&2
    fi

    echo "Production safety checks passed."
fi

# Schema changes are an explicit operator action, never a startup side effect.
# Apply pending revisions with deploy/migrate.sh before rolling out code that
# requires them. This entrypoint only starts the application and must not mutate
# the database schema.
echo "Skipping automatic schema migrations (operator action required)."

# Start the FastAPI application with the provided command
echo "Starting FastAPI application..."
exec "$@"
