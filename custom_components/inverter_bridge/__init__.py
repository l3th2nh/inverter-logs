"""Inverter Bridge — panel "Hệ điện mặt trời" (giám sát biến tần + tự động hóa).

- Đăng ký panel trên sidebar HA.
- Lưu cấu hình (ánh xạ cảm biến + thông báo + quy tắc tự động) vào /config/.storage.
- ENGINE server-side: tự chạy thông báo/quy tắc 24/7 (kể cả khi đóng trình duyệt).
- REST endpoint /api/inverter_bridge/data: trả toàn bộ thông tin cho cuộc gọi nội bộ.
- Lệnh WebSocket: inverter_bridge/get (đọc) và inverter_bridge/save (ghi).
"""
import logging
import os
import time
from datetime import timedelta
from ipaddress import ip_address

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.network import is_local

try:  # vị trí hằng số auth có thể đổi theo phiên bản HA
    from homeassistant.components.http.const import KEY_AUTHENTICATED
except ImportError:  # pragma: no cover
    KEY_AUTHENTICATED = "ha_authenticated"

_LOGGER = logging.getLogger(__name__)

DOMAIN = "inverter_bridge"
PANEL_URL = "/inverter_bridge/panel.js"
PANEL_VER = "11"  # tăng mỗi lần sửa panel để chống cache
PANEL_URL_V = f"{PANEL_URL}?v={PANEL_VER}"
PANEL_PATH = "he-dien-mat-troi"
ENGINE_INTERVAL = timedelta(seconds=10)
PLATFORMS = [Platform.SENSOR]
LOG_LIMIT = 200  # số dòng nhật ký giữ lại


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    panel_js = os.path.join(os.path.dirname(__file__), "panel.js")

    store = Store(hass, 1, DOMAIN)
    data = hass.data.setdefault(DOMAIN, {})
    data["store"] = store
    data.setdefault("runtime", {})
    data["config"] = await store.async_load() or {}

    # Nhật ký hoạt động (lưu bền, sống lại sau restart).
    if "logs_store" not in data:
        logs_store = Store(hass, 1, f"{DOMAIN}_logs")
        data["logs_store"] = logs_store
        data["logs"] = await logs_store.async_load() or []

    # Di trú: tab "Thông báo" cũ -> 1 quy tắc notify (thống nhất vào Tự động hóa,
    # không mất thông báo đang bật). Chạy 1 lần vì sau đó 'notif' bị xóa khỏi config.
    _legacy = data["config"].pop("notif", None)
    if _legacy is not None:
        _rules = data["config"].setdefault("rules", [])
        if not any(rr.get("_from_notif") for rr in _rules):
            _rules.append({
                "id": "notif_migrated",
                "_from_notif": True,
                "name": "Báo khi bắt đầu lấy điện lưới",
                "enabled": bool(_legacy.get("enabled")),
                "action": "notify",
                "notifyService": _legacy.get("service", "persistent_notification.create"),
                "notifyMessage": _legacy.get("message", ""),
                "entities": [],
                "cooldownSec": _legacy.get("cooldownSec", 300),
                "trig": {
                    "type": "grid_import_start",
                    "threshold": _legacy.get("threshold", 50),
                    "forSec": _legacy.get("forSec", 30),
                },
            })
        await store.async_save(data["config"])

    # Nguồn dữ liệu Modbus TCP (đọc thẳng que WiFi Solis). Mặc định dùng IP .89 nếu
    # người dùng chưa điền -> chạy ngay, không cần bấm Configure (zero-config).
    from .modbus import DEFAULT_HOST, DEFAULT_MAP, DEFAULT_PORT, SolisModbusCoordinator

    host = (entry.data.get("host") or DEFAULT_HOST).strip()
    if host and not data.get("coordinator"):
        coordinator = SolisModbusCoordinator(
            hass, host, entry.data.get("port", DEFAULT_PORT)
        )
        try:
            await coordinator.async_config_entry_first_refresh()
        except Exception as err:  # noqa: BLE001  — que chưa sẵn sàng: vẫn cho panel chạy
            _LOGGER.warning(
                "Inverter Bridge: chưa đọc được que Modbus %s (%s); panel vẫn chạy. "
                "Đổi IP ở Cài đặt → Thiết bị & Dịch vụ → Inverter Bridge → Cấu hình.",
                host, err,
            )
            coordinator = None

        if coordinator is not None:
            data["coordinator"] = coordinator
            await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

            # Tự seed/di trú ánh xạ cảm biến cho panel/engine -> zero-config:
            #  - chưa có map, HOẶC map còn trỏ entity ESP32 cũ (sensor.inverter_bridge_*)
            #    nay đã chết -> tự chuyển sang sensor.ib_* của Modbus.
            cur_map = data["config"].get("map") or {}
            grid_eid = cur_map.get("grid", "") or ""
            if not cur_map or grid_eid.startswith("sensor.inverter_bridge_"):
                data["config"]["map"] = dict(DEFAULT_MAP)
                await store.async_save(data["config"])

    # Phục vụ file JS của panel (1 lần / phiên HA)
    if not data.get("static_registered"):
        data["static_registered"] = True
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_URL, panel_js, False)]
        )
        hass.http.register_view(InverterDataView())

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
        websocket_api.async_register_command(hass, ws_logs)
        websocket_api.async_register_command(hass, ws_logs_clear)

    # Engine chạy nền định kỳ (chỉ đăng ký 1 lần)
    if not data.get("engine_unsub"):
        async def _tick(now):
            await _engine_evaluate(hass)

        data["engine_unsub"] = async_track_time_interval(hass, _tick, ENGINE_INTERVAL)

    _LOGGER.info("Inverter Bridge: đã nạp panel + engine + REST + WebSocket")
    return True


