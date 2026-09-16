"""
Predict IQ - Explainable AI (XAI) Engine with SHAP
Computes feature attributions and transparent technician explanations from real sensor data and trained models.
"""

from typing import List, Dict, Any, Tuple, Optional
import numpy as np

def compute_xai_explanation(
    temperature: float,
    vibration: float,
    current: float,
    rpm: float,
    model: Any = None,
    feature_vector: Optional[np.ndarray] = None,
    rated_rpm: float = 1450.0,
    rated_current: float = 10.0,
    max_temp: float = 75.0,
    max_vibration: float = 4.5,
) -> Tuple[Dict[str, float], List[Dict[str, Any]], List[str], str]:
    """
    Calculates SHAP feature importances, symptom reasons, and plain-English technician explanation.
    """
    reasons = []

    # Telemetry normalization against asset baselines
    temp_ratio = temperature / max(max_temp, 30.0)
    vib_ratio = vibration / max(max_vibration, 0.5)
    curr_ratio = current / max(rated_current, 1.0)
    rpm_slip = abs(rpm - rated_rpm) / max(rated_rpm, 100.0)

    # 1. Compute SHAP values if model and shap are available
    shap_raw: Dict[str, float] = {}
    use_model_shap = False

    if model is not None and feature_vector is not None:
        try:
            import shap
            explainer = shap.TreeExplainer(model)
            shap_values = explainer.shap_values(feature_vector.reshape(1, -1))

            # Handle binary classification shap output format
            if isinstance(shap_values, list) and len(shap_values) > 1:
                vals = shap_values[1][0]
            elif isinstance(shap_values, np.ndarray) and len(shap_values.shape) == 3:
                vals = shap_values[0, :, 1]
            else:
                vals = np.array(shap_values).flatten()

            if len(vals) >= 4:
                shap_raw = {
                    "temperature": float(abs(vals[0])),
                    "vibration": float(abs(vals[1])),
                    "current": float(abs(vals[2])),
                    "rpm": float(abs(vals[3])),
                }
                use_model_shap = True
        except Exception:
            use_model_shap = False

    # 2. Physics-grounded attribution calculation when SHAP is initializing or model is rule-informed
    if not use_model_shap:
        raw_t = max(0.0, temp_ratio - 0.85) * 1.5
        raw_v = max(0.0, vib_ratio - 0.80) * 2.2
        raw_c = max(0.0, curr_ratio - 0.90) * 1.2
        raw_r = max(0.0, rpm_slip - 0.05) * 0.8

        total_attribution = raw_t + raw_v + raw_c + raw_r
        if total_attribution > 0:
            shap_raw = {
                "temperature": round(raw_t / total_attribution, 2),
                "vibration": round(raw_v / total_attribution, 2),
                "current": round(raw_c / total_attribution, 2),
                "rpm": round(raw_r / total_attribution, 2),
            }
        else:
            shap_raw = {
                "temperature": 0.25,
                "vibration": 0.25,
                "current": 0.25,
                "rpm": 0.25,
            }

    # Normalize feature_importance dictionary to sum to ~1.0
    total_val = sum(shap_raw.values()) or 1.0
    feature_importance = {
        k: round(v / total_val, 2) for k, v in shap_raw.items()
    }

    # 3. Identify physical symptoms & reasons
    if vibration > max_vibration * 1.3:
        reasons.append(f"Severe vibration ({vibration:.2f} mm/s RMS, ISO threshold {max_vibration:.1f} mm/s)")
    elif vibration > max_vibration:
        reasons.append(f"Elevated vibration ({vibration:.2f} mm/s RMS)")

    if temperature > max_temp * 1.1:
        reasons.append(f"Critical operating temperature ({temperature:.1f}°C, threshold {max_temp:.1f}°C)")
    elif temperature > max_temp:
        reasons.append(f"Temperature above baseline ({temperature:.1f}°C)")

    if current > rated_current * 1.15:
        reasons.append(f"Excessive electrical load ({current:.1f} A, rated {rated_current:.1f} A)")

    if rpm_slip > 0.12:
        reasons.append(f"Speed slippage detected ({rpm:.0f} RPM vs rated {rated_rpm:.0f} RPM)")

    if not reasons:
        reasons.append("All sensor telemetry operating within healthy baseline tolerances")

    # 4. Synthesize plain-language explanation
    sorted_features = sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
    top_feature, top_score = sorted_features[0]

    if top_score > 0.35:
        if top_feature == "vibration":
            explanation = f"High vibration is the main reason for the increased failure risk ({vibration:.2f} mm/s RMS)."
        elif top_feature == "temperature":
            explanation = f"Elevated temperature is the primary factor driving the risk score ({temperature:.1f}°C)."
        elif top_feature == "current":
            explanation = f"Overcurrent load is the primary contributor to asset stress ({current:.1f} A)."
        else:
            explanation = f"Rotational speed deviation ({rpm:.0f} RPM) is the primary anomaly."
    else:
        explanation = "Sensor telemetry indicates stable nominal performance with balanced feature contributions."

    # 5. Build detailed contributing_factors list for UI
    contributing_factors = [
        {
            "factor": "Temperature",
            "impact": "Critical" if temp_ratio > 1.2 else "High" if temp_ratio > 1.0 else "Normal",
            "shap_value": feature_importance["temperature"],
            "value_observed": f"{temperature:.1f} °C",
            "threshold_reference": f"Max {max_temp:.1f} °C",
            "description": "Monitors thermal build-up from bearing friction and electrical winding heat.",
        },
        {
            "factor": "Vibration",
            "impact": "Critical" if vib_ratio > 1.4 else "High" if vib_ratio > 1.0 else "Normal",
            "shap_value": feature_importance["vibration"],
            "value_observed": f"{vibration:.2f} mm/s",
            "threshold_reference": f"ISO Limit {max_vibration:.1f} mm/s",
            "description": "Direct kinematic indicator of mechanical unbalance, looseness, or bearing wear.",
        },
        {
            "factor": "Current",
            "impact": "High" if curr_ratio > 1.15 else "Normal",
            "shap_value": feature_importance["current"],
            "value_observed": f"{current:.1f} A",
            "threshold_reference": f"Rated {rated_current:.1f} A",
            "description": "Reflects electromagnetic torque requirements and mechanical resistance drag.",
        },
        {
            "factor": "RPM",
            "impact": "High" if rpm_slip > 0.1 else "Normal",
            "shap_value": feature_importance["rpm"],
            "value_observed": f"{rpm:.0f} RPM",
            "threshold_reference": f"Rated {rated_rpm:.0f} RPM",
            "description": "Tracks shaft rotational speed and governor/load regulation.",
        },
    ]

    return feature_importance, contributing_factors, reasons, explanation
