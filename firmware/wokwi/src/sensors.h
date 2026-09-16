#ifndef PREDICT_IQ_WOKWI_SENSORS_H
#define PREDICT_IQ_WOKWI_SENSORS_H

#include <Arduino.h>

struct SensorReading {
    float value;
    bool valid;
};

void initSensors();
SensorReading readTemperature();
SensorReading readVibration();
SensorReading readCurrent();
SensorReading readRPM();

#endif
