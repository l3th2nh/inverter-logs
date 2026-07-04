"""Đọc biến tần Solis qua Modbus TCP (que WiFi datalogger) — nguồn dữ liệu native.

Không cần ESP32/RS485/MQTT: que WiFi stick của Solis mở Modbus TCP trên LAN.
Quy ước đã kiểm chứng LIVE (pymodbus, 2026-07-04):
  - FC04 (input register), ĐỊA CHỈ = số thanh ghi RAW theo tài liệu (33xxx),
    KHÔNG trừ offset 30001; slave/unit id = 1.
  - Số 32-bit: địa chỉ thấp = word cao (big-endian) → (reg[0]<<16)|reg[1].
Register map + metadata trùng firmware/src/config.h (nguồn: home_assistant_solarman).
"""
from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.components.sensor import SensorDeviceClass, SensorStateClass
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

_LOGGER = logging.getLogger(__name__)

DEFAULT_HOST = "192.168.0.89"
DEFAULT_PORT = 502
SLAVE_ID = 1
UPDATE_INTERVAL = timedelta(seconds=15)

# key, tên, doc_reg, count(1=16b/2=32b), type, scale, unit, device_class, state_class
_M = SensorStateClass.MEASUREMENT
_T = SensorStateClass.TOTAL_INCREASING
REGISTERS = [
    ("battery_soc",          "Battery SOC",          33139, 1, "U16", 1.0,  "%",   SensorDeviceClass.BATTERY,     _M),
    ("battery_soh",          "Battery SOH",          33140, 1, "U16", 1.0,  "%",   None,                          _M),
    ("battery_voltage",      "Battery Voltage",      33133, 1, "U16", 0.1,  "V",   SensorDeviceClass.VOLTAGE,     _M),
    ("battery_current",      "Battery Current",      33134, 1, "S16", 0.1,  "A",   SensorDeviceClass.CURRENT,     _M),
    ("battery_power",        "Battery Power",        33149, 2, "S32", 1.0,  "W",   SensorDeviceClass.POWER,       _M),
    ("grid_power",           "Grid Power",           33257, 2, "S32", 1.0,  "W",   SensorDeviceClass.POWER,       _M),
    ("meter_frequency",      "Grid Frequency",       33282, 1, "U16", 0.01, "Hz",  SensorDeviceClass.FREQUENCY,   _M),
    ("pv1_voltage",          "PV1 Voltage",          33049, 1, "U16", 0.1,  "V",   SensorDeviceClass.VOLTAGE,     _M),
    ("pv2_voltage",          "PV2 Voltage",          33051, 1, "U16", 0.1,  "V",   SensorDeviceClass.VOLTAGE,     _M),
    ("pv_power",             "PV Power",             33057, 2, "S32", 1.0,  "W",   SensorDeviceClass.POWER,       _M),
    ("house_load_power",     "House Load Power",     33147, 1, "U16", 1.0,  "W",   SensorDeviceClass.POWER,       _M),
    ("inverter_ac_power",    "Inverter AC Power",    33151, 2, "S32", 1.0,  "W",   SensorDeviceClass.POWER,       _M),
    ("inverter_temperature", "Inverter Temperature", 33093, 1, "S16", 0.1,  "°C",  SensorDeviceClass.TEMPERATURE, _M),
    ("daily_generation",     "Daily Generation",     33035, 1, "U16", 0.1,  "kWh", SensorDeviceClass.ENERGY,      _T),
    ("total_generation",     "Total Generation",     33029, 2, "U32", 1.0,  "kWh", SensorDeviceClass.ENERGY,      _T),
    ("total_imported",         "Total Imported",         33169, 2, "U32", 1.0, "kWh", SensorDeviceClass.ENERGY, _T),
    ("total_battery_charge",   "Total Battery Charge",   33161, 2, "U32", 1.0, "kWh", SensorDeviceClass.ENERGY, _T),
    ("total_battery_discharge","Total Battery Discharge",33165, 2, "U32", 1.0, "kWh", SensorDeviceClass.ENERGY, _T),
    ("battery_charge_today",   "Battery Charge Today",   33163, 1, "U16", 0.1, "kWh", SensorDeviceClass.ENERGY, _T),
    ("battery_discharge_today","Battery Discharge Today",33167, 1, "U16", 0.1, "kWh", SensorDeviceClass.ENERGY, _T),
]

# Đảo dấu để theo quy ước trực quan: DƯƠNG = SẠC (nạp), ÂM = XẢ.
# Solis trả battery_power/current DƯƠNG khi ĐANG XẢ (kiểm chứng: PV=0, lưới=0, tải>0
# mà battery_power dương + SOC đang tụt). Panel/engine giả định dương=sạc nên phải đảo.
INVERT_SIGN = {"battery_power", "battery_current"}

# Ánh xạ mặc định cho panel/engine (tự seed để không phải cấu hình tay).
DEFAULT_MAP = {
    "grid": "sensor.ib_grid_power",
    "soc": "sensor.ib_battery_soc",
    "pv": "sensor.ib_pv_power",
    "load": "sensor.ib_house_load_power",
    "batt": "sensor.ib_battery_power",
    "gridSign": "import_pos",
}


def _decode(regs: list[int], typ: str, scale: float):
    if typ in ("U16", "S16"):
        v = regs[0]
        if typ == "S16" and v & 0x8000:
            v -= 0x10000
    else:  # 32-bit: địa chỉ thấp = word cao
        v = (regs[0] << 16) | regs[1]
        if typ == "S32" and v & 0x80000000:
            v -= 0x100000000
    return round(v * scale, 2)


class SolisModbusCoordinator(DataUpdateCoordinator):
    """Poll que WiFi Solis qua Modbus TCP, trả dict {key: value}."""

    def __init__(self, hass: HomeAssistant, host: str, port: int) -> None:
        super().__init__(
            hass, _LOGGER, name="inverter_bridge_modbus", update_interval=UPDATE_INTERVAL
        )
        self._host = host
        self._port = port
        self._client = None

    async def _ensure_client(self):
        # Import trong hàm để pymodbus chỉ cần khi thực sự bật Modbus.
        from pymodbus.client import AsyncModbusTcpClient

        if self._client is None:
            self._client = AsyncModbusTcpClient(self._host, port=self._port, timeout=5)
        if not self._client.connected:
            await self._client.connect()
        if not self._client.connected:
            raise UpdateFailed(f"Không kết nối được que Modbus {self._host}:{self._port}")
        return self._client

    async def _read(self, client, addr, count):
        try:
            rr = await client.read_input_registers(address=addr, count=count, slave=SLAVE_ID)
        except TypeError:  # pymodbus mới đổi 'slave' -> 'device_id'
            rr = await client.read_input_registers(address=addr, count=count, device_id=SLAVE_ID)
        if rr.isError():
            return None
        return rr.registers

    async def _async_update_data(self) -> dict:
        client = await self._ensure_client()
        out: dict[str, float | None] = {}
        for key, _name, reg, count, typ, scale, *_ in REGISTERS:
            regs = await self._read(client, reg, count)
            val = None if regs is None else _decode(regs, typ, scale)
            if val is not None and key in INVERT_SIGN:
                val = -val
            out[key] = val
        if all(v is None for v in out.values()):
            raise UpdateFailed("Que Modbus không trả về thanh ghi nào")
        return out

    async def async_shutdown(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # noqa: BLE001
                pass
        await super().async_shutdown()
