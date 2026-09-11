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

// Simulation calibration (documented in README.md): the potentiometer emulates a
// conditioned ACS712-style current signal, so ADC counts map linearly onto a
// physically plausible 0..20 A range. Default pot position (2048) reads ~10.0 A.
#define ADC_MAX_COUNTS 4095.0f
#define CURRENT_FULL_SCALE_A 20.0f

// Simulation calibration (documented in README.md): vibration-velocity mapping.
// MPU6050 acceleration is AC-coupled (per-axis gravity EMA) and converted to an
// mm/s RMS-scale value at VIBRATION_REFERENCE_HZ: v = a / (2*pi*f_ref) * 1000.
// 159.155 Hz keeps the conversion a clean /1000: 1 m/s^2 AC -> 1 mm/s.
#define VIBRATION_REFERENCE_HZ 159.155f
#define GRAVITY_EMA_ALPHA 0.05f

#define SENSOR_INTERVAL_MS 5000UL
#define HEARTBEAT_INTERVAL_MS 30000UL
#define WIFI_RECONNECT_INTERVAL_MS 10000UL
#define HTTP_TIMEOUT_MS 8000
#define SERIAL_BAUD 115200

#endif
