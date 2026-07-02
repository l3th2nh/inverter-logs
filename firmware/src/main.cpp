// ============================================================================
//  main.cpp - InverterLogs: doc Solis -> MQTT -> Home Assistant (auto-discovery)
// ============================================================================
//  SIM_MODE=1: dung du lieu Solis "gia" (khong can RS485) -> demo len HA ngay.
//  SIM_MODE=0: doc RS485 that (che do MASTER) - dung khi bench voi dongle.
//  (Che do SNIFFER passive cho Solis that se them o buoc sau.)
//
//  Luong: WiFi -> MQTT (Mosquitto) -> publish discovery 1 lan -> vong lap
//         doc metric (SIM/Modbus) -> in Serial + publish JSON state.
// ============================================================================
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ModbusMaster.h>
#include <math.h>
#include "config.h"
#include "app_config.h"
#include "portal.h"

static const int PIN_BOOT_BTN = 0;   // nut BOET/GPIO0: giu ~2s luc khoi dong -> vao portal

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);
ModbusMaster node;

static uint16_t g_reg_offset = REG_OFFSET_MODBUS;
static bool     g_offset_locked = false;

// -------------------- Doc/giai ma metric --------------------
static uint32_t combine32(uint16_t lowAddrWord, uint16_t highAddrWord) {
  uint16_t hi = REG32_LOW_ADDR_IS_HIGH_WORD ? lowAddrWord : highAddrWord;
  uint16_t lo = REG32_LOW_ADDR_IS_HIGH_WORD ? highAddrWord : lowAddrWord;
  return ((uint32_t)hi << 16) | lo;
}

#if SIM_MODE
static double simBase(uint16_t doc_reg) {
  for (size_t j = 0; j < SIM_VALUES_COUNT; j++)
    if (SIM_VALUES[j].doc_reg == doc_reg) return SIM_VALUES[j].value;
  return 0.0;
}
#else
static bool readInputRegs(uint16_t doc_reg, uint8_t count, uint16_t* out) {
  uint16_t wire_addr = doc_reg - g_reg_offset;
  uint8_t rc = node.readInputRegisters(wire_addr, count);
  if (rc != node.ku8MBSuccess) return false;
  for (uint8_t i = 0; i < count; i++) out[i] = node.getResponseBuffer(i);
  return true;
}
static bool decodeReg(const RegDef& r, double& value) {
  uint16_t raw[2] = {0, 0};
  if (!readInputRegs(r.doc_reg, r.count, raw)) return false;
  switch (r.type) {
    case U16: value = (double)raw[0] * r.scale; break;
    case S16: value = (double)(int16_t)raw[0] * r.scale; break;
    case U32: value = (double)combine32(raw[0], raw[1]) * r.scale; break;
    case S32: value = (double)(int32_t)combine32(raw[0], raw[1]) * r.scale; break;
  }
  return true;
}
static int readSocWithOffset(uint16_t offset) {
  uint8_t rc = node.readInputRegisters(PROBE_REG_SOC - offset, 1);
  if (rc != node.ku8MBSuccess) return -1;
  return (int)node.getResponseBuffer(0);
}
static void probeAddressing() {
  int socA = readSocWithOffset(REG_OFFSET_MODBUS);
  delay(50);
  int socB = readSocWithOffset(REG_OFFSET_RAW);
  Serial.printf("[PROBE] SOC offsetA=%d rawB=%d\n", socA, socB);
  if (socA >= 0 && socA <= 100)      { g_reg_offset = REG_OFFSET_MODBUS; g_offset_locked = true; }
  else if (socB >= 0 && socB <= 100) { g_reg_offset = REG_OFFSET_RAW;    g_offset_locked = true; }
  else { g_offset_locked = false; Serial.println(F("[PROBE] khong doc duoc - kiem tra A/B, slave, 3V3, cheo TX/RX")); }
}
#endif

// Doc toan bo metric -> values[], ok[]. SIM: gia tri gia co dao dong nhe.
static void readAllMetrics(double values[], bool ok[]) {
  double t = millis() / 1000.0;
  for (size_t i = 0; i < SOLIS_REGS_COUNT; i++) {
    const RegDef& r = SOLIS_REGS[i];
#if SIM_MODE
    double v = simBase(r.doc_reg);
    if (strcmp(r.state_class, "measurement") == 0)  // dao dong +-6% cho do thi HA nhay
      v *= (1.0 + 0.06 * sin(t * 0.5 + (double)i));
    values[i] = v; ok[i] = true;
#else
    ok[i] = decodeReg(r, values[i]);
#endif
  }
}

