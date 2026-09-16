#include "wifi_manager.h"
#include <time.h>

static unsigned long lastReconnectAttempt = 0;
static bool wasConnected = false;

void initWiFi() {
    Serial.println("\n[WIFI] Initializing Wi-Fi station mode...");
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);

    if (String(WIFI_SSID) == "YOUR_WIFI_SSID") {
        Serial.println("[WIFI WARNING] Default placeholder SSID detected. Please configure WIFI_SSID in config.h.");
    }

    Serial.print("[WIFI] Connecting to SSID: ");
    Serial.println(WIFI_SSID);

    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    // Non-blocking quick initial check (up to 15 attempts x 300ms = 4.5s max)
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 15) {
        delay(300);
        Serial.print(".");
        digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        wasConnected = true;
        digitalWrite(PIN_STATUS_LED, HIGH);
        configTime(UTC_OFFSET_SECONDS, DAYLIGHT_OFFSET_SECONDS, NTP_SERVER);
        Serial.println("\n[WIFI] WiFi connected successfully!");
        Serial.print("[WIFI] IP Address: ");
        Serial.println(WiFi.localIP());
        Serial.print("[WIFI] RSSI Signal: ");
        Serial.print(WiFi.RSSI());
        Serial.println(" dBm");
    } else {
        wasConnected = false;
        digitalWrite(PIN_STATUS_LED, LOW);
        Serial.println("\n[WIFI] Initial connection attempt timed out. Will retry asynchronously in main loop.");
    }
}

bool isWiFiConnected() {
    return WiFi.status() == WL_CONNECTED;
}

void handleWiFiReconnect() {
    if (WiFi.status() == WL_CONNECTED) {
        if (!wasConnected) {
            wasConnected = true;
            digitalWrite(PIN_STATUS_LED, HIGH);
            Serial.println("\n[WIFI] Connection restored!");
            Serial.print("[WIFI] IP: ");
            Serial.println(WiFi.localIP());
        }
        return;
    }

    // Connection is lost
    if (wasConnected) {
        wasConnected = false;
        digitalWrite(PIN_STATUS_LED, LOW);
        Serial.println("\n[WIFI] Connection dropped. Awaiting reconnect window...");
    }

    unsigned long now = millis();
    if (now - lastReconnectAttempt >= WIFI_RECONNECT_INTERVAL) {
        lastReconnectAttempt = now;
        Serial.print("[WIFI] Attempting reconnection to: ");
        Serial.println(WIFI_SSID);
        WiFi.disconnect();
        WiFi.reconnect();
    }
}

String getIPAddress() {
    return isWiFiConnected() ? WiFi.localIP().toString() : "0.0.0.0";
}

int getWiFiRSSI() {
    return isWiFiConnected() ? WiFi.RSSI() : 0;
}
