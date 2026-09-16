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

// Slow per-axis gravity estimates used to AC-couple the accelerometer signal.
// Static gravity is not vibration; only the varying (AC) component is converted
// to a vibration-velocity value. Initialized from the first sample so the first
// telemetry POST carries a sane ~0 mm/s value instead of a gravity artifact.
float gravX = 0.0f;
float gravY = 0.0f;
float gravZ = 0.0f;
bool gravityEstimated = false;
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

    const float ax = acceleration.acceleration.x;
    const float ay = acceleration.acceleration.y;
    const float az = acceleration.acceleration.z;
    if (!isfinite(ax) || !isfinite(ay) || !isfinite(az)) {
        return {0.0f, false};
    }

    if (!gravityEstimated) {
        gravX = ax;
        gravY = ay;
        gravZ = az;
        gravityEstimated = true;
    }
    // Slow EMA (per call at SENSOR_INTERVAL_MS) tracks gravity/orientation drift
    // while leaving real vibration frequencies in the AC component.
    gravX += GRAVITY_EMA_ALPHA * (ax - gravX);
    gravY += GRAVITY_EMA_ALPHA * (ay - gravY);
    gravZ += GRAVITY_EMA_ALPHA * (az - gravZ);

    const float acMagnitude = sqrtf(
        (ax - gravX) * (ax - gravX) +
        (ay - gravY) * (ay - gravY) +
        (az - gravZ) * (az - gravZ)
    );

    // Simulation calibration (documented in README.md): convert the AC
    // acceleration magnitude to a vibration-velocity RMS-scale value using a
    // fixed reference frequency, v[mm/s] = a[m/s^2] / (2*pi*f_ref) * 1000.
    // This is a simulation-calibration mapping, not a physical calibration claim.
    const float velocityMmS = (acMagnitude / (2.0f * PI * VIBRATION_REFERENCE_HZ)) * 1000.0f;
    return {velocityMmS, isfinite(velocityMmS)};
}

SensorReading readCurrent() {
    // Simulation calibration (documented in README.md): the Wokwi potentiometer
    // emulates a conditioned ACS712-style current signal. The 12-bit ADC span
    // (0..4095 counts) maps linearly onto 0..CURRENT_FULL_SCALE_A amperes, so the
    // value sent to the API is amperes, never raw ADC counts. Physical ACS712
    // voltage-to-current calibration belongs only in real-hardware integration.
    const int rawValue = analogRead(CURRENT_ANALOG_PIN);
    const float amps = (static_cast<float>(rawValue) / ADC_MAX_COUNTS) * CURRENT_FULL_SCALE_A;
    return {amps, rawValue >= 0 && isfinite(amps)};
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
