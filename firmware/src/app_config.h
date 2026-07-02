// ============================================================================
//  app_config.h - Cau hinh nguoi dung (WiFi + inverter + MQTT), luu vao NVS
// ============================================================================
#pragma once
#include <Arduino.h>

struct AppConfig {
  char wifi_ssid[33];
  char wifi_pass[65];
  char brand[16];        // solis | deye | growatt | lux | custom
  char model[40];        // dong may (chon tu list theo brand)
  char custom_name[40];  // khi brand=custom hoac model ngoai list
  char mqtt_host[40];
  uint16_t mqtt_port;
  char mqtt_user[33];
  char mqtt_pass[33];
  bool configured;       // da cau hinh xong chua
};

extern AppConfig g_cfg;

void appConfigBegin();           // load tu NVS (+ seed mac dinh neu bat co)
void appConfigSave();            // luu g_cfg vao NVS
void appConfigFactoryReset();    // xoa cau hinh (ve trang thai chua cau hinh)
