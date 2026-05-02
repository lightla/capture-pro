mod wsl;
mod capture;
mod local_fs;
mod windows_folder_picker;
mod settings_cache;
#[cfg(target_os = "windows")]
mod win_clipboard;
#[cfg(target_os = "windows")]
mod win_window_target;
use tauri::Manager;
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;
use settings_cache::{SettingsState};

#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dwm::DwmFlush;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};

#[cfg(target_os = "windows")]
fn flush_compositor() {
    // Ensure previous hide/show operations are committed by DWM before we capture the screen,
    // otherwise we can end up with a faint ghost of our window in the screenshot.
    unsafe {
        let _ = DwmFlush();
        let _ = DwmFlush();
    }
}

#[cfg(target_os = "windows")]
fn wait_hidden(window: &tauri::WebviewWindow) {
    // Don't rely on a fixed sleep; instead, poll visibility briefly so capture starts as soon
    // as the compositor actually drops the window.
    for _ in 0..40 {
        match window.is_visible() {
            Ok(true) => {
                flush_compositor();
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            Ok(false) => break,
            Err(_) => break,
        }
    }
}

#[cfg(target_os = "windows")]
fn set_exclude_from_capture(window: &tauri::WebviewWindow, exclude: bool) {
    // Best-effort: prevent our UI from appearing in screen capture even if the compositor
    // hasn't fully removed the window yet.
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = SetWindowDisplayAffinity(
                windows::Win32::Foundation::HWND(hwnd.0 as isize),
                if exclude { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE },
            );
        }
    }
}

static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);
static MAIN_IS_DOCKED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Default)]
struct LastCapture {
    text_path: String,
    file_path: Option<String>,
}

#[derive(Default)]
struct ClipboardState(Mutex<Option<LastCapture>>);

#[derive(Clone, Debug, Default, serde::Serialize)]
struct PhysicalRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default)]
struct OverlayTargetState(Mutex<Option<PhysicalRect>>);

#[derive(Clone, Debug)]
struct DockSnapshot {
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    resizable: bool,
    always_on_top: bool,
}

#[derive(Default)]
struct DockState(Mutex<Option<DockSnapshot>>);

#[derive(Default)]
struct UiVisibilityState(Mutex<bool>); // true when user explicitly hid the app

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DockResult {
    docked: bool,
    always_on_top: bool,
}

const MAIN_MIN_WIDTH_DEFAULT: f64 = 800.0;
const MAIN_MIN_HEIGHT_DEFAULT: f64 = 520.0;
static MAIN_MIN_SIZE: OnceLock<Mutex<(f64, f64)>> = OnceLock::new();

fn get_main_min_size() -> (f64, f64) {
    MAIN_MIN_SIZE
        .get()
        .and_then(|m| m.lock().ok().map(|g| *g))
        .unwrap_or((MAIN_MIN_WIDTH_DEFAULT, MAIN_MIN_HEIGHT_DEFAULT))
}

fn set_main_min_size_value(min_w: f64, min_h: f64) {
    let (min_w, min_h) = (
        min_w.max(320.0).min(4096.0),
        min_h.max(320.0).min(4096.0),
    );
    let mutex = MAIN_MIN_SIZE.get_or_init(|| Mutex::new((MAIN_MIN_WIDTH_DEFAULT, MAIN_MIN_HEIGHT_DEFAULT)));
    if let Ok(mut guard) = mutex.lock() {
        *guard = (min_w, min_h);
    }
}

#[tauri::command]
fn set_main_min_size(app: tauri::AppHandle, min_w: f64, min_h: f64, snap: Option<bool>) -> Result<(), String> {
    set_main_min_size_value(min_w, min_h);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    if MAIN_IS_DOCKED.load(Ordering::SeqCst) {
        // Dock mode owns sizing; ignore normal-mode min sizing updates.
        return Ok(());
    }
    let (w, h) = get_main_min_size();
    main.set_min_size(Some(tauri::LogicalSize::new(w, h)))
        .map_err(|e| e.to_string())?;

    if snap.unwrap_or(false) {
        // Open at exactly min.
        main.set_size(tauri::LogicalSize::new(w, h))
            .map_err(|e| e.to_string())?;
    } else {
        // Only snap up when the window is currently below min; do not block enlarging.
        let Ok(scale) = main.scale_factor() else { return Ok(()) };
        let Ok(size) = main.outer_size() else { return Ok(()) };
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        if logical_w + 0.5 < w || logical_h + 0.5 < h {
            enforce_main_min_size(&main);
        }
    }
    Ok(())
}

