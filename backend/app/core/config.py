"""
Predict IQ - V1 Backend Central Configuration

Single source of truth for CORS, timeouts, device token, and telemetry bounds.

In Phase 0 this replaces scattered os.getenv reads in the V0 tree. Real values come from
environment variables only; templates (backend/.env.example, root .env.example) contain keys
without real secrets.
"""

from functools import lru_cache
from typing import Annotated, List

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False
    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("APP_ENV", "ENVIRONMENT"),
    )

    # PostgreSQL (connection string preferred; fallback assembly is still supported for
    # local dev only)
    database_url: str = ""
    db_host: str = ""
    db_port: int = 5432
    db_name: str = ""
    db_user: str = ""
    db_password: str = ""
    # libpq sslmode: "require" protects remote/managed databases (production
    # default); local docker-compose PostgreSQL has no TLS and must explicitly
    # set DB_SSLMODE=disable in deploy/.env. Never silently weaken production.
    db_sslmode: str = "require"
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_recycle: int = 1800

    # Device telemetry
    device_timeout_seconds: int = 60
    device_api_key: str = ""

    # Operator session (browser write authentication)
    operator_password: str = ""
    operator_session_secret: str = ""
    operator_session_ttl_seconds: int = 86400

    # External AI provider (Gemini). Both fail closed: with no key the analyze
    # endpoint returns an explicit configuration error and never fabricates a
    # prediction. The key never enters source code or logs.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"

    # CORS - deliberate origins only. Empty list means "no browser origins allowed".
    cors_origins: Annotated[List[str], NoDecode] = []

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    # Telemetry bounds (mirrors the active backend validation contract; kept as constants
    # so they can be reused by services/health engine later).
    telemetry_temp_min: float = -50.0
    telemetry_temp_max: float = 300.0
    telemetry_vibration_min: float = 0.0
    telemetry_vibration_max: float = 100.0
    telemetry_current_min: float = 0.0
    telemetry_current_max: float = 1000.0
    telemetry_rpm_min: float = 0.0
    telemetry_rpm_max: float = 60000.0

    @property
    def database_url_effective(self) -> str:
        if self.database_url:
            return self.database_url
        if not all([self.db_host, self.db_port, self.db_name, self.db_user, self.db_password]):
            return ""
        from urllib.parse import quote_plus

        return (
            f"postgresql+psycopg://{quote_plus(self.db_user)}:"
            f"{quote_plus(self.db_password)}@{self.db_host}:{self.db_port}/{self.db_name}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
