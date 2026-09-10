#ifndef PREDICT_IQ_SENSORS_H
#define PREDICT_IQ_SENSORS_H

#include <Arduino.h>
#include "config.h"

// =============================================================================
// SENSOR STATUS ENUMERATION & RESULT STRUCTURES
// =============================================================================

enum SensorStatus {
    SENSOR_CONNECTED,       // Physical sensor verified and producing valid readings
    SENSOR_DISCONNECTED,    // Configured pin/bus has no response / wire unplugged
    SENSOR_ERROR,          // Hardware communication error or reading out of bounds
    SENSOR_NOT_CONFIGURED   // Physical hardware component not yet wired/enabled
};

// Represents an individual sensor measurement or unconfigured state
struct SensorReadingResult {
    float value;            // Measurement value (only valid if has_value == true)
    bool has_value;         // True if valid numeric reading acquired, false if null
    SensorStatus status;    // Hardware availability state
};

// Aggregated telemetry package representing all 4 industrial channels
struct TelemetrySnapshot {
    SensorReadingResult temperature;
    SensorReadingResult vibration;
    SensorReadingResult current;
    SensorReadingResult rpm;
    bool has_any_numeric_reading;
};

// Helper to convert SensorStatus enum to API-compliant JSON string
const char* sensorStatusToString(SensorStatus status);

// Core Sensor Lifecycle Functions
void initSensors();
SensorReadingResult readTemperature();
SensorReadingResult readVibration();
SensorReadingResult readCurrent();
SensorReadingResult readRPM();
TelemetrySnapshot sampleAllSensors();

#endif // PREDICT_IQ_SENSORS_H
