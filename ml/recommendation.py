"""
Predict IQ - Maintenance Recommendation Engine
Generates actionable, component-specific maintenance advice derived from real sensor anomalies and ML diagnostic verdicts.
"""

from typing import Dict, Any, List

def generate_recommendation(
    component: str,
    failure_probability: float,
    temperature: float,
    vibration: float,
    current: float,
    rpm: float,
    feature_importance: Dict[str, float] = None,
) -> str:
    """
    Produces concise, technician-ready corrective action guidance.
    """
    comp_lower = component.lower() if component else ""

    if failure_probability >= 0.75:
        prefix = "CRITICAL: Schedule preventive maintenance immediately. "
    elif failure_probability >= 0.45:
        prefix = "WARNING: "
    else:
        return "Asset parameters operating normally. Maintain routine visual checks and lubrication schedule."

    if "bearing" in comp_lower:
        return prefix + "Inspect bearing lubrication, check for raceway spalling, and verify laser shaft alignment."
    elif "motor" in comp_lower or "stator" in comp_lower or "winding" in comp_lower:
        return prefix + "Check motor load, perform Megger insulation test on stator windings, and inspect ventilation."
    elif "cooling" in comp_lower or "thermal" in comp_lower:
        return prefix + "Inspect cooling fan and airflow, flush heat exchanger passages, and verify ambient temperatures."
    elif "electrical" in comp_lower or "current" in comp_lower:
        return prefix + "Check current load balance, inspect terminal lugs, and verify circuit breaker connections."
    elif "shaft" in comp_lower or "coupling" in comp_lower or "align" in comp_lower:
        return prefix + "Inspect dynamic rotor balance, flexible coupling spider, and foundation mounting torque."
    else:
        if vibration > 4.5:
            return prefix + "Inspect bearing assembly and dynamic rotor balancing."
        elif temperature > 75.0:
            return prefix + "Check cooling airflow and lubricant thermal breakdown."
        elif current > 12.0:
            return prefix + "Inspect electrical supply phases and mechanical resistance."
        else:
            return prefix + "Perform comprehensive mechanical inspection and vibration analysis."
