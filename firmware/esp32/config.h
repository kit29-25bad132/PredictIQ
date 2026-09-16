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

// TLS trust anchor for API_BASE_URL (PUBLIC certificate - not a secret):
// Google Trust Services "GTS Root R4" (self-signed ECDSA P-384, 2016-2036),
// the root CA of the Render managed HTTPS certificate chain:
//   leaf *.onrender.com -> GTS WE1 -> GTS Root R4
// SHA-256: 34:9D:FA:40:58:C5:E2:63:12:3B:39:8A:E7:95:57:3C:4E:13:13:C8:3F:E6:8F:93:55:6C:D5:E8:03:1B:3C:7D
// Source: https://pki.goog/repo/certs/gtsr4.pem
// Passed to setCACert() in api_client.cpp so certificate verification stays
// fully ENABLED (chain + hostname/SNI). Never replace with setInsecure()
// outside the TLS_ALLOW_INSECURE test build.
#define API_ROOT_CA \
    "-----BEGIN CERTIFICATE-----\n" \
    "MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD\n" \
    "VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG\n" \
    "A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw\n" \
    "WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz\n" \
    "IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi\n" \
    "AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi\n" \
    "QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR\n" \
    "HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW\n" \
    "BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D\n" \
    "9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8\n" \
    "p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD\n" \
    "-----END CERTIFICATE-----\n"

// Write-gate credential (DEVICE_API_KEY configured on the backend). Sent as
// the 'X-API-Key' header on every POST. Leave empty ONLY for a backend whose
// DEVICE_API_KEY is unset (gate disabled with a startup warning); a deployed
// gated backend rejects unauthenticated writes with HTTP 401/403.
#define DEVICE_API_KEY            ""

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

// =============================================================================
// WRITE-GATE API KEY (X-API-Key header)
// =============================================================================
// Set via build flag or by editing the DEVICE_API_KEY define above. Never
// commit a real key. Example build flag in platformio.ini:
//   -D DEVICE_API_KEY="\"your-real-key\""
#ifndef DEVICE_API_KEY
#define DEVICE_API_KEY ""
#endif

// =============================================================================
// TLS DISCIPLINE (security plan §9.6)
// =============================================================================
// Certificate verification is DISABLED only under the explicit test build flag
// below, for tunnels whose certs cannot be validated by the ESP32 trust store
// (e.g. ngrok interception). Never enable for a deployment; the production path
// uses a host with a verifiable certificate (TLS_ALLOW_INSECURE undefined).
// Enable in platformio.ini with:  -D TLS_ALLOW_INSECURE
#ifdef TLS_ALLOW_INSECURE
#define TLS_INSECURE_ALLOWED 1
#else
#define TLS_INSECURE_ALLOWED 0
#endif

#endif // PREDICT_IQ_CONFIG_H
