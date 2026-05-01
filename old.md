# Danh sách tính năng Capture Pro (v1.0 - Go/Fyne)

Dưới đây là bản ghi chi tiết 100% các tính năng và hành vi thao tác của phiên bản cũ. Đây là "kinh thánh" để bản v2.0 (Tauri/Rust) kế thừa và phát triển.

## 1. Chế độ Chụp ảnh (Capture Modes) & Thao tác chi tiết

Khi nhấn Hotkey chụp ảnh (mặc định `Ctrl+Alt+Z`), một lớp phủ (Overlay) toàn màn hình sẽ hiện ra.

### A. Thao tác chung (Trong Overlay)
*   **Phím `Esc`**: Hủy bỏ việc chụp và đóng Overlay.
*   **Phím `Enter`**: Thực hiện chụp vùng đã chọn.
*   **Double Click (Nhấp đúp chuột)**: Nếu nhấp đúp vào bên trong vùng đang chọn, app sẽ thực hiện chụp ngay lập tức.
*   **Phím `F1`**: Chuyển nhanh sang chế độ **Full screen**.
*   **Phím `F2`**: Chuyển nhanh sang chế độ **Window under cursor**.
*   **Phím `F3`**: Chuyển nhanh sang chế độ **Freeform**.
*   **Thanh gợi ý (Hint Bar)**: Luôn hiện ở cạnh dưới màn hình nhắc nhở các phím tắt (F1, F2, F3, Enter, Esc).

### B. Chế độ Freeform (Quét vùng tự do)
*   **Quét chuột (Click & Drag)**: Nhấn và kéo chuột ở vùng trống để tạo vùng chọn mới.
*   **Di chuyển vùng chọn**: Nhấn và kéo chuột *bên trong* vùng đã chọn để di chuyển toàn bộ khung.
*   **Thay đổi kích thước (Resize)**:
    *   Có **8 điểm nắm (Handles)** tại các góc và trung điểm các cạnh (màu xanh).
    *   Con trỏ chuột thay đổi hình dạng linh hoạt (VResize, HResize, Crosshair) khi rê vào các điểm nắm.
*   **Hiển thị kích thước (Size Badge)**: Một thẻ màu đen (`24, 28, 39, 220`) hiện ngay sát vùng chọn hiển thị thông số `Width x Height` thời gian thực.

### C. Chế độ Window under cursor (Chụp cửa sổ)
*   **Tự động bắt mục tiêu**: Di chuyển chuột để app tự động tìm và highlight khung xanh quanh cửa sổ ứng dụng nằm dưới con trỏ.
*   **Thao tác**: Nhấn `Enter` hoặc `Double Click` để chụp.

---

