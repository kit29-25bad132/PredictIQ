#include <Arduino.h>

#include "api_client.h"
#include "config.h"
#include "sensors.h"
#include "wifi_manager.h"

void setup() {
    Serial.begin(SERIAL_BAUD);
    delay(500);
    Serial.println("\nPredict IQ Wokwi Node");
    Serial.print("Firmware: ");
    Serial.println(FIRMWARE_VERSION);
    Serial.print("API Base URL: ");
    Serial.println(API_BASE_URL);

    // --- Auth mode diagnostic (no secrets printed) ---
#ifdef GATEWAY_TOKEN
    if (strlen(GATEWAY_TOKEN) > 0) {
        Serial.println("[AUTH] Mode: GATEWAY (Bearer token configured)");
    } else {
        Serial.println("[AUTH] WARNING: GATEWAY_TOKEN is empty.");
        Serial.println("[AUTH] Heartbeat/telemetry will fail with HTTP 401.");
        Serial.println("[AUTH] Rebuild with: GATEWAY_TOKEN=<token> pio run -e esp32-s3-devkitc-1");
    }
#else
    Serial.println("[AUTH] Mode: DIRECT (using X-API-Key)");
#endif

    initSensors();
    initWiFi();

    sendHeartbeat();
}

void loop() {
    maintainWiFi();

    static unsigned long lastHeartbeat = 0;
    if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat = millis();
        sendHeartbeat();
    }

    static unsigned long lastSample = 0;
    if (millis() - lastSample < SENSOR_INTERVAL_MS) {
        delay(10);
        return;
    }
    lastSample = millis();

    const SensorReading temperature = readTemperature();
    const SensorReading vibration = readVibration();
    const SensorReading current = readCurrent();
    const SensorReading rpm = readRPM();

    Serial.println("\nPredict IQ IoT Node");
    Serial.println("-------------------");
    Serial.print("Device: ");
    Serial.println(DEVICE_ID);
    Serial.print("Machine: ");
    Serial.println(MACHINE_ID);
    Serial.println(isWiFiConnected() ? "WiFi: CONNECTED" : "WiFi: DISCONNECTED");
    Serial.print("Temperature: ");
    Serial.println(temperature.valid ? String(temperature.value, 2) : "ERROR");
    Serial.print("Vibration: ");
    Serial.println(vibration.valid ? String(vibration.value, 2) : "ERROR");
    Serial.print("Current: ");
    Serial.println(current.valid ? String(current.value, 2) : "ERROR");
    Serial.print("RPM: ");
    Serial.println(rpm.valid ? String(rpm.value, 2) : "ERROR");
    Serial.print("Timestamp: ");
    Serial.println(isTimeSynchronized() ? currentUtcTimestamp() : "NTP NOT SYNCHRONIZED");

    Serial.println("Sending sensor data...");
    sendTelemetry(temperature, vibration, current, rpm);
}
