#[cfg(target_os = "windows")]
use windows::Win32::Foundation::RECT;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsIconic};

#[derive(Clone, Copy, Debug)]
pub struct PhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[cfg(target_os = "windows")]
fn rect_from_win_rect(r: RECT) -> Option<PhysicalRect> {
    let w = r.right - r.left;
    let h = r.bottom - r.top;
    if w <= 0 || h <= 0 {
        return None;
    }
    Some(PhysicalRect {
        x: r.left,
        y: r.top,
        width: w as u32,
        height: h as u32,
    })
}

// NOTE: This is a "best effort" rect for the window that was foreground at the time the overlay was triggered.
// The overlay becomes foreground once shown, so we must snapshot before showing the overlay.
#[cfg(target_os = "windows")]
pub fn foreground_window_rect() -> Option<PhysicalRect> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
            return None;
        }
        if IsIconic(hwnd).as_bool() {
            return None;
        }

        // Prefer the extended frame bounds (more accurate with DWM).
        let mut r = RECT::default();
        let ok = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut r as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
        .is_ok();
        if ok {
            if let Some(out) = rect_from_win_rect(r) {
                return Some(out);
            }
        }

        // Fallback: GetWindowRect.
        let mut r2 = RECT::default();
        if GetWindowRect(hwnd, &mut r2).is_ok() {
            return rect_from_win_rect(r2);
        }

        None
    }
}

#[cfg(not(target_os = "windows"))]
pub fn foreground_window_rect() -> Option<PhysicalRect> {
    None
}

