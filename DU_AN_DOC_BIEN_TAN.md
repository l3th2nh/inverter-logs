# Dự án: Bộ đọc biến tần đa hãng qua RS485 → Home Assistant

> Thiết bị "cắm là chạy": cắm vào cổng RS485/COM của biến tần (Solis, Deye, Lux, Growatt...),
> tự nhận diện hãng, đọc toàn bộ thông số (pin, nhiệt độ, công suất PV, công suất lưới,
> tải tiêu thụ...) và đẩy ra cho bên thứ 3 (Home Assistant, MQTT) để làm dashboard + tự động hóa.
>
> Kế thừa phong cách dự án `DoBeNuoc`: ESP32 + PlatformIO/ESPHome + Home Assistant + custom_component.
> Cập nhật lần đầu: 2026-07-01.

---

## 1. Mục tiêu & phạm vi

**Mục tiêu:** 1 hộp nhỏ gắn cạnh biến tần, dây RS485 cắm vào cổng COM của biến tần.
Bật lên là:
1. Phát WiFi riêng (AP) → điện thoại bắt WiFi đó → mở trang cấu hình (captive portal) → chọn WiFi nhà + chọn hãng biến tần (hoặc để **Auto-detect**).
2. Thiết bị kết nối WiFi nhà, tự dò ra đúng hãng/biến tần, đọc dữ liệu định kỳ.
3. Đẩy dữ liệu qua **MQTT (HA auto-discovery)** → Home Assistant tự hiện sensor, không cần cấu hình tay.
4. Dùng dữ liệu để chạy kịch bản tự động (đang mua điện lưới → tắt bớt tải; dư điện mặt trời → bật điều hòa...).

**Các hãng nhắm tới (giai đoạn đầu):** Solis (Ginlong), Deye (= Sunsynk/SolArk cùng gốc), Luxpower (Lux), Growatt. Sau mở rộng: GoodWe, Sofar, Sungrow.

> ⚠️ Người dùng viết "RS845" — chuẩn đúng là **RS485** (chuẩn bus 2 dây A/B). Toàn bộ tài liệu dùng RS485.

---

## 2. Bức tranh lớn — tại sao làm được & tham khảo sẵn có

Gần như tất cả biến tần hybrid/solar đều nói chuyện **Modbus RTU trên RS485** (function code 0x03/0x04, đọc thanh ghi 16-bit). Mỗi hãng có **bản đồ thanh ghi (register map)** riêng: cùng "SOC pin" nhưng ở địa chỉ khác nhau, hệ số nhân (scale) khác nhau. → Bài toán chính **không phải phần cứng** (phần cứng gần như giống nhau cho mọi hãng), mà là **thu thập + tổ chức register map theo hãng** và **thuật toán tự nhận diện**.

**Đây là điểm mấu chốt để tổ chức firmware "theo brand":** mỗi hãng = 1 file profile mô tả bằng dữ liệu (địa chỉ thanh ghi, scale, đơn vị, device_class). Thêm hãng mới = thêm 1 file, không sửa lõi.

### Nguồn kế thừa (đừng viết register map từ đầu — tốn hàng tháng)
| Nguồn | Dùng để làm gì |
|---|---|
| **StephanJoubert/home_assistant_solarman** (GitHub) | Có sẵn file `.yaml` định nghĩa register map cho **deye_hybrid, solis, sofar, growatt...**. Format này gần như copy thẳng thành "brand profile" của ta. **Nguồn vàng.** |
| **kbialek/deye-inverter-mqtt** | Register map + logic Deye rất đầy đủ (Python), tham chiếu để kiểm chứng. |
| **pysolarmanv5** | Thư viện Modbus qua logger "Solarman" (Deye/Solis dùng stick này) — tham khảo protocol. |
| **Solar Assistant** (sản phẩm thương mại, Raspberry Pi) | Chính là thứ ta đang làm phiên bản DIY. Xem như "chuẩn mực" đối chiếu tính năng (nó auto-detect Solis/Deye/Lux/Growatt...). |
| **ESPHome `modbus_controller`** | Ví dụ cấu hình Modbus cho Solis/Deye có sẵn trên cộng đồng — dùng cho bản MVP nhanh 1 hãng. |

### Cảnh báo quan trọng theo hãng
- **Solis:** Modbus RTU, thường **9600 baud**, đọc **input register (0x04)**. Cổng COM là RJ45. Map documented tốt.
- **Deye / Sunsynk / SolArk:** Modbus RTU **9600**, **holding register (0x03)**, slave ID mặc định **1**. Map rất phổ biến. (Deye & Solis KHÁC map dù hay bị nhầm là cùng gốc.)
- **Growatt:** Modbus RTU 9600, map documented tốt.
- **⚠️ Luxpower (Lux):** KHÔNG phải Modbus RTU chuẩn — dùng **protocol riêng** (khung dữ liệu đặc thù, cộng đồng hay đấu qua dongle TCP — xem project `lxp-bridge`). → Lux cần "adapter" riêng trong firmware, KHÔNG dùng chung engine Modbus như 3 hãng kia. Coi đây là hạng mục riêng, làm sau Solis/Deye.

---

## 3. Quyết định kiến trúc (đã cân nhắc)

### 3.1. Chọn nền firmware: **Custom firmware (PlatformIO/Arduino) — KHÔNG dùng ESPHome cho bản chính**
| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **A. ESPHome (YAML `modbus_controller`)** | Nhanh, OTA sẵn, HA-native | Register map phải **cố định lúc biên dịch** → mỗi hãng 1 YAML riêng, KHÔNG auto-detect runtime, KHÓ làm captive portal chọn hãng | Chỉ dùng cho **MVP 1 hãng** (Phase 1) |
| **B. Custom firmware + brand-profile engine** ⭐ | Auto-detect runtime, đổi hãng không cần nạp lại, portal cấu hình, MQTT discovery — đúng tầm "sản phẩm" | Viết nhiều hơn | **CHỌN cho bản chính** — khớp yêu cầu "tổ chức theo brand + tự nhận diện + AP cấu hình" |
| C. Tasmota + Modbus rules | Có sẵn | Rất hạn chế với map phức tạp | Bỏ |

> Chiến lược: **Phase 1 dùng ESPHome đọc thử 1 hãng bạn đang có** để kiểm chứng phần cứng/dây nhanh trong 1 buổi → sau đó chuyển hẳn sang custom firmware (B) cho các phase còn lại. Đúng như `DoBeNuoc` đã làm (PlatformIO test trước, ESPHome sau).

