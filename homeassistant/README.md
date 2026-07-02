# Home Assistant — Dashboard & Automation cho Inverter Bridge

## 0. Đảm bảo entity có tên `sensor.ib_*` (làm 1 lần)
Firmware mới đã đặt `obj_id` để entity có tên cố định `sensor.ib_<key>` (vd `sensor.ib_battery_soc`).
Nếu thiết bị đã hiện trong HA **trước** khi nạp bản này, entity vẫn giữ tên cũ → làm sạch:

1. HA → **Settings → Devices & Services → MQTT → "Inverter Bridge"** → menu (góc phải) → **Delete**.
2. **Khởi động lại ESP32** (bấm nút **EN/RST**). Nó nối lại → publish discovery → HA tạo lại device
   với tên chuẩn `sensor.ib_*`.
3. Kiểm tra: **Developer Tools → States** gõ `sensor.ib_` → thấy 17 entity.

> Nếu không muốn xóa, cứ dùng tên hiện có và tự sửa prefix trong `dashboard.yaml` / `automations.yaml`.

## 1. Cài Dashboard
1. Mở dashboard bất kỳ → menu góc phải → **Edit Dashboard**.
2. Lại menu góc phải → **Raw configuration editor**.
3. Dán toàn bộ `dashboard.yaml` → **Save**.
   (Hoặc tạo dashboard mới: Settings → Dashboards → Add → rồi dán raw.)

## 2. Cài Automation
- **Cách UI:** Settings → Automations & scenes → **Create Automation** → menu → **Edit in YAML**
  → dán từng block trong `automations.yaml`.
- **Cách file:** dán nội dung vào `automations.yaml` trong thư mục config HA → **Developer Tools →
  YAML → Reload Automations**.

## 3. Lưu ý về dấu của `grid_power`
Định nghĩa hiện tại: **+ = mua điện lưới, − = bán ra**. Đây là quy ước theo register map —
**phải kiểm chứng với số thật của Solis** (so với SolisCloud/LCD). Nếu ngược, đổi `above`/`below`
trong `automations.yaml` cho khớp.

## 4. Gửi thông báo ra điện thoại
Hiện automation dùng `persistent_notification` (hiện trong HA). Để bắn ra điện thoại:
- Cài app **Home Assistant** trên điện thoại + đăng nhập → có service `notify.mobile_app_<tên>`.
- Thay `persistent_notification.create` bằng `notify.mobile_app_<tên>` trong automation.

## 5. (Sau) Energy Dashboard
Các sensor kWh (`sensor.ib_total_generation`, `sensor.ib_total_imported`...) có `device_class: energy`
+ `state_class: total_increasing` → thêm được vào **Settings → Dashboards → Energy** để thống kê.
