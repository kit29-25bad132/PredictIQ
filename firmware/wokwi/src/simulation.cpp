#include "simulation.h"

#include <math.h>

#include "config.h"

namespace {
enum OperatingState : uint8_t {
    NORMAL_OPERATION,
    INCREASING_LOAD,
    MECHANICAL_IMBALANCE,
    OVERLOAD,
    CRITICAL_STRESS,
    RECOVERY,
};

uint32_t randomState = WOKWI_SIMULATION_SEED;
unsigned long startedAt = 0;
float thermalState = 29.0f;

float nextNoise(float amplitude) {
    // Deterministic LCG: repeatable demonstrations without full-range random data.
    randomState = randomState * 1664525UL + 1013904223UL;
    const float unit = static_cast<float>((randomState >> 8) & 0x00ffffffUL) / 16777215.0f;
    return (unit * 2.0f - 1.0f) * amplitude;
}

OperatingState currentState() {
    const unsigned long elapsed = millis() - startedAt;
    return static_cast<OperatingState>((elapsed / WOKWI_STATE_INTERVAL_MS) % 6UL);
}

const char* stateName(OperatingState state) {
    switch (state) {
        case NORMAL_OPERATION: return "NORMAL_OPERATION";
        case INCREASING_LOAD: return "INCREASING_LOAD";
        case MECHANICAL_IMBALANCE: return "MECHANICAL_IMBALANCE";
        case OVERLOAD: return "OVERLOAD";
        case CRITICAL_STRESS: return "CRITICAL_STRESS";
        case RECOVERY: return "RECOVERY";
    }
    return "UNKNOWN";
}
}

void initWokwiSimulation() {
    startedAt = millis();
    thermalState = 29.0f;
    randomState = WOKWI_SIMULATION_SEED;
}

bool dynamicSimulationEnabled() {
    return WOKWI_SIMULATION_MODE == WOKWI_SIMULATION_AUTOMATIC_DYNAMIC;
}

const char* wokwiOperatingState() {
    return stateName(currentState());
}

void readWokwiSimulation(SensorReading& temperature, SensorReading& vibration,
                         SensorReading& current, SensorReading& rpm) {
    const OperatingState state = currentState();
    float targetTemperature = 30.0f;
    float targetCurrent = 7.5f;
    float targetRpm = 1450.0f;
    float targetVibration = 1.1f;

    // Load is shared: higher current correlates with lower RPM and gradual heat.
    // Imbalance primarily raises vibration; the critical state raises all channels.
    switch (state) {
        case INCREASING_LOAD:
            targetTemperature = 40.0f; targetCurrent = 10.5f; targetRpm = 1425.0f; targetVibration = 1.8f; break;
        case MECHANICAL_IMBALANCE:
            targetTemperature = 48.0f; targetCurrent = 11.5f; targetRpm = 1400.0f; targetVibration = 4.8f; break;
        case OVERLOAD:
            targetTemperature = 62.0f; targetCurrent = 15.0f; targetRpm = 1360.0f; targetVibration = 3.7f; break;
        case CRITICAL_STRESS:
            targetTemperature = 82.0f; targetCurrent = 18.0f; targetRpm = 1280.0f; targetVibration = 8.2f; break;
        case RECOVERY:
            targetTemperature = 38.0f; targetCurrent = 8.0f; targetRpm = 1440.0f; targetVibration = 1.4f; break;
        case NORMAL_OPERATION:
        default:
            break;
    }

    // Thermal inertia keeps temperature from stepping unrealistically every 30s.
    thermalState += (targetTemperature - thermalState) * 0.22f;
    temperature = {thermalState + nextNoise(0.35f), true};
    vibration = {fmaxf(0.0f, targetVibration + nextNoise(0.22f)), true};
    current = {fmaxf(0.0f, targetCurrent + nextNoise(0.30f)), true};
    rpm = {fmaxf(0.0f, targetRpm + nextNoise(18.0f)), true};
}
