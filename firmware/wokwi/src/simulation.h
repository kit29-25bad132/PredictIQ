#ifndef PREDICT_IQ_WOKWI_SIMULATION_H
#define PREDICT_IQ_WOKWI_SIMULATION_H

#include "sensors.h"

// Generates labelled Wokwi-only operating conditions. It never runs in the
// physical ESP32 firmware directory and never changes telemetry provenance.
void initWokwiSimulation();
bool dynamicSimulationEnabled();
const char* wokwiOperatingState();
void readWokwiSimulation(SensorReading& temperature, SensorReading& vibration,
                         SensorReading& current, SensorReading& rpm);

#endif
