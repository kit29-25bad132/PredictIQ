# Predict IQ Wokwi Sensor Node

This directory is a standalone Wokwi simulation for the Predict IQ telemetry path:

```text
Wokwi sensors -> ESP32-S3 -> Wi-Fi -> FastAPI /api/sensor-data -> PostgreSQL
```

The simulation uses sensor components and their measured outputs only. It does not generate random values, seed the database, contain database credentials, or implement predictions.

## Board and deployment

- Simulation board: `ESP32-S3 DevKitC-1`.
- Physical deployment target: ESP32-S3 with real sensor drivers selected and calibrated for the installed hardware.
- Wokwi values are simulation values only and must remain tagged `source: "WOKWI"`.

## Wiring

| Signal | Wokwi component | ESP32-S3 pin | Notes |
| --- | --- | --- | --- |
| Temperature | DS18B20 DQ | GPIO 4 | 4.7 kOhm pull-up from DQ to 3V3 |
| Vibration I2C SDA | MPU6050 SDA | GPIO 8 | AC-coupled acceleration mapped to mm/s RMS scale (simulation calibration) |
| Vibration I2C SCL | MPU6050 SCL | GPIO 9 | AC-coupled acceleration mapped to mm/s RMS scale (simulation calibration) |
| Wokwi current input | Potentiometer SIG | GPIO 1 ADC | ADC counts mapped to 0–20 A in `readCurrent()` (simulation calibration) |
| RPM pulse input | Pulse generator OUT | GPIO 18 | Rising-edge interrupt, one pulse per revolution |
| Power | All component VCC | 3V3 | Common simulation supply |
| Ground | All component GND | GND | Common ground |

The vibration channel is calibrated for the API contract's **mm/s RMS** unit in `readVibration()`. The MPU6050 acceleration magnitude is AC-coupled first (per-axis gravity estimated with a slow EMA, so static gravity is not counted as vibration), and the AC component is converted to a vibration-velocity scale at a fixed reference frequency: `v[mm/s] = a[m/s^2] / (2*pi*f_ref) * 1000` (`VIBRATION_REFERENCE_HZ`, `GRAVITY_EMA_ALPHA` in `src/config.h`). This is a **simulation calibration, not a physical calibration claim**: a single-point accelerometer sample is not a velocity spectrum, and real vibration-velocity RMS measurement belongs to physical integration (Phase 7). The analog current channel maps the potentiometer's 12-bit ADC counts (0–4095) linearly onto a simulated ACS712-scale range of **0–20 A** in `readCurrent()` (`ADC_MAX_COUNTS`, `CURRENT_FULL_SCALE_A` in `src/config.h`). This is also a **simulation calibration, not a physical calibration claim**: Wokwi has no ACS712 component, and real ACS712 voltage-to-current calibration belongs only in `readCurrent()` during physical integration. The default pot position (2048) reads ≈10.0 A, which the API contract (0–1000 A) accepts.

RPM is calculated as:

```text
RPM = pulses_per_second * 60 / PULSES_PER_REVOLUTION
```

Change `PULSES_PER_REVOLUTION` in `src/config.h` when the simulated or physical pulse source uses a different number of pulses per revolution.

## FastAPI URL and networking

Wokwi cannot use `localhost` to reach a FastAPI process on the development machine. Start FastAPI on an accessible interface and expose it through a tunnel or reachable deployment, then set this value in `src/config.h`:

```cpp
#define API_BASE_URL "https://your-public-fastapi-tunnel.example.com"
```

The firmware appends `/api/sensor-data`. Do not put database credentials or API keys in this project. FastAPI is the only database client.

Wokwi Wi-Fi is configured as:

```cpp
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
```

## Build and libraries

The included `platformio.ini` targets the ESP32-S3 DevKitC-1. Required libraries are:

- OneWire by Paul Stoffregen
- DallasTemperature by Miles Burton
- Adafruit MPU6050
- Adafruit Unified Sensor
- ArduinoJson
- ESP32 Arduino framework libraries: WiFi, HTTPClient, Wire, and time/NTP support

Open `diagram.json` in Wokwi with the PlatformIO firmware built from this directory. The serial monitor uses 115200 baud.

## TLS discipline

Certificate validation is on by default. `client.setInsecure()` is compiled **only** when the explicit test build flag `TLS_ALLOW_INSECURE` is set (uncomment `build_flags = -D TLS_ALLOW_INSECURE` in `platformio.ini`), and only for tunnels whose certificates the ESP32 trust store cannot verify. Without the flag the client enforces certificate validation; the Phase 8 deployment must use a host with a verifiable certificate and must never enable the flag.

## Live contract verification record (Phase 0.5)

Recorded 2026-09-11 per the V1 migration plan §8 step 5 (live gate).

- **Tooling:** Wokwi CLI v0.26.1 with `WOKWI_CLI_TOKEN` injected through the environment only (never stored, echoed, or committed); live `trycloudflare.com` tunnel to the V1 backend over HTTPS.
- **Database:** disposable local PostgreSQL with the real Alembic migrations (001–002) applied. The V1 telemetry/heartbeat routers, schemas, and ORM models used in the run are the real V1 modules, mounted unchanged by a temporary uncommitted verification harness (router wiring in `main.py` itself is Phase 1 scope by plan). No repo file was modified for verification wiring.
- **TLS:** the default secure build (certificate verification ON) was attempted first and cannot verify the tunnel certificate: `start_ssl_client: -1`, identical failure signature to the V0 audit's recorded run. The pass below therefore used the test-only `TLS_ALLOW_INSECURE` build flag, enabled via build environment for the test build only; the committed `platformio.ini` default remains secure.
- **Live result:** the flagged test build posted real Wokwi telemetry over the live tunnel: 18 firmware readings (`device_id ESP32_001`, `source: WOKWI`, contract-exact units) persisted with HTTP 201 and `reading_id` returned per accepted POST; a byte-identical replay of a captured firmware payload returned 201; HTTP read-back returned the stored rows (200).
- **Rejection behavior (live):** out-of-bounds temperature/vibration, NaN, Inf, invalid `source`, missing required field, and malformed timestamp each returned 422.
- **Timestamp:** firmware NTP `…Z` instants round-trip to storage unchanged (UTC preserved). The column is `TIMESTAMP WITHOUT TIME ZONE` until migration 003 (Phase 1, plan §4).
- **Serial note:** wokwi-cli v0.26.1 streams only ROM/boot and core error lines for this board — the same signature as V0's recorded `wokwi-debug.txt`. Acceptance is evidenced by the backend payload capture of the exact device bytes plus the HTTP and PostgreSQL results above; no serial log was fabricated.

## Serial output

Each sample prints the actual measured values, timestamp, HTTP status, and response body. A sensor error, missing NTP time, unavailable Wi-Fi, or non-2xx API response is reported and does not claim successful storage.

The expected successful API response includes a PostgreSQL-generated `reading_id`, for example:

```json
{"success":true,"message":"Sensor data stored successfully","reading_id":123}
```

## API payload

The firmware sends this payload shape:

```json
{
  "device_id": "ESP32_001",
  "machine_id": "M001",
  "temperature": "<DS18B20 reading>",
  "vibration": "<AC-coupled acceleration mapped to mm/s RMS scale>",
  "current": "<potentiometer position mapped to 0-20 A>",
  "rpm": "<calculated pulse RPM>",
  "timestamp": "<NTP UTC timestamp>",
  "source": "WOKWI"
}
```

Runtime values come from the Wokwi components and are not hardcoded by the firmware.