## 2. Đặc sản WSL Bridge (WSL Integration) - CỐT LÕI
*   **Lưu trực tiếp vào Linux**: Cho phép lưu ảnh trực tiếp vào hệ thống file của WSL (Ubuntu, v.v.).
*   **Duyệt File Thông minh**:
    *   Ưu tiên dùng UNC Path (`\\wsl.localhost\`).
    *   **Fallback `wsl.exe`**: Nếu UNC không khả dụng, app gọi `wsl.exe -d <distro> -- bash -lc` để chạy các lệnh `ls`, `mkdir -p`, `cat`, `rm`.
*   **Tự động nhận diện Home**: App so sánh Windows Username với các folder trong `/home/` của Linux để gợi ý thư mục lưu ảnh.
*   **Xử lý Quyền hạn**: Có logic bắt lỗi `Permission Denied` và hướng dẫn user chạy `chown` trong Linux.

---

## 3. Hệ thống Hotkeys & Clipboard
*   **Global Hotkey**: Mặc định `Ctrl+Alt+Z`.
*   **Paste Hotkey (Cực hay)**: Mặc định `Ctrl+Shift+V`. App sẽ lấy ảnh bitmap mới nhất trong bộ nhớ, gán vào Clipboard Windows, và **giả lập phím `Ctrl+V`** để dán ảnh vào ứng dụng đang active (Slack, Discord, IDE...).
*   **Clipboard Modes**:
    *   `Paths`: Copy đường dẫn file (WSL UNC hoặc Windows path) - Dùng cho Agent.
    *   `Files`: Copy file vật lý (File Drop List) - Dùng để dán trực tiếp vào folder hoặc chat app.

---

## 4. Quản lý Ảnh (Capture Browser)
*   **Grid & List View**: Chuyển đổi linh hoạt. Thumbnail được load bất đồng bộ (Async) để tránh lag.
*   **Rubber Band Selection**: Nhấn và kéo chuột trên vùng trống để chọn hàng loạt ảnh (khung chọn màu xanh `69, 163, 255`).
*   **Multi-select**: Giữ `Ctrl` khi Click để chọn thêm hoặc bỏ chọn từng ảnh.
*   **Preview Pane**: Hiển thị ảnh lớn và thông tin path chi tiết của ảnh đang chọn.
*   **Batch Actions**: Xóa hàng loạt hoặc Copy hàng loạt đường dẫn.

---

## 5. UI/UX & Hệ thống
*   **Responsive Layout**: 
    *   Cửa sổ > 450px: Hiện đầy đủ Text + Icon.
    *   Cửa sổ < 450px: Chỉ hiện Icon (Compact mode).
    *   Cửa sổ < 250px: Ẩn bớt cả select box (Ultra-compact).
*   **Always on Top (Pin)**: Sử dụng Win32 API (`SetWindowPos`) để ghim app luôn nổi.
*   **System Tray**: Menu chuột phải đầy đủ: Show, Capture, Settings, Quit.
*   **Error Logging**: Tự động ghi lỗi vào `%TEMP%\capturepro-last-error.txt` và copy vào clipboard khi có crash.

---
## 6. Bảng màu & Thẩm mỹ (Aesthetics & Colors)

Dưới đây là các mã màu "gốc" đang được dùng để tạo nên cảm giác hiện đại cho bản v1.0:

### A. Màu sắc Overlay (Khi đang chụp)
*   **Lớp phủ nền (Mask)**: `NRGBA{12, 14, 24, 170}` (Màu xanh đen rất đậm, có độ trong suốt).
*   **Khung chọn & Handle**: `NRGBA{69, 163, 255, 255}` (Màu xanh Vivid Blue - tạo điểm nhấn).
*   **Nền vùng chọn**: `NRGBA{69, 163, 255, 34}` (Xanh nhạt, cực kỳ trong suốt để thấy ảnh bên dưới).
*   **Thẻ thông số (Badge)**: `NRGBA{24, 28, 39, 220}` (Màu xám than đậm - tạo độ tương phản cao cho chữ trắng).

### B. Màu sắc Gallery (Thư viện ảnh)
*   **Nền Item (Mặc định)**: `NRGBA{245, 247, 250, 255}` (Trắng xám nhẹ, tạo cảm giác sạch sẽ).
*   **Nền Item (Khi được chọn)**: `NRGBA{219, 234, 254, 255}` (Xanh dương nhạt - dễ dàng nhận biết vùng đang chọn).
*   **Màu chữ Tiêu đề**: `NRGBA{30, 36, 50, 255}` (Xanh đen đậm).
*   **Màu chữ Mô tả/Path**: `NRGBA{93, 103, 122, 255}` (Xám trung tính).

### C. Phong cách chung
*   **Bo góc (Rounding)**: Tuy Fyne hạn chế nhưng các badge và button đều hướng tới sự gọn gàng.
*   **Độ phủ (Fill Mode)**: Preview luôn ở chế độ `Contain` để không làm biến dạng ảnh chụp.
*   **Icon**: Sử dụng bộ icon chuẩn của Fyne (Settings, Media, Visibility, Delete).

---
**Cam kết v2.0**: Phải giữ nguyên 100% các phím tắt và logic "thông minh" khi xử lý WSL này. Tuyệt đối không được làm app "ngu" đi.
