#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Ole::{CF_HDROP, CF_UNICODETEXT};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::DROPFILES;

#[cfg(target_os = "windows")]
fn set_clipboard_data(format: u32, handle: HANDLE) -> Result<(), String> {
    unsafe {
        OpenClipboard(HWND(0)).map_err(|e| format!("OpenClipboard failed: {}", e))?;
        let result = (|| {
            EmptyClipboard().map_err(|e| format!("EmptyClipboard failed: {}", e))?;
            SetClipboardData(format, handle).map_err(|e| format!("SetClipboardData failed: {}", e))?;
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(target_os = "windows")]
pub fn set_clipboard_files(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No paths provided".to_string());
    }

    // CF_HDROP uses a double-null-terminated UTF-16 list of absolute paths.
    let mut wide_list: Vec<u16> = Vec::new();
    for p in paths {
        wide_list.extend(p.encode_utf16());
        wide_list.push(0);
    }
    wide_list.push(0);

    let dropfiles_size = std::mem::size_of::<DROPFILES>();
    let payload_bytes = wide_list.len() * 2;
    let total_size = dropfiles_size + payload_bytes;

    unsafe {
        let hmem = GlobalAlloc(GMEM_MOVEABLE, total_size).map_err(|e| format!("GlobalAlloc failed: {}", e))?;
        let ptr = GlobalLock(hmem) as *mut u8;
        if ptr.is_null() {
            return Err("GlobalLock failed".to_string());
        }

        // Write header.
        let header = ptr as *mut DROPFILES;
        (*header).pFiles = dropfiles_size as u32;
        (*header).fWide = true.into();

        // Write UTF-16 file list.
        let payload_ptr = ptr.add(dropfiles_size) as *mut u16;
        std::ptr::copy_nonoverlapping(wide_list.as_ptr(), payload_ptr, wide_list.len());

        let _ = GlobalUnlock(hmem);

        // Ownership of hmem is transferred to the system on success.
        set_clipboard_data(CF_HDROP.0 as u32, HANDLE(hmem.0 as isize))
    }
}

#[cfg(target_os = "windows")]
pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let bytes = wide.len() * 2;

    unsafe {
        let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|e| format!("GlobalAlloc failed: {}", e))?;
        let ptr = GlobalLock(hmem) as *mut u16;
        if ptr.is_null() {
            return Err("GlobalLock failed".to_string());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
        let _ = GlobalUnlock(hmem);
        set_clipboard_data(CF_UNICODETEXT.0 as u32, HANDLE(hmem.0 as isize))
    }
}

#[cfg(target_os = "windows")]
pub fn paste_ctrl_v() -> Result<(), String> {
    unsafe {
        let inputs = [
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: KEYBD_EVENT_FLAGS(0), time: 0, dwExtraInfo: 0 } },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_V, wScan: 0, dwFlags: KEYBD_EVENT_FLAGS(0), time: 0, dwExtraInfo: 0 } },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_V, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_CONTROL, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0 } },
            },
        ];

        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if sent == 0 {
            return Err("SendInput failed".to_string());
        }
        Ok(())
    }
}
