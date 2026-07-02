#!/usr/bin/env python3
# ============================================================================
#  mqtt_check.py - Kiem tra nhanh: subscribe MQTT xem discovery + state cua
#  thiet bi Inverter Bridge (khong lam reset ESP32 nhu mo Serial monitor).
#
#  Cai:  pip install paho-mqtt
#  Chay: python mqtt_check.py
#  (Sua HOST/USER/PW cho khop broker cua ban.)
# ============================================================================
import os
import time
import paho.mqtt.client as mqtt

# Cau hinh qua bien moi truong (khong hardcode mat khau -> an toan khi len GitHub).
#   PowerShell:  $env:MQTT_PASS="..."; python mqtt_check.py
HOST = os.environ.get("MQTT_HOST", "192.168.0.146")
PORT = int(os.environ.get("MQTT_PORT", "1883"))
USER = os.environ.get("MQTT_USER", "inverter")
PW = os.environ.get("MQTT_PASS", "")

try:
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
except Exception:
    c = mqtt.Client()

disc, state = [], []

def on_connect(cl, u, f, rc):
    print("CONNECT rc =", rc, "(0=OK, 5=not authorized)")
    cl.subscribe("homeassistant/sensor/inverterbridge_01/#")
    cl.subscribe("inverterbridge/state")

def on_message(cl, u, msg):
    if msg.topic.endswith("/config"):
        disc.append(msg.topic)
    elif msg.topic == "inverterbridge/state":
        state.append(msg.payload.decode(errors="replace"))
        print("STATE:", state[-1][:200])

c.on_connect = on_connect
c.on_message = on_message
c.username_pw_set(USER, PW)
c.connect(HOST, PORT, 30)
c.loop_start()
time.sleep(16)
c.loop_stop()

print(f"\n== Discovery configs (retained): {len(disc)} ==")
for t in sorted(disc):
    print("  ", t)
print(f"== State messages / 16s: {len(state)} ==")
