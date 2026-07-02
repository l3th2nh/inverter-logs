# Firmware TEST Phase 1 — Đọc Solis S6 Hybrid qua RS485

Mục đích: kiểm chứng **phần cứng + register map** trước khi làm firmware production
(WiFi/captive portal/MQTT). In kết quả ra Serial, không cần Home Assistant.
(Đúng bài bản dự án `DoBeNuoc`: test Serial trước, production sau.)

## 1. Đấu dây (QUAN TRỌNG)

```
ESP32            XY-S485 (phía TTL)
GPIO17 (TX2) ──► RXD
GPIO16 (RX2) ◄── TXD
3V3          ──► VCC        ⚠️ DÙNG 3V3, KHÔNG dùng 5V (bảo vệ GPIO16)
GND          ──► GND

XY-S485 (phía RS485)   Solis COM (RJ45)
A+  ─────────────────► Pin 5 (RS485 A)
B−  ─────────────────► Pin 4 (RS485 B)
```
- XY-S485 tự điều hướng (auto flow) → **không cần** dây DE/RE.
- Đấu **chéo** TX↔RX, đi theo **chữ in trên board**, không theo màu dây.
- ⚠️ **Rút que WiFi stick của Solis** khỏi cổng COM khi test (tránh xung đột 2 master).

## 2. Nạp & xem log

```powershell
$pio = "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"
cd "d:\work\Iot\InverterLogs\firmware"
& $pio run -t upload -t monitor      # Serial 115200
```
Hoặc dùng VSCode + extension PlatformIO: mở thư mục `firmware/` → **Upload** → **Serial Monitor**.

## 3. Kết quả mong đợi

```
==== InverterLogs - Phase 1 test (Solis S6 Hybrid / RS485) ====
Slave ID=1, baud=9600, RX=GPIO16, TX=GPIO17

[PROBE] Dang do cach danh dia chi thanh ghi...
  - Convention A (offset 30001): SOC = 87
  - Convention B (raw 33xxx)    : SOC = -1
[PROBE] => Dung Convention A (offset 30001). OK.

---------------- SOLIS ----------------
  Battery SOC            =      87.00 %    (reg 33139)
  Battery Voltage        =      52.30 V    (reg 33133)
  Grid/Meter Power       =    -420.00 W    (reg 33257)   <- am = dang BAN ra luoi
  PV Power (DC total)    =    2150.00 W    (reg 33057)
  House Load Power       =     640.00 W    (reg 33147)
  Inverter Temperature   =      38.50 C    (reg 33093)
  ...
  [tong: 17 OK, 0 loi]
```

## 4. Firmware tự xử lý 2 điều chưa chắc chắn

| Vấn đề | Cách firmware xử lý | Nếu vẫn sai |
|---|---|---|
| **Đánh địa chỉ** `33xxx` hay `−30001`? | Bước `[PROBE]` thử cả 2, chọn cái ra SOC 0..100 | Xem log, nếu cả 2 fail → mục 5 |
| **Thứ tự word** số 32-bit | Mặc định `low addr = high word` (big-endian) | Nếu công suất (Power) sai/quá lớn → sửa `REG32_LOW_ADDR_IS_HIGH_WORD = false` trong `config.h`, nạp lại |

## 5. Xử lý lỗi

- **`[PROBE]` cả 2 convention đều fail / mọi thanh ghi LOI DOC:**
  1. Đảo lại A/B (thử Solis pin4↔pin5 hoặc đảo dây A+/B− trên module).
  2. Chắc chắn đã **rút que WiFi stick Solis**.
  3. Kiểm tra VCC module = **3V3**, TX/RX đấu **chéo** đúng.
  4. Thử slave ID khác: sửa `MODBUS_SLAVE_ID` (1→2→3) trong `config.h`.
- **Đọc được SOC nhưng vài thanh ghi khác lệch giá trị:** register map theo dòng máy có thể lệch
  → đối chiếu với màn hình LCD/SolisCloud, chỉnh lại địa chỉ trong `config.h` (bảng `SOLIS_REGS`).
- **Giá trị nhảy loạn / CRC error thỉnh thoảng:** bình thường với RS485; firmware có retry ngầm.
  Nếu nhiều → giảm nhiễu, thêm điện trở **120Ω** giữa A–B, hoặc rút ngắn dây.

## 6. Sau khi test OK
→ Chuyển sang firmware production: WiFi captive portal (chọn hãng/model) + auto-detect +
MQTT auto-discovery cho Home Assistant. Xem lộ trình ở `../DU_AN_DOC_BIEN_TAN.md` (Phase 2→7).
Register map đã xác thực ở bước này chính là **profile Solis** đầu tiên của engine đa hãng.

---

## 7. Chế độ PRODUCTION (đã có): MQTT → HA + Captive Portal

Firmware hiện tại đã là bản production: WiFi + MQTT auto-discovery + captive portal.

### Cấu hình
- **`SIM_MODE`** (config.h): `1` = dữ liệu Solis giả (demo HA không cần RS485); `0` = đọc RS485 thật.
- **`secrets.h`**: WiFi/MQTT mặc định (copy từ `secrets.h.example`). Chỉ dùng để seed lần đầu.
- **`PORTAL_SEED_DEFAULTS`** (app_config.cpp): `1` = nếu chưa cấu hình thì nạp secrets.h & chạy luôn
  (tiện dev). `0` = ép qua portal lần đầu (hành vi sản phẩm thật).

### Captive portal
- Vào portal khi: **chưa cấu hình** hoặc **giữ nút BOOT (GPIO0) ~2 giây** lúc khởi động (đèn/log báo).
- ESP32 phát WiFi **`InverterBridge-XXXX`** → điện thoại bắt WiFi này → trang cấu hình tự bung
  (nếu không, mở trình duyệt vào `http://192.168.4.1`).
- Chọn WiFi + mật khẩu; chọn Hãng → Model; nhập MQTT (điền sẵn 192.168.0.146). Bấm **Lưu** → tự reboot.
- Xóa cấu hình (về portal): giữ BOOT lúc khởi động, hoặc gọi `appConfigFactoryReset()`.

### Xem dữ liệu trên Home Assistant
1. HA phải **bật tích hợp MQTT**: Settings → Devices & Services → **+ Add Integration → MQTT**
   → broker `core-mosquitto`, port 1883, user/pass đã tạo trong add-on Mosquitto.
   (Cài add-on Mosquitto **chưa đủ** — phải thêm integration này thì HA mới đọc discovery.)
2. Xong → tự hiện device **"Inverter Bridge"** với 17 sensor (Settings → Devices & Services → MQTT).
3. Kiểm tra nhanh từ PC: `python tools/mqtt_check.py` (subscribe xem state/discovery).

### Kiểm chứng nhanh (không cần biến tần)
- Đặt `SIM_MODE 1`, điền `secrets.h`, nạp → 17 sensor lên HA với dữ liệu giả dao động.
- Đã chạy OK 2026-07-01: 17 discovery + state mỗi 3s.
