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
// GlobalSign Root CA (RSA-2048, self-signed, 1998-2028), the trust anchor of
// the Render managed HTTPS certificate chain:
//   leaf onrender.com -> GTS WE1 -> GTS Root R4 (cross-signed) -> GlobalSign Root CA
// Source: system trust store (GlobalSign Root CA, serial 04:00:00:00:00:01:15:4b:5a:c3:94)
// Passed to setCACert() in api_client.cpp so certificate verification stays
// fully ENABLED (chain + hostname/SNI). Never replace with setInsecure()
// outside the TLS_ALLOW_INSECURE test build.
#define API_ROOT_CA \
    "-----BEGIN CERTIFICATE-----\n" \
    "MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG\n" \
    "A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv\n" \
    "b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw\n" \
    "MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i\n" \
    "YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT\n" \
    "aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ\n" \
    "jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp\n" \
    "xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp\n" \
    "1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG\n" \
    "snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ\n" \
    "U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8\n" \
    "9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E\n" \
    "BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B\n" \
    "AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz\n" \
    "yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE\n" \
    "38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP\n" \
    "AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad\n" \
    "DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME\n" \
    "HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==\n" \
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
