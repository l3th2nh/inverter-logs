"""Config flow: vài click là xong. Điền sẵn IP que WiFi Solis (Modbus TCP)."""
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback

from . import DOMAIN
from .modbus import DEFAULT_HOST, DEFAULT_PORT


def _schema(host=DEFAULT_HOST, port=DEFAULT_PORT):
    # host để trống -> chế độ panel-only (dùng sensor MQTT/ESP32 như trước).
    return vol.Schema(
        {
            vol.Optional("host", default=host): str,
            vol.Optional("port", default=port): int,
        }
    )


class InverterBridgeConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            data = {"host": (user_input.get("host") or "").strip(), "port": user_input.get("port", DEFAULT_PORT)}
            return self.async_create_entry(title="Inverter Bridge", data=data)
        return self.async_show_form(step_id="user", data_schema=_schema())

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return InverterBridgeOptionsFlow(config_entry)


class InverterBridgeOptionsFlow(config_entries.OptionsFlow):
    """Đổi IP/port que WiFi sau này mà không cần xóa integration."""

    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        entry = self.config_entry
        if user_input is not None:
            new_data = {
                "host": (user_input.get("host") or "").strip(),
                "port": user_input.get("port", DEFAULT_PORT),
            }
            self.hass.config_entries.async_update_entry(entry, data=new_data)
            await self.hass.config_entries.async_reload(entry.entry_id)
            return self.async_create_entry(title="", data={})
        return self.async_show_form(
            step_id="init",
            data_schema=_schema(
                entry.data.get("host", DEFAULT_HOST),
                entry.data.get("port", DEFAULT_PORT),
            ),
        )