#[tauri::command]
fn get_last_target_window_rect(state: tauri::State<'_, OverlayTargetState>) -> Option<PhysicalRect> {
    state.0.lock().ok().and_then(|g| (*g).clone())
}

#[tauri::command]
fn set_last_capture_paths(state: tauri::State<'_, ClipboardState>, text_path: String, file_path: Option<String>) {
    if let Ok(mut guard) = state.0.lock() {
        eprintln!("[CaptureProKey] set_last_capture_paths text_path='{}' file_path={:?}", text_path, file_path);
        *guard = Some(LastCapture { text_path, file_path });
    }
}

#[tauri::command]
fn set_clipboard_files(paths: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return win_clipboard::set_clipboard_files(&paths);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = paths;
        Err("File clipboard is only supported on Windows".to_string())
    }
}

#[tauri::command]
fn set_clipboard_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return win_clipboard::set_clipboard_text(&text);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Err("Text clipboard is only supported on Windows in this build".to_string())
    }
}

#[tauri::command]
fn debug_log(message: String) {
    eprintln!("[CaptureProDebug] {}", message);
}

async fn show_overlay_impl(app: tauri::AppHandle) {
    // Block entering capture mode if save location isn't configured.
    if let Some(msg) = app
        .try_state::<SettingsState>()
        .and_then(|s| s.0.lock().ok().and_then(|g| g.missing_save_location_message()))
    {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
        let _ = app.emit("app-toast", msg);
        return;
    }

    if let Some(main) = app.get_webview_window("main") {
        // Only temporarily hide if it's currently visible. If user already hid the app,
        // we should not change that state.
        let is_visible = main.is_visible().unwrap_or(true);
        #[cfg(target_os = "windows")]
        set_exclude_from_capture(&main, true);
        if is_visible {
            let _ = main.hide();
            #[cfg(target_os = "windows")]
            wait_hidden(&main);
        }
    }
    #[cfg(target_os = "windows")]
    flush_compositor();

    // Snapshot the foreground window rect BEFORE showing the overlay.
    // Once the overlay is visible, it becomes focused/top-most.
    #[cfg(target_os = "windows")]
    {
        if let Ok(mut guard) = app.state::<OverlayTargetState>().0.lock() {
            *guard = win_window_target::foreground_window_rect()
                .map(|r| PhysicalRect { x: r.x, y: r.y, width: r.width, height: r.height });
        }
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        // Prepare overlay for the next capture without doing heavy cleanup.
        // This ensures old selection/rectangle is cleared immediately.
        let _ = overlay.eval("window.__captureProPrepForShow && window.__captureProPrepForShow();");
        let _ = overlay.hide();
        #[cfg(target_os = "windows")]
        wait_hidden(&overlay);
    }

    #[cfg(target_os = "windows")]
    flush_compositor();
    let background = capture::capture_full_screen_preview().await;

    if let Some(overlay) = app.get_webview_window("overlay") {
        match background {
            Ok(background) => {
                if let Ok(background_json) = serde_json::to_string(&background) {
                    let _ = overlay.eval(&format!(
                        "window.__captureProPendingBackground = {background_json}; window.__captureProSetBackground && window.__captureProSetBackground(window.__captureProPendingBackground);"
                    ));
                }
            }
            Err(err) => {
                if let Ok(err_json) = serde_json::to_string(&err) {
                    let _ = overlay.eval(&format!(
                        "window.__captureProPendingError = {err_json}; window.__captureProSetError && window.__captureProSetError(window.__captureProPendingError);"
                    ));
                }
            }
        }
        let _ = overlay.show();
        let _ = overlay.set_focus();
    }
}

