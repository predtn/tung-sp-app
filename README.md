# Nhập liệu không khó

Ứng dụng desktop (Electron + React). Nạp nhiều file PDF hồ sơ bệnh nhân, AI (OpenAI)
trích xuất các trường cần thiết, bạn kiểm tra/sửa, rồi import vào một tab trong Google Sheet.

## Cài đặt

```bash
npm install
```

Nếu cần xử lý PDF scan (ảnh), gói `@napi-rs/canvas` đã có trong dependencies.

## Chạy thử (dev)

```bash
npm run dev
```

> Nếu cửa sổ app không hiện lên và console báo lỗi liên quan đến `electron.app` bị `undefined`,
> kiểm tra biến môi trường `ELECTRON_RUN_AS_NODE` — nếu bị set (một số terminal/CI đặt sẵn),
> bỏ nó đi (`unset ELECTRON_RUN_AS_NODE` trên bash, hoặc mở terminal mới) rồi chạy lại.

## Đóng gói (Windows .exe)

```bash
npm run build
```

File cài đặt nằm trong `release/`.

---

## Chuẩn bị khoá / cấu hình (làm 1 lần)

### 1. OpenAI API key
Bạn đã có. Dán vào **Cài đặt → OpenAI → API Key**. Model mặc định `gpt-4o` (có vision, đọc được PDF scan).

### 2. Google OAuth (để ghi Google Sheet bằng tài khoản của bạn)

1. Vào https://console.cloud.google.com/ → tạo project mới (hoặc dùng project sẵn có).
2. **APIs & Services → Library** → tìm **Google Sheets API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - Điền tên app, email hỗ trợ, email liên hệ → Save
   - **Test users** → thêm chính email `predzxcvn@gmail.com`
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Desktop app**
   - Tạo xong, copy **Client ID** và **Client Secret**
5. Trong app: **Cài đặt → Google Sheets** → dán Client ID + Client Secret.

> App dùng luồng loopback `http://127.0.0.1:42813` — không cần khai báo redirect URI thủ công
> với Desktop app client (Google cho phép sẵn).

### 3. Google Sheet đích

1. Tạo 1 file Google Sheets.
2. Lấy **Spreadsheet ID** từ URL:
   `https://docs.google.com/spreadsheets/d/`**`<ĐÂY_LÀ_ID`**`/edit`
3. Dán vào **Cài đặt → Google Sheets → Spreadsheet ID**.
4. Nhấn **Lưu cài đặt**, rồi **Đăng nhập Google**.

---

## Thêm / sửa trường trích xuất

Vào **Cài đặt → Các trường trích xuất**. Ở đầu có ô **"Áp dụng cho"** và nút **"+ Tạo tab mới"** (tạo tab trên Google Sheet, tự
gán bộ trường mặc định):

- **Bộ trường chung**: dùng khi quét vào tab chưa cấu hình riêng, và làm mẫu khởi tạo cho
  tab mới. Bấm "Lưu bộ trường chung" — không đụng tới Google Sheet.
- **Tab: <tên>**: bộ trường riêng của từng tab (cần đăng nhập Google để thấy danh sách tab).
  Bấm **"Lưu & đồng bộ Google Sheet"** sẽ:
  - ghi lại hàng tiêu đề (dòng 1) của tab đó theo danh sách trường,
  - sắp xếp lại cột dữ liệu bên dưới khớp theo **tên cột** (đổi thứ tự không mất dữ liệu),
  - **in đậm** hàng tiêu đề và cố định (freeze) dòng 1.
  - Nếu có cột bị xoá mà đang chứa dữ liệu, app hỏi xác nhận rõ trước.

Các cột **"File nguồn"** và **"Thời gian nhập"** luôn được thêm tự động ở cuối.

Mỗi trường:
- **Tên hiển thị**: tên cột trong Google Sheet.
- **Mô tả cho AI**: càng rõ càng chính xác (vd: "Số điện thoại liên hệ, 10 chữ số").
- **Ví dụ** (tuỳ chọn): giá trị mẫu để AI bám định dạng, vd `15/03/1992` cho ngày.

Lưu tại `%APPDATA%/tung-sp-app/fields.config.json` (`fields` = bộ chung, `byTab` = theo tab).

## Quét PDF theo tab

Ở **bước 1**, chọn **Tab đích** trước khi nạp PDF (khi đã đăng nhập Google). AI sẽ quét
theo đúng bộ trường của tab đó. Nếu chưa chọn tab, quét theo bộ trường chung.

---

## Luồng dùng

1. Kéo-thả PDF vào ô nạp file (hoặc bấm "chọn file"). Quét tối đa 3 file cùng lúc.
2. Chờ AI quét. Bảng kết quả hiện ra:
   - ô **vàng** = AI không chắc chắn
   - ô **đỏ** = sai định dạng (ngày không đúng dd/mm/yyyy, năm sinh vô lý…)
   - chuyển giữa chế độ **Bảng** / **Thẻ** (thẻ tự bật khi > 7 trường)
3. Sửa trực tiếp trên bảng/thẻ. Click **tên file nguồn** để mở panel xem PDF ngay cạnh
   bảng, đối chiếu. Xoá hồ sơ lỗi bằng nút ✕.
4. Chọn tab đích (hoặc "+ Tạo tab mới"), bấm **Import**. Nếu còn ô vàng / cảnh báo định
   dạng, app hỏi lại trước khi ghi.

## Nhật ký import

Nút **Nhật ký** trên thanh trên cùng: xem lại các lần import trước — thời gian, tab đích,
số dòng, danh sách file, chi phí ước tính. Lưu tại `%APPDATA%/tung-sp-app/import-history.json`,
giữ 200 lần gần nhất.

## Bảo mật

- API key và token Google lưu **cục bộ** trên máy bạn (`%APPDATA%/tung-sp-app/`).
- Dữ liệu bệnh nhân chỉ đi: máy bạn → OpenAI API → Google Sheet của bạn. Không qua server trung gian nào khác.
- Cân nhắc: nội dung PDF được gửi tới OpenAI để xử lý. Xem chính sách dữ liệu của OpenAI (API không dùng dữ liệu để train theo mặc định).
