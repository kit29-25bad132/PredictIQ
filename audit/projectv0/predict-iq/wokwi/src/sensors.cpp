#include "sensors.h"

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <Wire.h>
#include <math.h>

#include "config.h"

namespace {
OneWire oneWire(DS18B20_PIN);
DallasTemperature temperatureSensor(&oneWire);
Adafruit_MPU6050 mpu;
volatile unsigned long pulseCount = 0;
unsigned long lastRpmSampleMicros = 0;

void IRAM_ATTR onPulse() {
    ++pulseCount;
}
}

void initSensors() {
    Serial.println("[SENSORS] Initializing Wokwi sensor components...");

    temperatureSensor.begin();
    Serial.println("[SENSORS] DS18B20 ready on GPIO 4.");

    Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
    if (!mpu.begin()) {
        Serial.println("[SENSORS] MPU6050 initialization failed.");
    } else {
        mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
        mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
        Serial.println("[SENSORS] MPU6050 ready on I2C GPIO 8/9.");
    }

    analogReadResolution(12);
    pinMode(CURRENT_ANALOG_PIN, INPUT);
    Serial.println("[SENSORS] Wokwi analog current input ready on GPIO 1.");

    pinMode(RPM_PULSE_PIN, INPUT_PULLDOWN);
    attachInterrupt(digitalPinToInterrupt(RPM_PULSE_PIN), onPulse, RISING);
    lastRpmSampleMicros = micros();
    Serial.println("[SENSORS] Wokwi pulse input ready on GPIO 18.");
}

SensorReading readTemperature() {
    temperatureSensor.requestTemperatures();
    const float value = temperatureSensor.getTempCByIndex(0);
    const bool valid = value != DEVICE_DISCONNECTED_C && isfinite(value) && value >= -55.0f && value <= 125.0f;
    return {value, valid};
}

SensorReading readVibration() {
    sensors_event_t acceleration;
    sensors_event_t gyro;
    sensors_event_t temperature;
    mpu.getEvent(&acceleration, &gyro, &temperature);

    const float magnitude = sqrtf(
        acceleration.acceleration.x * acceleration.acceleration.x +
        acceleration.acceleration.y * acceleration.acceleration.y +
        acceleration.acceleration.z * acceleration.acceleration.z
    );
    return {magnitude, isfinite(magnitude)};
}

SensorReading readCurrent() {
    // This is the raw Wokwi analog representation of an ACS712 output.
    // Real ACS712 voltage-to-amp calibration belongs in this function later.
    const int rawValue = analogRead(CURRENT_ANALOG_PIN);
    return {static_cast<float>(rawValue), rawValue >= 0};
}

SensorReading readRPM() {
    const unsigned long now = micros();
    const unsigned long elapsed = now - lastRpmSampleMicros;
    if (elapsed == 0) {
        return {0.0f, false};
    }

    noInterrupts();
    const unsigned long pulses = pulseCount;
    pulseCount = 0;
    interrupts();
    lastRpmSampleMicros = now;

    const float seconds = static_cast<float>(elapsed) / 1000000.0f;
    const float rpm = (static_cast<float>(pulses) / seconds * 60.0f) / static_cast<float>(PULSES_PER_REVOLUTION);
    return {rpm, isfinite(rpm)};
}