# ============================ Đọc số liệu ============================
def _num(hass: HomeAssistant, entity):
    if not entity:
        return None
    st = hass.states.get(entity)
    if not st or st.state in ("unknown", "unavailable", "", None):
        return None
    try:
        return float(st.state)
    except (ValueError, TypeError):
        return None


def _readings(hass: HomeAssistant, cfg: dict) -> dict:
    m = cfg.get("map", {}) if cfg else {}
    graw = _num(hass, m.get("grid"))
    gsign = m.get("gridSign", "import_pos")
    gimp = None if graw is None else (graw if gsign == "import_pos" else -graw)
    return {
        "grid_raw": graw,
        "grid_import": gimp,
        "soc": _num(hass, m.get("soc")),
        "pv": _num(hass, m.get("pv")),
        "load": _num(hass, m.get("load")),
        "batt": _num(hass, m.get("batt")),
    }


def _cond(typ: str, thr: float, r: dict) -> bool:
    gi, soc, pv, load = r["grid_import"], r["soc"], r["pv"], r["load"]
    if typ in ("grid_import_start", "grid_import_above"):
        return gi is not None and gi > thr
    if typ == "battery_below":
        return soc is not None and soc < thr
    if typ == "pv_below":
        return pv is not None and pv < thr
    if typ == "load_above":
        return load is not None and load > thr
    return False


def _render_msg(msg: str, r: dict) -> str:
    def w(v):
        return "–" if v is None else f"{round(v)} W"

    power = "0 W" if r["grid_import"] is None else f"{max(0, round(r['grid_import']))} W"
    soc = "–" if r["soc"] is None else f"{round(r['soc'])}%"
    return (
        (msg or "")
        .replace("{power}", power)
        .replace("{pv}", w(r["pv"]))
        .replace("{soc}", soc)
        .replace("{load}", w(r["load"]))
        .replace("{time}", dt_util.now().strftime("%H:%M"))
    )


async def _call(hass: HomeAssistant, service: str, service_data: dict) -> None:
    if "." not in service:
        return
    domain, name = service.split(".", 1)
    try:
        await hass.services.async_call(domain, name, service_data, blocking=False)
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Inverter Bridge: lỗi gọi %s: %s", service, err)


async def _persistent(hass: HomeAssistant, title: str, message: str, nid: str) -> None:
    await hass.services.async_call(
        "persistent_notification", "create",
        {"title": title, "message": message, "notification_id": nid}, blocking=False,
    )


async def _send_notification(
    hass: HomeAssistant, service: str, title: str, message: str, rid: str
) -> tuple[bool, str]:
    """Gửi thông báo linh hoạt, chịu được nhiều kiểu dịch vụ HA; luôn có fallback.

    Trả về (ok, chi tiết) để ghi nhật ký.
    - persistent_notification.create  -> hiện trong HA.
    - notify.<x> kiểu cũ (mobile_app_x, notify...) -> nhận {title, message} trực tiếp.
    - notify entity (HA mới) -> notify.send_message + target: entity_id (ra điện thoại).
    - notify.send_message trần / lỗi -> fallback về persistent (kèm ghi chú) để không mất báo.
    """
    nid = f"inverter_bridge_rule_{rid}"
    if service.startswith("persistent_notification"):
        await _persistent(hass, title, message, nid)
        return True, "Đã hiện thông báo trong HA"
    domain, _, name = service.partition(".")
    try:
        # notify.<x> kiểu cũ (không phải send_message)
        if domain == "notify" and name and name != "send_message" \
                and hass.services.has_service("notify", name):
            await hass.services.async_call(
                "notify", name, {"title": title, "message": message}, blocking=True
            )
            return True, f"Đã gửi qua {service}"
        # notify entity qua send_message + target (mobile_app trên HA mới)
        if service.startswith("notify.") and hass.states.get(service) is not None \
                and hass.services.has_service("notify", "send_message"):
            await hass.services.async_call(
                "notify", "send_message",
                {"title": title, "message": message},
                blocking=True, target={"entity_id": service},
            )
            return True, f"Đã gửi tới {service}"
        # domain khác người dùng tự nhập
        if domain and name and domain not in ("notify",) and hass.services.has_service(domain, name):
            await hass.services.async_call(
                domain, name, {"title": title, "message": message}, blocking=True
            )
            return True, f"Đã gọi {service}"
        raise ValueError(
            f"dịch vụ '{service}' không dùng được (chọn notify.mobile_app_… hoặc để 'trong HA')"
        )
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Inverter Bridge: gửi thông báo '%s' lỗi (%s) -> dùng persistent", service, err)
        await _persistent(
            hass, title, f"{message}\n\n(Không gửi được qua '{service}'. Sửa quy tắc chọn dịch vụ khác.)", nid
        )
        return False, f"Lỗi '{service}': {err}. Đã hiện trong HA thay thế."


