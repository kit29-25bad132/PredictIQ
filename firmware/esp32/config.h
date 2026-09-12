#ifndef PREDICT_IQ_CONFIG_H
#define PREDICT_IQ_CONFIG_H

#include <Arduino.h>

// =============================================================================
// PREDICT IQ - ESP32 FIRMWARE CONFIGURATION
// =============================================================================

// Firmware Metadata
#define FIRMWARE_VERSION          "1.0.0"
#define FIRMWARE_NAME             "PredictIQ_ESP32_IoT"

// Wi-Fi Network Credentials (Update with your plant / lab Wi-Fi credentials)
#define WIFI_SSID                 "YOUR_WIFI_SSID"
#define WIFI_PASSWORD             "YOUR_WIFI_PASSWORD"

// Predict IQ FastAPI Backend Base URL
// Example for local network: "http://192.168.1.100:8000"
// Example for cloud host:    "https://predictiq.yourdomain.com"
#define API_BASE_URL              "http://192.168.1.100:8000"

// Hardware & Asset Identification
#define DEVICE_ID                 "ESP32_001"
#define MACHINE_ID                "M001"
#define DEVICE_TYPE               "ESP32"
#define SENSOR_SOURCE             "REAL_HARDWARE"
#define NTP_SERVER                "pool.ntp.org"
#define UTC_OFFSET_SECONDS        0L
#define DAYLIGHT_OFFSET_SECONDS   0L


// Timing & Transmission Intervals (Milliseconds)
// Change these intervals freely without altering core logic
#define SENSOR_INTERVAL_MS        5000UL    // Sample & send sensor telemetry every 5s
#define HEARTBEAT_INTERVAL_MS     15000UL   // Send device heartbeat every 15s
#define WIFI_RECONNECT_INTERVAL   10000UL   // Retry Wi-Fi connection every 10s if dropped
#define HTTP_TIMEOUT_MS           5000      // HTTP request timeout (5 seconds)

// Status LED Pin (Built-in LED on GPIO 2 for most ESP32 Dev Kits)
#define PIN_STATUS_LED            2

// =============================================================================
// PHYSICAL SENSOR PIN CONFIGURATION (Placeholders - To be wired to hardware)
// =============================================================================
// Uncomment and assign exact GPIO pins when physical sensors are connected
// #define PIN_TEMP_ONEWIRE       4   // DS18B20 1-Wire Digital Bus / DHT22 Data
// #define PIN_VIB_ANALOG         34  // Analog Piezo / MPU6050 I2C (SDA=21, SCL=22)
// #define PIN_CURRENT_ADC        35  // ACS712 / SCT-013 CT Analog Input
// #define PIN_RPM_INTERRUPT      18  // Optical / Hall-Effect Sensor Interrupt Pin

#endif // PREDICT_IQ_CONFIG_H
