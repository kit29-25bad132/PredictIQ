#ifndef PREDICT_IQ_WOKWI_CONFIG_H
#define PREDICT_IQ_WOKWI_CONFIG_H

#include <Arduino.h>

// Wokwi networking uses this virtual access point. No password is required.
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""

// Replace with a publicly reachable FastAPI URL or tunnel URL. Do not use localhost.
#define API_BASE_URL "https://gents-suburb-scorch.ngrok-free.dev"

#define DEVICE_ID "ESP32_001"
#define MACHINE_ID "M001"
#define SENSOR_SOURCE "WOKWI"
#define FIRMWARE_VERSION "1.0.0"

#define NTP_SERVER "pool.ntp.org"
#define UTC_OFFSET_SECONDS 0L
#define DAYLIGHT_OFFSET_SECONDS 0L

#define DS18B20_PIN 4
#define I2C_SDA_PIN 8
#define I2C_SCL_PIN 9
#define CURRENT_ANALOG_PIN 1
#define RPM_PULSE_PIN 18
#define PULSES_PER_REVOLUTION 1UL

#define SENSOR_INTERVAL_MS 5000UL
#define HEARTBEAT_INTERVAL_MS 30000UL
#define WIFI_RECONNECT_INTERVAL_MS 10000UL
#define HTTP_TIMEOUT_MS 8000
#define SERIAL_BAUD 115200

#endif
