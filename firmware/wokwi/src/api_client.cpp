#include "api_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "wifi_manager.h"

bool sendHeartbeat() {
    if (!isWiFiConnected()) {
        Serial.println("API connection failed");
        return false;
    }

    HTTPClient http;
    // Wokwi/test-only: ngrok certificate validation is intentionally disabled.
    WiFiClientSecure client;
    client.setInsecure();
    const String endpoint = String(API_BASE_URL) + "/api/devices/heartbeat";
    http.begin(client, endpoint);
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    JsonDocument payload;
    payload["device_id"] = DEVICE_ID;
    payload["machine_id"] = MACHINE_ID;
    payload["firmware_version"] = FIRMWARE_VERSION;
    payload["source"] = SENSOR_SOURCE;

    String body;
    serializeJson(payload, body);
    const int statusCode = http.POST(body);
    Serial.print("Heartbeat HTTP Status: ");
    Serial.println(statusCode);
    const bool success = statusCode >= 200 && statusCode < 300;
    if (success) {
        Serial.println("Heartbeat: SENT");
    } else {
        Serial.println("API connection failed");
    }
    http.end();
    return success;
}

bool sendTelemetry(const SensorReading& temperature, const SensorReading& vibration, const SensorReading& current, const SensorReading& rpm) {
    if (!isWiFiConnected()) {
        Serial.println("[HTTP] Telemetry skipped: Wi-Fi is not connected.");
        return false;
    }
    if (!isTimeSynchronized()) {
        Serial.println("[HTTP] Telemetry skipped: NTP time is not synchronized.");
        return false;
    }
    if (!temperature.valid || !vibration.valid || !current.valid || !rpm.valid) {
        Serial.println("[HTTP] Telemetry skipped: one or more sensor readings are invalid.");
        return false;
    }

    HTTPClient http;
    // Wokwi/test-only: ngrok certificate validation is intentionally disabled.
    WiFiClientSecure client;
    client.setInsecure();
    const String endpoint = String(API_BASE_URL) + "/api/sensor-data";
    http.begin(client, endpoint);
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    JsonDocument payload;
    payload["device_id"] = DEVICE_ID;
    payload["machine_id"] = MACHINE_ID;
    payload["temperature"] = temperature.value;
    payload["vibration"] = vibration.value;
    payload["current"] = current.value;
    payload["rpm"] = rpm.value;
    payload["timestamp"] = currentUtcTimestamp();
    payload["source"] = SENSOR_SOURCE;

    String body;
    serializeJson(payload, body);

    Serial.println("Sending telemetry...");
    const int statusCode = http.POST(body);
    Serial.print("HTTP Status: ");
    Serial.println(statusCode);

    if (statusCode <= 0) {
        Serial.println("API connection failed");
        Serial.print("HTTP error: ");
        Serial.println(http.errorToString(statusCode));
        http.end();
        return false;
    }

    if (statusCode < 200 || statusCode >= 300) {
        Serial.println("API connection failed");
    }

    const String response = http.getString();
    Serial.print("Response: ");
    Serial.println(response);
    http.end();
    return statusCode >= 200 && statusCode < 300;
}