### 3.2. Chọn luồng cấu hình: **Captive portal TRÊN THIẾT BỊ (không phải ha.local)**
Bạn mô tả "bắt wifi rồi vào ha.local để cấu hình" — cần tách bạch: `ha.local` là Home Assistant (máy chủ), không phải thiết bị. Luồng chuyên nghiệp là **portal chạy ngay trên ESP32** (như WiFiManager/Tasmota/ESPHome-improv):

```
Lần đầu bật  ──►  ESP32 phát AP "InverterBridge-A1B2"  (không mật khẩu / mã in trên tem)
   │
Điện thoại bắt AP đó  ──►  tự bật trang http://192.168.4.1  (captive portal của THIẾT BỊ)
   │
Trang cấu hình:  [Chọn WiFi nhà ▼] [Mật khẩu] | Hãng biến tần: (○ Auto-detect  ○ Solis ○ Deye ○ Lux ○ Growatt)
   │                                          | (tùy chọn) MQTT broker IP/user/pass
Lưu  ──►  ESP32 reboot, vào WiFi nhà  ──►  auto-detect  ──►  đẩy MQTT  ──►  HA tự hiện sensor
```

- **Không phụ thuộc HA để cấu hình** → thiết bị vẫn chạy độc lập, ai cũng dùng được.
- HA nhận dữ liệu qua **MQTT auto-discovery** (chuẩn công nghiệp, "bên thứ 3 khai thác" đúng nghĩa) → HA tự tạo sensor, không cần custom_component. (Custom_component/Lovelace card đẹp làm sau, giống `be_nuoc`.)
- Có thể thêm **mDNS** để truy cập `http://inverterbridge.local` xem trang trạng thái sau khi đã online.

### 3.3. An toàn & chạy song song với que WiFi stick → **PASSIVE SNIFFING (nghe lén thụ động)** ⭐
> Đây là quyết định kiến trúc QUAN TRỌNG NHẤT, do 2 yêu cầu bắt buộc: (1) thiết bị phải chạy **song song** với que WiFi stick của Solis (KHÔNG được mất SolisCloud); (2) **tuyệt đối an toàn** cho biến tần, không được có rủi ro làm hỏng.

**Vấn đề "2 master":** Modbus RTU chuẩn chỉ cho 1 master/bus. Trên cổng COM Solis, que WiFi stick là master (hỏi), biến tần là slave (đáp). Nếu thiết bị ta cũng làm master (chủ động hỏi) → **xung đột 2 master**, hỏng giao tiếp. → **KHÔNG làm master trên cổng đó.**

**Giải pháp: thiết bị chỉ NGHE, KHÔNG BAO GIỜ GỬI.** RS485 là bus chung — mọi node đều nghe được toàn bộ traffic. Ta đấu A/B **song song** vào bus, để module RS485 ở chế độ nhận vĩnh viễn, **giải mã các khung Modbus mà que stick đang hỏi và biến tần đang đáp** (bắt cặp request→response). Que stick vẫn chạy bình thường, SolisCloud vẫn hoạt động, còn ta lấy ké dữ liệu.

**Vì sao AN TOÀN 100% cho biến tần:**
- Ta **không bao giờ truyền** lên bus → không thể gây xung đột, không thể ghi nhầm thanh ghi, không thể làm treo giao tiếp stick↔inverter.
- Chỉ thêm 1 "tai nghe" trở kháng cao vào bus (RS485 chịu 32+ node) → không tải bus.
- Module XY-S485 **cách ly** → sự cố điện bên ta không lan sang biến tần.
- Về bản chất giống cắm tai nghe vào đường dây — không can thiệp.

**Đã có tiền lệ chứng minh khả thi:** `candlerb/solis_exporter` và `grob6000/esphome-externalcomponents` làm ĐÚNG việc này — sniff thụ động giữa inverter Solis và que logger; ESP32 nhỏ tới mức nhét vừa trong vỏ que logger. `ha-addon-modbusspy` cũng là sniffer thụ động.

**Đánh đổi:** ta chỉ thấy các thanh ghi mà **que stick có hỏi**. May mắn là stick Solis poll một tập rất rộng (SOC, PV, lưới, tải, nhiệt độ, năng lượng...) — đủ cho mọi automation ta cần. Nếu sau này cần thanh ghi stick không hỏi → cân nhắc (giữ nguyên passive là ưu tiên).

**Chế độ hoạt động của firmware theo tình huống:**
| Tình huống | Chế độ | Ghi chú |
|---|---|---|
| Có que WiFi stick (mặc định của bạn) | **SNIFFER (passive)** | Chạy song song, an toàn tuyệt đối |
| Không có stick (cắm 1 mình) | **MASTER (active poll)** | Chủ động hỏi, lấy được mọi thanh ghi |
| Mọi hãng | **CHỈ ĐỌC** | Không GHI thanh ghi tới khi rất hiểu (tránh đổi nhầm cài đặt) — tính năng ghi làm rất sau, có xác nhận |

---

## 4. Danh sách linh kiện (BOM)

| # | Linh kiện | Công dụng | Ghi chú chọn mua |
|---|---|---|---|
| 1 | **ESP32 DevKit** (WROOM-32) | Vi điều khiển + WiFi | Có thể ESP32-S3; classic đủ dùng. Đồng bộ với `DoBeNuoc`. |
| 2 | **Module RS485 CÁCH LY (isolated)** | Giao tiếp RS485 an toàn cạnh biến tần | ⭐ Ưu tiên **có cách ly quang + tự động điều hướng** (chip kiểu ADM2483 / CA-IS3082 / "isolated RS485 to TTL auto flow"). Rẻ hơn: **MAX485 module** (không cách ly) chỉ cho prototype. |
| 3 | **Nguồn 5V** | Nuôi ESP32 | Prototype: cấp USB. Sản phẩm: adapter 5V USB, hoặc **Hi-Link HLK-5M05** (220V→5V) nếu muốn cấp nguồn 220V gọn trong hộp. |
| 4 | **Điện trở 120Ω** (đầu cuối bus) | Terminate RS485 khi dây dài/cuối bus | Gắn qua **jumper** để bật/tắt (nhiều biến tần đã có sẵn 120Ω bên trong → chỉ bật khi cần). |
| 5 | **Đầu RJ45 + dây / cầu đấu A-B-GND** | Cắm vào cổng COM biến tần | Đa số biến tần dùng **RJ45** (kiểu Pylontech/WeCo) hoặc **cầu đấu xanh Phoenix A/B/GND**. Làm 1 pigtail RJ45 → 3 dây (A, B, GND). |
| 6 | **LED trạng thái + nút Reset/Config** | Báo trạng thái, giữ nút 5s để về AP cấu hình | LED: xanh=online, vàng=đang dò, đỏ=lỗi comms. |
| 7 | **TVS/ESD trên A-B** (tùy chọn, nên có) | Chống sét lan truyền / xung | Chuyên nghiệp hơn, bảo vệ cổng biến tần. |
| 8 | **Hộp nhựa kín** | Lắp đặt cạnh biến tần | Tránh bụi/ẩm. |

