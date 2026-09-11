#include "sensors.h"

// =============================================================================
// SENSOR STATUS STRING MAPPING
// =============================================================================

const char* sensorStatusToString(SensorStatus status) {
    switch (status) {
        case SENSOR_CONNECTED:
            return "CONNECTED";
        case SENSOR_DISCONNECTED:
            return "DISCONNECTED";
        case SENSOR_ERROR:
            return "ERROR";
        case SENSOR_NOT_CONFIGURED:
        default:
            return "NOT_CONFIGURED";
    }
}

// =============================================================================
// SENSOR HARDWARE INITIALIZATION
// =============================================================================

void initSensors() {
    Serial.println("[SENSORS] Initializing physical sensor hardware interfaces...");

    // 1. Temperature Hardware Initialization Hook (e.g. DallasTemperature / OneWire / I2C)
    // #if defined(PIN_TEMP_ONEWIRE)
    //   oneWire.begin(PIN_TEMP_ONEWIRE);
    //   tempSensors.begin();
    //   Serial.println("[SENSORS] Temperature sensor initialized on OneWire pin.");
    // #else
    Serial.println("[SENSORS] Temperature sensor: NOT CONFIGURED (Hardware pin unassigned)");
    // #endif

    // 2. Vibration Hardware Initialization Hook (e.g. Wire.begin() for MPU6050)
    // #if defined(PIN_VIB_ANALOG) || defined(MPU6050_I2C)
    //   Wire.begin(21, 22);
    //   Serial.println("[SENSORS] Vibration accelerometer bus initialized.");
    // #else
    Serial.println("[SENSORS] Vibration sensor: NOT CONFIGURED (Hardware pin unassigned)");
    // #endif

    // 3. Current Sensor Initialization Hook (e.g. ADC attenuation config)
    // #if defined(PIN_CURRENT_ADC)
    //   analogSetPinAttenuation(PIN_CURRENT_ADC, ADC_11db);
    //   Serial.println("[SENSORS] Current sensor ADC initialized.");
    // #else
    Serial.println("[SENSORS] Current sensor: NOT CONFIGURED (Hardware pin unassigned)");
    // #endif

    // 4. Tachometer / RPM Pulse Counter Hook (e.g. Interrupt attachment)
    // #if defined(PIN_RPM_INTERRUPT)
    //   pinMode(PIN_RPM_INTERRUPT, INPUT_PULLUP);
    //   attachInterrupt(digitalPinToInterrupt(PIN_RPM_INTERRUPT), onRpmPulseISR, RISING);
    //   Serial.println("[SENSORS] RPM tachometer interrupt initialized.");
    // #else
    Serial.println("[SENSORS] RPM sensor: NOT CONFIGURED (Hardware pin unassigned)");
    // #endif

    Serial.println("[SENSORS] Sensor interface ready. Only real physical measurements will be transmitted.");
}

// =============================================================================
// 1. TEMPERATURE SENSOR INTERFACE
// =============================================================================
SensorReadingResult readTemperature() {
    SensorReadingResult result;
    
    // Hardware Hook Example:
    // When DS18B20 / PT100 / MAX6675 is physically connected, uncomment implementation:
    /*
    tempSensors.requestTemperatures();
    float tempC = tempSensors.getTempCByIndex(0);
    if (tempC == DEVICE_DISCONNECTED_C) {
        result.value = 0.0f;
        result.has_value = false;
        result.status = SENSOR_DISCONNECTED;
        return result;
    }
    if (tempC < -50.0f || tempC > 300.0f) {
        result.value = 0.0f;
        result.has_value = false;
        result.status = SENSOR_ERROR;
        return result;
    }
    result.value = tempC;
    result.has_value = true;
    result.status = SENSOR_CONNECTED;
    return result;
    */

    // Physical sensor not attached: report NOT_CONFIGURED with no numeric fabrication
    result.value = 0.0f;
    result.has_value = false;
    result.status = SENSOR_NOT_CONFIGURED;
    return result;
}

// =============================================================================
// 2. VIBRATION VELOCITY RMS SENSOR INTERFACE
// =============================================================================
SensorReadingResult readVibration() {
    SensorReadingResult result;

    // Hardware Hook Example:
    // When MPU6050 / ADXL345 / Piezo sensor is physically connected:
    /*
    int16_t ax, ay, az;
    mpu.getAcceleration(&ax, &ay, &az);
    float rawG = sqrt(pow(ax/16384.0, 2) + pow(ay/16384.0, 2) + pow(az/16384.0, 2));
    float vibRms = rawG * 9.81 * 100.0; // mm/s conversion
    result.value = vibRms;
    result.has_value = true;
    result.status = SENSOR_CONNECTED;
    return result;
    */

    // Physical sensor not attached: report NOT_CONFIGURED without mock numbers
    result.value = 0.0f;
    result.has_value = false;
    result.status = SENSOR_NOT_CONFIGURED;
    return result;
}

// =============================================================================
// 3. PHASE CURRENT SENSOR INTERFACE
// =============================================================================
SensorReadingResult readCurrent() {
    SensorReadingResult result;

    // Hardware Hook Example:
    // When ACS712-20A or SCT-013 CT clamp is physically connected:
    /*
    int rawAdc = analogRead(PIN_CURRENT_ADC);
    float voltage = (rawAdc / 4095.0f) * 3.3f;
    float currentAmps = abs((voltage - 1.65f) / 0.100f); // 100mV/A sensitivity
    result.value = currentAmps;
    result.has_value = true;
    result.status = SENSOR_CONNECTED;
    return result;
    */

    // Physical sensor not attached: report NOT_CONFIGURED without mock numbers
    result.value = 0.0f;
    result.has_value = false;
    result.status = SENSOR_NOT_CONFIGURED;
    return result;
}

// =============================================================================
// 4. ROTATIONAL SPEED (RPM) SENSOR INTERFACE
// =============================================================================
SensorReadingResult readRPM() {
    SensorReadingResult result;

    // Hardware Hook Example:
    // When optical / Hall-effect sensor is attached to interrupt pin:
    /*
    noInterrupts();
    unsigned int pulses = pulseCount;
    pulseCount = 0;
    interrupts();
    float calculatedRpm = (pulses * 60.0f); // 1 pulse/rev
    result.value = calculatedRpm;
    result.has_value = true;
    result.status = SENSOR_CONNECTED;
    return result;
    */

    // Physical sensor not attached: report NOT_CONFIGURED without mock numbers
    result.value = 0.0f;
    result.has_value = false;
    result.status = SENSOR_NOT_CONFIGURED;
    return result;
}

// =============================================================================
// AGGREGATE SAMPLER
// =============================================================================
TelemetrySnapshot sampleAllSensors() {
    TelemetrySnapshot snapshot;
    snapshot.temperature = readTemperature();
    snapshot.vibration   = readVibration();
    snapshot.current     = readCurrent();
    snapshot.rpm         = readRPM();

    snapshot.has_any_numeric_reading = (
        snapshot.temperature.has_value ||
        snapshot.vibration.has_value ||
        snapshot.current.has_value ||
        snapshot.rpm.has_value
    );

    return snapshot;
}
