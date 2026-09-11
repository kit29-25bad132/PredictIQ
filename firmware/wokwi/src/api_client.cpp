#include "api_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "wifi_manager.h"

namespace {

// Transport selection follows the configured URL scheme so the documented dev
// fallback (plain HTTP through a tunnel or the Wokwi gateway, plan §8 step 5 /
// R1) works without weakening HTTPS: HTTPS keeps the TLS discipline below
// (certificate verification ON unless the TLS_ALLOW_INSECURE test build flag is
// set); HTTP uses a plain client and no TLS flag applies.
struct HttpTransport {
    WiFiClient plain;
    WiFiClientSecure secure;
    bool tls = false;
};

bool beginRequest(HTTPClient& http, HttpTransport& transport, const String& endpoint) {
    transport.tls = endpoint.startsWith("https://");
    if (transport.tls) {
        // TLS discipline: certificate validation is bypassed ONLY under the
        // explicit test build flag (TLS_ALLOW_INSECURE), for tunnels whose
        // certificates cannot be validated by the ESP32 trust store. See config.h.
        if (TLS_INSECURE_ALLOWED) {
            transport.secure.setInsecure();
        } else {
            transport.secure.setCACert(nullptr);
            transport.secure.setHandshakeTimeout(HTTP_TIMEOUT_MS / 1000);
        }
        return http.begin(transport.secure, endpoint);
    }
    return http.begin(transport.plain, endpoint);
}

}  // namespace

bool sendHeartbeat() {
    if (!isWiFiConnected()) {
        Serial.println("API connection failed");
        return false;
    }

    HTTPClient http;
    HttpTransport transport;
    if (!beginRequest(http, transport, String(API_BASE_URL) + "/api/devices/heartbeat")) {
        Serial.println("API connection failed");
        return false;
    }
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
    HttpTransport transport;
    if (!beginRequest(http, transport, String(API_BASE_URL) + "/api/sensor-data")) {
        Serial.println("[HTTP] Failed to open connection to API.");
        return false;
    }
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
