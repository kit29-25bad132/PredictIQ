#ifndef PREDICT_IQ_WOKWI_CONFIG_H
#define PREDICT_IQ_WOKWI_CONFIG_H

#include <Arduino.h>

// Wokwi networking uses this virtual access point. No password is required.
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""

// Replace with a publicly reachable FastAPI URL or tunnel URL. For local Wokwi
// simulation use the developer machine's LAN address: host.wokwi.internal
// resolves ONLY inside the simulated network (not on the Windows host), and
// the local gateway path is not available to wokwi-cli runs in this
// environment. Plain HTTP on the local trusted dev network keeps TLS out of
// the Phase 4 proof path. Update the octets if the laptop's Wi-Fi address
// changes (see ipconfig).
#define API_BASE_URL "https://predictiq-backend-771t.onrender.com"  // Render managed HTTPS (GTS WE1 -> pinned GTS Root R4)
//
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

// TLS trust anchor for TEST 1 of the TLS diagnostic suite (example.com).
// PUBLIC certificate - not a secret. example.com's chain terminates in a
// different root from Render's:
//   leaf example.com -> Cloudflare TLS Issuing ECC CA 3 -> SSL.com TLS Transit ECC CA R2
//   -> SSL.com TLS ECC Root CA 2022 (self-signed, 2022-2046)
// Source: local system trust store (ca-bundle.crt), SHA-256 fingerprint verified:
//   C3:2F:FD:9F:46:F9:36:D1:6C:36:73:99:09:59:43:4B:9A:D6:0A:AF:BB:9E:7C:F3:36:54:F1:44:CC:1B:A1:43
// TEST 1 keeps certificate verification fully ENABLED with this anchor - it must
// never fall back to setInsecure() or to Render's GlobalSign anchor.
#define EXAMPLE_ROOT_CA \
    "-----BEGIN CERTIFICATE-----\n" \
    "MIICOjCCAcCgAwIBAgIQFAP1q/s3ixdAW+JDsqXRxDAKBggqhkjOPQQDAzBOMQsw\n" \
    "CQYDVQQGEwJVUzEYMBYGA1UECgwPU1NMIENvcnBvcmF0aW9uMSUwIwYDVQQDDBxT\n" \
    "U0wuY29tIFRMUyBFQ0MgUm9vdCBDQSAyMDIyMB4XDTIyMDgyNTE2MzM0OFoXDTQ2\n" \
    "MDgxOTE2MzM0N1owTjELMAkGA1UEBhMCVVMxGDAWBgNVBAoMD1NTTCBDb3Jwb3Jh\n" \
    "dGlvbjElMCMGA1UEAwwcU1NMLmNvbSBUTFMgRUNDIFJvb3QgQ0EgMjAyMjB2MBAG\n" \
    "ByqGSM49AgEGBSuBBAAiA2IABEUpNXP6wrgjzhR9qLFNoFs27iosU8NgCTWyJGYm\n" \
    "acCzldZdkkAZDsalE3D07xJRKF3nzL35PIXBz5SQySvOkkJYWWf9lCcQZIxPBLFN\n" \
    "SeR7T5v15wj4A4j3p8OSSxlUgaNjMGEwDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSME\n" \
    "GDAWgBSJjy+j6CugFFR781a4Jl9nOAuc0DAdBgNVHQ4EFgQUiY8vo+groBRUe/NW\n" \
    "uCZfZzgLnNAwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2gAMGUCMFXjIlbp\n" \
    "15IkWE8elDIPDAI2wv2sdDJO4fscgIijzPvX6yv/N33w7deedWo1dlJF4AIxAMeN\n" \
    "b0Igj762TVntd00pxCAgRWSGOlDGxK0tk/UYfXLtqc/ErFc2KAhl3zx5Zn6g6g==\n" \
    "-----END CERTIFICATE-----\n"

// Write-gate credential (DEVICE_API_KEY configured on the backend). Sent as the
// 'X-API-Key' header on every POST. Leave empty ONLY when the backend has no
// DEVICE_API_KEY configured (gate disabled with a startup warning).
#ifndef DEVICE_API_KEY
#define DEVICE_API_KEY ""
#endif

#define DEVICE_ID "ESP32_001"
#define MACHINE_ID "TEST-001"
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

// TLS discipline (security plan §9.6): certificate verification is DISABLED only
// under the explicit test build flag below, for tunnels whose certs cannot be
// validated by the ESP32 trust store (e.g. ngrok interception). Never enable for
// a deployment; the Phase 8 deployment uses a host with a verifiable certificate
// (TLS_ALLOW_INSECURE undefined).
// Enable in platformio.ini with:  -D TLS_ALLOW_INSECURE
#ifdef TLS_ALLOW_INSECURE
#define TLS_INSECURE_ALLOWED 1
#else
#define TLS_INSECURE_ALLOWED 0
#endif

#endif
