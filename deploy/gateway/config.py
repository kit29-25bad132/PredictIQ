"""
PredictIQ Gateway - Configuration

All configuration via environment variables. Fails closed on missing secrets.
Never hard-codes API keys, passwords, or production URLs.
"""

import json
import math
import sys
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class GatewaySettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Render upstream ---
    render_backend_url: str = Field(
        ...,
        description="Render backend base URL, e.g. https://predictiq-backend-771t.onrender.com",
    )
    render_device_api_key: str = Field(
        ...,
        description="DEVICE_API_KEY configured on the Render backend. Never exposed to Wokwi.",
    )

    # --- Wokwi-side gateway credential ---
    gateway_token: str = Field(
        ...,
        description="Application-level token that Wokwi sends to this gateway. "
        "Never send the Render DEVICE_API_KEY to Wokwi.",
    )

    # --- Device / machine allowlists ---
    allowed_devices: str = Field(
        default="ESP32_001",
        description="Comma-separated list of accepted device_id values.",
    )
    allowed_machines: str = Field(
        default="TEST-001",
        description="Comma-separated list of accepted machine_id values.",
    )

    # --- Limits ---
    max_request_bytes: int = Field(
        default=8192,
        description="Maximum allowed request body size in bytes.",
    )
    rate_limit_per_minute: int = Field(
        default=120,
        description="Maximum requests per minute per IP.",
    )
    upstream_timeout_seconds: float = Field(
        default=10.0,
        description="Timeout for upstream Render HTTPS requests.",
    )

    # --- Server ---
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=9000)
    reload: bool = Field(default=False)

    # --- Telemetry bounds (mirrors backend/app/schemas/sensor.py) ---
    temp_min: float = -50.0
    temp_max: float = 300.0
    vibration_min: float = 0.0
    vibration_max: float = 100.0
    current_min: float = 0.0
    current_max: float = 1000.0
    rpm_min: float = 0.0
    rpm_max: float = 60000.0

    @property
    def allowed_devices_set(self) -> set:
        return {d.strip() for d in self.allowed_devices.split(",") if d.strip()}

    @property
    def allowed_machines_set(self) -> set:
        return {m.strip() for m in self.allowed_machines.split(",") if m.strip()}

    def validate_render_url(self) -> None:
        """Ensure the Render URL uses HTTPS (fail closed)."""
        url = self.render_backend_url.rstrip("/")
        if not url.startswith("https://"):
            raise ValueError(
                f"RENDER_BACKEND_URL must use HTTPS. Got: {url}"
            )

    def validate_no_secrets_in_lists(self) -> None:
        """Sanity: ensure allowlists don't accidentally contain keys."""
        for val in [self.allowed_devices, self.allowed_machines]:
            if len(val) > 1000:
                raise ValueError("Allowlist value is suspiciously long; check configuration.")


def load_settings() -> GatewaySettings:
    """Load and validate settings. Exits on critical configuration errors."""
    try:
        settings = GatewaySettings()
    except Exception as exc:
        print(f"FATAL: Gateway configuration error: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        settings.validate_render_url()
        settings.validate_no_secrets_in_lists()
    except ValueError as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        sys.exit(1)

    if not settings.render_device_api_key:
        print("FATAL: RENDER_DEVICE_API_KEY is required but not set.", file=sys.stderr)
        sys.exit(1)

    if not settings.gateway_token:
        print("FATAL: GATEWAY_TOKEN is required but not set.", file=sys.stderr)
        sys.exit(1)

    return settings
