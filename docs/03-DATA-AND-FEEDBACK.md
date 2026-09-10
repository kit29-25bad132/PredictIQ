# PredictIQ — Data & Maintenance Feedback Loop
## Status: LOCKED

This is a core product differentiator.

```text
Telemetry → Prediction → Alert → Inspection → Maintenance
          → Actual Cause + Action + Outcome → Ground Truth
          → Dataset → Candidate Model → Evaluation → Approved Version
```

### Feedback captured
- machine ID
- prediction ID
- observed condition
- actual fault/root cause
- symptoms
- action taken
- parts replaced
- severity
- outcome
- technician notes
- timestamps

### Prediction-vs-reality
Always preserve what AI predicted, when it predicted it, what the technician found, what was done, and whether the prediction matched reality.

### Critical policy
Technician feedback is data, not an automatic retraining command. Production model updates require curation, training, evaluation, versioning, and approval.

### Future
Photos and voice notes may be added later.
