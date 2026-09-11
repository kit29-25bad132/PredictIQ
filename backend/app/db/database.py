"""SQLAlchemy connection and session management for Supabase PostgreSQL."""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from backend.app.core.config import get_settings

settings = get_settings()
DATABASE_URL = settings.database_url_effective
engine = None
SessionLocal = None
if DATABASE_URL:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_recycle=settings.db_pool_recycle,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """
    FastAPI Dependency for database sessions.
    Yields a managed SQLAlchemy database session and ensures closure.
    """
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL or complete DB_* settings are required")

    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
