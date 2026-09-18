#ifndef PREDICT_IQ_WOKWI_CONFIG_H
#define PREDICT_IQ_WOKWI_CONFIG_H

#include <Arduino.h>

// Wokwi networking uses this virtual access point. No password is required.
#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""

// Local Wokwi transport: plain HTTP to the local gateway adapter on the
// developer machine. The gateway forwards to Render over HTTPS.
// host.wokwi.internal resolves to the host machine from within Wokwi simulations.
// GATEWAY_TOKEN must be supplied at build time (platformio.ini).
#define API_BASE_URL "http://host.wokwi.internal:9000"
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

// TLS trust anchor for TEST 4 of the TLS diagnostic suite (Vercel TLS probe).
// PUBLIC certificate - not a secret. Vercel serves Let's Encrypt certificates
// whose chain terminates in ISRG Root X1 (RSA-4096, self-signed, 2015-2035):
//   leaf *.vercel.app -> R10 -> ISRG Root X1
// Source: https://letsencrypt.org/certs/isrgrootx1.pem
// TEST 4 keeps certificate verification fully ENABLED with this anchor.
#define VERCEL_ROOT_CA \
    "-----BEGIN CERTIFICATE-----\n" \
    "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\n" \
    "-----END CERTIFICATE-----\n"

// TEST 4 target: disposable Vercel TLS probe endpoint.
// UPDATE THIS URL after deploying the vercel-tls-probe project.
// Format: https://<YOUR-PROJECT-NAME>.vercel.app/api/tls-probe
#define VERCEL_PROBE_HOST "predictiq-tls-probe.vercel.app"
#define VERCEL_PROBE_URL "https://predictiq-tls-probe.vercel.app/api/tls-probe"


// Write-gate credential (DEVICE_API_KEY configured on the backend). Sent as the
// 'X-API-Key' header on every POST. Leave empty ONLY when the backend has no
// DEVICE_API_KEY configured (gate disabled with a startup warning).
#ifndef DEVICE_API_KEY
#define DEVICE_API_KEY ""
#endif

// Gateway authentication token. When API_BASE_URL points to the PredictIQ
// gateway (plain HTTP, because Wokwi TLS is broken), this token is sent as
// the 'Authorization: Bearer <token>' header. The gateway validates this
// token server-side and uses its own RENDER_DEVICE_API_KEY to authenticate
// with the Render backend. NEVER send the Render DEVICE_API_KEY to Wokwi.
// Leave empty to skip gateway auth (direct Render mode).
#ifndef GATEWAY_TOKEN
#define GATEWAY_TOKEN ""
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
