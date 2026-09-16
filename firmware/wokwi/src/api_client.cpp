#include "api_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <WiFiUdp.h>
#include <DNSServer.h>

#include "config.h"
#include "wifi_manager.h"
#include <errno.h>
#include <lwip/sockets.h>
#include <lwip/netdb.h>

// --- TEMPORARY TLS DIAGNOSTICS - REMOVE AFTER TEST ---

// Custom error code decoder for mbedTLS errors. Supplements mbedtls_strerror()
// which returns "UNKNOWN ERROR CODE" for NET module errors when MBEDTLS_NET_C
// is not compiled in (esp_config.h undef's it for ESP32 bare-metal targets).
static const char* _tls_diag_decode_error(int err) {
    switch (err) {
        case -0x0050: return "MBEDTLS_ERR_NET_CONN_RESET (TCP connection reset)";
        case -0x7780: return "MBEDTLS_ERR_SSL_FATAL_ALERT_MESSAGE (peer sent fatal alert)";
        case -0x6C00: return "MBEDTLS_ERR_SSL_INTERNAL_ERROR (internal SSL error)";
        case -0x6C80: return "MBEDTLS_ERR_SSL_UNKNOWN_IDENTITY (unknown PSK identity)";
        case -0x7800: return "MBEDTLS_ERR_SSL_PEER_VERIFY_FAILED (peer verification failed)";
        case -0x7880: return "MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY (peer closed connection)";
        case -0x7900: return "MBEDTLS_ERR_SSL_BAD_HS_CLIENT_HELLO";
        case -0x7980: return "MBEDTLS_ERR_SSL_BAD_HS_SERVER_HELLO";
        case -0x7A00: return "MBEDTLS_ERR_SSL_BAD_HS_CERTIFICATE";
        case -0x7B00: return "MBEDTLS_ERR_SSL_BAD_HS_SERVER_KEY_EXCHANGE";
        case -0x7B80: return "MBEDTLS_ERR_SSL_BAD_HS_SERVER_HELLO_DONE";
        case -0x7C00: return "MBEDTLS_ERR_SSL_BAD_HS_CLIENT_KEY_EXCHANGE";
        case -0x7300: return "MBEDTLS_ERR_SSL_UNKNOWN_CIPHER";
        case -0x7380: return "MBEDTLS_ERR_SSL_NO_CIPHER_CHOSEN";
        case -0x0014: return "MBEDTLS_ERR_NET_RECV_FAILED (socket recv failed)";
        case -0x0015: return "MBEDTLS_ERR_NET_SEND_FAILED (socket send failed)";
        case -0x0072: return "MBEDTLS_ERR_NET_SOCKET_CONTEXT_ASSUME_WRITABLE";
        default: {
            static char unknown_buf[48];
            snprintf(unknown_buf, sizeof(unknown_buf), "UNKNOWN mbedTLS error: %d (0x%04X)", err, (unsigned int)(err & 0xFFFF));
            return unknown_buf;
        }
    }
}

// Subclass that exposes the protected sslclient pointer for diagnostic access.
// SAFETY: Only call getSslContext() BEFORE stop() has been called on the client.
// After stop(), sslclient is zeroed and freed - reading from it is UB.
class DiagnosticSecureClient : public WiFiClientSecure {
public:
    sslclient_context* getSslContext() { return sslclient; }
};

// Staged failure report. Prints ONLY facts the API guarantees. After a failed
// handshake NO session exists: the version/ciphersuite getters return
// pre-connection context defaults (historically "SSLv3.0"/"(null)") and must
// NEVER be reported as negotiated values.
static void _diag_report_stage_fail(const char* hostname, unsigned long elapsed_ms, const char* err_buf, int last_err) {
    Serial.printf("TCP CONNECT: PASS\n");
    Serial.printf("TLS HANDSHAKE: FAIL (%lu ms)\n", elapsed_ms);
    Serial.printf("ERROR: %d / 0x%04X\n", last_err, (unsigned int)(last_err & 0xFFFF));
    Serial.printf("ERROR MEANING: %s\n", _tls_diag_decode_error(last_err));
    if (err_buf && err_buf[0] != '\0') {
        Serial.printf("mbedtls_strerror: %s\n", err_buf);
    }
    Serial.printf("SNI: %s (sent)\n", hostname);
    Serial.printf("CERTIFICATE: NOT RECEIVED\n");
    Serial.printf("CERTIFICATE VERIFICATION: NOT PERFORMED\n");
    Serial.printf("CIPHERSUITE: NOT NEGOTIATED\n");
    Serial.printf("TLS VERSION: NOT NEGOTIATED\n");
    Serial.printf("HTTP REQUEST: NOT SENT\n");
    Serial.printf("HTTP RESPONSE: NOT AVAILABLE\n");
}

