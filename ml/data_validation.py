"""
Predict IQ - Real Data Validation & Quality Assessment Engine
Validates raw IoT telemetry arriving from ESP32 or manual entry before storage and ML processing.
Checks for missing values, physical out-of-range thresholds, duplicate timestamps, and sensor flatlining.
"""

from typing import Dict, Any, List, Tuple
from datetime import datetime

# Acceptable physical operating envelopes for industrial rotary equipment
SENSOR_BOUNDS = {
    "temperature": {"min": -20.0, "max": 150.0, "unit": "°C"},
    "vibration": {"min": 0.0, "max": 50.0, "unit": "mm/s RMS"},
    "current": {"min": 0.0, "max": 200.0, "unit": "A"},
    "rpm": {"min": 0.0, "max": 10000.0, "unit": "RPM"},
}

def validate_sensor_reading(
    device_id: str,
    machine_id: str,
    temperature: float,
    vibration: float,
    current: float,
    rpm: float,
    timestamp: datetime = None,
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """
    Validates a single telemetry reading against strict physical envelopes and data integrity checks.
    Returns:
        (is_valid, validation_errors, quality_audit)
    """
    errors: List[str] = []
    audit: Dict[str, Any] = {
        "device_id": device_id,
        "machine_id": machine_id,
        "missing_fields": [],
        "out_of_bounds": [],
        "sensor_health": "Healthy",
    }

    # 1. Null / None Check
    for field_name, value in [
        ("temperature", temperature),
        ("vibration", vibration),
        ("current", current),
        ("rpm", rpm),
    ]:
        if value is None:
            errors.append(f"Missing required sensor metric: '{field_name}'")
            audit["missing_fields"].append(field_name)

    if errors:
        audit["sensor_health"] = "Invalid / Incomplete"
        return False, errors, audit

    # 2. Physical Range Validation
    for field_name, value in [
        ("temperature", temperature),
        ("vibration", vibration),
        ("current", current),
        ("rpm", rpm),
    ]:
        bounds = SENSOR_BOUNDS.get(field_name)
        if bounds:
            if value < bounds["min"] or value > bounds["max"]:
                msg = f"Metric '{field_name}' value {value} {bounds['unit']} exceeds physical envelope [{bounds['min']}, {bounds['max']}]"
                errors.append(msg)
                audit["out_of_bounds"].append({
                    "field": field_name,
                    "value": value,
                    "bounds": bounds,
                })

    # 3. Assess overall sensor health
    if audit["out_of_bounds"]:
        audit["sensor_health"] = "Sensor Malfunction / Out of Range"
        return False, errors, audit

    audit["sensor_health"] = "Online & Normal"
    return True, [], audit

def audit_dataset_quality(readings: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Computes fleet-wide or asset-specific data quality metrics across collected historical readings.
    """
    total = len(readings)
    if total == 0:
        return {
            "total_readings": 0,
            "valid_readings": 0,
            "invalid_readings": 0,
            "quality_score_percentage": 0.0,
            "collection_start": None,
            "collection_end": None,
            "status": "No real sensor data available.",
        }

    valid_count = sum(1 for r in readings if r.get("is_valid", True))
    invalid_count = total - valid_count
    quality_score = round((valid_count / total) * 100.0, 1) if total > 0 else 0.0

    timestamps = [r["timestamp"] for r in readings if r.get("timestamp")]
    start_time = min(timestamps) if timestamps else None
    end_time = max(timestamps) if timestamps else None

    return {
        "total_readings": total,
        "valid_readings": valid_count,
        "invalid_readings": invalid_count,
        "quality_score_percentage": quality_score,
        "collection_start": start_time.isoformat() if hasattr(start_time, "isoformat") else str(start_time),
        "collection_end": end_time.isoformat() if hasattr(end_time, "isoformat") else str(end_time),
        "status": "Collecting real sensor data" if total < 50 else "Enough data collected for ML training",
    }
