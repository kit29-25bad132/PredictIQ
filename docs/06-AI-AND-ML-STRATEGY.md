# PredictIQ — AI/ML Strategy
## Status: LOCKED

### Level 1 — Prototype
Deterministic rules and/or controlled prototype models prove the workflow. No industrial accuracy claims.

### Level 2 — Server ML
Real data → quality checks → synchronization → features → windows → labels → train/validation/test → model → evaluation → versioned deployment.

### Level 3 — Edge AI
Validated model → optimization → quantization → ESP32-S3 → Edge inference → compare with server.

### Possible outputs
- anomaly score
- failure risk
- fault category
- confidence
- degradation trend
- RUL

### Governance
Production models require version, dataset/version, features, metrics, evaluation date, and deployment status.

### Rule
Never invent accuracy, confidence, or RUL. Simulation values must be labeled as prototype/simulation.