#[tauri::command]
fn close_overlay(app: tauri::AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    // Show main window again
    let user_hidden = app
        .try_state::<UiVisibilityState>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false);
    if !user_hidden {
        if let Some(main) = app.get_webview_window("main") {
            #[cfg(target_os = "windows")]
            set_exclude_from_capture(&main, false);
            if main.is_minimized().unwrap_or(false) {
                let _ = main.unminimize();
            }
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
}

#[tauri::command]
async fn show_overlay(app: tauri::AppHandle) {
    show_overlay_impl(app).await;
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, value: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(value);
    }
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn hide_main_window_user(app: tauri::AppHandle, state: tauri::State<'_, UiVisibilityState>) {
    if let Ok(mut hidden) = state.0.lock() {
        *hidden = true;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn show_main_window_user(app: tauri::AppHandle, state: tauri::State<'_, UiVisibilityState>) {
    if let Ok(mut hidden) = state.0.lock() {
        *hidden = false;
    }
    if let Some(w) = app.get_webview_window("main") {
        // If the window is minimized, `show()` may not restore it on some platforms.
        // Best-effort unminimize so taskbar/tray restore always works.
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn toggle_dock_main_right(
    app: tauri::AppHandle,
    state: tauri::State<'_, DockState>,
    dock_columns: Option<u8>,
) -> Result<DockResult, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    if let Some(snapshot) = state.0.lock().map_err(|_| "Dock state lock failed".to_string())?.take() {
        MAIN_IS_DOCKED.store(false, Ordering::SeqCst);
        let _ = main.set_resizable(true);
        // Restore normal minimum size when undocking.
        let (min_w, min_h) = get_main_min_size();
        main
            .set_min_size(Some(tauri::LogicalSize::new(min_w, min_h)))
            .map_err(|e| e.to_string())?;
        main
            .set_position(snapshot.position)
            .map_err(|e| e.to_string())?;
        main
            .set_size(snapshot.size)
            .map_err(|e| e.to_string())?;
        main
            .set_resizable(snapshot.resizable)
            .map_err(|e| e.to_string())?;
        let _ = main.set_always_on_top(snapshot.always_on_top);
        let _ = main.show();
        let _ = main.set_focus();
        return Ok(DockResult {
            docked: false,
            always_on_top: snapshot.always_on_top,
        });
    }

    if main.is_maximized().unwrap_or(false) {
        let _ = main.unmaximize();
    }

    // Mark docked early so resize/move events during docking won't trigger normal-mode min enforcement.
    MAIN_IS_DOCKED.store(true, Ordering::SeqCst);

    let snapshot = DockSnapshot {
        position: main.outer_position().map_err(|e| e.to_string())?,
        size: main.outer_size().map_err(|e| e.to_string())?,
        resizable: main.is_resizable().unwrap_or(true),
        always_on_top: main.is_always_on_top().unwrap_or(false),
    };

    let monitor = main
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| main.primary_monitor().ok().flatten())
        .ok_or_else(|| "No monitor found".to_string())?;

    let work = monitor.work_area();
    let dock_width = if dock_columns.unwrap_or(2) == 1 { 330 } else { 520 };
    let dock_height = work.size.height;
    // Inset slightly from the work-area edge to avoid the window shadow/frame being clipped off-screen.
    let dock_right_inset: i32 = 12;
    let x = (work.position.x + work.size.width as i32 - dock_width - dock_right_inset).max(work.position.x);
    let y = work.position.y;

    main
        .set_min_size(Some(tauri::LogicalSize::new(210.0, 640.0)))
        .map_err(|e| e.to_string())?;
    main
        .set_size(tauri::PhysicalSize::new(dock_width as u32, dock_height))
        .map_err(|e| e.to_string())?;
    main
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    main
        .set_size(tauri::PhysicalSize::new(dock_width as u32, dock_height))
        .map_err(|e| e.to_string())?;
    main.set_resizable(false).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "Dock state lock failed".to_string())? = Some(snapshot);
    let _ = main.set_always_on_top(true);
    let _ = main.show();
    let _ = main.set_focus();
    Ok(DockResult {
        docked: true,
        always_on_top: true,
    })
}

fn enforce_main_min_size(window: &tauri::WebviewWindow) {
    if MAIN_IS_DOCKED.load(Ordering::SeqCst) {
        return;
    }
    let (min_w_logical, min_h_logical) = get_main_min_size();
    // Re-apply min size at the native layer in case it was reset by some code path.
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(min_w_logical, min_h_logical)));
    let Ok(scale) = window.scale_factor() else { return };
    let Ok(size) = window.outer_size() else { return };
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;

    if logical_w + 0.5 >= min_w_logical && logical_h + 0.5 >= min_h_logical {
        return;
    }

    let min_w = (min_w_logical * scale).ceil().max(1.0) as u32;
    let min_h = (min_h_logical * scale).ceil().max(1.0) as u32;
    let _ = window.set_size(tauri::PhysicalSize::new(
        size.width.max(min_w),
        size.height.max(min_h),
    ));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyZ);
    let paste_hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyV);
    // Fallback hotkey to help debug/report collisions with Ctrl+Shift+V on some systems/apps.
    let paste_hotkey_alt = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                // Diagnostic: log every shortcut callback so we can see if Ctrl+Shift+V is reaching us.
                eprintln!("[CaptureProKey] Shortcut event: {:?} state={:?}", shortcut, event.state());

                if event.state() != ShortcutState::Pressed {
                    return;
                }

                if shortcut == &hotkey {
                    eprintln!("[CaptureProKey] Ctrl+Shift+Z triggered");
                    if let Some(overlay) = app.get_webview_window("overlay") {
                        let is_visible = overlay.is_visible().unwrap_or(false);
                        if is_visible {
                            close_overlay(app.clone());
                        } else {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                show_overlay_impl(app).await;
                            });
                        }
                    }
                    return;
                }

                if shortcut == &paste_hotkey || shortcut == &paste_hotkey_alt {
                    #[cfg(target_os = "windows")]
                    {
                        eprintln!("[CaptureProKey] Paste hotkey triggered ({:?})", shortcut);
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<ClipboardState>();
                            let last = state.0.lock().ok().and_then(|g| (*g).clone());
                            let mut text_path = last.as_ref().map(|x| x.text_path.clone()).unwrap_or_default();
                            let mut file_path = last.as_ref().and_then(|x| x.file_path.clone()).unwrap_or_default();

                            // If user currently has a non-path text in clipboard, do nothing.
                            // Ctrl+Shift+V should only "activate" when clipboard is an image (copy/paste image flow)
                            // or when clipboard text looks like a real file path.
                            let mut clipboard_text_now: Option<String> = None;
                            match win_clipboard::get_clipboard_text() {
                                Ok(Some(s)) => {
                                    let picked = s
                                        .lines()
                                        .map(|l| l.trim())
                                        .find(|l| !l.is_empty())
                                        .unwrap_or("")
                                        .trim_matches('"')
                                        .to_string();
                                    if !picked.is_empty() {
                                        clipboard_text_now = Some(picked);
                                    }
                                }
                                Ok(None) => {}
                                Err(e) => {
                                    eprintln!("[CaptureProKey] Ctrl+Shift+V: get_clipboard_text failed: {}", e);
                                }
                            }

                            // If we don't have cached last capture, fall back to current clipboard text.
                            if file_path.is_empty() || text_path.is_empty() {
                                if let Some(candidate) = clipboard_text_now.clone() {
                                    let is_pathish = candidate.starts_with(r"\\")
                                        || candidate.contains(r":\")
                                        || candidate.contains(r":/")
                                        || candidate.starts_with('/');
                                    let exists = is_pathish && std::path::Path::new(&candidate).is_file();
                                    if exists {
                                        text_path = candidate.clone();
                                        file_path = candidate;
                                        eprintln!("[CaptureProKey] Ctrl+Shift+V: using clipboard text path");
                                    }
                                }
                            }

                            if file_path.is_empty() {
                                eprintln!("[CaptureProKey] Ctrl+Shift+V: no file path available");
                                // Still allow "paste image from clipboard" behavior when user already copied an image.
                                let _ = tauri::async_runtime::spawn_blocking(move || {
                                    match win_clipboard::clipboard_has_image() {
                                        Ok(true) => {
                                            eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard already has image, pasting");
                                            let _ = win_clipboard::paste_ctrl_v();
                                        }
                                        Ok(false) => {
                                            eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard has no image");
                                        }
                                        Err(e) => {
                                            eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard_has_image failed: {}", e);
                                        }
                                    }
                                }).await;
                                return;
                            }

                            let _ = tauri::async_runtime::spawn_blocking(move || {
                                let mut ok = false;
                                let mut should_restore_text = false;

                                // If the user already copied an image (from Snipping Tool/Photos/etc),
                                // Ctrl+Shift+V should just paste it without touching the clipboard.
                                match win_clipboard::clipboard_has_image() {
                                    Ok(true) => {
                                        eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard already has image, pasting");
                                        ok = true;
                                        should_restore_text = false;
                                    }
                                    Ok(false) => {}
                                    Err(e) => {
                                        eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard_has_image failed: {}", e);
                                    }
                                }

                                // If clipboard currently contains text, only proceed when that text is exactly
                                // the capture path (or a valid existing file path). Otherwise Ctrl+Shift+V should
                                // do nothing so we don't hijack normal text copy/paste.
                                if !ok {
                                    match win_clipboard::get_clipboard_text() {
                                        Ok(Some(s)) => {
                                            let picked = s
                                                .lines()
                                                .map(|l| l.trim())
                                                .find(|l| !l.is_empty())
                                                .unwrap_or("")
                                                .trim_matches('"')
                                                .to_string();
                                            if !picked.is_empty() {
                                                let is_pathish = picked.starts_with(r"\\")
                                                    || picked.contains(r":\")
                                                    || picked.contains(r":/")
                                                    || picked.starts_with('/');
                                                let exists = is_pathish && std::path::Path::new(&picked).is_file();
                                                let matches_last = !text_path.is_empty() && picked == text_path;
                                                if !(matches_last || exists) {
                                                    eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard text not a path, ignoring");
                                                    return;
                                                }
                                            }
                                        }
                                        Ok(None) => {}
                                        Err(_) => {}
                                    }
                                }

                                // Prefer pasting the actual image (bitmap) into apps.
                                if !ok {
                                    for _ in 0..16 {
                                        if win_clipboard::set_clipboard_image_from_file(&file_path).is_ok() {
                                            eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard image OK");
                                            ok = true;
                                            should_restore_text = true;
                                            break;
                                        }
                                        std::thread::sleep(std::time::Duration::from_millis(50));
                                    }
                                }

                                // Fallback: paste the file itself (CF_HDROP) if image format isn't accepted.
                                if !ok {
                                    for _ in 0..16 {
                                        if win_clipboard::set_clipboard_files(&[file_path.clone()]).is_ok() {
                                            eprintln!("[CaptureProKey] Ctrl+Shift+V: clipboard files OK");
                                            ok = true;
                                            should_restore_text = true;
                                            break;
                                        }
                                        std::thread::sleep(std::time::Duration::from_millis(50));
                                    }
                                }

                                if ok {
                                    if let Err(e) = win_clipboard::paste_ctrl_v() {
                                        eprintln!("[CaptureProKey] Ctrl+Shift+V: paste_ctrl_v failed: {}", e);
                                    } else {
                                        eprintln!("[CaptureProKey] Ctrl+Shift+V: paste_ctrl_v sent");
                                    }

                                    // Restore the path text so normal Ctrl+V still pastes the path afterwards,
                                    // but only if we actually overwrote the clipboard with file/image content.
                                    if should_restore_text && !text_path.is_empty() {
                                        std::thread::spawn(move || {
                                            std::thread::sleep(std::time::Duration::from_millis(1800));
                                            // Don't overwrite user's clipboard if they copied something meanwhile.
                                            // Only restore when clipboard doesn't currently have any text.
                                            match win_clipboard::get_clipboard_text() {
                                                Ok(Some(s)) if !s.trim().is_empty() => {
                                                    eprintln!("[CaptureProKey] Ctrl+Shift+V: skip restore (clipboard text changed)");
                                                }
                                                _ => {
                                                    let _ = win_clipboard::set_clipboard_text(&text_path);
                                                }
                                            }
                                        });
                                    }
                                } else {
                                    eprintln!("[CaptureProKey] Ctrl+Shift+V: failed to set clipboard payload");
                                }
                            }).await;
                        });
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        eprintln!("[CaptureProKey] Paste hotkey not supported on this OS");
                    }
                }
            })
            .build()
        )
        .setup(move |app| {
            app.manage(ClipboardState::default());
            app.manage(SettingsState::default());
            app.manage(OverlayTargetState::default());
            app.manage(DockState::default());
            app.manage(UiVisibilityState::default());

            // Close behavior: clicking X should exit the process (graceful shutdown).
            if let Some(main) = app.get_webview_window("main") {
                // Ensure a baseline min size exists immediately (frontend will override via set_main_min_size).
                set_main_min_size_value(MAIN_MIN_WIDTH_DEFAULT, MAIN_MIN_HEIGHT_DEFAULT);
                let (w, h) = get_main_min_size();
                let _ = main.set_min_size(Some(tauri::LogicalSize::new(w, h)));

                let main_for_event = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Allow the close request to proceed.
                        ALLOW_EXIT.store(true, Ordering::SeqCst);
                        let _ = api;
                    }

                    if let tauri::WindowEvent::Resized(_) = event {
                        // Hard-enforce min size on Windows; some resize paths can bypass min constraints.
                        enforce_main_min_size(&main_for_event);
                    }

                    if let tauri::WindowEvent::Moved(_) = event {
                        // Some Windows snap/drag paths can adjust size without a Resized event.
                        enforce_main_min_size(&main_for_event);
                    }
                });
            }

            // Tray icon (EVKey-style) so the app feels like a background service.
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                use tauri::tray::TrayIconBuilder;

                let show = MenuItem::with_id(app, "tray_show", "Show", true, None::<String>)?;
                let capture = MenuItem::with_id(app, "tray_capture", "Capture", true, None::<String>)?;
                let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<String>)?;
                let sep = PredefinedMenuItem::separator(app)?;
                let menu = Menu::with_items(app, &[&show, &capture, &sep, &quit])?;

                let tray = TrayIconBuilder::new()
                    .icon(tauri::include_image!("icons/32x32.png"))
                    .menu(&menu)
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| {
                        match event.id().as_ref() {
                            "tray_show" => {
                                if let Some(state) = app.try_state::<UiVisibilityState>() {
                                    if let Ok(mut hidden) = state.0.lock() {
                                        *hidden = false;
                                    }
                                }
                                if let Some(main) = app.get_webview_window("main") {
                                    if main.is_minimized().unwrap_or(false) {
                                        let _ = main.unminimize();
                                    }
                                    let _ = main.show();
                                    let _ = main.set_focus();
                                }
                            }
                            "tray_capture" => {
                                let app = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    show_overlay_impl(app).await;
                                });
                            }
                            "tray_quit" => {
                                ALLOW_EXIT.store(true, Ordering::SeqCst);
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { .. }) {
                            let app = tray.app_handle();
                            if let Some(main) = app.get_webview_window("main") {
                                if main.is_minimized().unwrap_or(false) {
                                    let _ = main.unminimize();
                                }
                                let _ = main.show();
                                let _ = main.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                // Keep the tray icon alive for the lifetime of the app.
                std::mem::forget(tray);
            }

            match app.global_shortcut().register(hotkey) {
                Ok(_) => eprintln!("[CaptureProKey] Shortcut Ctrl+Shift+Z registered OK"),
                Err(e) => eprintln!("[CaptureProKey] FAILED to register shortcut: {:?}", e),
            }
            match app.global_shortcut().register(paste_hotkey) {
                Ok(_) => eprintln!("[CaptureProKey] Shortcut Ctrl+Shift+V registered OK"),
                Err(e) => eprintln!("[CaptureProKey] FAILED to register paste shortcut: {:?}", e),
            }
            match app.global_shortcut().register(paste_hotkey_alt) {
                Ok(_) => eprintln!("[CaptureProKey] Shortcut Ctrl+Alt+V registered OK"),
                Err(e) => eprintln!("[CaptureProKey] FAILED to register Ctrl+Alt+V: {:?}", e),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            wsl::list_wsl_distros,
            wsl::list_wsl_directories,
            wsl::get_wsl_home_directory,
            wsl::windows_path_to_wsl,
            wsl::write_wsl_file,
            wsl::write_wsl_base64_file,
            wsl::queue_wsl_base64_write,
            wsl::list_wsl_image_files,
            wsl::read_wsl_image_as_base64,
            wsl::delete_wsl_file,
            local_fs::list_local_image_files,
            local_fs::read_local_image_as_base64,
            local_fs::delete_local_file,
            local_fs::queue_local_base64_write,
            local_fs::list_local_directories,
            local_fs::get_local_home_directory,
            windows_folder_picker::pick_windows_folder,
            capture::capture_full_screen,
            capture::capture_full_screen_preview,
            capture::capture_region,
            capture::capture_region_clean,
            settings_cache::set_settings_cache,
            debug_log,
            set_last_capture_paths,
            set_clipboard_files,
            set_clipboard_text,
            get_last_target_window_rect,
            close_overlay,
            show_overlay,
            set_always_on_top,
            hide_main_window,
            hide_main_window_user,
            show_main_window_user,
            toggle_dock_main_right,
            set_main_min_size,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
