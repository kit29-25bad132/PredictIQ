# Predict IQ - ESP32 Industrial IoT Sensor Firmware

Production-ready firmware for deploying ESP32 microcontrollers as edge telemetry nodes for the Predict IQ Predictive Maintenance Platform.

---

## 1. Zero Synthetic Data Policy

This firmware adheres strictly to real physical telemetry:
- **No Mock or Random Values**: When physical sensors are not wired, the firmware reports `NOT_CONFIGURED` or `DISCONNECTED` with `null` numeric values.
- **Real Heartbeat**: The device sends periodic heartbeats to `POST /api/devices/heartbeat` so the FastAPI backend and PostgreSQL database track actual device connectivity via `last_seen` timestamps.
- **Genuine Readings Only**: Physical measurements are only sent to `POST /api/sensor-data` when validated hardware produces real signals.

---

## 2. Project Structure

```
esp32/
├── predict_iq_esp32.ino   # Main setup() and non-blocking loop() tasks
├── config.h               # Central configuration (Wi-Fi, API URLs, Timers, IDs)
├── sensors.h              # Modular hardware sensor interface definitions
├── sensors.cpp            # Driver implementations and physical hardware hooks
├── wifi_manager.h         # Non-blocking Wi-Fi station manager interface
├── wifi_manager.cpp       # Reconnection handler with backoff
├── api_client.h           # FastAPI REST client interface
├── api_client.cpp         # HTTP POST serialization using ArduinoJson
└── README.md              # Documentation and wiring guide
```

---

## 3. Hardware Requirements & Library Dependencies

### Hardware
- Any standard **ESP32 Development Board** (e.g. ESP32-WROOM-32D, ESP32-S3, NodeMCU ESP32).
- Micro-USB / USB-C programming cable.

### Required Arduino Libraries
Install via the Arduino IDE Library Manager (**Tools** → **Manage Libraries...**):
1. **ArduinoJson** (by Benoit Blanchon, v6.21.x or v7.x)
2. **WiFi** (built-in with ESP32 board package)
3. **HTTPClient** (built-in with ESP32 board package)

---

## 4. Configuration Instructions

Open `esp32/config.h` and configure the following parameters:

```cpp
// 1. Wi-Fi Network Credentials
#define WIFI_SSID             "YOUR_PLANT_WIFI"
#define WIFI_PASSWORD         "YOUR_SECURE_PASSWORD"

// 2. Predict IQ FastAPI Backend URL
// Replace with the IP address or domain of your FastAPI server
#define API_BASE_URL          "http://192.168.1.100:8000"

// 3. Hardware & Machine Mapping
#define DEVICE_ID             "ESP32_001"
#define MACHINE_ID            "M001"

// 4. Sampling & Heartbeat Intervals
#define SENSOR_INTERVAL_MS    5000UL    // Sample sensors every 5 seconds
#define HEARTBEAT_INTERVAL_MS 15000UL   // Send heartbeat every 15 seconds
```

---

## 5. Device Registration & Heartbeat Flow

Before an ESP32 sends telemetry, register it in PostgreSQL via the FastAPI API:

### 1. Register Device
```bash
curl -X POST http://localhost:8000/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "ESP32_001",
    "machine_id": "M001",
    "device_type": "ESP32",
    "firmware_version": "1.0.0"
  }'
```

### 2. Device Heartbeat (`POST /api/devices/heartbeat`)
Every 15 seconds, the ESP32 posts its status:
```json
{
  "device_id": "ESP32_001",
  "machine_id": "M001",
  "device_type": "ESP32",
  "firmware_version": "1.0.0",
  "timestamp": "2026-08-31T10:30:00Z",
  "temperature_status": "NOT_CONFIGURED",
  "vibration_status": "NOT_CONFIGURED",
  "current_status": "NOT_CONFIGURED",
  "rpm_status": "NOT_CONFIGURED"
}
```
The backend updates `device.last_seen` in PostgreSQL, marking the device as `CONNECTED` on the dashboard.

---

## 6. How to Connect Physical Sensors Later

> [!CAUTION]
> Actual GPIO pin assignments, operating voltages, pull-up resistors, and signal isolation depend strictly on the exact physical sensor models selected. Always check manufacturer datasheets before wiring.

When physical sensors are ready to be integrated:

### 1. Temperature Sensor (e.g. DS18B20 / PT100 / MAX6675)
- Open `esp32/sensors.cpp` → `readTemperature()`.
- Add sensor library include (e.g. `<DallasTemperature.h>`).
- Read physical degrees Celsius, validate finite bounds, and return `SENSOR_CONNECTED`.

### 2. Vibration Sensor (e.g. MPU6050 / ADXL345 / Piezo)
- Open `esp32/sensors.cpp` → `readVibration()`.
- Initialize I2C bus (`Wire.begin(SDA, SCL)`).
- Compute root-mean-square (RMS) velocity in mm/s according to ISO 10816, and return `SENSOR_CONNECTED`.

### 3. Current Sensor (e.g. ACS712 / SCT-013 CT Clamp)
- Open `esp32/sensors.cpp` → `readCurrent()`.
- Sample analog pin with ADC attenuation and sensitivity calibration.
- Compute RMS current in Amperes, and return `SENSOR_CONNECTED`.

### 4. RPM Sensor (e.g. Optical / Hall-Effect Pulse Sensor)
- Open `esp32/sensors.cpp` → `readRPM()`.
- Attach interrupt pin to count shaft revolutions over a 1-second gate time.
- Convert pulse count to RPM, and return `SENSOR_CONNECTED`.

---

## 7. Compilation & Flashing Instructions

### Using Arduino IDE
1. Install **ESP32 Board Support** (**Preferences** → Additional Board Manager URLs: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`).
2. Select your board: **Tools** → **Board** → **ESP32 Arduino** → **ESP32 Dev Module**.
3. Select your serial port: **Tools** → **Port**.
4. Set upload speed to `921600` or `115200`.
5. Open `esp32/predict_iq_esp32.ino` and click **Upload** (Ctrl + U).
6. Open **Serial Monitor** at **115200 baud** to view real-time connection logs and heartbeat transmissions.
