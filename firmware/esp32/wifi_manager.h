#ifndef PREDICT_IQ_WIFI_MANAGER_H
#define PREDICT_IQ_WIFI_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include "config.h"

// =============================================================================
// WI-FI CONNECTION MANAGER INTERFACE
// =============================================================================

void initWiFi();
bool isWiFiConnected();
void handleWiFiReconnect();
String getIPAddress();
int getWiFiRSSI();

#endif // PREDICT_IQ_WIFI_MANAGER_H