> Điểm khác `DoBeNuoc`: dự án nước cần ADS1115 (đọc analog 4-20mA). Dự án này **không cần ADC** — chỉ cần **module RS485**. Phần cứng đơn giản hơn, phần mềm phức tạp hơn.

---

## 5. Sơ đồ đấu nối (netlist) — cho phần cứng THỰC TẾ đã có

Phần cứng: **ESP32 DevKit (USB-C)** + **module XY-S485 (AIDEEPEN) — isolated, auto flow direction**.
Module này: cách ly nguồn+tín hiệu, tự điều hướng (KHÔNG cần dây DE/RE), có TVS + ống phóng khí chống sét + cầu chì nhiệt. Phía TTL là JST 4 chân **VCC–TXD–RXD–GND**, phía RS485 là cầu đấu **A+ / B− / Earth**.

```
XY-S485  phía TTL (JST 4 chân)                 ESP32
────────────────────────────                   ─────────────────
VCC  ◄──────────────────────────────────────   3V3   ⚠️ DÙNG 3V3, KHÔNG dùng 5V (xem lưu ý)
TXD  (module gửi ra MCU) ───────────────────►   GPIO16 (UART2 RX)
RXD  (module nhận từ MCU) ◄──────────────────   GPIO17 (UART2 TX)
GND  ───────────────────────────────────────   GND

XY-S485  phía RS485 (cầu đấu)                   Solis COM (RJ45)
────────────────────────────                   ─────────────────
A+   ───────────────────────────────────────   chân RS485 A của Solis   (tra manual — mục 5.1)
B−   ───────────────────────────────────────   chân RS485 B của Solis
Earth (E) ───(tùy chọn)─────────────────────   vỏ/màn chắn cáp (nếu có)

Nguồn ESP32: cấp qua USB-C khi test. Lắp cố định: adapter 5V USB.
```

> ⚠️ **BẮT BUỘC cấp VCC module = 3V3, KHÔNG phải 5V.** Module chạy 3–5.5V; nếu cấp 5V thì chân TXD của module xuất mức cao 5V → **GPIO16 của ESP32 không chịu được 5V, có thể hỏng**. Cấp 3V3 để mức tín hiệu TXD = 3.3V, an toàn cho ESP32.

> ⚠️ **Đấu chéo TX↔RX:** ESP32 TX (GPIO17) → module **RXD**; ESP32 RX (GPIO16) ← module **TXD**. Đi theo **chữ in trên board** (silkscreen VCC-TXD-RXD-GND), đừng đi theo màu dây.

> ✅ Module đã **cách ly + auto-direction + chống sét** → đúng chuẩn "chuyên nghiệp", không cần thêm module cách ly/TVS rời. Phía A+/B− nối biến tần và phía TTL nối ESP32 có GND riêng (cách ly) — đó là điều mong muốn.

### 5.1. Chân A/B trên cổng Solis S6 — ĐÃ XÁC ĐỊNH ✅
Theo tài liệu Solar-Assistant cho **Solis S6 Hybrid** (khớp dòng S6-EH1P của bạn):

| Pin RJ45 (cổng COM) | Chức năng |
|---|---|
| **Pin 5** | **RS485 A** |
| **Pin 4** | **RS485 B** |
| 1, 2, 3, 6, 7, 8 | Không dùng |

- "Chỉ cần nối RS485A và RS485B. GND nối cũng được, không bắt buộc." → nối **Solis Pin5 (A) → XY-S485 A+** ; **Solis Pin4 (B) → XY-S485 B−**.
- Pin 4-5 là **cặp giữa** của hạt RJ45 (theo T568B là đôi xanh dương). Dùng **breakout RJ45** để lấy 2 chân này ra cầu đấu.
- Thông số comms: **9600 baud, 8N1, slave ID 1, function code 04 (input register)**.
- ⚠️ **Xung đột master:** cổng COM này là nơi cắm **que datalogger/WiFi stick** của Solis (stick là master, biến tần là slave). **Không cắm được cả stick lẫn thiết bị ta cùng lúc.** Khi dùng thiết bị này → **rút que WiFi stick** (tạm mất SolisCloud). Cần biết trước.
- Đảo A/B không gây cháy — nếu không đọc được thì thử đảo lại.

> ⚙️ **Về địa chỉ trên đường truyền:** tài liệu Solis ghi thanh ghi dạng `33xxx` (bảng "operating info" 30001–39999). Khi làm **Modbus master trực tiếp**, có nơi phải gửi địa chỉ = `số tài liệu − 30001` (vd 33093 → 3092), có nơi gửi thẳng `33xxx`. → Firmware test Phase 1 sẽ **thử cả 2** và tự báo cách nào đúng (xem mục 13).

---

## 6. Cấu trúc thư mục dự án (đề xuất)

```
InverterLogs/
├── DU_AN_DOC_BIEN_TAN.md          # tài liệu này
├── esphome/
│   └── mvp-solis.yaml             # Phase 1: MVP đọc thử 1 hãng bằng ESPHome
├── firmware/                       # Bản chính (PlatformIO, custom)
│   ├── platformio.ini
│   └── src/
│       ├── main.cpp
│       ├── core/                   # LÕI, không phụ thuộc hãng
│       │   ├── modbus_rtu.*        # đọc/ghi thanh ghi, CRC, timeout, retry
│       │   ├── wifi_portal.*       # AP + captive portal cấu hình
│       │   ├── mqtt_ha.*           # MQTT + Home Assistant auto-discovery
│       │   ├── detector.*          # thuật toán auto-detect hãng
│       │   └── scheduler.*         # vòng lặp đọc định kỳ, watchdog, reconnect
│       ├── brands/                 # ⭐ MỖI HÃNG 1 PROFILE (data-driven)
│       │   ├── brand_registry.*    # danh sách profile + hàm tra cứu
│       │   ├── solis/profile.*     # register map + chữ ký nhận diện Solis
│       │   ├── deye/profile.*
│       │   ├── growatt/profile.*
│       │   └── lux/adapter.*       # Lux dùng protocol riêng → adapter riêng
│       └── model/
│           └── metric.h            # struct chuẩn: {key, addr, fc, scale, unit, device_class}
└── custom_components/              # (tùy chọn, sau) card/panel đẹp cho HA như be_nuoc
    └── inverter_bridge/
```