// Negotiation facts - valid ONLY after a SUCCESSFUL handshake, where the
// mbedTLS API guarantees the returned values describe the live session.
static void _diag_print_negotiated(sslclient_context* ctx) {
    const char* version = mbedtls_ssl_get_version(&ctx->ssl_ctx);
    const char* cipher = mbedtls_ssl_get_ciphersuite(&ctx->ssl_ctx);
    uint32_t verify_flags = mbedtls_ssl_get_verify_result(&ctx->ssl_ctx);
    const mbedtls_x509_crt* peer_cert = mbedtls_ssl_get_peer_cert(&ctx->ssl_ctx);

    Serial.printf("TLS VERSION: %s\n", version ? version : "NOT AVAILABLE");
    Serial.printf("CIPHERSUITE: %s\n", cipher ? cipher : "NOT AVAILABLE");
    Serial.printf("CERTIFICATE VERIFICATION: %s\n", verify_flags == 0 ? "PASS (0 flags)" : "FAIL");
    if (verify_flags != 0) {
        char verify_buf[512];
        mbedtls_x509_crt_verify_info(verify_buf, sizeof(verify_buf), "    ", verify_flags);
        Serial.printf("Verify details:\n%s\n", verify_buf);
    }
    if (peer_cert) {
        char cert_buf[1024];
        mbedtls_x509_crt_info(cert_buf, sizeof(cert_buf), "    ", peer_cert);
        Serial.printf("PEER CERTIFICATE: RECEIVED\n%s\n", cert_buf);
    } else {
        Serial.printf("PEER CERTIFICATE: NOT RECEIVED\n");
    }
}

// Pre-connection diagnostics: logs DNS resolution, TCP connect timing.
// Safe to call at any time.
static void _diag_dns_resolve(const char* hostname) {
    Serial.printf("[DIAG] DNS resolving: %s\n", hostname);
    IPAddress ip;
    unsigned long t0 = millis();
    bool resolved = WiFi.hostByName(hostname, ip);
    unsigned long elapsed = millis() - t0;
    if (resolved) {
        Serial.printf("[DIAG] DNS resolved %s -> %s (%lu ms)\n", hostname, ip.toString().c_str(), elapsed);
    } else {
        Serial.printf("[DIAG] DNS FAILED for %s (%lu ms)\n", hostname, elapsed);
    }
}

