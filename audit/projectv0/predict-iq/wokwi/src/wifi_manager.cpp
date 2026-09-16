#include "wifi_manager.h"

#include <time.h>
#include <WiFi.h>

#include "config.h"

namespace {
unsigned long lastReconnectAttempt = 0;
}

void initWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[WIFI] Connecting to Wokwi-GUEST");

    const unsigned long started = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - started < 15000UL) {
        delay(250);
        Serial.print('.');
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println(" failed");
        return;
    }

    Serial.println(" connected");
    Serial.print("[WIFI] IP: ");
    Serial.println(WiFi.localIP());
    configTime(UTC_OFFSET_SECONDS, DAYLIGHT_OFFSET_SECONDS, NTP_SERVER);
}

void maintainWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
        return;
    }

    if (millis() - lastReconnectAttempt >= WIFI_RECONNECT_INTERVAL_MS) {
        lastReconnectAttempt = millis();
        Serial.println("[WIFI] Reconnecting...");
        WiFi.reconnect();
    }
}

bool isWiFiConnected() {
    return WiFi.status() == WL_CONNECTED;
}

bool isTimeSynchronized() {
    return time(nullptr) >= 1000000000;
}

String currentUtcTimestamp() {
    time_t now = time(nullptr);
    struct tm utcTime;
    gmtime_r(&now, &utcTime);
    char buffer[25];
    strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utcTime);
    return String(buffer);
}