### Ý tưởng "brand profile" (trái tim của việc tổ chức theo hãng)
Mỗi profile chỉ là **dữ liệu mô tả**, ví dụ (giả mã):
```cpp
// brands/deye/profile — Deye Hybrid
BrandProfile DEYE = {
  .name = "Deye Hybrid",
  .baud = 9600, .slave_id = 1,
  .detect = { .fc = 0x03, .addr = 3, .expect_mask = ..., },   // đọc thanh ghi "model" để nhận diện
  .metrics = {
    // key,            fc,   addr, kiểu,   scale, đơn vị, device_class
    {"battery_soc",    0x03, 588,  U16,    1,     "%",   "battery"},
    {"battery_power",  0x03, 590,  S16,    1,     "W",   "power"},
    {"pv_power",       0x03, 672,  U16,    10,    "W",   "power"},
    {"grid_power",     0x03, 619,  S16,    1,     "W",   "power"},   // âm=xuất, dương=mua
    {"load_power",     0x03, 653,  U16,    1,     "W",   "power"},
    {"inverter_temp",  0x03, 541,  S16,    0.1,   "°C",  "temperature"},
    // ... (lấy đầy đủ từ home_assistant_solarman/deye_hybrid.yaml)
  }
};
```
> Các con số địa chỉ ở trên là **minh họa** — số thật lấy từ file YAML của `home_assistant_solarman` rồi kiểm chứng bằng máy thật ở Phase 1-2.

---

## 7. Thuật toán tự nhận diện (auto-detect)

```
Cho mỗi baud trong [9600, 19200, 4800]:
  Cho mỗi slave_id trong [1, 2, ... , (mặc định từng hãng)]:
    Cho mỗi profile trong registry (Solis, Deye, Growatt...):
      - Gửi lệnh đọc "thanh ghi nhận diện" của profile (vd: model/SN/protocol version)
      - Nếu đọc OK & giá trị khớp chữ ký (expect_mask) → KHÓA profile này
      - Lưu {brand, baud, slave_id} vào bộ nhớ (NVS) để lần sau khỏi dò lại
Nếu hết mà không khớp → báo "không nhận diện được" (đèn đỏ), cho phép chọn tay trong portal.
```
- **Chữ ký nhận diện:** ưu tiên thanh ghi trả về mã model / serial cố định theo hãng, hoặc dải giá trị hợp lệ đặc trưng. Tránh nhầm giữa Deye/Solis bằng cách đọc đúng thanh ghi định danh của từng hãng.
- **Lux** không nằm trong vòng Modbus này → thử adapter Lux riêng nếu 3 hãng Modbus đều trượt.
- Lưu cấu hình đã dò vào NVS → lần bật sau **vào thẳng**, chỉ dò lại khi mất comms lâu.

---

## 8. Dữ liệu đẩy ra HA (các sensor mục tiêu)

| Nhóm | Sensor | Đơn vị | Dùng cho automation |
|---|---|---|---|
| Pin | SOC, điện áp, dòng, **công suất sạc/xả** (âm/dương), nhiệt độ pin | %, V, A, W, °C | Ưu tiên xả pin, cảnh báo pin nóng |
| PV | Công suất mỗi MPPT string, tổng PV, điện áp/dòng string | W, V, A | Biết đang dư nắng |
| **Lưới** | **Công suất lưới (grid power): dương=MUA, âm=BÁN** | W | ⭐ Kịch bản "đang mua điện → tắt tải" |
| Tải | Công suất tải (load/backup), AC output | W | Biết đang tiêu thụ bao nhiêu |
| Nhiệt | Nhiệt độ biến tần (inverter/heatsink) | °C | Cảnh báo quá nhiệt |
| Năng lượng | PV hôm nay/tổng, mua/bán hôm nay, sạc/xả hôm nay | kWh | Thống kê, Energy Dashboard HA |
| Trạng thái | Chế độ chạy, mã lỗi, tần số, điện áp lưới | — | Cảnh báo sự cố |

MQTT auto-discovery sẽ tự tạo các entity trên trong HA (device_class + unit chuẩn → vào thẳng **Energy Dashboard**).

---

## 9. Kịch bản tự động hóa (ví dụ thực tế trong HA)

**A. Đang mua điện lưới nhiều → cắt tải không cần thiết**
```yaml
automation:
  - alias: "Mua dien luoi cao -> tat tai phu"
    trigger:
      - platform: numeric_state
        entity_id: sensor.inverter_grid_power   # dương = đang mua
        above: 300                                # mua > 300W trong 2 phút
        for: "00:02:00"
    action:
      - service: switch.turn_off
        target: { entity_id: [switch.dieu_hoa_phong_trong, switch.binh_nong_lanh] }
```

**B. Dư điện mặt trời (đang bán ra lưới) → bật điều hòa cho mát/xài đồ**
```yaml
  - alias: "Du dien mat troi -> bat dieu hoa"
    trigger:
      - platform: numeric_state
        entity_id: sensor.inverter_grid_power
        below: -800                               # đang bán ra > 800W
        for: "00:05:00"
    condition:
      - condition: numeric_state
        entity_id: sensor.inverter_battery_soc
        above: 90                                 # pin đã gần đầy mới xả sang tải
    action:
      - service: climate.turn_on
        target: { entity_id: climate.phong_khach }
```

**C. Pin/biến tần quá nóng → cảnh báo điện thoại** (numeric_state trên `battery_temp`/`inverter_temp` → notify).

> Đây chính là giá trị cuối cùng của dự án: biến số liệu biến tần thành **hành động tự động tiết kiệm điện**.

---

## 10. Lộ trình triển khai (phases)

### Phase 0 — Nghiên cứu & gom register map (1 tuần, làm trên máy tính)
- [ ] Xác định **bạn đang có biến tần hãng nào** để làm trước (quyết định thứ tự Phase 1).
- [ ] Tra manual cổng COM/RS485 của biến tần đó (chân A/B, baud, slave ID).
- [ ] Clone `home_assistant_solarman`, lấy file YAML register map của hãng đó làm gốc profile.