// TCP connect diagnostic: tests raw TCP connectivity to host:port.
// Returns the socket fd on success, -1 on failure.
static int _diag_tcp_connect(const char* hostname, uint16_t port, int timeout_ms = 5000) {
    IPAddress ip;
    if (!WiFi.hostByName(hostname, ip)) {
        Serial.printf("[DIAG] TCP SKIP: DNS failed for %s\n", hostname);
        return -1;
    }

    Serial.printf("[DIAG] TCP connecting to %s:%u (%s)...\n", hostname, port, ip.toString().c_str());

    int sock = lwip_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock < 0) {
        Serial.printf("[DIAG] TCP socket() failed: errno %d\n", errno);
        return -1;
    }

    struct sockaddr_in serv_addr;
    memset(&serv_addr, 0, sizeof(serv_addr));
    serv_addr.sin_family = AF_INET;
    serv_addr.sin_addr.s_addr = ip;
    serv_addr.sin_port = htons(port);

    // Non-blocking connect with timeout
    fcntl(sock, F_SETFL, fcntl(sock, F_GETFL, 0) | O_NONBLOCK);
    int res = lwip_connect(sock, (struct sockaddr*)&serv_addr, sizeof(serv_addr));
    if (res < 0 && errno != EINPROGRESS) {
        Serial.printf("[DIAG] TCP connect() failed immediately: errno %d\n", errno);
        lwip_close(sock);
        return -1;
    }

    fd_set fdset;
    struct timeval tv;
    FD_ZERO(&fdset);
    FD_SET(sock, &fdset);
    tv.tv_sec = timeout_ms / 1000;
    tv.tv_usec = (timeout_ms % 1000) * 1000;

    unsigned long t0 = millis();
    res = select(sock + 1, nullptr, &fdset, nullptr, &tv);
    unsigned long elapsed = millis() - t0;

    if (res < 0) {
        Serial.printf("[DIAG] TCP select() failed: errno %d (%lu ms)\n", errno, elapsed);
        lwip_close(sock);
        return -1;
    } else if (res == 0) {
        Serial.printf("[DIAG] TCP connect TIMEOUT after %lu ms\n", elapsed);
        lwip_close(sock);
        return -1;
    }

    int sockerr;
    socklen_t len = (socklen_t)sizeof(int);
    res = getsockopt(sock, SOL_SOCKET, SO_ERROR, &sockerr, &len);
    if (res < 0 || sockerr != 0) {
        Serial.printf("[DIAG] TCP connect error: getsockopt res=%d sockerr=%d errno=%d (%lu ms)\n", res, sockerr, errno, elapsed);
        lwip_close(sock);
        return -1;
    }

    Serial.printf("[DIAG] TCP connected to %s:%u (%lu ms)\n", hostname, port, elapsed);

    // Return the socket fd (caller must close it)
    return sock;
}

// HTTPS GET diagnostic: attempts a full TLS handshake and HTTP GET.
// Logs each stage with timing. Returns HTTP status code or negative error.
static int _diag_https_get(const char* url, const char* hostname, const char* ca_pem) {
    Serial.printf("\n[DIAG] ===== HTTPS GET: %s =====\n", url);

    // Stage 1: DNS
    _diag_dns_resolve(hostname);

    // Stage 2: TCP
    int sock = _diag_tcp_connect(hostname, 443, 8000);
    if (sock < 0) {
        Serial.printf("[DIAG] HTTPS ABORT: TCP failed\n");
        return -1;
    }

    // Stage 3: TLS handshake (using WiFiClientSecure directly)
    unsigned long tls_start = millis();
    Serial.printf("[DIAG] TLS handshake starting (sock fd=%d)...\n", sock);

    DiagnosticSecureClient client;
    client.setCACert(ca_pem);
    client.setHandshakeTimeout(HTTP_TIMEOUT_MS / 1000);

    // We already have a socket. We can't easily inject it into WiFiClientSecure
    // without using the internal sslclient. Instead, let's use the full
    // WiFiClientSecure::connect() path which does TCP + TLS together.
    // Close our test socket and let the client do its own TCP+TLS.
    lwip_close(sock);

    // Use WiFiClientSecure for the full handshake
    unsigned long t0 = millis();
    bool connected = client.connect(hostname, 443);
    unsigned long elapsed = millis() - t0;

    if (!connected) {
        char err_buf[128];
        int last_err = client.lastError(err_buf, sizeof(err_buf));
        // SAFETY: The SSL context has been freed by stop() inside connect().
        // Do NOT call mbedtls_ssl_get_version/get_ciphersuite/etc here: no
        // session was negotiated, so those getters hold no valid session data.
        _diag_report_stage_fail(hostname, elapsed, err_buf, last_err);
        client.stop();
        return last_err;
    }

    Serial.printf("TLS HANDSHAKE: PASS (%lu ms)\n", elapsed);

    // Stage 4: TLS metadata (valid ONLY after a successful handshake)
    _diag_print_negotiated(client.getSslContext());

    // Stage 5: HTTP GET
    Serial.printf("HTTP REQUEST: GET %s\n", url);
    HTTPClient http;
    http.begin(client, url);
    // HTTPClient::setTimeout() takes MILLISECONDS.
    http.setTimeout((unsigned long)HTTP_TIMEOUT_MS);
    t0 = millis();
    int httpStatus = http.GET();
    elapsed = millis() - t0;

    if (httpStatus > 0) {
        Serial.printf("HTTP RESPONSE: RECEIVED (status=%d, %lu ms)\n", httpStatus, elapsed);
        String response = http.getString();
        Serial.printf("[DIAG] Response length: %d bytes\n", response.length());
        if (response.length() <= 512) {
            Serial.printf("[DIAG] Response body: %s\n", response.c_str());
        } else {
            Serial.printf("[DIAG] Response body (first 512): %s\n", response.substring(0, 512).c_str());
        }
    } else {
        Serial.printf("HTTP RESPONSE: NOT AVAILABLE (HTTPClient error %d: %s)\n", httpStatus, http.errorToString(httpStatus).c_str());
    }

    http.end();
    client.stop();
    Serial.printf("[DIAG] ===== END HTTPS GET: %s =====\n\n", url);
    return httpStatus;
}

