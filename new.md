# Yêu cầu mới cho Capture Pro v2.0

Dưới đây là các thay đổi và yêu cầu mới dành riêng cho phiên bản tái cấu trúc (Tauri/Rust).

## 1. Thay đổi phím tắt mặc định (Hotkeys)
*   **Hotkey chụp ảnh (Primary)**: Thay đổi từ `Ctrl+Alt+Z` sang **`Ctrl+Shift+Z`**.
    *   *Lý do*: Phím tắt mới thuận tay hơn và tránh xung đột với một số ứng dụng khác.
    *   *Yêu cầu*: Phải là Global Hotkey (hoạt động ngay cả khi app đang ẩn).

## 2. Công nghệ & Hiệu năng
*   **Core**: Sử dụng **Rust (Tauri)** thay cho Go (Fyne).
*   **Giao diện**: Sử dụng **React + Shadcn/UI + Tailwind CSS**.
*   **Ưu tiên**: App phải siêu nhẹ, khởi động tức thì và không gây lag máy.

## 3. Cải tiến WSL Bridge
*   Giao diện chọn folder WSL phải trực quan hơn bản cũ.
*   Tự động ghi nhớ Distro và Folder cuối cùng mà người dùng đã chọn.
*   Hỗ trợ hiển thị dung lượng còn trống của Distro WSL nếu có thể.

## 4. Trải nghiệm UI/UX (Premium)
*   **Glassmorphism**: Áp dụng hiệu ứng mờ kính cho Overlay chụp ảnh và Sidebar của app chính.
*   **Micro-animations**: Các hiệu ứng chuyển cảnh mượt mà khi mở preview ảnh hoặc khi chụp xong.
*   **Dark Mode**: Mặc định là giao diện tối cao cấp.

## 5. Cơ chế Chọn ảnh (Selection Logic) - Giống Windows
*   **Ctrl + Click**: Chọn hoặc bỏ chọn từng ảnh riêng lẻ (Multi-select individual).
*   **Shift + Click**: Chọn một dải ảnh liên tiếp từ vị trí đã chọn trước đó đến vị trí hiện tại (Range selection).
    *   *Yêu cầu*: Phải hoạt động chuẩn xác như Windows File Explorer (ví dụ: chọn A, giữ Shift chọn C thì phải chọn luôn cả B).

## 6. Tính năng mới dự kiến
*   **Quick Copy to Agent**: Nút bấm riêng để copy đường dẫn theo format dành riêng cho Agent CLI (ví dụ: bọc trong thẻ markdown hoặc kèm theo metadata).
*   **Pin to Side**: Chế độ ghim app vào cạnh màn hình (giống thanh công cụ).

---
**Trạng thái**: Đã ghi nhớ phím tắt mới `Ctrl+Shift+Z`. Sẵn sàng thực hiện.