### Phase 1 — MVP phần cứng, đọc thử 1 hãng (ESPHome, 1 buổi)
- [ ] Ráp ESP32 + module RS485, cắm vào biến tần.
- [ ] Nạp `esphome/mvp-solis.yaml` (hoặc deye) với `modbus_controller` + vài thanh ghi (SOC, grid_power, pv_power).
- [ ] Thấy số chạy đúng trong HA → **xác nhận phần cứng + dây + register map đúng**. (Giống bước test PlatformIO của `DoBeNuoc`.)

### Phase 2 — Custom firmware + brand-profile engine (bản chính)
- [ ] Dựng `firmware/` PlatformIO: core Modbus RTU (CRC, timeout, retry) + 1 profile (hãng đã test).
- [ ] Đọc toàn bộ metric của hãng đó, in Serial → đối chiếu với ESPHome ở Phase 1.
- [ ] Refactor thành `BrandProfile` data-driven.

### Phase 3 — Đa hãng + auto-detect
- [ ] Thêm profile hãng 2, 3 (Deye/Growatt) từ YAML nguồn.
- [ ] Viết `detector` quét baud/slave/profile → khóa hãng, lưu NVS.
- [ ] (Sau) adapter riêng cho **Lux** (protocol riêng).

### Phase 4 — WiFi captive portal cấu hình
- [ ] AP + trang cấu hình (chọn WiFi, chọn hãng/Auto, nhập MQTT).
- [ ] Nút giữ 5s để xóa cấu hình về lại AP.
- [ ] Lưu cấu hình vào NVS.

### Phase 5 — MQTT + Home Assistant auto-discovery
- [ ] Publish discovery topic cho từng metric (device_class/unit chuẩn).
- [ ] HA tự hiện device "Inverter Bridge" với đầy đủ sensor.

### Phase 6 — Dashboard + Automation
- [ ] Card Lovelace / Energy Dashboard.
- [ ] Nạp 3 automation ở mục 9, tinh chỉnh ngưỡng.

### Phase 7 — Hoàn thiện sản phẩm
- [ ] OTA update, watchdog, tự reconnect WiFi/MQTT/Modbus.
- [ ] Module RS485 **cách ly** + TVS, hộp kín, LED trạng thái.
- [ ] (Tùy chọn) custom_component + Lovelace card đẹp như `be_nuoc`.
- [ ] (Rất sau, cẩn trọng) chức năng GHI thanh ghi có xác nhận.

---

## 11. Rủi ro & lưu ý

1. **An toàn điện:** biến tần dính điện lưới/PV cao áp. Dùng module RS485 **cách ly**, đấu dây khi biến tần đã có sẵn cổng COM (tín hiệu thấp áp) — KHÔNG mở khoang công suất.
2. **Read-only trước:** không ghi thanh ghi cho tới khi thật hiểu, tránh đổi nhầm cài đặt biến tần.
3. **Lux khác biệt:** đừng gom Lux chung engine Modbus — làm sau, adapter riêng.
4. **Cổng COM có thể đang bận:** nếu biến tần đã cắm sẵn stick WiFi/BMS trên cùng bus RS485 → có thể xung đột. Kiểm tra biến tần có cổng RS485 thứ 2 (Meter) trống không, hoặc đấu song song bus đúng cách (cùng baud, khác slave — cẩn thận).
5. **Register map phải kiểm chứng máy thật:** số địa chỉ trên mạng đôi khi lệch theo firmware biến tần → luôn đối chiếu với app chính hãng ở Phase 1-2.

---

## 12. Chốt cấu hình khởi động (đã xác định 2026-07-01)

| Hạng mục | Chốt |
|---|---|
| **Biến tần** | ✅ **Solis S6-EH1P(9.9-16)K03-NV-YD-L**, bản **12kW** — dòng **S6 Hybrid 1 pha có pin** (đủ data pin/lưới/PV/tải) |
| **Cổng biến tần** | ✅ **RJ45** — cần chụp trang "COM/RS485 pin definition" của manual để chốt chân A/B |
| **Phần cứng** | ✅ ESP32 DevKit + **XY-S485 isolated auto-direction** + breakout RJ45 — ĐỦ (xem mục 12.1) |
| **Home Assistant** | ✅ Đang chạy `http://192.168.0.146:8123` (ha.local, cùng dải Wi-Fi 192.168.0.x) |
| **MQTT broker** | ✅ **Đã cài Mosquitto** trên HA |

### 12.1. Đánh giá phần cứng — ĐỦ, không thiếu gì cốt lõi
- ✅ **ESP32 DevKit** — OK.
- ✅ **XY-S485 (isolated, auto flow)** — lựa chọn **rất tốt**, còn xịn hơn khuyến nghị ban đầu: cách ly nguồn+tín hiệu, tự điều hướng (đỡ 1 GPIO + code đơn giản), có TVS + ống phóng khí chống sét + cầu chì nhiệt. Không cần mua thêm module cách ly/TVS.
- ✅ **Breakout RJ45** — để dò/đấu chân A/B từ cổng COM Solis.
- 🟡 **Nên có thêm (không gấp):**
  - **1 dây mạng RJ45 (male-male)** để nối cổng COM Solis → breakout (nếu breakout là jack cái).
  - **Adapter 5V USB** để cấp nguồn cố định khi lắp thật (giờ test cắm USB máy tính là đủ).
  - **Hộp nhựa kín** khi hoàn thiện.
- ❌ **KHÔNG cần:** ADS1115/ADC (khác dự án nước), module cách ly rời, nguồn cách ly riêng (module tự cách ly từ VCC).

### 12.2. Thiết kế field cấu hình (theo yêu cầu: brand + model + custom name)
Trang captive portal & bản ghi cấu hình (NVS) sẽ có:
```json
{
  "wifi_ssid": "...", "wifi_pass": "...",
  "inverter": {
    "mode": "auto",                 // "auto" = tự dò | "manual" = chọn tay
    "brand": "solis",               // solis | deye | growatt | lux | custom
    "model": "S6-EH1P-hybrid",      // chọn từ danh sách theo brand
    "custom_name": ""               // điền khi brand=custom hoặc model không có trong list
  },
  "modbus": { "baud": 9600, "slave_id": 1 },   // để trống = auto-scan
  "mqtt": { "host": "192.168.0.146", "port": 1883, "user": "...", "pass": "..." }
}
```
**Auto-detect 2 tầng:**
1. **Tầng brand:** quét baud/slave, thử "chữ ký" từng hãng → khóa brand (vd đọc được đúng thanh ghi định danh Solis).
2. **Tầng model:** sau khi biết brand, đọc **thanh ghi "Inverter model / product code"** của hãng đó để suy ra dòng máy (vd phân biệt S6 hybrid vs S5 string). Solis có thanh ghi model → tự nhận được cả model.
3. Nếu không khớp danh sách → cho người dùng nhập **custom_name** + chọn "gần giống" để dùng tạm register map cơ bản.

