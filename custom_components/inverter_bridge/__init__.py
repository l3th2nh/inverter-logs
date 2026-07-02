"""Inverter Bridge — panel "Hệ điện mặt trời" (giám sát biến tần + tự động hóa).

- Đăng ký panel trên sidebar HA.
- Lưu cấu hình (ánh xạ cảm biến + thông báo + quy tắc tự động) vào /config/.storage
  qua Store -> đồng bộ mọi máy/điện thoại.
- 2 lệnh WebSocket: inverter_bridge/get (đọc) và inverter_bridge/save (ghi).
Cùng khuôn mẫu panel "Nhà tôi" của dự án bể nước.
"""
import logging
import os

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

DOMAIN = "inverter_bridge"
PANEL_URL = "/inverter_bridge/panel.js"
PANEL_VER = "4"  # tăng mỗi lần sửa panel để chống cache
PANEL_URL_V = f"{PANEL_URL}?v={PANEL_VER}"
PANEL_PATH = "he-dien-mat-troi"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    panel_js = os.path.join(os.path.dirname(__file__), "panel.js")

    store = Store(hass, 1, DOMAIN)
    data = hass.data.setdefault(DOMAIN, {})
    data["store"] = store

    # Phục vụ file JS của panel (1 lần / phiên HA)
    if not data.get("static_registered"):
        data["static_registered"] = True
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_URL, panel_js, False)]
        )

    # Panel trên sidebar
    if PANEL_PATH not in hass.data.get(frontend.DATA_PANELS, {}):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_PATH,
            webcomponent_name="solar-inverter-panel",
            module_url=PANEL_URL_V,
            sidebar_title="Hệ điện mặt trời",
            sidebar_icon="mdi:solar-power-variant",
            require_admin=False,
            config={},
        )

    if not data.get("ws_registered"):
        data["ws_registered"] = True
        websocket_api.async_register_command(hass, ws_get)
        websocket_api.async_register_command(hass, ws_save)

    _LOGGER.info("Inverter Bridge: đã nạp panel + lệnh WebSocket")
    return True


@websocket_api.websocket_command({vol.Required("type"): "inverter_bridge/get"})
@websocket_api.async_response
async def ws_get(hass: HomeAssistant, connection, msg) -> None:
    store: Store = hass.data[DOMAIN]["store"]
    data = await store.async_load() or {}
    connection.send_result(msg["id"], data)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "inverter_bridge/save",
        vol.Required("config"): dict,
    }
)
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection, msg) -> None:
    store: Store = hass.data[DOMAIN]["store"]
    await store.async_save(msg["config"])
    connection.send_result(msg["id"], {"ok": True})


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if PANEL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_PATH)
    return True
