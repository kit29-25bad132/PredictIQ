"""SQLAlchemy connection and session management for Supabase PostgreSQL."""

import os
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=True)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    required_settings = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
    missing_settings = [name for name in required_settings if not os.getenv(name)]
    if missing_settings:
        raise RuntimeError(
            "Missing required database environment variables: "
            + ", ".join(missing_settings)
        )

    DATABASE_URL = (
        f"postgresql+psycopg://{quote_plus(os.environ['DB_USER'])}:"
        f"{quote_plus(os.environ['DB_PASSWORD'])}@{os.environ['DB_HOST']}:"
        f"{os.environ['DB_PORT']}/{os.environ['DB_NAME']}"
    )

engine = create_engine(
    DATABASE_URL,
    connect_args={"sslmode": "require"},
    pool_pre_ping=True,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
    pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "1800")),
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    """
    FastAPI Dependency for database sessions.
    Yields a managed SQLAlchemy database session and ensures closure.
    """
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
