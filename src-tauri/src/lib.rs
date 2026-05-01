mod wsl;
mod capture;
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

async fn show_overlay_impl(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
        let _ = overlay.emit("overlay-hide", ());
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
        let _ = overlay.emit("overlay-hide", ());
    }
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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &hotkey && event.state() == ShortcutState::Pressed {
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
                }
            })
            .build()
        )
        .setup(move |app| {
            match app.global_shortcut().register(hotkey) {
                Ok(_) => eprintln!("[CaptureProKey] Shortcut Ctrl+Shift+Z registered OK"),
                Err(e) => eprintln!("[CaptureProKey] FAILED to register shortcut: {:?}", e),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            wsl::list_wsl_distros,
            wsl::list_wsl_directories,
            wsl::get_wsl_home_directory,
            wsl::write_wsl_file,
            wsl::write_wsl_base64_file,
            wsl::list_wsl_image_files,
            wsl::read_wsl_image_as_base64,
            wsl::delete_wsl_file,
            capture::capture_full_screen,
            capture::capture_full_screen_preview,
            capture::capture_region,
            capture::capture_region_clean,
            close_overlay,
            show_overlay,
            set_always_on_top,
            hide_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