async def _call_ok(hass: HomeAssistant, service: str, service_data: dict) -> tuple[bool, str]:
    """Gọi service (chờ kết quả) và trả (ok, chi tiết) để ghi nhật ký."""
    if "." not in service:
        return False, "dịch vụ không hợp lệ"
    domain, name = service.split(".", 1)
    try:
        await hass.services.async_call(domain, name, service_data, blocking=True)
        return True, "OK"
    except Exception as err:  # noqa: BLE001
        return False, str(err)


def _append_log(hass: HomeAssistant, entry: dict) -> None:
    """Ghi 1 dòng nhật ký (mới nhất lên đầu), giới hạn 200 dòng, lưu bền (debounced)."""
    data = hass.data.setdefault(DOMAIN, {})
    logs = data.setdefault("logs", [])
    logs.insert(0, entry)
    del logs[LOG_LIMIT:]
    store = data.get("logs_store")
    if store is not None:
        store.async_delay_save(lambda: data.get("logs", []), 3)


def _handle(runtime: dict, key: str, on: bool, for_sec: float, cool_sec: float):
    """Trả về 'fire' nếu cần bắn, 'reset' nếu vừa hết điều kiện, None nếu không."""
    rt = runtime.setdefault(key, {"since": 0.0, "fired": False, "last": 0.0})
    now = time.monotonic()
    if on:
        if not rt["since"]:
            rt["since"] = now
        held = (now - rt["since"]) >= for_sec
        cool_ok = (now - rt["last"]) >= cool_sec
        if held and not rt["fired"] and cool_ok:
            rt["fired"] = True
            rt["last"] = now
            return "fire"
        if held and not rt["fired"] and not cool_ok:
            rt["fired"] = True
        return None
    was = rt["fired"]
    rt["since"] = 0.0
    rt["fired"] = False
    return "reset" if was else None


async def _engine_evaluate(hass: HomeAssistant) -> None:
    data = hass.data.get(DOMAIN, {})
    cfg = data.get("config") or {}
    runtime = data.setdefault("runtime", {})
    r = _readings(hass, cfg)

    # Quy tắc tự động (tắt/bật thiết bị hoặc gửi thông báo).
    # (Tab "Thông báo" riêng đã bỏ; thông báo lấy lưới nay là 1 quy tắc.)
    for rule in cfg.get("rules", []):
        rid = rule.get("id")
        if not rid:
            continue
        if not rule.get("enabled"):
            runtime.pop(rid, None)
            continue
        trig = rule.get("trig", {})
        res = _handle(
            runtime, rid,
            _cond(trig.get("type"), float(trig.get("threshold", 0) or 0), r),
            float(trig.get("forSec", 0) or 0),
            float(rule.get("cooldownSec", 0) or 0),
        )
        if res == "fire":
            action = rule.get("action", "turn_off")
            if action == "notify":
                service = rule.get("notifyService") or "persistent_notification.create"
                ok, detail = await _send_notification(
                    hass, service,
                    rule.get("name") or "Hệ điện mặt trời",
                    _render_msg(rule.get("notifyMessage", ""), r),
                    rid,
                )
            else:
                ents = rule.get("entities", [])
                if not ents:
                    ok, detail = False, "Chưa chọn thiết bị nào"
                else:
                    ok, detail = await _call_ok(
                        hass, f"homeassistant.{action}", {"entity_id": ents}
                    )
                    verb = "Bật" if action == "turn_on" else "Tắt"
                    detail = f"{verb} {len(ents)} thiết bị — {detail}"
            _append_log(hass, {
                "ts": dt_util.now().isoformat(),
                "rule": rule.get("name") or "(không tên)",
                "rule_id": rid,
                "action": action,
                "ok": ok,
                "detail": detail,
            })


