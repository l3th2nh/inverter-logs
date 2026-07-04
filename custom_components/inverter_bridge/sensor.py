"""Nền tảng sensor: tạo 17 entity sensor.ib_* từ coordinator Modbus.

Entity id cố định `sensor.ib_<key>` → trùng nguồn ESP32/MQTT cũ nên dashboard.yaml,
automations.yaml và panel "Hệ điện mặt trời" dùng ngay, không phải sửa gì.
"""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import DOMAIN
from .modbus import REGISTERS, SolisModbusCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: SolisModbusCoordinator | None = (
        hass.data.get(DOMAIN, {}).get("coordinator")
    )
    if coordinator is None:
        return  # chưa bật Modbus (chế độ panel-only / MQTT) → không tạo sensor
    async_add_entities(
        SolisModbusSensor(coordinator, entry.entry_id, reg) for reg in REGISTERS
    )


class SolisModbusSensor(CoordinatorEntity, SensorEntity):
    """Một thanh ghi Solis đọc qua Modbus TCP."""

    _attr_has_entity_name = False

    def __init__(self, coordinator: SolisModbusCoordinator, entry_id: str, reg) -> None:
        super().__init__(coordinator)
        key, name, _reg, _cnt, _typ, _scale, unit, dev_class, state_class = reg
        self._key = key
        self.entity_id = f"sensor.ib_{key}"
        self._attr_unique_id = f"{entry_id}_{key}"
        self._attr_name = name
        self._attr_native_unit_of_measurement = unit
        self._attr_device_class = dev_class
        self._attr_state_class = state_class
        self._attr_suggested_display_precision = 0 if unit == "W" else 2
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)},
            name="Inverter Bridge (Solis)",
            manufacturer="Solis",
            model="S6 Hybrid",
        )

    @property
    def native_value(self):
        data = self.coordinator.data or {}
        return data.get(self._key)
