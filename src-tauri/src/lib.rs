mod wsl;
mod capture;
mod local_fs;
mod windows_folder_picker;
mod settings_cache;
#[cfg(target_os = "windows")]
mod win_clipboard;
use tauri::Manager;
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use settings_cache::{SettingsState};

static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Default)]
struct LastCapture {
    text_path: String,
    file_path: Option<String>,
}

#[derive(Default)]
struct ClipboardState(Mutex<Option<LastCapture>>);

#[tauri::command]
fn set_last_capture_paths(state: tauri::State<'_, ClipboardState>, text_path: String, file_path: Option<String>) {
    if let Ok(mut guard) = state.0.lock() {
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
        let _ = main.hide();
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        // Prepare overlay for the next capture without doing heavy cleanup.
        // This ensures old selection/rectangle is cleared immediately.
        let _ = overlay.eval("window.__captureProPrepForShow && window.__captureProPrepForShow();");
        let _ = overlay.hide();
    }

    std::thread::sleep(std::time::Duration::from_millis(180));
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
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyZ);
    let paste_hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyV);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
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

                if shortcut == &paste_hotkey {
                    #[cfg(target_os = "windows")]
                    {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<ClipboardState>();
                            let last = state.0.lock().ok().and_then(|g| (*g).clone());
                            let Some(last) = last else { return; };
                            let Some(file_path) = last.file_path.clone() else { return; };
                            let text_path = last.text_path.clone();

                            let _ = tauri::async_runtime::spawn_blocking(move || {
                                let mut ok = false;

                                // Prefer pasting the actual image (bitmap) into apps.
                                for _ in 0..16 {
                                    if win_clipboard::set_clipboard_image_from_file(&file_path).is_ok() {
                                        ok = true;
                                        break;
                                    }
                                    std::thread::sleep(std::time::Duration::from_millis(50));
                                }

                                // Fallback: paste the file itself (CF_HDROP) if image format isn't accepted.
                                if !ok {
                                    for _ in 0..16 {
                                        if win_clipboard::set_clipboard_files(&[file_path.clone()]).is_ok() {
                                            ok = true;
                                            break;
                                        }
                                        std::thread::sleep(std::time::Duration::from_millis(50));
                                    }
                                }

                                if ok {
                                    let _ = win_clipboard::paste_ctrl_v();

                                    // Restore the path text so normal Ctrl+V still pastes the path afterwards.
                                    // Delay so the target app has time to read the clipboard payload.
                                    std::thread::spawn(move || {
                                        std::thread::sleep(std::time::Duration::from_millis(500));
                                        let _ = win_clipboard::set_clipboard_text(&text_path);
                                    });
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

            // Minimize-to-tray behavior: keep service running even when user closes the window.
            if let Some(main) = app.get_webview_window("main") {
                let main_window = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if !ALLOW_EXIT.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = main_window.hide();
                        }
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
                                if let Some(main) = app.get_webview_window("main") {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            wsl::list_wsl_distros,
            wsl::list_wsl_directories,
            wsl::get_wsl_home_directory,
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
            set_last_capture_paths,
            set_clipboard_files,
            set_clipboard_text,
            close_overlay,
            show_overlay,
            set_always_on_top,
            hide_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
