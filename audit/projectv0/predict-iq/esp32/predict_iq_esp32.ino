/*
  =============================================================================
  Predict IQ - ESP32 Industrial IoT Firmware (Real-Data Architecture)
  =============================================================================
  Target Hardware: ESP32 Development Board (ESP-WROOM-32 / ESP32-S3)
  Framework: Arduino for ESP32
  Architecture:
    Physical Sensors (Temp, Vib, Current, RPM)
      ↓
    Modular Hardware Drivers (sensors.cpp)
      ↓
    Wi-Fi Manager (wifi_manager.cpp)
      ↓
    FastAPI REST Client (api_client.cpp)
      ↓
    PostgreSQL Database
      ↓
    Predict IQ Dashboard
  
  Zero Fake Data Policy:
    When sensors are not physically wired, the firmware reports NOT_CONFIGURED
    and transmits device heartbeats. It NEVER generates simulated or random numbers.
  =============================================================================
*/

#include <Arduino.h>
#include "config.h"
#include "sensors.h"
#include "wifi_manager.h"
#include "api_client.h"

// Non-blocking timer state
static unsigned long lastSensorSampleTime = 0;
static unsigned long lastHeartbeatTime    = 0;

void setup() {
    Serial.begin(115200);
    delay(1500);

    Serial.println("\n=======================================================");
    Serial.println("  PREDICT IQ - ESP32 Real Industrial IoT Node v1.0.0   ");
    Serial.println("=======================================================");
    Serial.print("Device ID:        "); Serial.println(DEVICE_ID);
    Serial.print("Assigned Machine: "); Serial.println(MACHINE_ID);
    Serial.print("Firmware Version: "); Serial.println(FIRMWARE_VERSION);
    Serial.print("Target API Base:  "); Serial.println(API_BASE_URL);
    Serial.print("Sampling Rate:    "); Serial.print(SENSOR_INTERVAL_MS / 1000); Serial.println(" seconds");
    Serial.print("Heartbeat Rate:   "); Serial.print(HEARTBEAT_INTERVAL_MS / 1000); Serial.println(" seconds");
    Serial.println("=======================================================\n");

    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, LOW);

    // 1. Initialize Sensor Hardware Subsystem
    initSensors();

    // 2. Initialize Wi-Fi Connection
    initWiFi();

    // 3. Send initial startup heartbeat to register device online in PostgreSQL
    Serial.println("\n[SETUP] Sending initial power-on device heartbeat...");
    TelemetrySnapshot initialSnapshot = sampleAllSensors();
    sendHeartbeat(initialSnapshot);
}

void loop() {
    unsigned long currentMillis = millis();

    // 1. Asynchronous Wi-Fi Connection Maintenance
    handleWiFiReconnect();

    // 2. Periodic Device Heartbeat Task
    if (currentMillis - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatTime = currentMillis;
        TelemetrySnapshot snapshot = sampleAllSensors();
        sendHeartbeat(snapshot);
    }

    // 3. Periodic Sensor Sampling & Telemetry Task
    if (currentMillis - lastSensorSampleTime >= SENSOR_INTERVAL_MS) {
        lastSensorSampleTime = currentMillis;

        // Acquire genuine readings from physical hardware
        TelemetrySnapshot snapshot = sampleAllSensors();

        Serial.println("\n--- [TELEMETRY SAMPLE] ---");
        Serial.printf("Temperature: %s (Status: %s)\n",
            snapshot.temperature.has_value ? String(snapshot.temperature.value).c_str() : "NULL",
            sensorStatusToString(snapshot.temperature.status));
        Serial.printf("Vibration:   %s (Status: %s)\n",
            snapshot.vibration.has_value ? String(snapshot.vibration.value).c_str() : "NULL",
            sensorStatusToString(snapshot.vibration.status));
        Serial.printf("Current:     %s (Status: %s)\n",
            snapshot.current.has_value ? String(snapshot.current.value).c_str() : "NULL",
            sensorStatusToString(snapshot.current.status));
        Serial.printf("RPM:         %s (Status: %s)\n",
            snapshot.rpm.has_value ? String(snapshot.rpm.value).c_str() : "NULL",
            sensorStatusToString(snapshot.rpm.status));

        // Dispatch to FastAPI Backend & PostgreSQL
        sendSensorTelemetry(snapshot);
    }

    // Yield execution to RTOS watchdog
    delay(10);
}
