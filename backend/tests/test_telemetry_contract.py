"""
Predict IQ - Telemetry contract tests (Phase 0.5).

Codifies the payload contract (docs/05 + ADR-002, plan §8) against the active
validation schema ``backend.app.schemas.sensor.SensorDataInput``:

    device_id, machine_id, timestamp, temperature (°C), vibration (mm/s RMS),
    current (A), rpm (rpm), source (WOKWI | REAL_HARDWARE)

Bounds (from the schema, KEEP): temperature -50..300, vibration 0..100,
current 0..1000, rpm 0..60000. Non-finite numbers and unknown sources are
rejected. Every required field is mandatory.

These tests are the permanent contract gate: CI runs them, and later phases
(Wokwi payload verification in 0.5, real hardware in 7) replay captured
firmware payloads against this same suite.
"""

import math

import pytest
from pydantic import ValidationError

from backend.app.schemas.sensor import SensorDataInput

REQUIRED_FIELDS = (
    "device_id",
    "machine_id",
    "timestamp",
    "source",
)

NUMERIC_FIELDS = ("temperature", "vibration", "current", "rpm")

# (field, lower edge accepted, value just below rejected,
#  upper edge accepted, value just above rejected)
BOUNDS = (
    ("temperature", -50.0, -50.01, 300.0, 300.01),
    ("vibration", 0.0, -0.01, 100.0, 100.01),
    ("current", 0.0, -0.01, 1000.0, 1000.01),
    ("rpm", 0.0, -1.0, 60000.0, 60001.0),
)


def valid_payload() -> dict:
    """A contract-exact payload (docs/05 shape, Wokwi source)."""
    return {
        "device_id": "PIQ-ESP32-001",
        "machine_id": "MOTOR-001",
        "timestamp": "2026-01-01T00:00:00Z",
        "temperature": 48.2,
        "vibration": 0.31,
        "current": 1.8,
        "rpm": 1420,
        "source": "WOKWI",
    }


# ============================================================================
# 1. Valid payloads
# ============================================================================

def test_valid_payload_is_accepted() -> None:
    parsed = SensorDataInput(**valid_payload())

    assert parsed.device_id == "PIQ-ESP32-001"
    assert parsed.machine_id == "MOTOR-001"
    # Instant semantics: the Z timestamp parses as UTC.
    assert parsed.timestamp.tzinfo is not None
    assert parsed.timestamp.year == 2026
    assert parsed.temperature == pytest.approx(48.2)
    assert parsed.vibration == pytest.approx(0.31)
    assert parsed.current == pytest.approx(1.8)
    assert parsed.rpm == pytest.approx(1420)
    assert parsed.source == "WOKWI"


@pytest.mark.parametrize("source", ["WOKWI", "REAL_HARDWARE"])
def test_valid_source_values_are_accepted(source: str) -> None:
    payload = valid_payload() | {"source": source}
    assert SensorDataInput(**payload).source == source


def test_partial_sensor_payload_is_accepted() -> None:
    payload = valid_payload()
    payload.pop("rpm")
    parsed = SensorDataInput(**payload)

    assert parsed.rpm is None
    assert parsed.temperature == pytest.approx(48.2)


@pytest.mark.parametrize("field", NUMERIC_FIELDS)
def test_integer_values_are_coerced_to_float(field: str) -> None:
    payload = valid_payload() | {field: 0}
    parsed = SensorDataInput(**payload)
    assert isinstance(getattr(parsed, field), float)


# ============================================================================
# 2. Missing required fields
# ============================================================================

@pytest.mark.parametrize("field", REQUIRED_FIELDS)
def test_missing_required_field_is_rejected(field: str) -> None:
    payload = valid_payload()
    del payload[field]

    with pytest.raises(ValidationError) as excinfo:
        SensorDataInput(**payload)

    assert field in str(excinfo.value)


# ============================================================================
# 3. Non-finite numbers
# ============================================================================

@pytest.mark.parametrize("field", NUMERIC_FIELDS)
@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_values_are_rejected(field: str, value: float) -> None:
    assert not math.isfinite(value)
    payload = valid_payload() | {field: value}

    with pytest.raises(ValidationError) as excinfo:
        SensorDataInput(**payload)

    assert field in str(excinfo.value)


# ============================================================================
# 4. Bounds edges
# ============================================================================

@pytest.mark.parametrize(
    "field, value",
    [(b[0], b[1]) for b in BOUNDS] + [(b[0], b[3]) for b in BOUNDS],
)
def test_bounds_edges_are_accepted(field: str, value: float) -> None:
    payload = valid_payload() | {field: value}
    assert SensorDataInput(**payload)


@pytest.mark.parametrize(
    "field, value",
    [(b[0], b[2]) for b in BOUNDS] + [(b[0], b[4]) for b in BOUNDS],
)
def test_out_of_bounds_values_are_rejected(field: str, value: float) -> None:
    payload = valid_payload() | {field: value}

    with pytest.raises(ValidationError) as excinfo:
        SensorDataInput(**payload)

    assert field in str(excinfo.value)


# ============================================================================
# 5. Types
# ============================================================================

@pytest.mark.parametrize("field", NUMERIC_FIELDS)
@pytest.mark.parametrize("value", ["not-a-number", [1.0], {"v": 1.0}])
def test_non_numeric_types_are_rejected(field: str, value) -> None:
    payload = valid_payload() | {field: value}

    with pytest.raises(ValidationError) as excinfo:
        SensorDataInput(**payload)

    assert field in str(excinfo.value)


@pytest.mark.parametrize("field", ["device_id", "machine_id"])
def test_identity_fields_must_be_non_empty(field: str) -> None:
    payload = valid_payload() | {field: ""}
    with pytest.raises(ValidationError):
        SensorDataInput(**payload)


@pytest.mark.parametrize("timestamp", ["not-a-timestamp", [2026]])
def test_invalid_timestamp_is_rejected(timestamp) -> None:
    payload = valid_payload() | {"timestamp": timestamp}
    with pytest.raises(ValidationError):
        SensorDataInput(**payload)


def test_integer_timestamp_is_interpreted_as_epoch_seconds() -> None:
    """
    Documented Pydantic v2 behavior: an int timestamp is Unix epoch seconds.

    Recorded deliberately: devices send ISO-8601 strings, so this leniency does
    not widen the operational contract; a stricter datetime parser is a
    Phase 1 schema decision, not a Phase 0.5 change.
    """
    parsed = SensorDataInput(**(valid_payload() | {"timestamp": 0}))
    assert parsed.timestamp.year == 1970


# ============================================================================
# 6. Source validation
# ============================================================================

@pytest.mark.parametrize(
    "source",
    ["wokwi", "real_hardware", "SIMULATION", "", "WOKWI ", "WOKWI_SIM"],
)
def test_invalid_source_values_are_rejected(source: str) -> None:
    payload = valid_payload() | {"source": source}

    with pytest.raises(ValidationError) as excinfo:
        SensorDataInput(**payload)

    assert "source" in str(excinfo.value)