# ============================ REST endpoint ============================
def _request_is_local(request) -> bool:
    """True nếu request tới từ mạng nội bộ (LAN/loopback)."""
    remote = request.remote
    if not remote:
        return False
    try:
        return is_local(ip_address(remote))
    except ValueError:
        return False


class InverterDataView(HomeAssistantView):
    """GET /api/inverter_bridge/data — toàn bộ số liệu biến tần.

    - Gọi NỘI BỘ (LAN/loopback): KHÔNG cần token (có token vẫn chạy).
    - Gọi TỪ BÊN NGOÀI: bắt buộc Home Assistant long-lived token
      (header: Authorization: Bearer <token>).
    Endpoint đi kèm HTTP server của HA -> tự truy cập được qua Nabu Casa / DuckDNS /
    reverse proxy (nhớ cấu hình trusted_proxies để HA nhận đúng IP thật của client).
    """

    url = "/api/inverter_bridge/data"
    name = "api:inverter_bridge:data"
    requires_auth = False  # tự kiểm tra: LAN miễn token, ngoài LAN cần token

    async def get(self, request):
        if not request.get(KEY_AUTHENTICATED, False) and not _request_is_local(request):
            return self.json_message("Cần token khi gọi từ bên ngoài mạng nội bộ", 401)
        hass = request.app["hass"]
        cfg = hass.data.get(DOMAIN, {}).get("config") or {}
        r = _readings(hass, cfg)
        gi = r["grid_import"]
        thr = 50.0  # ngưỡng bỏ qua nhiễu để phân loại "importing"
        if gi is None:
            grid_status = "unknown"
        elif gi > thr:
            grid_status = "importing"
        elif gi < -20:
            grid_status = "exporting"
        else:
            grid_status = "self"
        batt = r["batt"]
        batt_status = "idle"
        if batt is not None:
            batt_status = "charging" if batt > 15 else "discharging" if batt < -15 else "idle"

        # kèm mọi entity cùng "họ" với cảm biến lưới (suy ra tiền tố từ map.grid),
        # để lấy đủ 17 sensor bất kể tên là sensor.ib_* hay sensor.inverter_bridge_*
        mp = cfg.get("map") or {}
        entities = {}
        grid_eid = mp.get("grid") or ""
        prefix = grid_eid[:-len("grid_power")] if grid_eid.endswith("grid_power") else None
        if prefix:
            for state in hass.states.async_all("sensor"):
                if state.entity_id.startswith(prefix):
                    entities[state.entity_id] = state.state
        else:  # dự phòng: ít nhất trả các sensor đã ánh xạ
            for eid in (mp.get("grid"), mp.get("soc"), mp.get("batt"), mp.get("pv"), mp.get("load")):
                st = hass.states.get(eid) if eid else None
                if st:
                    entities[eid] = st.state

        return self.json({
            "grid": {"power_w": r["grid_raw"], "import_w": gi, "status": grid_status},
            "battery": {"soc_pct": r["soc"], "power_w": batt, "status": batt_status},
            "pv": {"power_w": r["pv"]},
            "load": {"power_w": r["load"]},
            "self_sufficient": grid_status in ("self", "exporting"),
            "entities": entities,
            "timestamp": dt_util.now().isoformat(),
        })


# ============================ WebSocket ============================
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
    data = hass.data[DOMAIN]
    store: Store = data["store"]
    await store.async_save(msg["config"])
    data["config"] = msg["config"]        # engine dùng ngay cấu hình mới
    data["runtime"] = {}                   # reset trạng thái để áp dụng thay đổi
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({vol.Required("type"): "inverter_bridge/logs"})
@websocket_api.async_response
async def ws_logs(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], hass.data.get(DOMAIN, {}).get("logs", []))


@websocket_api.websocket_command({vol.Required("type"): "inverter_bridge/logs_clear"})
@websocket_api.async_response
async def ws_logs_clear(hass: HomeAssistant, connection, msg) -> None:
    data = hass.data.get(DOMAIN, {})
    data["logs"] = []
    if data.get("logs_store") is not None:
        await data["logs_store"].async_save([])
    connection.send_result(msg["id"], {"ok": True})


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.get(DOMAIN, {})
    if data.get("coordinator"):
        await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
        await data["coordinator"].async_shutdown()
        data["coordinator"] = None
    if data.get("engine_unsub"):
        data["engine_unsub"]()
        data["engine_unsub"] = None
    if PANEL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        frontend.async_remove_panel(hass, PANEL_PATH)
    return True
