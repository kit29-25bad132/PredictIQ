import os

from sqlalchemy import text

try:
    from backend.database.database import engine
except ModuleNotFoundError:
    from database.database import engine

try:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    print("SUCCESS: Supabase PostgreSQL connected.")

except Exception as e:
    error = str(e)
    password = os.getenv("DB_PASSWORD")
    if password:
        error = error.replace(password, "[REDACTED]")
    print(f"ERROR: Supabase PostgreSQL connection failed: {error}")