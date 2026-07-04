#!/usr/bin/env python3
# ============================================================================
#  mqtt_clear_discovery.py — Xoa discovery RETAINED cu cua thiet bi ESP32
#  "Inverter Bridge" tren broker MQTT.
#
#  Dung khi: da chuyen sang doc bien tan bang Modbus TCP (integration v1.1.x),
#  nhung broker con giu cac message discovery retained cua firmware ESP32 cu ->
#  HA tao lai device "Inverter Bridge" (MQTT) va sensor.ib_* bi trung (_2).
#  Script nay publish payload RONG (retained) len tung topic .../config -> xoa han,
#  HA se khong tao lai khi restart.
#
#  ⚠️ Truoc khi chay: dam bao ESP32 KHONG con chay/publish (neu khong no se
#     dang ky lai ngay). Da chuyen sang Modbus thi ESP32 le ra da tat.
#
#  Cai:  pip install paho-mqtt   (da co san trong moi truong du an)
#  Xem truoc (khong xoa gi):
#     PowerShell:  $env:MQTT_PASS="matkhau"; python tools/mqtt_clear_discovery.py --dry-run
#  Xoa that:
#     PowerShell:  $env:MQTT_PASS="matkhau"; python tools/mqtt_clear_discovery.py
#
#  Cau hinh qua bien moi truong (khong hardcode mat khau -> an toan khi len GitHub):
#     MQTT_HOST (mac dinh 192.168.0.146), MQTT_PORT (1883), MQTT_USER (inverter),
#     MQTT_PASS, IB_DEVICE_ID (inverterbridge_01), IB_DISCOVERY_PREFIX (homeassistant)
# ============================================================================
import argparse
import os
import sys
import time

import paho.mqtt.client as mqtt

HOST = os.environ.get("MQTT_HOST", "192.168.0.146")
PORT = int(os.environ.get("MQTT_PORT", "1883"))
USER = os.environ.get("MQTT_USER", "inverter")
PW = os.environ.get("MQTT_PASS", "")
DEVICE_ID = os.environ.get("IB_DEVICE_ID", "inverterbridge_01")
PREFIX = os.environ.get("IB_DISCOVERY_PREFIX", "homeassistant")

# Bat moi loai component (sensor/binary_sensor/...) cua dung device_id nay.
TOPIC_FILTER = f"{PREFIX}/+/{DEVICE_ID}/#"


def main() -> int:
    ap = argparse.ArgumentParser(description="Xoa discovery MQTT retained cu cua Inverter Bridge (ESP32).")
    ap.add_argument("--dry-run", action="store_true", help="Chi liet ke topic se xoa, khong xoa.")
    ap.add_argument("--wait", type=float, default=3.0, help="So giay cho broker gui het retained (mac dinh 3).")
    args = ap.parse_args()

    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
    except Exception:
        client = mqtt.Client()
    if USER:
        client.username_pw_set(USER, PW)

    found: dict[str, int] = {}      # topic .../config -> so byte payload hien tai
    state = {"rc": None}

    def on_connect(cl, _u, _f, rc):
        state["rc"] = rc
        print(f"CONNECT rc = {rc}  (0=OK, 4=sai user/pass, 5=not authorized)")
        if rc == 0:
            cl.subscribe(TOPIC_FILTER)
            print(f"Subscribe: {TOPIC_FILTER}")

    def on_message(_cl, _u, msg):
        # Chi quan tam config discovery con RETAINED (payload khac rong).
        if msg.retain and msg.topic.endswith("/config") and len(msg.payload) > 0:
            found[msg.topic] = len(msg.payload)

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(HOST, PORT, keepalive=30)
    except Exception as err:  # noqa: BLE001
        print(f"LOI ket noi {HOST}:{PORT}: {err}")
        return 2

    client.loop_start()
    # Cho ket noi
    t0 = time.time()
    while state["rc"] is None and time.time() - t0 < 8:
        time.sleep(0.1)
    if state["rc"] is None:
        print("Khong ket noi duoc broker (timeout).")
        client.loop_stop()
        return 2
    if state["rc"] != 0:
        client.loop_stop()
        return 2
    # Cho nhan het retained
    time.sleep(args.wait)

    if not found:
        print("\nKhong tim thay discovery retained nao cua "
              f"'{DEVICE_ID}'. Khong co gi de xoa (co the da sach, hoac chua tung chay ESP32).")
        client.loop_stop()
        return 0

    print(f"\nTim thay {len(found)} topic discovery retained:")
    for t in sorted(found):
        print(f"  - {t}  ({found[t]} byte)")

    if args.dry_run:
        print("\n[DRY-RUN] Chua xoa gi. Bo --dry-run de xoa that.")
        client.loop_stop()
        return 0

    print("\nDang xoa (publish payload rong, retained=True)...")
    infos = []
    for t in sorted(found):
        infos.append(client.publish(t, payload=b"", qos=1, retain=True))
    for info in infos:
        try:
            info.wait_for_publish(timeout=5)
        except Exception:  # noqa: BLE001
            pass
    time.sleep(0.5)
    client.loop_stop()
    client.disconnect()
    print(f"Da xoa {len(found)} topic. Restart Home Assistant -> device MQTT 'Inverter Bridge' cu se khong hien lai.")
    print("Neu van hien lai: kiem tra ESP32 co con chay/publish khong.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
