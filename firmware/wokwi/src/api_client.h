#ifndef PREDICT_IQ_WOKWI_API_CLIENT_H
#define PREDICT_IQ_WOKWI_API_CLIENT_H

#include "sensors.h"

bool sendTelemetry(const SensorReading& temperature, const SensorReading& vibration, const SensorReading& current, const SensorReading& rpm);
bool sendHeartbeat();
void runTlsDiagnostics();

#endif
