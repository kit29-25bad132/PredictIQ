#ifndef PREDICT_IQ_API_CLIENT_H
#define PREDICT_IQ_API_CLIENT_H

#include <Arduino.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sensors.h"
#include "wifi_manager.h"

// =============================================================================
// FASTAPI CLIENT INTERFACE (POSTGRESQL BACKEND)
// =============================================================================

bool sendHeartbeat(const TelemetrySnapshot& snapshot);
bool sendSensorTelemetry(const TelemetrySnapshot& snapshot);

#endif // PREDICT_IQ_API_CLIENT_H
