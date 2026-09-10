# PredictIQ — Project Charter
## Status: LOCKED

### One-line idea
PredictIQ is a low-cost, real-time predictive-maintenance system that monitors rotating machines, predicts potential failures, explains the reasons behind risk, supports maintenance decisions, and learns from actual service outcomes.

### Initial target
- Rotating machinery / motor-pump prototype
- Temperature, vibration, current, RPM
- Wokwi + ESP32-S3 first
- Online end-to-end workflow

### Core loop
Machine → Sensors → ESP32-S3 → Telemetry → API → Database → Health/AI → Prediction → Explanation → Alert → Maintenance → Technician feedback → Ground truth → Controlled model improvement

### Non-negotiable principles
1. Low-cost and practical.
2. Real-time/near-real-time monitoring.
3. Explain predictions, not just scores.
4. Capture actual maintenance causes and outcomes.
5. Never present simulation as industrial evidence.
6. Never invent accuracy, confidence, or RUL.
7. Wokwi and real hardware use the same telemetry contract.
8. Prototype first; advanced Edge AI/RUL later.
9. Existing code is audited before reuse.
10. Git history contains meaningful commits.

### Prototype Definition of Done
Wokwi generates telemetry → ESP32 sends it online → API validates it → PostgreSQL stores it → dashboard displays live/history → abnormal behavior produces health/alert/prediction → explanation is shown → technician records maintenance and feedback → feedback becomes structured ground truth.
