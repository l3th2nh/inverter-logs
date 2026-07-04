# Custom component: Inverter Bridge — panel "Hệ điện mặt trời"

Panel tùy chỉnh trên sidebar HA (giống menu "Nhà tôi" của dự án bể nước): sơ đồ dòng năng lượng
trực tiếp + cấu hình **thông báo khi lấy điện lưới** + **quy tắc tự động** (tắt/bật thiết bị),
có **xuất YAML** để HA chạy nền 24/7. Dùng thẳng kết nối HA (không cần token).

**Từ v1.1.0: integration TỰ ĐỌC biến tần Solis qua Modbus TCP** (que WiFi datalogger đã ở trên LAN)
→ tự tạo 17 cảm biến `sensor.ib_*`. **KHÔNG cần ESP32/RS485/MQTT, không cần YAML.** Chỉ cần điền IP
que WiFi (điền sẵn `192.168.0.89`) lúc thêm integration.

## Cài đặt (HACS — vài click, cập nhật qua GitHub)
1. HACS → ⋮ → **Custom repositories** → dán URL repo, category **Integration** → **Add**.
2. Tìm **"Inverter Bridge"** → **Download** → **Restart** Home Assistant.
3. **Settings → Devices & Services → + Add Integration** → **"Inverter Bridge"**.
4. Điền **IP que WiFi Solis** (đã điền sẵn `192.168.0.89`, cổng `502`) → **Submit**.
   (Để trống IP nếu chỉ muốn panel dùng cảm biến có sẵn từ MQTT/ESP32 như trước.)
5. Sidebar hiện **"Hệ điện mặt trời"**, và có ngay 17 `sensor.ib_*` (ánh xạ panel tự seed).

> Đổi IP sau: Settings → Devices & Services → Inverter Bridge → **Configure**.
> ⚠️ Nếu trước đây đã có thiết bị **MQTT "Inverter Bridge"** → **xóa nó** (tránh trùng `sensor.ib_*`).

### Cài thủ công (không HACS)
Chép `inverter_bridge/` vào `<HA config>/custom_components/` (qua Samba
`\\192.168.0.146\config\custom_components\`, File editor, hoặc SSH) → Restart → Add Integration.

## Dùng
- Lần đầu, bấm nút **bánh răng** (góc phải) → **Ánh xạ cảm biến**: mặc định đã trỏ `sensor.ib_*`.
  Kiểm tra **Công suất lưới** đúng, và **chiều dương** (xem giá trị trực tiếp: đang lấy lưới mà số
  dương → chọn "Dương = NHẬP"). Lưu.
- **Quy tắc tự động** (trang chính, từ v1.3.0 không còn tab "Thông báo" riêng): thêm quy tắc
  KHI…THÌ **tắt/bật thiết bị** hoặc **gửi thông báo** (chọn `notify.mobile_app_…` để báo ra
  **điện thoại**). Chọn "Gửi thông báo" thì danh sách thiết bị tự ẩn; nội dung hỗ trợ biến
  `{power} {pv} {soc} {load} {time}`.
  > Cấu hình "Thông báo lấy lưới" cũ tự chuyển thành 1 quy tắc (KHI *Bắt đầu lấy điện lưới* THÌ
  > *Gửi thông báo*) khi cập nhật — không mất, và sửa được như quy tắc thường.
- Tab **Nhật ký** (v1.4.0): xem mọi lần quy tắc **chạy** — thời điểm, ✓ thành công / ✕ thất bại,
  và chi tiết (dịch vụ gửi, số thiết bị, lỗi nếu có). Do engine nền ghi (kể cả khi đóng trình
  duyệt), lưu bền qua restart, giữ 200 dòng gần nhất. Có nút **Tải lại** và **Xóa nhật ký**.
- **Xuất YAML**: để HA chạy nền 24/7 (khuyến nghị cho vận hành thật).

## Lưu ý
- Quy tắc/thông báo "chạy trực tiếp trên trang" chỉ hoạt động **khi panel đang mở**. Muốn chạy
  ổn định kể cả khi tắt trình duyệt → **Xuất YAML** dán vào `automations.yaml`.
- Cấu hình (ánh xạ + thông báo + quy tắc) lưu ở `/config/.storage/inverter_bridge` → đồng bộ mọi
  máy/điện thoại, không mất khi F5.
- **Nguồn cảm biến**: từ v1.1.0 integration tự đọc Modbus TCP (điền IP que WiFi) → không cần MQTT.
  Nếu để trống IP thì panel dùng cảm biến `sensor.ib_*` từ nguồn khác (MQTT/ESP32) như trước.
- Quy ước Modbus đã kiểm chứng: FC04, địa chỉ raw 33xxx, unit 1, 32-bit big-endian
  (xem `inverter_bridge/modbus.py`). Poll mỗi 15s.
