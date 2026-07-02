# Custom component: Inverter Bridge — panel "Hệ điện mặt trời"

Panel tùy chỉnh trên sidebar HA (giống menu "Nhà tôi" của dự án bể nước): sơ đồ dòng năng lượng
trực tiếp + cấu hình **thông báo khi lấy điện lưới** + **quy tắc tự động** (tắt/bật thiết bị),
có **xuất YAML** để HA chạy nền 24/7. Dùng thẳng kết nối HA (không cần token).

## Cài đặt
1. Chép thư mục `inverter_bridge/` vào `custom_components/` trong thư mục cấu hình HA:
   ```
   <HA config>/custom_components/inverter_bridge/
     ├── __init__.py
     ├── manifest.json
     ├── config_flow.py
     ├── strings.json
     └── panel.js
   ```
   Cách chép (chọn 1): add-on **Samba share** (`\\192.168.0.146\config\custom_components\`),
   add-on **File editor/Studio Code Server**, hoặc SSH.
2. **Khởi động lại Home Assistant** (Settings → System → Restart).
3. **Settings → Devices & Services → + Add Integration** → gõ **"Inverter Bridge"** → thêm.
4. Sidebar xuất hiện mục **"Hệ điện mặt trời"**. Mở ra.

## Dùng
- Lần đầu, bấm nút **bánh răng** (góc phải) → **Ánh xạ cảm biến**: mặc định đã trỏ `sensor.ib_*`.
  Kiểm tra **Công suất lưới** đúng, và **chiều dương** (xem giá trị trực tiếp: đang lấy lưới mà số
  dương → chọn "Dương = NHẬP"). Lưu.
- Tab **Thông báo**: bật + đặt ngưỡng/nội dung → **Thử thông báo** để kiểm tra.
- Tab **Tự động hóa**: thêm quy tắc KHI…THÌ tắt/bật thiết bị.
- **Xuất YAML**: để HA chạy nền 24/7 (khuyến nghị cho vận hành thật).

## Lưu ý
- Quy tắc/thông báo "chạy trực tiếp trên trang" chỉ hoạt động **khi panel đang mở**. Muốn chạy
  ổn định kể cả khi tắt trình duyệt → **Xuất YAML** dán vào `automations.yaml`.
- Cấu hình (ánh xạ + thông báo + quy tắc) lưu ở `/config/.storage/inverter_bridge` → đồng bộ mọi
  máy/điện thoại, không mất khi F5.
- Cần đã bật tích hợp **MQTT** để có sẵn `sensor.ib_*` (từ firmware ESP32).