### Solis qua RS485 (ghi nhớ cho Phase 1)
- Solis: **Modbus RTU**, thường **9600 baud, 8N1**, đọc **input register (FC 0x04)**. Slave ID kiểm chứng bằng máy.
- Cổng RS485 của Solis là **RJ45** — PHẢI tra manual model cụ thể để biết pin A/B (mỗi dòng Solis khác nhau). Làm pigtail RJ45 → 3 dây A/B/GND.
- Nguồn register map gốc: file `solis` trong `home_assistant_solarman` → kiểm chứng lại với app SolisCloud.

### Cài MQTT broker (Mosquitto) — làm trên giao diện HA (~2 phút)
1. Mở `http://192.168.0.146:8123` → đăng nhập.
2. **Settings → Add-ons → Add-on Store** → tìm **"Mosquitto broker"** → **Install** → **Start** → bật **Start on boot** + **Watchdog**.
3. **Settings → Devices & Services** → HA sẽ gợi ý cấu hình tích hợp **MQTT** → **Configure** (dùng broker `core-mosquitto`).
4. (Khuyên) Tạo user MQTT riêng cho thiết bị: **Settings → People/Users** hoặc dùng user HA — firmware sẽ nhập user/pass này trong captive portal.
5. Xong → cổng 1883 sẽ mở, firmware publish discovery là HA tự hiện device "Inverter Bridge".

> Lưu ý: HAOS chỉ mở 8123 (SSH/1883 tùy add-on). Cài Mosquitto qua UI là đủ; sau khi cài, cổng 1883 sẽ mở.

---

## 13. Register map Solis Hybrid (S6-EH1P) — dùng cho Phase 1

Nguồn: `home_assistant_solarman/solis_hybrid.yaml` (kiểm chứng lại với LCD/SolisCloud khi chạy thật).
Tất cả đọc bằng **FC 04 (input register)**, slave ID 1, 9600 8N1. Số 32-bit = 2 thanh ghi liền kề.

| Metric | Reg (tài liệu) | Kiểu | Scale | Đơn vị |
|---|---|---|---|---|
| **Battery SOC** | 33139 | u16 | 1 | % |
| Battery SOH | 33140 | u16 | 1 | % |
| Battery Voltage | 33133 | u16 | 0.1 | V |
| Battery Current | 33134 | s16 | 0.1 | A |
| **Battery Power** (sạc/xả) | 33149–33150 | s32 | 1 | W |
| **Grid/Meter Power** (mua +/bán −) | 33257–33258 | s32 | 1 | W |
| Meter Frequency | 33282 | u16 | 0.01 | Hz |
| PV1 Voltage | 33049 | u16 | 0.1 | V |
| PV2 Voltage | 33051 | u16 | 0.1 | V |
| **Tổng công suất DC (PV)** | 33057–33058 | s32 | 1 | W |
| **House Load Power** (tải nhà) | 33147 | u16 | 1 | W |
| Inverter AC Power | 33151–33152 | s32 | 1 | W |
| **Inverter Temperature** | 33093 | s16 | 0.1 | °C |
| Daily Generation (PV hôm nay) | 33035 | u16 | 0.1 | kWh |
| Total Generation | 33029–33030 | u32 | 1 | kWh |
| Total Imported (mua tổng) | 33169–33170 | u32 | 1 | kWh |
| Total Battery Charge | 33161–33162 | u32 | 1 | kWh |

> 3 metric quan trọng nhất cho automation: **Grid Power (33257)**, **Battery SOC (33139)**, **PV Power (33057)**.

### Firmware test Phase 1
Đã tạo tại `firmware/` (PlatformIO). Nó đọc các thanh ghi trên và in Serial, **tự thử 2 cách đánh địa chỉ** (raw `33xxx` và offset `−30001`) để xác định cách nào máy bạn chấp nhận. Xem `firmware/README.md`.

#### ✅ KẾT QUẢ TEST (2026-07-01) — SIM_MODE ĐÃ CHẠY OK
Nạp firmware SIM_MODE=1 vào ESP32 (COM3), Serial in **17/17 thanh ghi giải mã đúng 100%**:
- Số âm bù-2 đúng (Battery Power −665W, Grid −420W), thứ tự word 32-bit đúng (`low addr = high word`), scale (×0.1/×0.01) & kiểu U16/S16/U32/S32 đúng.
- → **Rủi ro phần mềm giải mã đã loại bỏ.** Còn lại: validate tầng phần cứng RS485 (bench với USB-RS485 dongle CH340 + `tools/solis_emulator.py`).
- Công cụ dev: **USB-RS485 CH340** (~79k) đã chọn mua; dùng để chạy "Solis giả" trên PC.

#### ✅ KẾT QUẢ Phase 2 — MQTT → HOME ASSISTANT ĐÃ CHẠY (2026-07-01)
Firmware production (WiFi + MQTT + HA auto-discovery) chạy với dữ liệu SIM:
- ESP32 nối WiFi (IP 192.168.0.24) → Mosquitto (`192.168.0.146:1883`, user `inverter`) → **connect rc=0**.
- Publish **17 discovery topic** (retained) → HA **tự tạo device "Inverter Bridge" + 17 sensor**, không cấu hình tay.
- Đẩy JSON state mỗi 3s → xác minh bằng subscribe MQTT từ PC: nhận đều 6 bản/16s, số dao động đúng.
- Đã có: `firmware/src/{main.cpp, config.h, secrets.h}` + `MQTT_MAX_PACKET_SIZE=1024` + PubSubClient.
- ⚠️ Lưu ý: mở Serial monitor làm reset board → gây `rc=-4` tạm thời (phiên ma trên broker). Để yên là ổn.
- 🔜 Còn lại: (1) SNIFFER passive cho Solis thật, (4) tách brand-profile engine.

