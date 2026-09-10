# PredictIQ — System Architecture
## Status: LOCKED

## Prototype
```text
Wokwi → ESP32-S3 → simulated sensors → Wi-Fi → FastAPI → PostgreSQL
                                                     ↓
                                         Health / Prototype AI
                                                     ↓
                                               React Dashboard
                                                     ↓
                                      Alerts → Explanation → Maintenance
                                                     ↓
                                            Technician Feedback
                                                     ↓
                                               Ground Truth
```

## Production
```text
Real Machine → Sensors → ESP32-S3 → Edge AI + Telemetry
                                      ↓
                                 Secure Network
                                      ↓
                                    FastAPI
                                      ↓
                         PostgreSQL + AI Services
                                      ↓
                         Dashboard / Alerts / XAI / RUL
                                      ↓
                                Maintenance
                                      ↓
                                Ground Truth
                                      ↓
                         Controlled Model Improvement
```

## Components
- Web: React/TypeScript
- API: FastAPI
- Database: PostgreSQL
- Device: ESP32-S3
- Simulation: Wokwi
- AI: prototype health logic first; validated ML later
- XAI: human-readable contributors; SHAP where appropriate
- RUL: validated only after adequate degradation data

## Key rule
The backend must not depend on Wokwi-specific behavior. Wokwi and real devices publish the same logical telemetry contract.