// -------------------- MQTT / Home Assistant auto-discovery --------------------
static void publishDiscovery() {
  char topic[128], payload[512], devcla[48];
  for (size_t i = 0; i < SOLIS_REGS_COUNT; i++) {
    const RegDef& r = SOLIS_REGS[i];
    snprintf(topic, sizeof(topic), "%s/sensor/%s/%s/config",
             MQTT_DISCOVERY_PREFIX, DEVICE_ID, r.key);
    devcla[0] = 0;
    if (r.device_class[0]) snprintf(devcla, sizeof(devcla), ",\"dev_cla\":\"%s\"", r.device_class);
    snprintf(payload, sizeof(payload),
      "{\"name\":\"%s\",\"uniq_id\":\"%s_%s\",\"obj_id\":\"ib_%s\",\"stat_t\":\"%s\","
      "\"val_tpl\":\"{{ value_json.%s }}\",\"unit_of_meas\":\"%s\",\"stat_cla\":\"%s\"%s,"
      "\"dev\":{\"ids\":[\"%s\"],\"name\":\"%s\",\"mdl\":\"%s\",\"mf\":\"DIY\"}}",
      r.name, DEVICE_ID, r.key, r.key, MQTT_STATE_TOPIC,
      r.key, r.unit, r.state_class, devcla,
      DEVICE_ID, DEVICE_NAME, DEVICE_MODEL);
    mqtt.publish(topic, payload, true);   // retained
    delay(20);
  }
  Serial.printf("[MQTT] Da publish discovery cho %u sensor\n", (unsigned)SOLIS_REGS_COUNT);
}

static void publishState(double values[], bool ok[]) {
  char payload[640];
  int n = snprintf(payload, sizeof(payload), "{");
  bool first = true;
  for (size_t i = 0; i < SOLIS_REGS_COUNT; i++) {
    if (!ok[i]) continue;
    n += snprintf(payload + n, sizeof(payload) - n, "%s\"%s\":%.2f",
                  first ? "" : ",", SOLIS_REGS[i].key, values[i]);
    first = false;
  }
  snprintf(payload + n, sizeof(payload) - n, "}");
  mqtt.publish(MQTT_STATE_TOPIC, payload);
}

static void mqttReconnect() {
  while (!mqtt.connected()) {
    Serial.print(F("[MQTT] Ket noi... "));
    if (mqtt.connect(DEVICE_ID, g_cfg.mqtt_user, g_cfg.mqtt_pass)) {
      Serial.println(F("OK"));
      publishDiscovery();
    } else {
      Serial.printf("that bai rc=%d, thu lai sau 3s\n", mqtt.state());
      delay(3000);
    }
  }
}

static void wifiConnect() {
  Serial.printf("[WiFi] Ket noi %s ...\n", g_cfg.wifi_ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(g_cfg.wifi_ssid, g_cfg.wifi_pass);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 30000) { delay(500); Serial.print('.'); }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\n[WiFi] OK, IP = %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println(F("\n[WiFi] THAT BAI - kiem tra secrets.h"));
}

// -------------------- setup / loop --------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(F("\n==== InverterLogs - Solis -> MQTT -> Home Assistant ===="));
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);   // nut BOOT: giu 2s LUC DANG CHAY -> portal

  appConfigBegin();
  if (!g_cfg.configured) {
    Serial.println(F("[cfg] Chua cau hinh -> vao CAPTIVE PORTAL"));
    startPortal();   // blocking: luu xong se ESP.restart()
  }
  Serial.printf("[cfg] brand=%s model=%s mqtt=%s:%u\n",
                g_cfg.brand, g_cfg.model, g_cfg.mqtt_host, g_cfg.mqtt_port);

#if SIM_MODE
  Serial.println(F(">>> SIM_MODE = 1: du lieu Solis GIA <<<"));
#else
  Serial2.begin(MODBUS_BAUD, SERIAL_8N1, PIN_RS485_RX, PIN_RS485_TX);
  node.begin(MODBUS_SLAVE_ID, Serial2);
  probeAddressing();
#endif
  wifiConnect();
  mqtt.setServer(g_cfg.mqtt_host, g_cfg.mqtt_port);
  mqtt.setBufferSize(1024);   // du cho payload discovery
}

// Giu nut BOOT (GPIO0) >=2s LUC DANG CHAY -> vao portal cau hinh.
static void checkPortalButton() {
  static uint32_t downSince = 0;
  if (digitalRead(PIN_BOOT_BTN) == LOW) {
    if (downSince == 0) downSince = millis();
    else if (millis() - downSince > 2000) {
      Serial.println(F("[BOOT] Giu 2s -> vao CAPTIVE PORTAL"));
      startPortal();   // blocking: luu xong se ESP.restart()
    }
  } else downSince = 0;
}

void loop() {
  checkPortalButton();                 // poll nhanh de bat nut giu 2s
  if (WiFi.status() != WL_CONNECTED) wifiConnect();
  if (!mqtt.connected()) mqttReconnect();
  mqtt.loop();

#if !SIM_MODE
  if (!g_offset_locked) { probeAddressing(); delay(1000); return; }
#endif

  static uint32_t lastPub = 0;         // publish moi POLL_INTERVAL_MS (non-blocking)
  if (millis() - lastPub >= POLL_INTERVAL_MS) {
    lastPub = millis();
    double values[SOLIS_REGS_COUNT];
    bool   ok[SOLIS_REGS_COUNT];
    readAllMetrics(values, ok);
    publishState(values, ok);
    int good = 0; for (size_t i = 0; i < SOLIS_REGS_COUNT; i++) good += ok[i];
    Serial.printf("[state] %d/%u metric | SOC=%.0f%% PV=%.0fW Grid=%.0fW Batt=%.0fW\n",
                  good, (unsigned)SOLIS_REGS_COUNT, values[0], values[9], values[5], values[4]);
  }
  delay(20);                           // vong lap nhanh -> nut nhay
}