#### ✅ KẾT QUẢ Phase 2 — WiFi CAPTIVE PORTAL ĐÃ CHẠY (2026-07-01)
Thiết bị tự cấu hình qua web, không còn hardcode WiFi/MQTT:
- File: `firmware/src/{app_config.*, portal.*}` — lưu cấu hình vào **NVS** (Preferences).
- Vào portal khi: **chưa cấu hình** hoặc **giữ nút BOOT (GPIO0) ~2s** lúc khởi động.
- Portal: phát AP **`InverterBridge-XXXX`** → điện thoại bắt WiFi → trang cấu hình tự bung (captive) tại `192.168.4.1`:
  - Chọn WiFi (quét sẵn danh sách) + mật khẩu.
  - Chọn **Hãng** (Solis/Deye/Growatt/Lux/Custom) → **Model** (dropdown lọc theo hãng, JS) → ô **tên tùy chỉnh**.
  - MQTT host/port/user/pass (điền sẵn 192.168.0.146).
  - Lưu → NVS → tự khởi động lại → vào WiFi + đẩy MQTT.
- `PORTAL_SEED_DEFAULTS=1` (mặc định dev): nếu chưa cấu hình thì nạp từ `secrets.h` để chạy ngay. Đặt `0` để ép qua portal lần đầu (hành vi sản phẩm thật).
- Đã kiểm chứng: nạp firmware portal, thiết bị vẫn nối WiFi + MQTT + publish 17 sensor bình thường (không regression).
- ✅ **Portal đã test thực tế OK (2026-07-01):** giữ nút **BOOT (GPIO0) ~2s LÚC ĐANG CHẠY** (không phải lúc reset — giữ lúc reset sẽ vào download mode) → phát AP `InverterBridge-XXXX` → điện thoại vào `192.168.4.1` thấy form cấu hình. Nút được poll trong `loop()` (non-blocking).
> Lưu ý: firmware test hiện tại là chế độ **MASTER (active)** — chỉ dùng để bench-test với thiết bị giả lập/BMS, KHÔNG cắm vào cổng COM Solis khi còn que stick (sẽ xung đột). Bản chạy thật vào Solis sẽ là chế độ **SNIFFER passive** (xem mục 3.3 và 14).

#### ✅ KẾT QUẢ Phase 6 (một phần) — DASHBOARD + AUTOMATION (2026-07-01)
- Thêm `obj_id` vào discovery → entity tên cố định **`sensor.ib_<key>`** (dashboard/automation chạy chắc).
- File: `homeassistant/{dashboard.yaml, automations.yaml, README.md}`.
- Dashboard: gauge SOC + nhiệt độ, glance công suất (PV/lưới/tải/pin), history 24h, chi tiết, năng lượng.
- Automation mẫu (dùng thông báo, chưa có thiết bị điều khiển): mua điện cao, dư điện bán ra, quá nhiệt, pin yếu — có comment sẵn chỗ gắn switch/climate thật.
- ⚠️ Dấu `grid_power` (+mua/−bán) cần kiểm chứng với số Solis thật.

#### ✅ KẾT QUẢ — PANEL TÙY CHỈNH "Hệ điện mặt trời" (2026-07-02)
Custom component `custom_components/inverter_bridge/` (giống khuôn mẫu panel "Nhà tôi" của DoBeNuoc):
- Panel sidebar HA: sơ đồ dòng năng lượng trực tiếp (PV/lưới/pin/tải) + badge đang lấy/bán lưới.
- Tab **Thông báo**: cảnh báo khi bắt đầu lấy điện lưới (ngưỡng, giữ, cooldown, nội dung, test).
- Tab **Tự động hóa**: quy tắc KHI…THÌ tắt/bật thiết bị; chạy trực tiếp khi panel mở + **Xuất YAML** cho 24/7.
- Ánh xạ cảm biến (mặc định `sensor.ib_*`) + chọn chiều dương lưới. Lưu qua WebSocket Store (`/config/.storage`).
- Dùng thẳng `hass` (states/callService/services) — không cần token. `node --check` + `py_compile` OK.
- Cài: chép `custom_components/inverter_bridge/` vào HA config → restart → Add Integration "Inverter Bridge". Xem `custom_components/README.md`.

---

## 14. Kế hoạch TEST AN TOÀN — không đụng biến tần thật cho tới khi chắc chắn

> Nguyên tắc: **validate 100% phần mềm + phần cứng trên bàn (bench) trước**, chỉ cắm vào biến tần thật ở bước cuối, và khi đó là chế độ **passive (chỉ nghe)** nên vốn đã an toàn.

Phần cứng bạn đang có để giả lập: **1 BMS (RS485 + CAN)**, **1 Makerbase CANable 2.0** (USB-CAN, chip STM32G431).

### Thang test 4 nấc (từ an toàn nhất → thật)
| Nấc | Mục tiêu | Cách làm | Rủi ro biến tần |
|---|---|---|---|
| **1. SIM mode (chỉ phần mềm)** | Kiểm tra giải mã register, scale, dấu, thứ tự word, publish MQTT/HA | Firmware có cờ `SIM_MODE`: nạp dữ liệu Solis "giả" (SOC=87, grid=−420...) vào đúng pipeline giải mã → xem HA có hiện đúng không | KHÔNG (0 dây nối) |
| **2. Bench Modbus MASTER (phần cứng thật)** | Kiểm tra XY-S485 + đấu 3V3/chéo + stack Modbus RTU chạy thật | ESP32 (master) ↔ **BMS RS485** (slave). Đọc/scan thanh ghi BMS. Xác nhận đọc RS485 OK | KHÔNG (chỉ đụng BMS) |
| **3. Bench SNIFFER (giả lập đúng cảnh Solis)** | Kiểm tra bộ **sniffer passive** — trái tim bản chạy thật | Cần 1 "master giả" (đóng vai que stick) + 1 "slave" nói chuyện, ESP32 nghe lén. Xem lựa chọn bên dưới | KHÔNG |
| **4. Cắm biến tần thật (passive)** | Chạy thật | Đấu A/B song song bus COM Solis, firmware **chỉ nghe** | Cực thấp — không truyền gì lên bus |

### Chi tiết Nấc 3 — dựng "phòng thí nghiệm Solis" trên bàn
Cần 2 node nói chuyện Modbus RTU trên 1 bus RS485 để ESP32 sniff:
- **Cách A (khuyên — sát thật nhất):** mua **1 USB-RS485 dongle** (~30–50k). PC chạy `pymodbus`:
  - 1 tiến trình **slave** = "Solis giả" nạp đúng register map ở mục 13 (SOC, grid, PV...).
  - 1 tiến trình **master** = "que stick giả" poll liên tục.
  - ESP32 + XY-S485 đấu song song A/B → **sniff** → phải hiện đúng số như Solis giả.
  → Đây là bản sao 1:1 của hiện trường, validate sniffer trọn vẹn mà 0 rủi ro. (Tôi sẽ viết sẵn script Python này.)
