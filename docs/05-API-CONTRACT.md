# PredictIQ — API & Telemetry Contract
## Status: LOCKED CONCEPT; exact routes finalized after code audit

### Telemetry
```json
{
  "device_id": "PIQ-ESP32-001",
  "machine_id": "MOTOR-001",
  "timestamp": "2026-01-01T00:00:00Z",
  "temperature": 48.2,
  "vibration": 0.31,
  "current": 1.82,
  "rpm": 1420
}
```

### Initial endpoint concepts
```text
GET  /api/health
GET  /api/machines
POST /api/machines
GET  /api/machines/{id}
POST /api/devices
POST /api/devices/heartbeat
POST /api/sensor-data
GET  /api/sensor-data
GET  /api/predictions
GET  /api/alerts
POST /api/maintenance
GET  /api/maintenance
POST /api/feedback
```

Rules:
- Validate all device input.
- Keep units documented and consistent.
- Require device/machine identity and timestamp.
- Do not make backend behavior Wokwi-specific.
