#include "api_client.h"
#include <time.h>

static bool getFormattedTimestamp(String& timestamp) {
    time_t now = time(nullptr);
    if (now < 1000000000) {
        return false;
    }

    struct tm utcTime;
    gmtime_r(&now, &utcTime);
    char buffer[25];
    if (strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utcTime) == 0) {
        return false;
    }
    timestamp = buffer;
    return true;
}

bool sendHeartbeat(const TelemetrySnapshot& snapshot) {
    if (!isWiFiConnected()) {
        Serial.println("[API CLIENT] Cannot send heartbeat: Wi-Fi offline.");
        return false;
    }

    String endpoint = String(API_BASE_URL) + "/api/devices/heartbeat";
    HTTPClient http;
    http.begin(endpoint);
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    // Build JSON Heartbeat Payload
    StaticJsonDocument<384> doc;
    doc["device_id"]           = DEVICE_ID;
    doc["machine_id"]          = MACHINE_ID;
    doc["device_type"]         = DEVICE_TYPE;
    doc["firmware_version"]    = FIRMWARE_VERSION;
    String timestamp;
    if (getFormattedTimestamp(timestamp)) {
        doc["timestamp"] = timestamp;
    }

    // Transmit actual hardware availability states
    doc["temperature_status"]  = sensorStatusToString(snapshot.temperature.status);
    doc["vibration_status"]    = sensorStatusToString(snapshot.vibration.status);
    doc["current_status"]      = sensorStatusToString(snapshot.current.status);
    doc["rpm_status"]          = sensorStatusToString(snapshot.rpm.status);

    String payload;
    serializeJson(doc, payload);

    Serial.print("[HTTP HEARTBEAT] Sending to: ");
    Serial.println(endpoint);
    Serial.print("[PAYLOAD] ");
    Serial.println(payload);

    int httpCode = http.POST(payload);
    bool success = false;

    if (httpCode > 0) {
        Serial.print("[HTTP RESPONSE] Code: ");
        Serial.println(httpCode);
        if (httpCode >= 200 && httpCode < 300) {
            String response = http.getString();
            Serial.print("[HEARTBEAT SUCCESS] ");
            Serial.println(response);
            success = true;
        } else {
            Serial.print("[HEARTBEAT FAILED] Server returned: ");
            Serial.println(http.getString());
        }
    } else {
        Serial.print("[HTTP ERROR] Request failed: ");
        Serial.println(http.errorToString(httpCode).c_str());
    }

    http.end();
    return success;
}

bool sendSensorTelemetry(const TelemetrySnapshot& snapshot) {
    if (!isWiFiConnected()) {
        Serial.println("[API CLIENT] Cannot send telemetry: Wi-Fi offline.");
        return false;
    }

    // Strict Real-Data Rule: If NO physical sensors are producing valid numbers,
    // do NOT post empty numerical records to /api/sensor-data. Send heartbeat instead!
    if (!snapshot.has_any_numeric_reading) {
        Serial.println("[API CLIENT] All physical sensors reported NOT_CONFIGURED. Skipping /api/sensor-data (sending heartbeat status).");
        return sendHeartbeat(snapshot);
    }

    String endpoint = String(API_BASE_URL) + "/api/sensor-data";
    HTTPClient http;
    http.begin(endpoint);
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");

    // Build JSON Telemetry Payload with ONLY genuine numeric readings
    StaticJsonDocument<384> doc;
    String timestamp;
    if (!getFormattedTimestamp(timestamp)) {
        Serial.println("[API CLIENT] Cannot send telemetry: NTP time is not synchronized.");
        return false;
    }
    doc["device_id"]   = DEVICE_ID;
    doc["machine_id"]  = MACHINE_ID;
    doc["source"]      = SENSOR_SOURCE;
    doc["timestamp"]   = timestamp;

    if (snapshot.temperature.has_value) {
        doc["temperature"] = round(snapshot.temperature.value * 100.0) / 100.0;
    }
    if (snapshot.vibration.has_value) {
        doc["vibration"]   = round(snapshot.vibration.value * 100.0) / 100.0;
    }
    if (snapshot.current.has_value) {
        doc["current"]     = round(snapshot.current.value * 100.0) / 100.0;
    }
    if (snapshot.rpm.has_value) {
        doc["rpm"]         = round(snapshot.rpm.value * 10.0) / 10.0;
    }

    String payload;
    serializeJson(doc, payload);

    Serial.print("[HTTP TELEMETRY] Sending to: ");
    Serial.println(endpoint);
    Serial.print("[PAYLOAD] ");
    Serial.println(payload);

    int httpCode = http.POST(payload);
    bool success = false;

    if (httpCode > 0) {
        Serial.print("[HTTP RESPONSE] Code: ");
        Serial.println(httpCode);
        if (httpCode >= 200 && httpCode < 300) {
            String response = http.getString();
            Serial.print("[TELEMETRY SUCCESS] Stored in PostgreSQL: ");
            Serial.println(response);
            success = true;
        } else {
            Serial.print("[TELEMETRY FAILED] Server returned: ");
            Serial.println(http.getString());
        }
    } else {
        Serial.print("[HTTP ERROR] Request failed: ");
        Serial.println(http.errorToString(httpCode).c_str());
    }

    http.end();
    return success;
}
