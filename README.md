# Inverter Bridge — đọc biến tần solar qua RS485 → Home Assistant

Thiết bị ESP32 đọc dữ liệu biến tần (Solis, sau này Deye/Growatt/Lux…) qua **RS485/Modbus**,
đẩy vào **Home Assistant** bằng MQTT auto-discovery, kèm **panel "Hệ điện mặt trời"** để giám sát
dòng năng lượng và xây kịch bản tự động (tắt/bật thiết bị theo trạng thái lấy/bán điện lưới).

- Custom component: `custom_components/inverter_bridge/` — panel sidebar HA + **tự đọc biến tần
  Solis qua Modbus TCP** (que WiFi datalogger trên LAN) tạo 17 `sensor.ib_*`. **Không cần
  ESP32/RS485/MQTT/YAML** — cài qua HACS, điền IP (điền sẵn) là xong. Đây là cách khuyến nghị.
- Firmware: `firmware/` (PlatformIO, ESP32) — WiFi captive portal + MQTT + auto-discovery.
  (Phương án thay thế khi biến tần KHÔNG có que WiFi hở Modbus TCP → đọc RS485 trực tiếp.)
- Công cụ dev: `tools/` (giả lập Solis + kiểm tra MQTT). Tài liệu: `DU_AN_DOC_BIEN_TAN.md`.

## Cài panel qua HACS (khuyến nghị)

1. HACS → menu ⋮ → **Custom repositories**.
2. Dán URL repo này, category **Integration** → **Add**.
3. Tìm **"Inverter Bridge"** trong HACS → **Download** → **Restart** Home Assistant.
4. **Settings → Devices & Services → + Add Integration** → **Inverter Bridge**.
5. Sidebar hiện **"Hệ điện mặt trời"**. Mở là dùng — panel **tự dò cảm biến**, không cần cấu hình tay.

> Yêu cầu: đã bật tích hợp **MQTT** (add-on Mosquitto) để có sẵn các sensor `sensor.ib_*` từ ESP32.

## Cài panel thủ công (không dùng HACS)

Chép `custom_components/inverter_bridge/` vào thư mục `custom_components/` của Home Assistant →
Restart → Add Integration "Inverter Bridge".

## Phần cứng

ESP32 + module RS485 cách ly (XY-S485 auto-direction). Solis S6 Hybrid: RJ45 **pin5 = A, pin4 = B**,
9600 8N1. Chi tiết sơ đồ mạch + register map: xem `DU_AN_DOC_BIEN_TAN.md`.

## Bảo mật

`firmware/src/secrets.h` (WiFi/MQTT) đã bị `.gitignore` — không lên repo. Copy từ `secrets.h.example`.
