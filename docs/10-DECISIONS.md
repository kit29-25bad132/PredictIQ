# PredictIQ — Architecture Decisions
## Status: LOCKED

### ADR-001 — Wokwi first
Use Wokwi + ESP32-S3 to prove the complete workflow before physical hardware.

### ADR-002 — Same telemetry contract
Wokwi and real devices use the same logical payload so hardware can be swapped without redesigning the platform.

### ADR-003 — Prototype health before advanced ML
A deterministic/prototype health layer lets the system become end-to-end while real datasets are collected.

### ADR-004 — Feedback is first-class
Maintenance outcomes and actual root causes are structured ground truth.

### ADR-005 — Controlled model improvement
Feedback never automatically replaces a production model.

### ADR-006 — No fake RUL
RUL is genuine only after sufficient degradation data and validation.

### ADR-007 — Audit existing code
Existing work is a starting point, not an unquestioned foundation.

### ADR-008 — Git history matters
Commits must communicate meaningful engineering progress.
