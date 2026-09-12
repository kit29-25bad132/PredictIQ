# PredictIQ ESP32-S3 — Real-Hardware Firmware (Phase 7)

Real-hardware firmware for deploying ESP32-S3 microcontrollers as edge telemetry
nodes. Posts telemetry to the FastAPI backend with `source: "REAL_HARDWARE"`.

## Phase 7 Changes

- **SENSOR_SOURCE** is `"REAL_HARDWARE"` (was incorrectly `"WOKWI"` in the V0
  esp32 skeleton — this fixes the V0 mislabel).
- **DEVICE_API_KEY** removed (dead token config — security cleanup). The API
  client now sends only `Content-Type: application/json`.
- Sensor drivers retain the honest `NOT_CONFIGURED` placeholder behavior: when
  no sensor is wired, the firmware reports `NOT_CONFIGURED` with no numeric
  fabrication and falls back to heartbeat-only posts.

## Status

| Aspect | Status |
|--------|--------|
| Firmware source | Implemented (`firmware/esp32/`) |
| SENSOR_SOURCE label | `REAL_HARDWARE` (Phase 7 fix applied) |
| Code-level verification | Done — contract review performed |
| Sensor drivers | Honest placeholders (field-wiring pending) |
| Wokwi / simulator | Separate path: `firmware/wokwi/` |
| Real-hardware verification | **PENDING** physical ESP32-S3 + sensors |

## Contract Units (non-negotiable)

- Temperature: **°C**
- Vibration: **mm/s RMS**
- Current: **A (amperes)**
- RPM: **RPM**

The firmware must NOT emit raw ADC counts, raw m/s², or other unconverted
values as if they were the contract units. This fixes two V0 contract violations:
1. Vibration was raw MPU6050 acceleration (m/s²) labeled as mm/s.
2. Current was raw ADC counts 0–4095 (rejected by backend bounds as 422).

## Partial-Reading Policy

When **all four** sensors are attached and read successfully, the firmware posts
a full telemetry row to `POST /api/sensor-data`. When **any** sensor is missing,
it posts **heartbeats only** (`POST /api/devices/heartbeat`) — never a partial
row with invented placeholder values. This is enforced by the
`has_any_numeric_reading` check in `api_client.cpp`.

## Build

```bash
cd firmware/esp32
pio run -e esp32s3
```

## Wiring

**Pending field recording.** The actual sensor wiring must be recorded by the
field team per machine and appended here when available. Until then, this
firmware is implementation-verified only; real-hardware verification is pending.

## Verification Claims

- **Static / code verification:** performed.
- **Simulator / Wokwi verification:** not claimed here.
- **Real-hardware verification:** not claimed here; pending physical device access.
