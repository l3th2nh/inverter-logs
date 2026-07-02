// ============================================================================
//  config.h - Cau hinh phan cung + register map + metric Solis S6 Hybrid
// ============================================================================
#pragma once
#include <Arduino.h>

// ---- SIM_MODE: 1 = du lieu Solis "gia" (khong dung RS485), de demo MQTT->HA
//      va test giai ma ma khong can day/dongle/bien tan.
//      0 = doc RS485 that (bench dongle, hoac Solis that che do master). ----
#define SIM_MODE 1

// ---- Thong tin thiet bi (hien trong Home Assistant) ----
#define DEVICE_ID    "inverterbridge_01"
#define DEVICE_NAME  "Inverter Bridge"
#define DEVICE_MODEL "Solis S6-EH1P"
#define MQTT_STATE_TOPIC     "inverterbridge/state"
#define MQTT_DISCOVERY_PREFIX "homeassistant"

// ---- Chan UART noi XY-S485 (dung UART2 cua ESP32) ----
static const int PIN_RS485_RX = 16;   // ESP32 RX2  <- XY-S485 TXD
static const int PIN_RS485_TX = 17;   // ESP32 TX2  -> XY-S485 RXD

// ---- Thong so Modbus (Solis S6 Hybrid) ----
static const uint32_t MODBUS_BAUD     = 9600;
static const uint8_t  MODBUS_SLAVE_ID = 1;
static const uint32_t POLL_INTERVAL_MS = 3000;   // chu ky doc + publish

// ---- Cach danh dia chi thanh ghi (xem README) ----
static const uint16_t REG_OFFSET_MODBUS = 30001; // convention A (Modbus chuan)
static const uint16_t REG_OFFSET_RAW    = 0;     // convention B (gui thang 33xxx)

// ---- Thu tu word cho so 32-bit (Solis: dia chi thap = word cao) ----
static const bool REG32_LOW_ADDR_IS_HIGH_WORD = true;

// ---- Kieu du lieu thanh ghi ----
enum RegType { U16, S16, U32, S32 };

struct RegDef {
  const char* key;          // khoa may (snake_case) cho MQTT/HA
  const char* name;         // ten hien thi
  uint16_t    doc_reg;      // so thanh ghi theo tai lieu (33xxx)
  uint8_t     count;        // 1 = 16-bit, 2 = 32-bit
  RegType     type;
  float       scale;
  const char* unit;         // don vi (HA)
  const char* device_class; // HA device_class ("" = bo qua)
  const char* state_class;  // "measurement" | "total_increasing"
};

// Register map + metadata HA (nguon: home_assistant_solarman/solis_hybrid.yaml)
static const RegDef SOLIS_REGS[] = {
  // key,                  ten,                    reg,   cnt,type, scale, unit,    device_class,  state_class
  {"battery_soc",          "Battery SOC",          33139, 1, U16, 1.0f,  "%",     "battery",     "measurement"},
  {"battery_soh",          "Battery SOH",          33140, 1, U16, 1.0f,  "%",     "",            "measurement"},
  {"battery_voltage",      "Battery Voltage",      33133, 1, U16, 0.1f,  "V",     "voltage",     "measurement"},
  {"battery_current",      "Battery Current",      33134, 1, S16, 0.1f,  "A",     "current",     "measurement"},
  {"battery_power",        "Battery Power",        33149, 2, S32, 1.0f,  "W",     "power",       "measurement"},
  {"grid_power",           "Grid Power",           33257, 2, S32, 1.0f,  "W",     "power",       "measurement"},
  {"meter_frequency",      "Grid Frequency",       33282, 1, U16, 0.01f, "Hz",    "frequency",   "measurement"},
  {"pv1_voltage",          "PV1 Voltage",          33049, 1, U16, 0.1f,  "V",     "voltage",     "measurement"},
  {"pv2_voltage",          "PV2 Voltage",          33051, 1, U16, 0.1f,  "V",     "voltage",     "measurement"},
  {"pv_power",             "PV Power",             33057, 2, S32, 1.0f,  "W",     "power",       "measurement"},
  {"house_load_power",     "House Load Power",     33147, 1, U16, 1.0f,  "W",     "power",       "measurement"},
  {"inverter_ac_power",    "Inverter AC Power",    33151, 2, S32, 1.0f,  "W",     "power",       "measurement"},
  {"inverter_temperature", "Inverter Temperature", 33093, 1, S16, 0.1f,  "\xC2\xB0" "C", "temperature", "measurement"},
  {"daily_generation",     "Daily Generation",     33035, 1, U16, 0.1f,  "kWh",   "energy",      "total_increasing"},
  {"total_generation",     "Total Generation",     33029, 2, U32, 1.0f,  "kWh",   "energy",      "total_increasing"},
  {"total_imported",       "Total Imported",       33169, 2, U32, 1.0f,  "kWh",   "energy",      "total_increasing"},
  {"total_battery_charge", "Total Battery Charge", 33161, 2, U32, 1.0f,  "kWh",   "energy",      "total_increasing"},
};
static const size_t SOLIS_REGS_COUNT = sizeof(SOLIS_REGS) / sizeof(SOLIS_REGS[0]);

static const uint16_t PROBE_REG_SOC = 33139;

// ---- Gia tri Solis "gia" cho SIM_MODE (gia tri ky thuat) ----
struct SimVal { uint16_t doc_reg; double value; };
static const SimVal SIM_VALUES[] = {
  {33139,   87.0}, {33140,   98.0}, {33133,   53.2}, {33134,  -12.5},
  {33149, -665.0}, {33257, -420.0}, {33282,   50.01},{33049,  310.5},
  {33051,  305.2}, {33057, 2150.0}, {33147,  640.0}, {33151, 1730.0},
  {33093,   38.5}, {33035,   12.3}, {33029, 8421.0}, {33169, 1503.0},
  {33161, 2044.0},
};
static const size_t SIM_VALUES_COUNT = sizeof(SIM_VALUES) / sizeof(SIM_VALUES[0]);