// HTTPS POST diagnostic: attempts a full TLS handshake and HTTP POST to Render.
static int _diag_https_post_render(const char* url, const char* hostname, const char* ca_pem) {
    Serial.printf("\n[DIAG] ===== HTTPS POST: %s =====\n", url);

    _diag_dns_resolve(hostname);

    DiagnosticSecureClient client;
    client.setCACert(ca_pem);
    client.setHandshakeTimeout(HTTP_TIMEOUT_MS / 1000);

    unsigned long t0 = millis();
    bool connected = client.connect(hostname, 443);
    unsigned long elapsed = millis() - t0;

    if (!connected) {
        char err_buf[128];
        int last_err = client.lastError(err_buf, sizeof(err_buf));
        // SAFETY: no session was negotiated; do not query the SSL context.
        _diag_report_stage_fail(hostname, elapsed, err_buf, last_err);
        client.stop();
        return last_err;
    }

    Serial.printf("TLS HANDSHAKE: PASS (%lu ms)\n", elapsed);

    // TLS metadata (valid ONLY after a successful handshake)
    _diag_print_negotiated(client.getSslContext());

    // Build minimal sensor payload
    JsonDocument payload;
    payload["device_id"] = DEVICE_ID;
    payload["machine_id"] = MACHINE_ID;
    payload["temperature"] = 25.0;
    payload["vibration"] = 1.0;
    payload["current"] = 10.0;
    payload["rpm"] = 1500.0;
    payload["timestamp"] = currentUtcTimestamp();
    payload["source"] = SENSOR_SOURCE;

    String body;
    serializeJson(payload, body);

    Serial.printf("[DIAG] Sending HTTP POST (%d bytes)...\n", body.length());
    HTTPClient http;
    http.begin(client, url);
    // HTTPClient::setTimeout() takes MILLISECONDS.
    http.setTimeout((unsigned long)HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");
#ifdef DEVICE_API_KEY
    if (strlen(DEVICE_API_KEY) > 0) {
        http.addHeader("X-API-Key", DEVICE_API_KEY);
    }
#endif

    t0 = millis();
    Serial.printf("HTTP REQUEST: POST %s (%d bytes)\n", url, body.length());
    int httpStatus = http.POST(body);
    elapsed = millis() - t0;

    if (httpStatus > 0) {
        Serial.printf("HTTP RESPONSE: RECEIVED (status=%d, %lu ms)\n", httpStatus, elapsed);
        String response = http.getString();
        Serial.printf("[DIAG] Response length: %d bytes\n", response.length());
        if (response.length() <= 1024) {
            Serial.printf("[DIAG] Response body: %s\n", response.c_str());
        } else {
            Serial.printf("[DIAG] Response body (first 1024): %s\n", response.substring(0, 1024).c_str());
        }
    } else {
        Serial.printf("HTTP RESPONSE: NOT AVAILABLE (HTTPClient error %d: %s)\n", httpStatus, http.errorToString(httpStatus).c_str());
    }

    http.end();
    client.stop();
    Serial.printf("[DIAG] ===== END HTTPS POST: %s =====\n\n", url);
    return httpStatus;
}

// Run full diagnostic suite. Called once from setup().
void runTlsDiagnostics() {
    Serial.println("\n");
    Serial.println("╔══════════════════════════════════════════════════════╗");
    Serial.println("║     PREDICTIQ TLS DIAGNOSTIC SUITE v1.0            ║");
    Serial.println("╚══════════════════════════════════════════════════════╝");
    Serial.println();

    Serial.printf("[DIAG] Free heap: %u bytes\n", ESP.getFreeHeap());
    Serial.printf("[DIAG] WiFi status: %s\n", isWiFiConnected() ? "CONNECTED" : "DISCONNECTED");
    Serial.printf("[DIAG] NTP sync: %s\n", isTimeSynchronized() ? "YES" : "NO");
    Serial.printf("[DIAG] Current time: %s\n", isTimeSynchronized() ? currentUtcTimestamp().c_str() : "N/A");
    Serial.println();

    // --- TEST 1: Public HTTPS endpoint (example.com) ---
    Serial.println("╔══════════════════════════════════════════════════════╗");
    Serial.println("║  TEST 1: example.com (known-good public HTTPS)     ║");
    Serial.println("╚══════════════════════════════════════════════════════╝");
    // Certificate verification stays FULLY ENABLED. example.com's chain
    // terminates in SSL.com TLS ECC Root CA 2022 - a DIFFERENT root from
    // Render's GlobalSign anchor - so TEST 1 pins its own trust anchor
    // (EXAMPLE_ROOT_CA). Never setInsecure() here: an unverified TEST 1
    // would prove nothing about the TLS stack.
    const char* kExampleHost = "example.com";
    const char* kExampleUrl = "https://example.com/";
    Serial.printf("TEST 1 TARGET: %s\n", kExampleUrl);
    const int exStatus = _diag_https_get(kExampleUrl, kExampleHost, EXAMPLE_ROOT_CA);
    Serial.println();

    // --- TEST 2: Render HTTPS (production TLS config) ---
    Serial.println("╔══════════════════════════════════════════════════════╗");
    Serial.println("║  TEST 2: Render HTTPS (production CA + verify)     ║");
    Serial.println("╚══════════════════════════════════════════════════════╝");
    Serial.printf("TEST 2 TARGET: https://predictiq-backend-771t.onrender.com/\n");
    int renderStatus = _diag_https_get(
        "https://predictiq-backend-771t.onrender.com/",
        "predictiq-backend-771t.onrender.com",
        API_ROOT_CA
    );

    // --- TEST 3: Render HTTPS POST (production telemetry path) ---
    Serial.println("╔══════════════════════════════════════════════════════╗");
    Serial.println("║  TEST 3: Render HTTPS POST /api/sensor-data        ║");
    Serial.println("╚══════════════════════════════════════════════════════╝");
    Serial.printf("TEST 3 TARGET: https://predictiq-backend-771t.onrender.com/api/sensor-data\n");
    int postStatus = _diag_https_post_render(
        "https://predictiq-backend-771t.onrender.com/api/sensor-data",
        "predictiq-backend-771t.onrender.com",
        API_ROOT_CA
    );

    // --- SUMMARY ---
    Serial.println("╔══════════════════════════════════════════════════════╗");
    Serial.println("║  DIAGNOSTIC SUMMARY                                 ║");
    Serial.println("╚══════════════════════════════════════════════════════╝");
    Serial.printf("  Free heap: %u bytes\n", ESP.getFreeHeap());
    Serial.printf("  TEST 1 (example.com GET): %s\n", exStatus > 0 ? "PASS" : "FAIL");
    Serial.printf("  TEST 2 (Render GET):      %s (status=%d)\n", renderStatus > 0 ? "PASS" : "FAIL", renderStatus);
    Serial.printf("  TEST 3 (Render POST):     %s (status=%d)\n", postStatus > 0 ? "PASS" : "FAIL", postStatus);
    Serial.println();

    if (exStatus > 0 && renderStatus <= 0) {
        Serial.println("[DIAG] CONCLUSION: Verified public HTTPS works but Render fails (Case F)." );
        Serial.println("[DIAG] NOT a general Wokwi/ESP32 HTTPS failure. Suspect the Render");
        Serial.println("[DIAG] edge rejecting this specific ClientHello. Distinguish 'the");
        Serial.println("[DIAG] library supports the primitives' from 'Render accepts the");
        Serial.println("[DIAG] actual ClientHello' before proposing any TLS change.");
    } else if (exStatus <= 0 && renderStatus <= 0) {
        Serial.println("[DIAG] CONCLUSION: ALL verified HTTPS connections fail (Case B/E).");
        Serial.println("[DIAG] Suspect general Wokwi gateway/network/TLS behavior.");
    } else if (exStatus > 0 && renderStatus > 0 && postStatus <= 0) {
        Serial.println("[DIAG] CONCLUSION: TLS/network path works; POST path fails (Case C).");
        Serial.println("[DIAG] Investigate HTTP POST/auth/backend behavior.");
    } else if (exStatus > 0 && renderStatus > 0 && postStatus > 0) {
        Serial.println("[DIAG] CONCLUSION: All tests pass (Case D). Original failure is");
        Serial.println("[DIAG] intermittent or timing/state dependent. Run the normal");
        Serial.println("[DIAG] firmware loop and verify actual Supabase telemetry rows.");
    } else {
        Serial.println("[DIAG] CONCLUSION: Unexpected result combination.");
    }
    Serial.println();
    Serial.println("[DIAG] ===== TLS DIAGNOSTIC SUITE COMPLETE =====\n");
}

// --- END TEMPORARY TLS DIAGNOSTICS ---

namespace {

// Transport selection follows the configured URL scheme so the documented dev
// fallback (plain HTTP through a tunnel or the Wokwi gateway, plan section 8 step 5 /
// R1) works without weakening HTTPS: HTTPS keeps the TLS discipline below
// (certificate verification ON unless the TLS_ALLOW_INSECURE test build flag is
// set); HTTP uses a plain client and no TLS flag applies.
struct DiagnosticHttpTransport {
    WiFiClient plain;
    DiagnosticSecureClient secure;
    bool tls = false;
};

bool beginRequest(HTTPClient& http, DiagnosticHttpTransport& transport, const String& endpoint) {
    transport.tls = endpoint.startsWith("https://");
    if (transport.tls) {
        // TLS discipline: certificate validation is bypassed ONLY under the
        // explicit test build flag (TLS_ALLOW_INSECURE), for tunnels whose
        // certificates cannot be validated by the ESP32 trust store. See config.h.
        if (TLS_INSECURE_ALLOWED) {
            transport.secure.setInsecure();
        } else {
            transport.secure.setCACert(API_ROOT_CA);
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
    DiagnosticHttpTransport transport;
    if (!beginRequest(http, transport, String(API_BASE_URL) + "/api/devices/heartbeat")) {
        Serial.println("API connection failed");
        return false;
    }
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");
#ifdef DEVICE_API_KEY
    // Write-gate: backend rejects unauthenticated writes with 401/403.
    if (strlen(DEVICE_API_KEY) > 0) {
        http.addHeader("X-API-Key", DEVICE_API_KEY);
    }
#endif

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
    DiagnosticHttpTransport transport;
    if (!beginRequest(http, transport, String(API_BASE_URL) + "/api/sensor-data")) {
        Serial.println("[HTTP] Failed to open connection to API.");
        return false;
    }
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.addHeader("Content-Type", "application/json");
#ifdef DEVICE_API_KEY
    // Write-gate: backend rejects unauthenticated writes with 401/403.
    if (strlen(DEVICE_API_KEY) > 0) {
        http.addHeader("X-API-Key", DEVICE_API_KEY);
    }
#endif

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
        // --- TEMPORARY TLS DIAGNOSTICS ---
        if (transport.tls) {
            char err_buf[128];
            int last_err = transport.secure.lastError(err_buf, sizeof(err_buf));
            Serial.printf("[DIAG] TLS error code: %d (0x%04X)\n", last_err, (unsigned int)(last_err & 0xFFFF));
            Serial.printf("[DIAG] mbedtls_strerror: %s\n", err_buf);
            Serial.printf("[DIAG] decoded: %s\n", _tls_diag_decode_error(last_err));
            Serial.printf("[DIAG] errno: %d\n", errno);
        }
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