- **Cách B (không mua gì thêm):** dùng **BMS RS485 làm slave** + **1 USB-RS485 dongle** (PC làm master poll BMS) + ESP32 sniff. Số liệu là của BMS nhưng **cơ chế sniffer giống hệt** → vẫn validate được khung/ghép cặp request-response.
- **Cách C:** dùng **2 con ESP32** (1 làm "Solis giả" slave, 1 làm sniffer). Cần thêm 1 module RS485 nữa.

### Về Makerbase CANable 2.0 & BMS CAN
- CANable 2.0 là **USB-CAN** (không phải RS485) → **không giả lập được RS485/Modbus của Solis**.
- Nhưng rất hữu ích cho **nhánh CAN**: sniff/giả lập **cổng CAN của BMS** (pin↔inverter thường nói chuyện CAN, vd giao thức kiểu Pylontech 500kbps). Dùng `python-can`/SocketCAN để đọc/bơm khung CAN an toàn với BMS.
- → Lộ trình phụ: sau khi xong Solis RS485, thêm tính năng **đọc pin qua CAN** (dùng CANable để nghiên cứu giao thức BMS trước).

### Khuyến nghị mua 1 món cho dev
**1× USB-RS485 dongle** (loại chip CH340/CP2102 + MAX485, có sẵn đầy, rẻ). Đây là công cụ dev giá trị nhất: biến PC thành máy giả lập Modbus (cả master lẫn slave) để test master, sniffer, và soi bus khi debug biến tần thật.

---

## 15. Sơ đồ mạch CỐ ĐỊNH (build 1 lần, sau chỉ nạp firmware)

> Mục tiêu: 1 board đa năng. Phần lõi (ESP32 + XY-S485) đấu 1 lần; muốn đọc RS485 hay CAN
> chỉ **nạp firmware + cắm dây vào cầu đấu tương ứng**, KHÔNG đấu lại mạch.

### 15.1. Nguyên tắc dùng chung
- **RS485 (XY-S485)** dùng chung cho: Solis (sniffer), thiết bị Modbus khác, dongle bench.
  → Cùng 1 cầu đấu A/B, chỉ đổi dây sang thiết bị cần đọc + đổi firmware.
- **CAN (SN65HVD230)** là **tầng phần cứng RIÊNG** (XY-S485 không làm được CAN). Thêm 1 con
  SN65HVD230 (3.3V) vào bus CAN (TWAI) của ESP32 → có thêm cầu đấu CAN-H/CAN-L.
- 2 tầng này **độc lập, không tranh chân** → gắn cả hai trên cùng board, firmware chọn dùng cái nào.

### 15.2. Bảng chân (netlist) board đa năng
```
ESP32            RS485 (XY-S485)            Ghi chu
GPIO17 (TX2) --> RXD                        UART2 TX
GPIO16 (RX2) <-- TXD                        UART2 RX
3V3          --> VCC                        !! 3V3, khong 5V
GND          --> GND
                 A+ / B-  --> [Cau dau RS485 A/B]   -> Solis pin5/pin4, hoac BMS/dongle

ESP32            CAN (SN65HVD230)           Ghi chu (TUY CHON - neu muon doc CAN)
GPIO25       --> CTX (D/TXD)                CAN TX (TWAI)
GPIO26       <-- CRX (R/RXD)                CAN RX (TWAI)
3V3          --> VCC (3V3)                  SN65HVD230 la 3.3V (dung TJA1050 5V se hong logic)
GND          --> GND
                 CANH / CANL --> [Cau dau CAN H/L]  -> cong CAN cua BMS

GPIO0  = nut BOOT (giu 2s luc chay -> portal)   | onboard
GPIO2  = LED trang thai                          | onboard
Nguon 5V: cap qua USB, hoac cau dau 5V -> ESP32 VIN. GND chung phia logic.
```

### 15.3. Cách build (giống DoBeNuoc — perfboard + hàng rào cái)
1. Hàn **hàng rào cái (female header)** làm đế cắm ESP32 (cắm/rút được).
2. Hàn đế cho **XY-S485** và (tùy chọn) **SN65HVD230**.
3. Hàn **2–3 cầu đấu (terminal block)**: `RS485 A/B`, `CAN H/L`, `5V/GND` (nếu cấp nguồn ngoài).
4. Đi dây theo netlist mục 15.2. GND chung phía logic (ESP32 ↔ chân logic 2 module).
5. Kiểm tra nguội (đồng hồ thông mạch), chắc chắn không chập 3V3–GND, rồi cắm module.

### 15.4. Sau khi build — chỉ nạp firmware + đổi dây cầu đấu
| Muốn làm | Cắm dây vào | Firmware |
|---|---|---|
| Bench với dongle (Solis giả) | Cầu đấu RS485 A/B ↔ USB-RS485 | `SIM_MODE 0`, chế độ MASTER |
| Đọc Solis thật (song song stick) | RS485 A/B ↔ Solis pin5/pin4 | Chế độ SNIFFER passive (làm sau) |
| Đọc JK-BMS qua RS485 | RS485 A/B ↔ JK-BMS | Firmware protocol JK (tính năng riêng, sau) |
| Đọc JK-BMS qua CAN | CAN H/L ↔ cổng CAN JK-BMS | Firmware CAN (tính năng riêng, sau) |

> ⚠️ **JK-BMS KHÔNG nói Modbus như Solis.** Cắm RS485/CAN vào JK-BMS sẽ không tự đọc bằng
> firmware Solis hiện tại — cần firmware nói đúng giao thức JK (làm sau). Validate phần cứng
> cho dự án Solis: dùng **USB-RS485 dongle + `tools/solis_emulator.py`** (đúng Modbus).

### 15.5. Về điện trở đầu cuối 120Ω
- **Sniff Solis (song song stick):** KHÔNG gắn 120Ω (bus giữa inverter–stick đã có sẵn).
- **Bench point-to-point với dongle @9600, dây ngắn:** không cần 120Ω.
- **Bus CAN:** CAN cần 120Ω ở 2 đầu bus; module SN65HVD230 thường có sẵn (hoặc jumper). BMS CAN
  thường đã terminate — chỉ thêm khi cần.

### Linh kiện cần thêm cho board đa năng
- 1× **SN65HVD230** (CAN transceiver 3.3V) — chỉ khi muốn đọc CAN.
- 2–3× **cầu đấu (terminal block)** 2 chân.
- Hàng rào cái, perfboard, dây. (ESP32 + XY-S485 đã có.)
