"""
Predict IQ - Real-Data Feature Engineering
Transforms raw physical telemetry streams (temperature, vibration, current, RPM)
into domain-informed feature vectors for machine learning training and inference.
"""

from typing import Dict, Any, List
import numpy as np

FEATURE_NAMES = [
    "temperature",
    "vibration",
    "current",
    "rpm",
    "temp_ratio",
    "vib_ratio",
    "curr_ratio",
    "rpm_slip",
    "vib_temp_interaction",
    "power_factor_est",
]

def extract_features(
    temperature: float,
    vibration: float,
    current: float,
    rpm: float,
    rated_rpm: float = 1450.0,
    rated_current: float = 10.0,
    max_temp: float = 75.0,
    max_vibration: float = 4.5,
) -> np.ndarray:
    """
    Constructs a 1D NumPy feature vector from sensor measurements and machine specifications.
    """
    # Safe denominators
    max_t = max(max_temp, 30.0)
    max_v = max(max_vibration, 0.5)
    rated_i = max(rated_current, 1.0)
    rated_r = max(rated_rpm, 100.0)

    # Dimensionless ratios & degradation metrics
    temp_ratio = temperature / max_t
    vib_ratio = vibration / max_v
    curr_ratio = current / rated_i
    rpm_slip = (rated_r - rpm) / rated_r

    # Interaction terms
    vib_temp_interaction = vib_ratio * temp_ratio
    power_factor_est = curr_ratio * (rpm / rated_r)

    features = [
        float(temperature),
        float(vibration),
        float(current),
        float(rpm),
        float(temp_ratio),
        float(vib_ratio),
        float(curr_ratio),
        float(rpm_slip),
        float(vib_temp_interaction),
        float(power_factor_est),
    ]

    return np.array(features, dtype=np.float32)

def batch_extract_features(
    readings: List[Dict[str, Any]],
    machine_specs: Dict[str, Any] = None,
) -> np.ndarray:
    """
    Extracts feature matrix (N x M) from a historical list of real sensor reading records.
    """
    specs = machine_specs or {}
    rated_rpm = specs.get("rated_rpm", 1450.0)
    rated_current = specs.get("rated_current", 10.0)
    max_temp = specs.get("max_temp", 75.0)
    max_vibration = specs.get("max_vibration", 4.5)

    rows = []
    for r in readings:
        feat = extract_features(
            temperature=r.get("temperature", 0.0),
            vibration=r.get("vibration", 0.0),
            current=r.get("current", 0.0),
            rpm=r.get("rpm", 0.0),
            rated_rpm=rated_rpm,
            rated_current=rated_current,
            max_temp=max_temp,
            max_vibration=max_vibration,
        )
        rows.append(feat)

    if not rows:
        return np.empty((0, len(FEATURE_NAMES)), dtype=np.float32)

    return np.vstack(rows)
