#ifndef PREDICT_IQ_WOKWI_WIFI_MANAGER_H
#define PREDICT_IQ_WOKWI_WIFI_MANAGER_H

#include <Arduino.h>

void initWiFi();
void maintainWiFi();
bool isWiFiConnected();
bool isTimeSynchronized();
String currentUtcTimestamp();

#endif
