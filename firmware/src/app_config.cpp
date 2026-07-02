// ============================================================================
//  app_config.cpp - Luu/doc cau hinh trong NVS (Preferences)
// ============================================================================
#include "app_config.h"
#include <Preferences.h>
#include "config.h"
#include "secrets.h"

// PORTAL_SEED_DEFAULTS=1: neu chua cau hinh, nap gia tri tu secrets.h va coi
// nhu da cau hinh (de thiet bi chay ngay khi dev, khoi phai qua portal moi lan
// nap). Dat 0 de ep di qua portal o lan dau (hanh vi san pham that).
#ifndef PORTAL_SEED_DEFAULTS
#define PORTAL_SEED_DEFAULTS 1
#endif

AppConfig g_cfg;
static Preferences prefs;
static const char* NS = "invbridge";

static void cpy(char* dst, size_t n, const String& s) {
  strlcpy(dst, s.c_str(), n);
}

void appConfigSave() {
  prefs.begin(NS, false);
  prefs.putString("wifi_ssid", g_cfg.wifi_ssid);
  prefs.putString("wifi_pass", g_cfg.wifi_pass);
  prefs.putString("brand",     g_cfg.brand);
  prefs.putString("model",     g_cfg.model);
  prefs.putString("cname",     g_cfg.custom_name);
  prefs.putString("mqtt_host", g_cfg.mqtt_host);
  prefs.putUShort("mqtt_port", g_cfg.mqtt_port);
  prefs.putString("mqtt_user", g_cfg.mqtt_user);
  prefs.putString("mqtt_pass", g_cfg.mqtt_pass);
  prefs.putBool("configured",  g_cfg.configured);
  prefs.end();
}

void appConfigFactoryReset() {
  prefs.begin(NS, false);
  prefs.clear();
  prefs.end();
  g_cfg.configured = false;
}

static void seedFromSecrets() {
  cpy(g_cfg.wifi_ssid, sizeof(g_cfg.wifi_ssid), WIFI_SSID);
  cpy(g_cfg.wifi_pass, sizeof(g_cfg.wifi_pass), WIFI_PASS);
  cpy(g_cfg.brand,     sizeof(g_cfg.brand),     "solis");
  cpy(g_cfg.model,     sizeof(g_cfg.model),     DEVICE_MODEL);
  g_cfg.custom_name[0] = 0;
  cpy(g_cfg.mqtt_host, sizeof(g_cfg.mqtt_host), MQTT_HOST);
  g_cfg.mqtt_port = MQTT_PORT;
  cpy(g_cfg.mqtt_user, sizeof(g_cfg.mqtt_user), MQTT_USER);
  cpy(g_cfg.mqtt_pass, sizeof(g_cfg.mqtt_pass), MQTT_PASS);
  g_cfg.configured = true;
}

void appConfigBegin() {
  memset(&g_cfg, 0, sizeof(g_cfg));
  prefs.begin(NS, true);   // read-only
  g_cfg.configured = prefs.getBool("configured", false);
  if (g_cfg.configured) {
    cpy(g_cfg.wifi_ssid, sizeof(g_cfg.wifi_ssid), prefs.getString("wifi_ssid", ""));
    cpy(g_cfg.wifi_pass, sizeof(g_cfg.wifi_pass), prefs.getString("wifi_pass", ""));
    cpy(g_cfg.brand,     sizeof(g_cfg.brand),     prefs.getString("brand", "solis"));
    cpy(g_cfg.model,     sizeof(g_cfg.model),     prefs.getString("model", ""));
    cpy(g_cfg.custom_name, sizeof(g_cfg.custom_name), prefs.getString("cname", ""));
    cpy(g_cfg.mqtt_host, sizeof(g_cfg.mqtt_host), prefs.getString("mqtt_host", MQTT_HOST));
    g_cfg.mqtt_port = prefs.getUShort("mqtt_port", MQTT_PORT);
    cpy(g_cfg.mqtt_user, sizeof(g_cfg.mqtt_user), prefs.getString("mqtt_user", ""));
    cpy(g_cfg.mqtt_pass, sizeof(g_cfg.mqtt_pass), prefs.getString("mqtt_pass", ""));
  }
  prefs.end();

#if PORTAL_SEED_DEFAULTS
  if (!g_cfg.configured) {
    Serial.println(F("[cfg] Chua cau hinh -> seed tu secrets.h (PORTAL_SEED_DEFAULTS=1)"));
    seedFromSecrets();
    appConfigSave();
  }
#endif
}
