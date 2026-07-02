# Lịch thăm thầy

App web tĩnh để đăng ký lịch đến thăm thầy theo khung giờ.

## Chạy app

Mở `index.html` bằng trình duyệt.

## Chức năng

- Chọn khung giờ: bắt đầu ngày/giờ → kết thúc ngày/giờ.
- Báo lỗi nếu giờ kết thúc trước giờ bắt đầu.
- Báo lịch bị trùng khung giờ.
- Đánh dấu ngày đông nếu từ 4 lượt trở lên.
- Theo dõi ai đã đăng ký, ai chưa đăng ký.
- Lưu tạm trên máy bằng `localStorage`.
- Có thể lưu online bằng Google Sheet + Apps Script.

## Cấu hình lưu online Google Sheet

1. Tạo Google Sheet mới.
2. Mở `Extensions > Apps Script`.
3. Xóa code cũ, dán toàn bộ nội dung file `google-apps-script.js`.
4. Bấm Run hàm `setup` một lần, cấp quyền.
5. Bấm `Deploy > New deployment > Web app`.
6. Chọn:
   - Execute as: `Me`
   - Who has access: `Anyone`
7. Deploy rồi copy `Web App URL`.
8. Mở app, dán URL vào ô `Google Apps Script URL`, bấm `Lưu URL`, rồi `Đồng bộ`.

## Zalo group

Zalo group không có API bot mở tiện như Telegram/Discord. Cách thực tế: gửi link app trong group, hoặc copy thông tin lịch từ app để nhắn vào nhóm. Dữ liệu chính nên nằm trong Google Sheet.
